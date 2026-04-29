const PDFJS_REL = '../node_modules/pdfjs-dist/legacy/build/pdf.mjs';
const PDF_WORKER_REL = '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs';
/** 打包到 app.asar 后也需能正确解析 cmap 路径（pdf.worker / fetch） */
const PDF_CMAP_URL = new URL('../node_modules/pdfjs-dist/cmaps/', import.meta.url).href;

let pdfjsLib = null;
let pdfJsLoadPromise = null;

async function ensurePdfJsLib() {
  if (pdfjsLib) return pdfjsLib;
  if (!pdfJsLoadPromise) {
    pdfJsLoadPromise = (async () => {
      const mod = await import(PDFJS_REL);
      pdfjsLib = mod;
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(PDF_WORKER_REL, import.meta.url).href;
      return pdfjsLib;
    })().catch((err) => {
      pdfJsLoadPromise = null;
      throw err;
    });
  }
  return pdfJsLoadPromise;
}

/** 在渲染进程加载（esbuild 打包到 public/vendor），不得经 preload 传 Book 对象 */
const EPUBJS_REL = './vendor/epub-browser.mjs';

let ePubFactory = null;
let epubJsLoadPromise = null;

/** esbuild CJS→ESM 常出现 default 双层包装：{ default: function ePub(...) } */
function unwrapEpubDefaultExport(mod) {
  if (!mod) return undefined;
  let v = mod.default !== undefined ? mod.default : mod;
  if (typeof v === 'function') return v;
  if (v != null && typeof v.default === 'function') return v.default;
  return undefined;
}

async function ensureEpubJsLib() {
  if (ePubFactory) return ePubFactory;
  if (!epubJsLoadPromise) {
    epubJsLoadPromise = (async () => {
      let lastElectronErr = null;

      /** file:// 下对另一磁盘路径的 import() 常失败 → 由主进程读 public/vendor/epub-browser.mjs，再 Blob URL import */
      async function tryLoadViaMainProcessBlob() {
        const api = window.electronAPI;
        if (!api || typeof api.readEpubVendorBundle !== 'function') return undefined;
        const src = await api.readEpubVendorBundle();
        if (!src) return undefined;
        const blobUrl = URL.createObjectURL(
          new Blob([src], { type: 'application/javascript' })
        );
        try {
          const mod = await import(blobUrl);
          return unwrapEpubDefaultExport(mod);
        } finally {
          URL.revokeObjectURL(blobUrl);
        }
      }

      async function tryLoadViaRelativeImport() {
        const mod = await import(new URL(EPUBJS_REL, import.meta.url));
        return unwrapEpubDefaultExport(mod);
      }

      let fn;

      try {
        fn = await tryLoadViaMainProcessBlob();
      } catch (e) {
        lastElectronErr = e;
        console.warn('[epub] 主进程读盘 + Blob 导入失败:', e?.message || e);
      }

      if (typeof fn !== 'function') {
        try {
          fn = await tryLoadViaRelativeImport();
        } catch (e2) {
          throw new Error(
            (lastElectronErr && lastElectronErr.message) ||
              (e2 && e2.message) ||
              String(lastElectronErr || e2)
          );
        }
      }

      if (typeof fn !== 'function') {
        throw new Error('EPUB 模块未导出默认工厂函数');
      }

      ePubFactory = fn;
      return ePubFactory;
    })().catch((err) => {
      epubJsLoadPromise = null;
      throw err;
    });
  }
  return epubJsLoadPromise;
}

let pdfDoc = null;
let currentPage = 1;
let totalPages = 0;
let scale = 1.0;
let fitMode = 'width';
let currentPdfPath = null;
let currentBookmarks = [];
let currentToc = [];
let isLoading = false;
let savePositionTimer = null;
let currentShelfFiles = [];

/** 当前阅读器：none / pdf / epub */
let viewerKind = 'none';
let epubBook = null;
let epubRendition = null;
let epubZoomPercent = 110;

function getCssPixelRatio() {
  return window.devicePixelRatio || 1;
}

const dropZone = document.getElementById('dropZone');
const pdfContainer = document.getElementById('pdfContainer');
const epubContainer = document.getElementById('epubContainer');
const epubViewerMount = document.getElementById('epubViewer');
const shelfView = document.getElementById('shelfView');
const shelfGrid = document.getElementById('shelfGrid');
const shelfTitle = document.getElementById('shelfTitle');
const shelfEmpty = document.getElementById('shelfEmpty');
const openBtn = document.getElementById('openBtn');
const shelfBtn = document.getElementById('shelfBtn');
const backToShelfBtn = document.getElementById('backToShelfBtn');
const changeFolderBtn = document.getElementById('changeFolderBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const pageInput = document.getElementById('pageInput');
const totalPagesEl = document.getElementById('totalPages');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomLevelEl = document.getElementById('zoomLevel');
const fitWidthBtn = document.getElementById('fitWidthBtn');
const fitHeightBtn = document.getElementById('fitHeightBtn');
const tocBtn = document.getElementById('tocBtn');
const bookmarkBtn = document.getElementById('bookmarkBtn');
const showBookmarksBtn = document.getElementById('showBookmarksBtn');
const tocSidebar = document.getElementById('tocSidebar');
const tocList = document.getElementById('tocList');
const closeTocBtn = document.getElementById('closeTocBtn');
const bookmarkSidebar = document.getElementById('bookmarkSidebar');
const bookmarkList = document.getElementById('bookmarkList');
const closeBookmarkBtn = document.getElementById('closeBookmarkBtn');
const fileNameEl = document.getElementById('fileName');
const statusText = document.getElementById('statusText');
const bookmarkIndicator = document.getElementById('bookmarkIndicator');
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingText = document.getElementById('loadingText');
const toolbarReading = document.getElementById('toolbarReading');
const settingsBtn = document.getElementById('settingsBtn');
const settingsOverlay = document.getElementById('settingsOverlay');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const settingsBackdrop = document.getElementById('settingsBackdrop');
const bookmarkLabelOverlay = document.getElementById('bookmarkLabelOverlay');
const bookmarkLabelBackdrop = document.getElementById('bookmarkLabelBackdrop');
const bookmarkLabelInput = document.getElementById('bookmarkLabelInput');
const bookmarkLabelOkBtn = document.getElementById('bookmarkLabelOkBtn');
const bookmarkLabelCancelBtn = document.getElementById('bookmarkLabelCancelBtn');
const bookmarkLabelCloseBtn = document.getElementById('bookmarkLabelCloseBtn');

/**
 * 若曾在 index.html 中误粘贴 preload 片段或内联 script 被提早截断，
 * 源码可能以文本节点出现在 body/#app 顶部；按特征摘除，不影响正常排版。
 */
function stripAccidentalPreloadSourceTextNodes() {
  const looksLikePreloadLeak = (s) =>
    typeof s === 'string' &&
    s.length > 30 &&
    /\bipcRenderer\s*\.\s*invoke\s*\(\s*['"]remove-bookmark['"]/.test(s);

  const stripUnder = (parent) => {
    if (!parent) return;
    for (let ch = parent.firstChild; ch; ) {
      const next = ch.nextSibling;
      if (ch.nodeType === Node.TEXT_NODE && looksLikePreloadLeak(ch.textContent)) {
        ch.remove();
      } else if (
        ch.nodeType === Node.ELEMENT_NODE &&
        ch.children.length === 0 &&
        looksLikePreloadLeak(ch.textContent)
      ) {
        ch.remove();
      }
      ch = next;
    }
  };

  stripUnder(document.body);
  const appRoot = document.getElementById('app');
  stripUnder(appRoot);
}

stripAccidentalPreloadSourceTextNodes();

const THEME_IDS = ['midnight', 'graphite', 'ocean', 'amber', 'paper'];

/** 书架封面：固定外壳尺寸，缩略图在盒内按比例「适应」缩放，避免窄长页面撑成条状 */
const SHELF_COVER_BOX_CSS_W = 100;
const SHELF_COVER_BOX_CSS_H = 140;

function classifyPath(pathName) {
  const l = (pathName || '').toLowerCase();
  if (l.endsWith('.epub')) return 'epub';
  return 'pdf';
}

function toArrayBuffer(binary) {
  if (!binary) return binary;
  if (binary instanceof ArrayBuffer) return binary;
  const u8 = binary instanceof Uint8Array ? binary : new Uint8Array(binary);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

function escapeHtml(raw) {
  const d = document.createElement('div');
  d.textContent = raw == null ? '' : String(raw);
  return d.innerHTML;
}

/**
 * Electron / Chromium 中 window.prompt 常不可用或立即返回 null，必须用自定义对话框。
 * @param {string} defaultLabel
 * @returns {Promise<string|null>} 确定时为名称字符串；取消为 null
 */
function promptBookmarkLabel(defaultLabel) {
  const overlay = bookmarkLabelOverlay;
  const input = bookmarkLabelInput;
  const okBtn = bookmarkLabelOkBtn;
  const cancelBtn = bookmarkLabelCancelBtn;
  const closeBtn = bookmarkLabelCloseBtn;
  const backdrop = bookmarkLabelBackdrop;
  if (!overlay || !input || !okBtn || !cancelBtn || !closeBtn || !backdrop) {
    return Promise.resolve(defaultLabel);
  }

  return new Promise((resolve) => {
    input.value = defaultLabel;

    const cleanup = () => {
      overlay.classList.remove('visible');
      overlay.setAttribute('aria-hidden', 'true');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      closeBtn.removeEventListener('click', onCancel);
      backdrop.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKeydown);
    };

    const done = (value) => {
      cleanup();
      resolve(value);
    };

    const onOk = () => {
      const raw = input.value.trim();
      done(raw || defaultLabel);
    };

    const onCancel = () => done(null);

    const onKeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onOk();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };

    overlay.classList.add('visible');
    overlay.setAttribute('aria-hidden', 'false');

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    closeBtn.addEventListener('click', onCancel);
    backdrop.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKeydown);

    queueMicrotask(() => {
      try {
        input.focus();
        input.select();
      } catch (_) {}
    });
  });
}

function destroyEpubViewer() {
  if (epubRendition) {
    try {
      epubRendition.destroy();
    } catch (_) {}
    epubRendition = null;
  }
  if (epubBook) {
    try {
      epubBook.destroy();
    } catch (_) {}
    epubBook = null;
  }
  if (epubViewerMount) epubViewerMount.innerHTML = '';
}

function showLoading(text = '正在加载...') {
  loadingText.textContent = text;
  loadingOverlay.classList.add('active');
  isLoading = true;
}

function setLoadingMessage(text) {
  if (loadingText) loadingText.textContent = text;
}

function hideLoading() {
  loadingOverlay.classList.remove('active');
  isLoading = false;
}

function showPdfView() {
  viewerKind = 'pdf';
  dropZone.classList.add('hidden');
  shelfView.classList.remove('active');
  pdfContainer.classList.add('active');
  if (epubContainer) {
    epubContainer.classList.remove('active');
    epubContainer.setAttribute('aria-hidden', 'true');
  }
  tocSidebar.classList.remove('active');
  bookmarkSidebar.classList.remove('active');
  backToShelfBtn.classList.remove('hidden');
  if (toolbarReading) toolbarReading.classList.remove('hidden');
  fileNameEl.classList.remove('hidden');
  enablePdfControls(true);
  setReadingNavChrome(true);
}

function showShelfView() {
  viewerKind = 'none';
  destroyEpubViewer();
  pdfContainer.classList.remove('active');
  if (epubContainer) {
    epubContainer.classList.remove('active');
    epubContainer.setAttribute('aria-hidden', 'true');
  }
  dropZone.classList.add('hidden');
  shelfView.classList.add('active');
  tocSidebar.classList.remove('active');
  bookmarkSidebar.classList.remove('active');
  backToShelfBtn.classList.add('hidden');
  if (toolbarReading) toolbarReading.classList.add('hidden');
  fileNameEl.classList.add('hidden');
  enablePdfControls(false);
  setReadingNavChrome(false);
}

function showWelcome() {
  viewerKind = 'none';
  destroyEpubViewer();
  dropZone.classList.remove('hidden');
  shelfView.classList.remove('active');
  pdfContainer.classList.remove('active');
  if (epubContainer) {
    epubContainer.classList.remove('active');
    epubContainer.setAttribute('aria-hidden', 'true');
  }
  tocSidebar.classList.remove('active');
  bookmarkSidebar.classList.remove('active');
  backToShelfBtn.classList.add('hidden');
  if (toolbarReading) toolbarReading.classList.add('hidden');
  fileNameEl.classList.add('hidden');
  enablePdfControls(false);
  setReadingNavChrome(false);
}

function showEpubReaderView() {
  viewerKind = 'epub';
  dropZone.classList.add('hidden');
  shelfView.classList.remove('active');
  pdfContainer.classList.remove('active');
  if (epubContainer) {
    epubContainer.classList.add('active');
    epubContainer.setAttribute('aria-hidden', 'false');
  }
  tocSidebar.classList.remove('active');
  bookmarkSidebar.classList.remove('active');
  backToShelfBtn.classList.remove('hidden');
  if (toolbarReading) toolbarReading.classList.remove('hidden');
  fileNameEl.classList.remove('hidden');
  epubToolbarState();
  setReadingNavChrome(true);
}

function epubToolbarState() {
  prevBtn.disabled = !epubRendition;
  nextBtn.disabled = !epubRendition;
  pageInput.disabled = true;
  pageInput.placeholder = '—';
  zoomInBtn.disabled = !epubRendition;
  zoomOutBtn.disabled = !epubRendition;
  fitWidthBtn.disabled = !epubRendition;
  fitHeightBtn.disabled = !epubRendition;
  tocBtn.disabled = !epubBook;
  bookmarkBtn.disabled = !epubRendition;
  showBookmarksBtn.disabled = !currentPdfPath;
  zoomLevelEl.disabled = !epubRendition;
  updateZoomLevelField();
}

function updateEpubPageLabel() {
  if (!epubRendition) return;
  const loc = epubRendition.currentLocation?.();
  const cur = loc?.start?.displayed?.page;
  const total = loc?.start?.displayed?.total;
  if (cur != null && total != null) {
    totalPagesEl.textContent = String(total);
    pageInput.value = String(cur);
  } else {
    totalPagesEl.textContent = '—';
    pageInput.value = '';
  }
}

function enablePdfControls(enable) {
  prevBtn.disabled = !enable;
  nextBtn.disabled = !enable;
  pageInput.disabled = !enable;
  zoomInBtn.disabled = !enable;
  zoomOutBtn.disabled = !enable;
  fitWidthBtn.disabled = !enable;
  fitHeightBtn.disabled = !enable;
  tocBtn.disabled = !enable;
  bookmarkBtn.disabled = !enable;
  showBookmarksBtn.disabled = !enable;
  zoomLevelEl.disabled = !enable;
}

function isCurrentPageBookmarked() {
  if (viewerKind === 'epub') {
    const cfi = epubRendition?.currentLocation?.()?.start?.cfi;
    if (!cfi) return false;
    return currentBookmarks.some((b) => b.cfi && b.cfi === cfi);
  }
  return currentBookmarks.some(
    (b) => b.page != null && Number(b.page) === Number(currentPage)
  );
}

function updateBookmarkIndicator() {
  if (isCurrentPageBookmarked()) {
    bookmarkIndicator.classList.remove('hidden');
  } else {
    bookmarkIndicator.classList.add('hidden');
  }
}

function getToolbarHeight() {
  const toolbar = document.querySelector('.toolbar');
  const statusbar = document.querySelector('.statusbar');
  return toolbar.offsetHeight + statusbar.offsetHeight;
}

function syncThemeSelection(themeId) {
  const id = THEME_IDS.includes(themeId) ? themeId : 'midnight';
  document.querySelectorAll('.theme-row').forEach((row) => {
    const sel = row.dataset.theme === id;
    row.classList.toggle('is-selected', sel);
    row.setAttribute('aria-selected', sel ? 'true' : 'false');
  });
}

function applyThemeVisual(themeId) {
  const id = THEME_IDS.includes(themeId) ? themeId : 'midnight';
  document.documentElement.setAttribute('data-theme', id);
  syncThemeSelection(id);
}

function openSettings() {
  if (!settingsOverlay) return;
  const raw = document.documentElement.getAttribute('data-theme');
  const t = THEME_IDS.includes(raw) ? raw : 'midnight';
  syncThemeSelection(t);
  settingsOverlay.classList.add('visible');
  settingsOverlay.setAttribute('aria-hidden', 'false');
}

function closeSettings() {
  if (!settingsOverlay) return;
  settingsOverlay.classList.remove('visible');
  settingsOverlay.setAttribute('aria-hidden', 'true');
}

async function initThemeFromStorage() {
  try {
    const t = await window.electronAPI.getTheme();
    applyThemeVisual(t);
  } catch (e) {
    applyThemeVisual('midnight');
  }
}

async function loadDeferredOutline() {
  const doc = pdfDoc;
  if (!doc) return;
  try {
    const outline = await doc.getOutline();
    if (pdfDoc !== doc) return;
    currentToc = await parseOutline(outline, doc);
    if (pdfDoc !== doc) return;
  } catch (e) {
    console.log('Outline unavailable:', e);
    currentToc = [];
  }
  updateTocButton();
}

async function loadPDF(data, filePath = null) {
  try {
    showLoading('正在解析 PDF…');
    destroyEpubViewer();
    await ensurePdfJsLib();

    if (pdfDoc) {
      pdfDoc.destroy();
      pdfDoc = null;
    }

    const loadingTask = pdfjsLib.getDocument({
      data,
      cMapUrl: PDF_CMAP_URL,
      cMapPacked: true
    });

    loadingTask.onProgress = (evt) => {
      if (!isLoading || !evt) return;
      const loaded = evt.loaded ?? 0;
      const total = evt.total ?? 0;
      if (total > 0) {
        const pct = Math.min(99, Math.round((100 * loaded) / total));
        setLoadingMessage(`正在解析 PDF… ${pct}%`);
      } else {
        setLoadingMessage('正在解析 PDF…');
      }
    };

    pdfDoc = await loadingTask.promise;
    totalPages = pdfDoc.numPages;
    totalPagesEl.textContent = totalPages;
    currentPdfPath = filePath;

    let startPage = 1;
    if (filePath) {
      const [savedPosition, bookmarks] = await Promise.all([
        window.electronAPI.getReadingPosition(filePath),
        window.electronAPI.getBookmarks(filePath)
      ]);
      if (typeof savedPosition === 'number') {
        startPage = Math.max(1, Math.floor(savedPosition));
      }
      currentBookmarks = bookmarks || [];
    } else {
      currentBookmarks = [];
    }

    currentPage = startPage;
    currentToc = [];

    showPdfView();
    setLoadingMessage('正在渲染页面…');

    await renderPage(currentPage);
    updateUI();
    updateBookmarkIndicator();
    updateTocButton();

    hideLoading();
    statusText.textContent = `已打开 · 共 ${totalPages} 页`;

    loadDeferredOutline().catch((e) =>
      console.warn('Deferred outline:', e)
    );
  } catch (error) {
    console.error('Error loading PDF:', error);
    hideLoading();
    statusText.textContent = '加载失败: ' + error.message;
    setReadingNavChrome(false);
  }
}

async function loadEPUB(binary, filePath = null) {
  try {
    let ePub;
    try {
      ePub = await ensureEpubJsLib();
    } catch (loadErr) {
      hideLoading();
      statusText.textContent =
        '无法加载 EPUB 引擎（请确认 public/vendor/epub-browser.mjs 存在，可执行 npm run bundle:epub；若仍失败请看终端 [read-epub-vendor-bundle] 日志）：' +
        (loadErr && loadErr.message ? loadErr.message : String(loadErr));
      return;
    }

    showLoading('正在打开 EPUB…');
    destroyEpubViewer();

    if (pdfDoc) {
      pdfDoc.destroy();
      pdfDoc = null;
    }

    viewerKind = 'epub';
    setLoadingMessage('正在解析电子书包…');

    const ab =
      binary instanceof ArrayBuffer ? binary : toArrayBuffer(binary);
    /** 禁止 openAs:'epub'：会把 ArrayBuffer 当 URL 去 fetch，ready 永远不结束 */
    epubBook = ePub(ab, {
      replacements: 'blobUrl'
    });

    await epubBook.ready;

    currentPdfPath = filePath;

    let startCfi = null;
    currentBookmarks = [];
    if (filePath) {
      const [saved, bookmarks] = await Promise.all([
        window.electronAPI.getReadingPosition(filePath),
        window.electronAPI.getBookmarks(filePath)
      ]);
      if (typeof saved === 'string' && saved.startsWith('epubcfi(')) startCfi = saved;
      currentBookmarks = bookmarks || [];
    }

    showEpubReaderView();
    if (!epubViewerMount) throw new Error('缺少 EPUB 容器');
    epubViewerMount.innerHTML = '';

    setLoadingMessage('正在排版…');

    epubRendition = epubBook.renderTo(epubViewerMount, {
      width: '100%',
      height: '100%',
      flow: 'paginated',
      spread: 'auto'
    });

    try {
      epubRendition.themes.fontSize(`${epubZoomPercent}%`);
    } catch (_) {}

    epubRendition.on('relocated', () => {
      if (currentPdfPath) {
        const loc = epubRendition.currentLocation?.();
        const cfi = loc?.start?.cfi;
        if (cfi) {
          window.electronAPI.saveReadingPosition(currentPdfPath, cfi);
        }
      }
      updateEpubPageLabel();
      updateBookmarkIndicator();
    });

    await epubRendition.display(startCfi || undefined);

    hideLoading();
    updateEpubPageLabel();
    epubToolbarState();
    updateBookmarkIndicator();
    statusText.textContent =
      currentPdfPath && filePath != null ? `EPUB · ${extractBaseName(filePath)}` : '已打开 EPUB';
  } catch (err) {
    console.error('loadEPUB', err);
    hideLoading();
    viewerKind = 'none';
    destroyEpubViewer();
    setReadingNavChrome(false);
    statusText.textContent = `EPUB 加载失败：${err && err.message ? err.message : String(err)}`;
  }
}

function extractBaseName(p) {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || '';
}

async function parseOutline(outline, pdf) {
  const result = [];

  async function resolveItemDestToPage(item) {
    let page = 1;
    if (!item || !item.dest) return page;
    try {
      const dest =
        typeof item.dest === 'string'
          ? await pdf.getDestination(item.dest)
          : item.dest;
      if (dest && dest.length) {
        const pageIdx = await pdf.getPageIndex(dest[0]);
        if (typeof pageIdx === 'number' && pageIdx >= 0) {
          page = pageIdx + 1;
        }
      }
    } catch (e) {
      console.warn('大纲条目解析目标页失败:', e);
    }
    return page;
  }

  async function walk(items) {
    if (!items || !items.length) return;
    for (const item of items) {
      const page = await resolveItemDestToPage(item);
      if (item.title) {
        result.push({
          title: item.title,
          page
        });
      }
      if (item.items && item.items.length) {
        await walk(item.items);
      }
    }
  }

  await walk(outline || []);
  return result;
}

async function linkAnnotationDestToPage(annotation, pdf) {
  if (!annotation.dest) return null;
  try {
    const dest =
      typeof annotation.dest === 'string'
        ? await pdf.getDestination(annotation.dest)
        : annotation.dest;
    if (dest && dest.length) {
      const idx = await pdf.getPageIndex(dest[0]);
      if (typeof idx === 'number' && idx >= 0) return idx + 1;
    }
  } catch (e) {}
  if (typeof annotation.pageNumber === 'number') return annotation.pageNumber;
  return null;
}

async function loadTocForPage(pageNum) {
  if (!pdfDoc) return [];

  try {
    const page = await pdfDoc.getPage(pageNum);
    const annotations = await page.getAnnotations();
    const links = annotations.filter((a) => a.subtype === 'Link' && a.dest);

    if (!links.length) return [];

    const out = [];
    for (const ann of links) {
      const targetPage = await linkAnnotationDestToPage(ann, pdfDoc);
      if (targetPage != null) {
        out.push({
          title: ann.title || `第 ${targetPage} 页`,
          page: targetPage
        });
      }
    }
    return out;
  } catch (e) {
    console.log('Error loading TOC:', e);
  }

  return [];
}

async function renderPage(pageNum) {
  if (!pdfDoc) return;

  try {
    await ensurePdfJsLib();

    const page = await pdfDoc.getPage(pageNum);
    const viewportBase = page.getViewport({ scale: 1 });

    const containerWidth = pdfContainer.clientWidth - 40;
    const containerHeight = pdfContainer.clientHeight - 40;
    const toolbarHeight = getToolbarHeight();

    let baseScaleFactor = scale;

    if (fitMode === 'width') {
      baseScaleFactor = containerWidth / viewportBase.width;
    } else if (fitMode === 'height') {
      baseScaleFactor = (containerHeight - toolbarHeight) / viewportBase.height;
    }

    const cssScale = baseScaleFactor * 0.98;
    const dpr = getCssPixelRatio();
    const cssViewport = page.getViewport({ scale: cssScale });
    const renderViewport = page.getViewport({ scale: cssScale * dpr });

    pdfContainer.innerHTML = '';
    // 适应宽度/高度时可滚动查看画布外的区域（长页纵向、宽页横向）
    pdfContainer.style.overflow = 'auto';

    const wrapper = document.createElement('div');
    wrapper.className = 'pdf-page-wrapper';

    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-page';
    const context = canvas.getContext('2d', { alpha: false });

    canvas.width = Math.floor(renderViewport.width);
    canvas.height = Math.floor(renderViewport.height);

    canvas.style.width = Math.ceil(cssViewport.width) + 'px';
    canvas.style.height = Math.ceil(cssViewport.height) + 'px';

    wrapper.appendChild(canvas);
    pdfContainer.appendChild(wrapper);

    await page.render({
      canvasContext: context,
      viewport: renderViewport
    }).promise;
  } catch (error) {
    console.error('Error rendering page:', error);
    statusText.textContent = '页面渲染失败';
  }
}

function scheduleSavePosition() {
  if (viewerKind !== 'pdf') return;
  if (savePositionTimer) {
    clearTimeout(savePositionTimer);
  }
  savePositionTimer = setTimeout(() => {
    if (currentPdfPath && currentPage) {
      window.electronAPI.saveReadingPosition(currentPdfPath, currentPage);
    }
  }, 1000);
}

function goToPage(pageNum) {
  if (!pdfDoc || viewerKind !== 'pdf') return;

  if (pageNum < 1) pageNum = 1;
  if (pageNum > totalPages) pageNum = totalPages;

  currentPage = pageNum;
  renderPage(currentPage).catch((err) => console.error(err));
  updateUI();
  updateBookmarkIndicator();
  scheduleSavePosition();
}

function updateZoomLevelField() {
  if (!zoomLevelEl) return;
  if (viewerKind === 'epub') {
    zoomLevelEl.value = epubRendition ? `${epubZoomPercent}%` : '—';
    return;
  }
  if (!pdfDoc) {
    zoomLevelEl.value = '100%';
    return;
  }
  const pct = Math.round(
    fitMode === 'width' || fitMode === 'height' ? 100 : scale * 100
  );
  zoomLevelEl.value = `${pct}%`;
}

function applyZoomPercentFromInput() {
  const raw = (zoomLevelEl.value || '').trim();
  const normalized = raw.replace(/%/g, '').replace(/\s/g, '').replace(/,/g, '');
  const n = parseFloat(normalized);
  if (!Number.isFinite(n) || n <= 0) {
    updateZoomLevelField();
    return;
  }
  let pct = Math.round(n);

  if (viewerKind === 'epub') {
    if (!epubRendition) {
      updateZoomLevelField();
      return;
    }
    epubZoomPercent = Math.min(220, Math.max(60, pct));
    try {
      epubRendition.themes.fontSize(`${epubZoomPercent}%`);
    } catch (_) {}
    updateZoomLevelField();
    return;
  }

  if (viewerKind !== 'pdf' || !pdfDoc) {
    updateZoomLevelField();
    return;
  }

  pct = Math.min(500, Math.max(25, pct));
  scale = pct / 100;
  fitMode = 'custom';
  void renderPage(currentPage)
    .then(() => {
      updateUI();
    })
    .catch((err) => console.error(err));
}

function updateUI() {
  if (viewerKind === 'epub') {
    updateEpubPageLabel();
    return;
  }
  if (!pdfDoc) {
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    updateZoomLevelField();
    return;
  }

  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;
  pageInput.value = currentPage;
  updateZoomLevelField();
}

function updateTocButton() {
  if (viewerKind === 'epub') {
    tocBtn.disabled = !epubBook;
  } else {
    tocBtn.disabled = !pdfDoc;
  }
}

function zoom(direction) {
  if (viewerKind === 'epub') {
    if (!epubRendition) return;
    if (direction === 'in') epubZoomPercent = Math.min(epubZoomPercent + 10, 220);
    else if (direction === 'out') epubZoomPercent = Math.max(epubZoomPercent - 10, 60);
    else if (direction === 'fit-width' || direction === 'fit-height') epubZoomPercent = 110;
    try {
      epubRendition.themes.fontSize(`${epubZoomPercent}%`);
    } catch (_) {}
    updateZoomLevelField();
    return;
  }
  if (!pdfDoc) return;

  if (direction === 'in') {
    scale = Math.min(scale + 0.25, 5.0);
    fitMode = 'custom';
  } else if (direction === 'out') {
    scale = Math.max(scale - 0.25, 0.25);
    fitMode = 'custom';
  } else if (direction === 'fit-width') {
    fitMode = 'width';
  } else if (direction === 'fit-height') {
    fitMode = 'height';
  }

  renderPage(currentPage).catch((err) => console.error(err));
  updateUI();
}

async function renderEpubNavigation() {
  tocList.innerHTML = '<div class="toc-loading">正在加载 EPUB 目录…</div>';
  try {
    if (!epubBook || !epubRendition) {
      tocList.innerHTML = '<div class="toc-empty">未打开电子书</div>';
      return;
    }

    await epubBook.loaded.navigation;
    const root = epubBook.navigation?.toc;
    const items = flattenEpubToc(root || []);

    tocList.innerHTML = '';
    if (items.length === 0) {
      tocList.innerHTML = '<div class="toc-empty">本书暂无目录导航</div>';
      return;
    }

    items.forEach((entry) => {
      const div = document.createElement('div');
      div.className = 'toc-item';
      div.innerHTML = `
        <span class="toc-item-title">${escapeHtml(entry.title)}</span>
      `;
      div.addEventListener('click', async () => {
        try {
          await epubRendition.display(entry.href);
          tocSidebar.classList.remove('active');
        } catch (e) {
          statusText.textContent = '跳转失败';
        }
      });
      tocList.appendChild(div);
    });
  } catch (e) {
    tocList.innerHTML = `<div class="toc-empty">目录加载失败</div>`;
  }
}

function flattenEpubToc(nodes) {
  const out = [];
  const walk = (list) => {
    for (const n of list || []) {
      if (n.label) {
        out.push({
          title: stripMarkup(String(n.label)),
          href: n.href
        });
      }
      if (n.subitems && n.subitems.length) walk(n.subitems);
    }
  };
  walk(nodes);
  return out.filter((it) => it.href);
}

function stripMarkup(s) {
  return String(s).replace(/<[^>]*>/gi, '').trim();
}

/** 阅读书籍时隐藏「打开」「书架」工具栏按钮，并同步系统菜单栏「文件」中的对应项 */
function setReadingNavChrome(reading) {
  const hide = !!reading;
  if (openBtn) openBtn.classList.toggle('hidden', hide);
  if (shelfBtn) shelfBtn.classList.toggle('hidden', hide);
  try {
    if (window.electronAPI && typeof window.electronAPI.setReadingMode === 'function') {
      void window.electronAPI.setReadingMode(hide);
    }
  } catch (_) {}
}

function renderToc() {
  if (viewerKind === 'epub') {
    void renderEpubNavigation();
    return;
  }

  tocList.innerHTML = '<div class="toc-loading">正在加载目录...</div>';

  setTimeout(async () => {
    if (currentToc.length === 0) {
      const pageToc = await loadTocForPage(currentPage);
      if (pageToc.length > 0) {
        renderTocItems(pageToc);
      } else {
        tocList.innerHTML =
          '<div class="toc-empty">该 PDF 没有目录<br>尝试点击页面跳转</div>';
      }
    } else {
      renderTocItems(currentToc);
    }
  }, 100);
}

function renderTocItems(items) {
  tocList.innerHTML = '';

  if (items.length === 0) {
    tocList.innerHTML = '<div class="toc-empty">该 PDF 没有目录</div>';
    return;
  }

  items.forEach((item) => {
    const div = document.createElement('div');
    div.className = 'toc-item';
    div.innerHTML = `
      <span class="toc-item-title">${item.title}</span>
      <span class="toc-item-page">${item.page}</span>
    `;
    div.addEventListener('click', () => {
      const n = Number(item.page);
      goToPage(Number.isFinite(n) ? n : 1);
      tocSidebar.classList.remove('active');
    });
    tocList.appendChild(div);
  });
}

function renderBookmarks() {
  bookmarkList.innerHTML = '';

  if (currentBookmarks.length === 0) {
    bookmarkList.innerHTML = '<div class="bookmark-empty">暂无书签<br>按 Cmd/Ctrl+D 添加</div>';
    return;
  }

  currentBookmarks.forEach((bookmark) => {
    const item = document.createElement('div');
    item.className = 'bookmark-item';
    item.innerHTML = `
      <span class="bookmark-item-label">${bookmark.label}</span>
      <span class="bookmark-item-time">${new Date(bookmark.createdAt).toLocaleString()}</span>
      <button class="bookmark-item-delete" data-id="${bookmark.id}">删除</button>
    `;

    item.querySelector('.bookmark-item-label').addEventListener('click', () => {
      if (bookmark.cfi && epubRendition) {
        epubRendition.display(bookmark.cfi).catch(() => {});
      } else if (bookmark.page != null) {
        const p = Number(bookmark.page);
        goToPage(Number.isFinite(p) ? p : bookmark.page);
      }
      bookmarkSidebar.classList.remove('active');
    });

    item.querySelector('.bookmark-item-delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.electronAPI.removeBookmark(currentPdfPath, bookmark.id);
      currentBookmarks = currentBookmarks.filter(b => b.id !== bookmark.id);
      renderBookmarks();
      updateBookmarkIndicator();
    });

    bookmarkList.appendChild(item);
  });
}

async function addBookmark() {
  try {
    if (viewerKind === 'epub') {
      if (!epubRendition || !currentPdfPath) {
        statusText.textContent =
          '无法保存书签：请通过「打开」或书架打开电子书后再添加（需要磁盘路径才能写入书签库）。';
        return;
      }
      const loc = epubRendition.currentLocation?.();
      const cfi = loc?.start?.cfi;
      if (!cfi) return;
      const label = await promptBookmarkLabel('阅读位置');
      if (label === null) return;
      const bookmark = await window.electronAPI.addBookmark(currentPdfPath, { cfi }, label);
      currentBookmarks.push(bookmark);
      renderBookmarks();
      bookmarkSidebar.classList.add('active');
      tocSidebar.classList.remove('active');
      updateBookmarkIndicator();
      statusText.textContent = `已添加书签: ${label}`;
      return;
    }

    if (!pdfDoc) return;

    if (!currentPdfPath) {
      statusText.textContent =
        '无法保存书签：请通过「打开」或书架打开 PDF（拖拽的文件若无法解析路径则无法持久化书签）。';
      return;
    }

    const label = await promptBookmarkLabel(`第 ${currentPage} 页`);
    if (label === null) return;

    const pageNum = Number(currentPage);
    const bookmark = await window.electronAPI.addBookmark(
      currentPdfPath,
      Number.isFinite(pageNum) ? pageNum : currentPage,
      label
    );
    currentBookmarks.push(bookmark);
    renderBookmarks();
    bookmarkSidebar.classList.add('active');
    tocSidebar.classList.remove('active');
    updateBookmarkIndicator();
    statusText.textContent = `已添加书签: ${label}`;
  } catch (err) {
    console.error('addBookmark', err);
    statusText.textContent =
      '书签保存失败：' + (err && err.message ? err.message : String(err));
  }
}

async function renderShelfWithCovers(files) {
  shelfGrid.innerHTML = '';

  if (files.length === 0) {
    shelfEmpty.classList.add('active');
    return;
  }

  shelfEmpty.classList.remove('active');
  currentShelfFiles = files;

  for (const file of files) {
    const isEpub = file.name.toLowerCase().endsWith('.epub');
    const item = document.createElement('div');
    item.className = 'shelf-item';
    const coverInner = isEpub
      ? `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
        <path d="M12 8h8"/>
      </svg>
    `
      : `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
      </svg>
    `;
    item.innerHTML = `
      <div class="shelf-item-cover${isEpub ? ' shelf-item-cover-epub' : ''}" data-path="${file.path}" data-format="${isEpub ? 'epub' : 'pdf'}">
        ${coverInner}
      </div>
      <span class="shelf-item-title">${escapeHtml(file.name)}</span>
      <span class="shelf-item-progress" data-path="${file.path}"></span>
    `;

    item.addEventListener('click', async () => {
      const kind = classifyPath(file.path);
      showLoading(kind === 'epub' ? '正在打开 EPUB…' : '正在读取 PDF…');
      const bookData = await window.electronAPI.readBookFile(file.path);
      if (bookData) {
        fileNameEl.textContent = file.name;
        if (kind === 'epub') {
          await loadEPUB(bookData.data, file.path);
        } else {
          await loadPDF(bookData.data, file.path);
        }
      } else {
        hideLoading();
        statusText.textContent = '加载失败';
      }
    });

    shelfGrid.appendChild(item);
  }

  renderCoversForVisibleItems();
  updateReadingProgress();
}

async function renderEpubShelfCover(coverEl, filePath) {
  let ePub;
  try {
    ePub = await ensureEpubJsLib();
  } catch (e) {
    console.warn('EPUB engine unavailable for shelf covers:', e);
    return;
  }

  let book = null;
  try {
    const res = await window.electronAPI.readBookFile(filePath);
    if (!res?.data) return;

    const ab = toArrayBuffer(res.data);
    book = ePub(ab, {
      replacements: 'blobUrl'
    });
    await book.ready;

    let coverHref = null;
    try {
      coverHref = await book.coverUrl();
    } catch (_) {
      coverHref = null;
    }

    const finishBook = () => {
      try {
        book.destroy();
      } catch (_) {}
      book = null;
    };

    if (!coverHref) {
      finishBook();
      return;
    }

    const img = document.createElement('img');
    img.className = 'shelf-epub-cover shelf-cover-img';
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';

    img.onload = () => finishBook();
    img.onerror = () => finishBook();

    img.src = coverHref;

    coverEl.innerHTML = '';
    coverEl.appendChild(img);

    img.decode?.().catch(() => {});
  } catch (e) {
    console.log('renderEpubShelfCover', filePath, e);
    try {
      book?.destroy?.();
    } catch (_) {}
  }
}

async function renderCoversForVisibleItems() {
  const items = shelfGrid.querySelectorAll('.shelf-item-cover[data-path]');
  const coverCache = {};

  let pdfJsReadyPromise = null;
  async function ensurePdfJsForCovers() {
    if (!pdfJsReadyPromise) {
      pdfJsReadyPromise = ensurePdfJsLib();
    }
    return pdfJsReadyPromise;
  }

  for (const coverEl of items) {
    const filePath = coverEl.dataset.path;
    if (coverCache[filePath]) continue;

    const lower = (filePath || '').toLowerCase();

    if (lower.endsWith('.epub')) {
      if (coverEl.querySelector('img.shelf-epub-cover')) {
        coverCache[filePath] = true;
        continue;
      }
      await renderEpubShelfCover(coverEl, filePath);
      coverCache[filePath] = true;
      continue;
    }

    try {
      await ensurePdfJsForCovers();
    } catch (e) {
      console.warn('PDF engine unavailable for shelf covers:', e);
      return;
    }

    if (coverEl.querySelector('canvas.shelf-cover-canvas')) {
      coverCache[filePath] = true;
      continue;
    }

    try {
      const pdfData = await window.electronAPI.readPdfFile(filePath);
      if (pdfData) {
        const loadingTask = pdfjsLib.getDocument({ data: pdfData.data });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);
        const dpr = Math.min(getCssPixelRatio(), 2);
        const baseVp = page.getViewport({ scale: 1 });
        const pw = baseVp.width;
        const ph = baseVp.height;
        const scaleCss = Math.min(
          SHELF_COVER_BOX_CSS_W / pw,
          SHELF_COVER_BOX_CSS_H / ph
        );
        const cssW = Math.max(1, Math.floor(pw * scaleCss));
        const cssH = Math.max(1, Math.floor(ph * scaleCss));

        const renderVp = page.getViewport({ scale: scaleCss * dpr });

        const canvas = document.createElement('canvas');
        canvas.className = 'shelf-cover-canvas';
        canvas.width = Math.max(1, Math.floor(renderVp.width));
        canvas.height = Math.max(1, Math.floor(renderVp.height));
        canvas.style.width = cssW + 'px';
        canvas.style.height = cssH + 'px';

        const context = canvas.getContext('2d', { alpha: false });

        await page.render({
          canvasContext: context,
          viewport: renderVp
        }).promise;

        coverEl.innerHTML = '';
        coverEl.appendChild(canvas);
        coverCache[filePath] = true;
        pdf.destroy();
      }
    } catch (e) {
      console.log('Error rendering cover for', filePath, e);
    }
  }
}

async function updateReadingProgress() {
  try {
    await ensurePdfJsLib();
  } catch (e) {
    return;
  }

  const items = shelfGrid.querySelectorAll('.shelf-item-progress[data-path]');

  for (const progressEl of items) {
    const filePath = progressEl.dataset.path;
    try {
      if (!(filePath || '').toLowerCase().endsWith('.pdf')) {
        progressEl.textContent = '';
        continue;
      }
      const position = await window.electronAPI.getReadingPosition(filePath);
      if (position && typeof position === 'number') {
        const pdfData = await window.electronAPI.readPdfFile(filePath);
        if (pdfData) {
          const loadingTask = pdfjsLib.getDocument({ data: pdfData.data });
          const pdf = await loadingTask.promise;
          const total = pdf.numPages;
          const percent = Math.round((position / total) * 100);
          progressEl.textContent = `已读 ${percent}%`;
          pdf.destroy();
        }
      } else {
        progressEl.textContent = '';
      }
    } catch (e) {
      progressEl.textContent = '';
    }
  }
}

function renderShelf(files) {
  shelfGrid.innerHTML = '';

  if (files.length === 0) {
    shelfEmpty.classList.add('active');
    return;
  }

  shelfEmpty.classList.remove('active');
  currentShelfFiles = files;

  files.forEach((file) => {
    const item = document.createElement('div');
    item.className = 'shelf-item';
    item.innerHTML = `
      <div class="shelf-item-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
      </div>
      <span class="shelf-item-title">${file.name}</span>
    `;

    item.addEventListener('click', async () => {
      showLoading('正在读取文件…');
      const pdfData = await window.electronAPI.readPdfFile(file.path);
      if (pdfData) {
        fileNameEl.textContent = file.name;
        loadPDF(pdfData.data, file.path);
      } else {
        hideLoading();
        statusText.textContent = '加载失败';
      }
    });

    shelfGrid.appendChild(item);
  });
}

function setupEventListeners() {
  if (typeof window.electronAPI === 'undefined') {
    console.error('window.electronAPI is not defined');
    statusText.textContent = 'preload 未注入：请使用 Electron 启动（不要用浏览器直接打开 index.html）。';
    return;
  }

  void initThemeFromStorage();
  window.electronAPI.onThemeChanged((id) => applyThemeVisual(id));

  if (settingsBtn) settingsBtn.addEventListener('click', () => openSettings());
  if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeSettings);
  if (settingsBackdrop) settingsBackdrop.addEventListener('click', closeSettings);

  document.querySelectorAll('.theme-row').forEach((row) => {
    row.addEventListener('click', async () => {
      const id = row.dataset.theme;
      if (!THEME_IDS.includes(id)) return;
      try {
        await window.electronAPI.setTheme(id);
      } catch (e) {
        console.error(e);
      }
    });
  });

  const requiredRefs = [
    ['openBtn', openBtn],
    ['shelfBtn', shelfBtn],
    ['dropZone', dropZone]
  ];
  for (const [name, el] of requiredRefs) {
    if (!el) {
      console.error(`Missing DOM element: ${name}`);
      statusText.textContent = '界面元素加载不完整，无法绑定按钮。';
      return;
    }
  }

  openBtn.addEventListener('click', () => {
    window.electronAPI.openFileDialog();
  });

  shelfBtn.addEventListener('click', () => {
    window.electronAPI.openFolderDialog();
  });

  backToShelfBtn.addEventListener('click', () => {
    showShelfView();
  });

  changeFolderBtn.addEventListener('click', () => {
    window.electronAPI.openFolderDialog();
  });

  prevBtn.addEventListener('click', () => {
    if (viewerKind === 'epub') {
      epubRendition?.prev?.();
      return;
    }
    goToPage(currentPage - 1);
  });

  nextBtn.addEventListener('click', () => {
    if (viewerKind === 'epub') {
      epubRendition?.next?.();
      return;
    }
    goToPage(currentPage + 1);
  });

  pageInput.addEventListener('change', (e) => {
    if (viewerKind !== 'pdf') return;
    const pageNum = parseInt(e.target.value, 10);
    if (!isNaN(pageNum)) {
      goToPage(pageNum);
    }
  });

  zoomInBtn.addEventListener('click', () => zoom('in'));
  zoomOutBtn.addEventListener('click', () => zoom('out'));
  fitWidthBtn.addEventListener('click', () => zoom('fit-width'));
  fitHeightBtn.addEventListener('click', () => zoom('fit-height'));

  zoomLevelEl.addEventListener('focus', () => {
    try {
      zoomLevelEl.select();
    } catch (_) {}
  });
  zoomLevelEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      zoomLevelEl.blur();
    }
  });
  zoomLevelEl.addEventListener('blur', () => {
    applyZoomPercentFromInput();
  });

  tocBtn.addEventListener('click', () => {
    renderToc();
    tocSidebar.classList.toggle('active');
    bookmarkSidebar.classList.remove('active');
  });

  bookmarkBtn.addEventListener('click', () => {
    addBookmark();
  });

  showBookmarksBtn.addEventListener('click', () => {
    renderBookmarks();
    bookmarkSidebar.classList.toggle('active');
    tocSidebar.classList.remove('active');
  });

  closeTocBtn.addEventListener('click', () => {
    tocSidebar.classList.remove('active');
  });

  closeBookmarkBtn.addEventListener('click', () => {
    bookmarkSidebar.classList.remove('active');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && bookmarkLabelOverlay?.classList.contains('visible')) {
      e.preventDefault();
      bookmarkLabelCancelBtn?.click();
      return;
    }
    if (e.key === 'Escape' && settingsOverlay?.classList.contains('visible')) {
      closeSettings();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
      e.preventDefault();
      addBookmark();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
      e.preventDefault();
      showShelfView();
      return;
    }
    if (e.target.tagName === 'INPUT') return;

    if (viewerKind === 'epub' && epubRendition) {
      if (e.key === 'ArrowLeft') {
        epubRendition.prev();
      } else if (e.key === 'ArrowRight') {
        epubRendition.next();
      }
      return;
    }

    if (!pdfDoc) return;

    if (e.key === 'ArrowLeft') {
      goToPage(currentPage - 1);
    } else if (e.key === 'ArrowRight') {
      goToPage(currentPage + 1);
    }
  });

  window.electronAPI.onFileOpened(async (data) => {
    if (!data) return;
    const kind = classifyPath(data.name);
    showLoading(kind === 'epub' ? '正在打开 EPUB…' : '正在读取 PDF…');
    const blob = await window.electronAPI.readBookFile(data.path);
    if (blob) {
      fileNameEl.textContent = data.name;
      if (kind === 'epub') {
        await loadEPUB(blob.data, data.path);
      } else {
        await loadPDF(blob.data, data.path);
      }
    } else {
      hideLoading();
      statusText.textContent = '读取文件失败';
    }
  });

  window.electronAPI.onFolderOpened((data) => {
    if (data) {
      shelfTitle.textContent = data.name;
      renderShelfWithCovers(data.files);
      showShelfView();
      statusText.textContent = `书架: ${data.files.length} 个图书文件`;
    }
  });

  window.electronAPI.onZoom((direction) => {
    zoom(direction);
  });

  window.electronAPI.onShowShelf(() => {
    showShelfView();
  });

  window.electronAPI.onAddBookmark(() => {
    addBookmark();
  });

  window.electronAPI.onToggleTocSidebar(() => {
    if (viewerKind === 'pdf' && !pdfDoc) {
      statusText.textContent = '请先打开 PDF 后再查看目录';
      return;
    }
    if (viewerKind === 'epub' && !epubBook) {
      statusText.textContent = '请先打开 EPUB 后再查看目录';
      return;
    }
    renderToc();
    tocSidebar.classList.toggle('active');
    bookmarkSidebar.classList.remove('active');
  });

  window.electronAPI.onToggleBookmarksSidebar(() => {
    if (!currentPdfPath) {
      statusText.textContent = '请先打开电子书后再查看书签';
      return;
    }
    renderBookmarks();
    bookmarkSidebar.classList.toggle('active');
    tocSidebar.classList.remove('active');
  });

  dropZone.addEventListener('click', () => {
    window.electronAPI.openFileDialog();
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      const ok =
        file.type === 'application/pdf' ||
        file.type === 'application/epub+zip' ||
        /\.pdf$/i.test(file.name) ||
        /\.epub$/i.test(file.name);
      if (ok) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const ab = event.target.result;
          fileNameEl.textContent = file.name;
          const kind = classifyPath(file.name);
          /** Electron 下从系统拖拽的文件通常带 path，便于书签/进度持久化 */
          const droppedPath = typeof file.path === 'string' && file.path.length > 0 ? file.path : null;
          if (kind === 'epub') {
            void loadEPUB(ab, droppedPath);
          } else {
            void loadPDF(ab, droppedPath);
          }
        };
        reader.readAsArrayBuffer(file);
      } else {
        statusText.textContent = '请选择 PDF 或 EPUB 文件';
      }
    }
  });

  window.addEventListener('resize', () => {
    if (viewerKind === 'epub' && epubRendition) {
      try {
        epubRendition.resize();
      } catch (_) {}
    } else if (pdfDoc) {
      renderPage(currentPage).catch((err) => console.error(err));
    }
    if (shelfView.classList.contains('active')) {
      renderCoversForVisibleItems().catch((err) => console.error(err));
    }
  });
}

function bootRenderer() {
  try {
    setupEventListeners();
  } catch (err) {
    console.error('bootRenderer:', err);
    const st = document.getElementById('statusText');
    if (st) st.textContent = '界面初始化失败：' + (err && err.message ? err.message : String(err));
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootRenderer);
} else {
  queueMicrotask(bootRenderer);
}
