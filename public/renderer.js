const PDFJS_REL = '../node_modules/pdfjs-dist/legacy/build/pdf.mjs';
const PDF_WORKER_REL = '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs';

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

function getCssPixelRatio() {
  return window.devicePixelRatio || 1;
}

const dropZone = document.getElementById('dropZone');
const pdfContainer = document.getElementById('pdfContainer');
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

const THEME_IDS = ['midnight', 'graphite', 'ocean', 'amber', 'paper'];

/** 书架封面：固定外壳尺寸，缩略图在盒内按比例「适应」缩放，避免窄长页面撑成条状 */
const SHELF_COVER_BOX_CSS_W = 100;
const SHELF_COVER_BOX_CSS_H = 140;

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
  dropZone.classList.add('hidden');
  shelfView.classList.remove('active');
  pdfContainer.classList.add('active');
  tocSidebar.classList.remove('active');
  bookmarkSidebar.classList.remove('active');
  backToShelfBtn.classList.remove('hidden');
  if (toolbarReading) toolbarReading.classList.remove('hidden');
  fileNameEl.classList.remove('hidden');
  enablePdfControls(true);
}

function showShelfView() {
  pdfContainer.classList.remove('active');
  dropZone.classList.add('hidden');
  shelfView.classList.add('active');
  tocSidebar.classList.remove('active');
  bookmarkSidebar.classList.remove('active');
  backToShelfBtn.classList.add('hidden');
  if (toolbarReading) toolbarReading.classList.add('hidden');
  fileNameEl.classList.add('hidden');
  enablePdfControls(false);
}

function showWelcome() {
  dropZone.classList.remove('hidden');
  shelfView.classList.remove('active');
  pdfContainer.classList.remove('active');
  tocSidebar.classList.remove('active');
  bookmarkSidebar.classList.remove('active');
  backToShelfBtn.classList.add('hidden');
  if (toolbarReading) toolbarReading.classList.add('hidden');
  fileNameEl.classList.add('hidden');
  enablePdfControls(false);
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
}

function isCurrentPageBookmarked() {
  return currentBookmarks.some(b => b.page === currentPage);
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
    await ensurePdfJsLib();

    if (pdfDoc) {
      pdfDoc.destroy();
      pdfDoc = null;
    }

    const loadingTask = pdfjsLib.getDocument({
      data,
      cMapUrl: '../node_modules/pdfjs-dist/cmaps/',
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
      if (savedPosition) {
        startPage = savedPosition;
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
  }
}

async function parseOutline(outline, pdf) {
  const result = [];
  if (!outline) return result;

  function processItem(item, destPage) {
    if (!item) return;

    if (item.title) {
      result.push({
        title: item.title,
        page: destPage,
        items: []
      });
    }

    if (item.items) {
      for (const subItem of item.items) {
        processItem(subItem, destPage);
      }
    }
  }

  for (const item of outline) {
    let page = 1;
    if (item.dest) {
      try {
        const dest =
          typeof item.dest === 'string'
            ? await pdf.getDestination(item.dest)
            : item.dest;
        if (dest && dest.length) {
          const pageIdx = await pdf.getPageIndex(dest[0]);
          if (typeof pageIdx === 'number') {
            page = pageIdx + 1;
          }
        }
      } catch (e) {}
    }
    processItem(item, page);
  }

  return result;
}

async function loadTocForPage(pageNum) {
  if (!pdfDoc) return [];

  try {
    const page = await pdfDoc.getPage(pageNum);
    const annotations = await page.getAnnotations();
    const dests = annotations.filter(a => a.subtype === 'Link' && a.dest);

    if (dests && dests.length > 0) {
      return dests.map(d => ({
        title: d.title || `Page ${d.pageNumber}`,
        page: d.pageNumber
      }));
    }
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
  if (!pdfDoc) return;

  if (pageNum < 1) pageNum = 1;
  if (pageNum > totalPages) pageNum = totalPages;

  currentPage = pageNum;
  renderPage(currentPage).catch((err) => console.error(err));
  updateUI();
  updateBookmarkIndicator();
  scheduleSavePosition();
}

function updateUI() {
  if (!pdfDoc) {
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }

  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;
  pageInput.value = currentPage;
  zoomLevelEl.textContent = Math.round((fitMode === 'width' || fitMode === 'height' ? 100 : scale * 100)) + '%';
}

function updateTocButton() {
  tocBtn.disabled = !pdfDoc;
}

function zoom(direction) {
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

function renderToc() {
  tocList.innerHTML = '<div class="toc-loading">正在加载目录...</div>';

  setTimeout(async () => {
    if (currentToc.length === 0) {
      const pageToc = await loadTocForPage(currentPage);
      if (pageToc.length > 0) {
        renderTocItems(pageToc);
      } else {
        tocList.innerHTML = '<div class="toc-empty">该 PDF 没有目录<br>尝试点击页面跳转</div>';
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
      goToPage(item.page);
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
      goToPage(bookmark.page);
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
  if (!pdfDoc || !currentPdfPath) return;

  const label = prompt('输入书签名称:', `第 ${currentPage} 页`);
  if (label === null) return;

  const bookmark = await window.electronAPI.addBookmark(currentPdfPath, currentPage, label);
  currentBookmarks.push(bookmark);
  renderBookmarks();
  updateBookmarkIndicator();
  statusText.textContent = `已添加书签: ${label}`;
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
    const item = document.createElement('div');
    item.className = 'shelf-item';
    item.innerHTML = `
      <div class="shelf-item-cover" data-path="${file.path}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
      </div>
      <span class="shelf-item-title">${file.name}</span>
      <span class="shelf-item-progress" data-path="${file.path}"></span>
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
  }

  renderCoversForVisibleItems();
  updateReadingProgress();
}

async function renderCoversForVisibleItems() {
  try {
    await ensurePdfJsLib();
  } catch (e) {
    console.warn('PDF engine unavailable for shelf covers:', e);
    return;
  }

  const items = shelfGrid.querySelectorAll('.shelf-item-cover[data-path]');
  const coverCache = {};

  for (const coverEl of items) {
    const filePath = coverEl.dataset.path;
    if (coverCache[filePath]) continue;

    // 已渲染过封面则保留，返回书架时不重复解码整本 PDF
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
      const position = await window.electronAPI.getReadingPosition(filePath);
      if (position) {
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
    goToPage(currentPage - 1);
  });

  nextBtn.addEventListener('click', () => {
    goToPage(currentPage + 1);
  });

  pageInput.addEventListener('change', (e) => {
    const pageNum = parseInt(e.target.value, 10);
    if (!isNaN(pageNum)) {
      goToPage(pageNum);
    }
  });

  zoomInBtn.addEventListener('click', () => zoom('in'));
  zoomOutBtn.addEventListener('click', () => zoom('out'));
  fitWidthBtn.addEventListener('click', () => zoom('fit-width'));
  fitHeightBtn.addEventListener('click', () => zoom('fit-height'));

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
    if (e.key === 'Escape' && settingsOverlay?.classList.contains('visible')) {
      closeSettings();
      return;
    }
    if (e.target.tagName === 'INPUT') return;
    if (!pdfDoc) return;

    if (e.key === 'ArrowLeft') {
      goToPage(currentPage - 1);
    } else if (e.key === 'ArrowRight') {
      goToPage(currentPage + 1);
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
      e.preventDefault();
      addBookmark();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
      e.preventDefault();
      showShelfView();
    }
  });

  window.electronAPI.onFileOpened(async (data) => {
    if (data) {
      showLoading('正在读取文件…');
      const pdfData = await window.electronAPI.readPdfFile(data.path);
      if (pdfData) {
        fileNameEl.textContent = data.name;
        loadPDF(pdfData.data, data.path);
      } else {
        hideLoading();
        statusText.textContent = '读取文件失败';
      }
    }
  });

  window.electronAPI.onFolderOpened((data) => {
    if (data) {
      shelfTitle.textContent = data.name;
      renderShelfWithCovers(data.files);
      showShelfView();
      statusText.textContent = `书架: ${data.files.length} 个 PDF 文件`;
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
    if (!pdfDoc) {
      statusText.textContent = '请先打开 PDF 后再查看 PDF 大纲目录';
      return;
    }
    renderToc();
    tocSidebar.classList.toggle('active');
    bookmarkSidebar.classList.remove('active');
  });

  window.electronAPI.onToggleBookmarksSidebar(() => {
    if (!pdfDoc || !currentPdfPath) {
      statusText.textContent = '请先打开 PDF 后再查看书签列表';
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
      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const arrayBuffer = event.target.result;
          const uint8Array = new Uint8Array(arrayBuffer);
          fileNameEl.textContent = file.name;
          loadPDF(uint8Array);
        };
        reader.readAsArrayBuffer(file);
      } else {
        statusText.textContent = '请选择 PDF 文件';
      }
    }
  });

  window.addEventListener('resize', () => {
    if (pdfDoc) {
      renderPage(currentPage).catch((err) => console.error(err));
    }
    if (shelfView.classList.contains('active')) {
      renderCoversForVisibleItems().catch((err) => console.error(err));
    }
  });
}

document.addEventListener('DOMContentLoaded', setupEventListeners);
