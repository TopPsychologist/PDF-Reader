const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  readPdfFile: (filePath) => ipcRenderer.invoke('read-pdf-file', filePath),
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
  saveReadingPosition: (filePath, page) => ipcRenderer.invoke('save-reading-position', filePath, page),
  getBookmarks: (filePath) => ipcRenderer.invoke('get-bookmarks', filePath),
  addBookmark: (filePath, page, label) => ipcRenderer.invoke('add-bookmark', filePath, page, label),
  removeBookmark: (filePath, bookmarkId) => ipcRenderer.invoke('remove-bookmark', filePath, bookmarkId),
  getAllBookmarks: () => ipcRenderer.invoke('get-all-bookmarks'),
  getShelfFolder: () => ipcRenderer.invoke('get-shelf-folder'),
  getTheme: () => ipcRenderer.invoke('get-theme'),
  setTheme: (themeId) => ipcRenderer.invoke('set-theme', themeId),
  onThemeChanged: (callback) => {
    ipcRenderer.on('theme-changed', (event, themeId) => callback(themeId));
  }
});
