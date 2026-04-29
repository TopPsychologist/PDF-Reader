import * as pdfjsLib from '../node_modules/pdfjs-dist/legacy/build/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
  import.meta.url
).toString();

let pdfDoc = null;
let currentPage = 1;
let totalPages = 0;
let scale = 1.0;
let currentPdfPath = null;
let currentBookmarks = [];
let isLoading = false;
let savePositionTimer = null;

const dropZone = document.getElementById('dropZone');
const pdfContainer = document.getElementById('pdfContainer');
const shelfView = document.getElementById('shelfView');
const shelfGrid = document.getElementById('shelfGrid');
const shelfTitle = document.getElementById('shelfTitle');
const shelfEmpty = document.getElementById('shelfEmpty');
const openBtn = document.getElementById('openBtn');
const shelfBtn = document.getElementById('shelfBtn');
const changeFolderBtn = document.getElementById('changeFolderBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const pageInput = document.getElementById('pageInput');
const totalPagesEl = document.getElementById('totalPages');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomLevelEl = document.getElementById('zoomLevel');
const fitWidthBtn = document.getElementById('fitWidthBtn');
const bookmarkBtn = document.getElementById('bookmarkBtn');
const showBookmarksBtn = document.getElementById('showBookmarksBtn');
const bookmarkSidebar = document.getElementById('bookmarkSidebar');
const bookmarkList = document.getElementById('bookmarkList');
const closeBookmarkBtn = document.getElementById('closeBookmarkBtn');
const fileNameEl = document.getElementById('fileName');
const statusText = document.getElementById('statusText');
const bookmarkIndicator = document.getElementById('bookmarkIndicator');
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingText = document.getElementById('loadingText');

function showLoading(text = '正在加载...') {
  loadingText.textContent = text;
  loadingOverlay.classList.add('active');
  isLoading = true;
}

function hideLoading() {
  loadingOverlay.classList.remove('active');
  isLoading = false;
}

function showPdfView() {
  dropZone.classList.add('hidden');
  shelfView.classList.remove('active');
  pdfContainer.classList.add('active');
  bookmarkSidebar.classList.remove('active');
  enablePdfControls(true);
}

function showShelfView() {
  pdfContainer.classList.remove('active');
  dropZone.classList.add('hidden');
  shelfView.classList.add('active');
  bookmarkSidebar.classList.remove('active');
  enablePdfControls(false);
}

function showWelcome() {
  dropZone.classList.remove('hidden');
  shelfView.classList.remove('active');
  pdfContainer.classList.remove('active');
  bookmarkSidebar.classList.remove('active');
  enablePdfControls(false);
}

function enablePdfControls(enable) {
  prevBtn.disabled = !enable;
  nextBtn.disabled = !enable;
  pageInput.disabled = !enable;
  zoomInBtn.disabled = !enable;
  zoomOutBtn.disabled = !enable;
  fitWidthBtn.disabled = !enable;
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

async function loadPDF(data, filePath = null) {
  try {
    showLoading('正在加载 PDF...');

    if (pdfDoc) {
      pdfDoc.destroy();
      pdfDoc = null;
    }

    const loadingTask = pdfjsLib.getDocument({
      data,
      cMapUrl: '../node_modules/pdfjs-dist/cmaps/',
      cMapPacked: true,
    });

    pdfDoc = await loadingTask.promise;
    totalPages = pdfDoc.numPages;
    totalPagesEl.textContent = totalPages;
    currentPdfPath = filePath;

    let startPage = 1;
    if (filePath) {
      const savedPosition = await window.electronAPI.getReadingPosition(filePath);
      if (savedPosition) {
        startPage = savedPosition;
      }
      currentBookmarks = await window.electronAPI.getBookmarks(filePath);
    }

    currentPage = startPage;
    showPdfView();

    await renderPage(currentPage);
    updateUI();
    updateBookmarkIndicator();

    hideLoading();
    statusText.textContent = '加载完成';
  } catch (error) {
    console.error('Error loading PDF:', error);
    hideLoading();
    statusText.textContent = '加载失败: ' + error.message;
  }
}

async function renderPage(pageNum) {
  if (!pdfDoc) return;

  try {
    const page = await pdfDoc.getPage(pageNum);
    let viewport = page.getViewport({ scale });

    const containerWidth = pdfContainer.clientWidth - 40;
    if (scale === 1.0 || viewport.width > containerWidth) {
      const fitScale = containerWidth / page.getViewport({ scale: 1 }).width;
      viewport = page.getViewport({ scale: fitScale * 0.98 });
    }

    pdfContainer.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'pdf-page-wrapper';

    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-page';
    const context = canvas.getContext('2d');

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    wrapper.appendChild(canvas);
    pdfContainer.appendChild(wrapper);

    await page.render({
      canvasContext: context,
      viewport: viewport
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
  renderPage(currentPage);
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
  zoomLevelEl.textContent = Math.round(scale * 100) + '%';
}

function zoom(direction) {
  if (!pdfDoc) return;

  if (direction === 'in') {
    scale = Math.min(scale + 0.25, 5.0);
  } else if (direction === 'out') {
    scale = Math.max(scale - 0.25, 0.25);
  } else if (direction === 'fit-width') {
    scale = 1.0;
  }

  renderPage(currentPage);
  updateUI();
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

function renderShelf(files) {
  shelfGrid.innerHTML = '';

  if (files.length === 0) {
    shelfEmpty.classList.add('active');
    return;
  }

  shelfEmpty.classList.remove('active');

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
          <polyline points="10 9 9 9 8 9"/>
        </svg>
      </div>
      <span class="shelf-item-title">${file.name}</span>
    `;

    item.addEventListener('click', async () => {
      showLoading('正在加载...');
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

openBtn.addEventListener('click', () => {
  window.electronAPI.openFileDialog();
});

shelfBtn.addEventListener('click', () => {
  window.electronAPI.openFolderDialog();
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

bookmarkBtn.addEventListener('click', () => {
  addBookmark();
});

showBookmarksBtn.addEventListener('click', () => {
  renderBookmarks();
  bookmarkSidebar.classList.toggle('active');
});

closeBookmarkBtn.addEventListener('click', () => {
  bookmarkSidebar.classList.remove('active');
});

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (!pdfDoc) return;

  if (e.key === 'ArrowLeft') {
    goToPage(currentPage - 1);
  } else if (e.key === 'ArrowRight') {
    goToPage(currentPage + 1);
  } else if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
    e.preventDefault();
    addBookmark();
  }
});

window.electronAPI.onFileOpened(async (data) => {
  if (data) {
    showLoading('正在读取文件...');
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
    renderShelf(data.files);
    showShelfView();
    statusText.textContent = `书架: ${data.files.length} 个 PDF 文件`;
  }
});

window.electronAPI.onZoom((direction) => {
  zoom(direction);
});

window.electronAPI.onShowShelf(() => {
  if (currentPdfPath) {
    window.electronAPI.openFolderDialog();
  } else {
    showWelcome();
  }
});

window.electronAPI.onAddBookmark(() => {
  addBookmark();
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
        statusText.textContent = '正在加载...';
      };
      reader.readAsArrayBuffer(file);
    } else {
      statusText.textContent = '请选择 PDF 文件';
    }
  }
});

window.addEventListener('resize', () => {
  if (pdfDoc) {
    renderPage(currentPage);
  }
});
