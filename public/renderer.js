import * as pdfjsLib from '../node_modules/pdfjs-dist/legacy/build/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
  import.meta.url
).toString();

let pdfDoc = null;
let currentPage = 1;
let totalPages = 0;
let scale = 1.0;
let isRendering = false;

const dropZone = document.getElementById('dropZone');
const pdfContainer = document.getElementById('pdfContainer');
const openBtn = document.getElementById('openBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const pageInput = document.getElementById('pageInput');
const totalPagesEl = document.getElementById('totalPages');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomLevelEl = document.getElementById('zoomLevel');
const fitWidthBtn = document.getElementById('fitWidthBtn');
const fileNameEl = document.getElementById('fileName');
const statusText = document.getElementById('statusText');

async function loadPDF(data) {
  try {
    const loadingTask = pdfjsLib.getDocument({ data });
    pdfDoc = await loadingTask.promise;
    totalPages = pdfDoc.numPages;
    totalPagesEl.textContent = totalPages;
    currentPage = 1;

    renderAllPages();
    updateUI();

    statusText.textContent = '加载完成';
  } catch (error) {
    console.error('Error loading PDF:', error);
    statusText.textContent = '加载失败: ' + error.message;
  }
}

async function renderAllPages() {
  if (!pdfDoc || isRendering) return;

  isRendering = true;
  pdfContainer.innerHTML = '';

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    await renderPage(pageNum);
  }

  isRendering = false;
  scrollToPage(currentPage);
}

async function renderPage(pageNum) {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.dataset.pageNumber = pageNum;
  canvas.className = 'pdf-page';

  const wrapper = document.createElement('div');
  wrapper.style.position = 'relative';
  wrapper.appendChild(canvas);
  pdfContainer.appendChild(wrapper);

  await page.render({
    canvasContext: context,
    viewport: viewport
  }).promise;

  return canvas;
}

function scrollToPage(pageNum) {
  const targetCanvas = pdfContainer.querySelector(`canvas[data-page-number="${pageNum}"]`);
  if (targetCanvas) {
    targetCanvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function goToPage(pageNum) {
  if (!pdfDoc) return;

  if (pageNum < 1) pageNum = 1;
  if (pageNum > totalPages) pageNum = totalPages;

  currentPage = pageNum;
  pageInput.value = currentPage;
  scrollToPage(currentPage);
  updateUI();
}

function updateUI() {
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
    const containerWidth = pdfContainer.clientWidth - 40;
    pdfDoc.getPage(1).then(page => {
      const viewport = page.getViewport({ scale: 1 });
      scale = containerWidth / viewport.width;
      renderAllPages();
      updateUI();
    });
    return;
  }

  renderAllPages();
  updateUI();
}

openBtn.addEventListener('click', () => {
  window.electronAPI.openFileDialog();
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

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;

  switch (e.key) {
    case 'ArrowLeft':
      goToPage(currentPage - 1);
      break;
    case 'ArrowRight':
      goToPage(currentPage + 1);
      break;
  }
});

window.electronAPI.onFileOpened((data) => {
  if (data) {
    fileNameEl.textContent = data.name;
    dropZone.classList.add('hidden');
    loadPDF(data.data);
    statusText.textContent = '正在加载...';
  }
});

window.electronAPI.onZoom((direction) => {
  zoom(direction);
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

dropZone.addEventListener('drop', (e) => {
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
        dropZone.classList.add('hidden');
        loadPDF(uint8Array);
        statusText.textContent = '正在加载...';
      };
      reader.readAsArrayBuffer(file);
    } else {
      statusText.textContent = '请选择 PDF 文件';
    }
  }
});

pdfContainer.addEventListener('scroll', () => {
  if (!pdfDoc) return;

  const container = pdfContainer;
  const containerHeight = container.clientHeight;

  const pages = container.querySelectorAll('canvas.pdf-page');
  for (const page of pages) {
    const rect = page.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    if (rect.top >= containerRect.top && rect.top < containerRect.top + containerHeight) {
      const pageNum = parseInt(page.dataset.pageNumber, 10);
      if (pageNum !== currentPage) {
        currentPage = pageNum;
        pageInput.value = currentPage;
        updateUI();
      }
      break;
    }
  }
});
