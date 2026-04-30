const { contextBridge, ipcRenderer } = require('electron');

/**
 * EPUB 渲染在 preload 中会经过 contextBridge 的结构化克隆，
 * Epub.js Book 会失去原型与方法，.ready 会变成挂住的 Promise，
 * —— 须在渲染进程直接 import epub（见 public/vendor/epub-browser.mjs）。
 */
contextBridge.exposeInMainWorld('electronAPI', {
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  readPdfFile: (filePath) => ipcRenderer.invoke('read-pdf-file', filePath),
  readBookFile: (filePath) => ipcRenderer.invoke('read-pdf-file', filePath),
  /** epub-browser.mjs 全文（供 Blob URL import，避开 file:// 跨文件 ES 模块限制） */
  readEpubVendorBundle: () => ipcRenderer.invoke('read-epub-vendor-bundle'),
  onFileOpened: (callback) => {
    ipcRenderer.on('file-opened', (event, data) => callback(data));
  },
  onFolderOpened: (callback) => {
    ipcRenderer.on('folder-opened', (event, data) => callback(data));
  },
  onZoom: (callback) => {
    ipcRenderer.on('zoom', (event, direction) => callback(direction));
  },
  onShowShelf: (callback) => {
    ipcRenderer.on('show-shelf', (event) => callback());
  },
  onAddBookmark: (callback) => {
    ipcRenderer.on('add-bookmark', (event) => callback());
  },
  onToggleTocSidebar: (callback) => {
    ipcRenderer.on('toggle-toc-sidebar', () => callback());
  },
  onToggleBookmarksSidebar: (callback) => {
    ipcRenderer.on('toggle-bookmarks-sidebar', () => callback());
  },
  getReadingPosition: (filePath) => ipcRenderer.invoke('get-reading-position', filePath),
  saveReadingPosition: (filePath, position) =>
    ipcRenderer.invoke('save-reading-position', filePath, position),
  getBookmarks: (filePath) => ipcRenderer.invoke('get-bookmarks', filePath),
  addBookmark: (filePath, pageOrPayload, label) =>
    ipcRenderer.invoke('add-bookmark', filePath, pageOrPayload, label),
  removeBookmark: (filePath, bookmarkId) =>
    ipcRenderer.invoke('remove-bookmark', filePath, bookmarkId),
  getAllBookmarks: () => ipcRenderer.invoke('get-all-bookmarks'),
  getShelfFolder: () => ipcRenderer.invoke('get-shelf-folder'),
  /** 历史书架路径列表（含是否存在） */
  getShelfFolderHistory: () => ipcRenderer.invoke('get-shelf-folder-history'),
  /** 切换到已有路径作为当前书架 */
  switchShelfFolder: (folderPath) => ipcRenderer.invoke('switch-shelf-folder', folderPath),
  /** 从历史记录下移除指定路径（不删磁盘文件夹） */
  removeShelfFolderFromHistory: (folderPath) =>
    ipcRenderer.invoke('remove-shelf-folder-from-history', folderPath),
  getTheme: () => ipcRenderer.invoke('get-theme'),
  setTheme: (themeId) => ipcRenderer.invoke('set-theme', themeId),
  getPdfSpreadMode: () => ipcRenderer.invoke('get-pdf-spread-mode'),
  setPdfSpreadMode: (mode) => ipcRenderer.invoke('set-pdf-spread-mode', mode),
  /** 阅读书籍时为 true，用于隐藏工具栏「打开 / 书架」并同步应用菜单 */
  setReadingMode: (reading) => ipcRenderer.invoke('set-reading-mode', reading),
  onThemeChanged: (callback) => {
    ipcRenderer.on('theme-changed', (event, themeId) => callback(themeId));
  }
});
