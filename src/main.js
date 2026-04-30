const { app, BrowserWindow, ipcMain, dialog, Menu, session } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

/** 阅读书籍时为 true，用于隐藏「打开 / 书架」相关菜单项 */
let readingModeActive = false;

const userDataPath = app.getPath('userData');
const storagePath = path.join(userDataPath, 'pdf-reader-data.json');

const THEME_IDS = ['midnight', 'graphite', 'ocean', 'amber', 'paper'];
const THEME_WINDOW_BG = {
  midnight: '#1a1a2e',
  graphite: '#17181c',
  ocean: '#0b1220',
  amber: '#221c12',
  paper: '#eef0f4'
};
const THEME_MENU_ITEMS = [
  ['midnight', '午夜蓝'],
  ['graphite', '石墨灰'],
  ['ocean', '深海青'],
  ['amber', '琥珀棕'],
  ['paper', '日间纸本']
];

/** PDF 阅读：单页 / 双页（并排） */
const PDF_SPREAD_MODES = ['single', 'double'];

function getStorageData() {
  const defaults = {
    readingPositions: {},
    bookmarks: {},
    shelfFolder: null,
    shelfFolderHistory: [],
    /** 用户从历史下拉移除的路径（规范化），避免 get 时再自动塞回列表 */
    shelfHistoryExcluded: [],
    theme: 'midnight',
    pdfSpreadMode: 'single'
  };
  try {
    if (fs.existsSync(storagePath)) {
      const raw = fs.readFileSync(storagePath, 'utf8');
      const data = JSON.parse(raw);
      return {
        ...defaults,
        ...data,
        readingPositions: data.readingPositions || {},
        bookmarks: data.bookmarks || {},
        shelfFolderHistory: Array.isArray(data.shelfFolderHistory)
          ? data.shelfFolderHistory
          : [],
        shelfHistoryExcluded: Array.isArray(data.shelfHistoryExcluded)
          ? data.shelfHistoryExcluded
          : []
      };
    }
  } catch (error) {
    console.error('Error reading storage:', error);
  }
  return { ...defaults };
}

function saveStorageData(data) {
  try {
    fs.writeFileSync(storagePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving storage:', error);
  }
}

/** 统一路径形态，避免同一文件因分隔符等差异产生多套书签 */
function normalizeBookmarkPath(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) return filePath;
  try {
    return path.normalize(filePath);
  } catch {
    return filePath;
  }
}

/** 书架支持的电子书扩展名（小写比对） */
const SHELF_EXTENSIONS = ['.pdf', '.epub'];

const MAX_SHELF_HISTORY = 30;
const MAX_SHELF_HISTORY_EXCLUDED = 64;

/** 用户再次选择某书架路径时，允许重新出现在历史中 */
function clearShelfHistoryExclusionForNormalizedPath(storage, normalizedPath) {
  if (!normalizedPath || !storage) return;
  storage.shelfHistoryExcluded = (
    Array.isArray(storage.shelfHistoryExcluded) ? storage.shelfHistoryExcluded : []
  ).filter((x) => {
    try {
      return path.normalize(x) !== normalizedPath;
    } catch {
      return true;
    }
  });
}

/** 将路径记入书架历史（当前路径置顶，去重） */
function pushShelfFolderHistory(storage, folderPath) {
  if (typeof folderPath !== 'string' || !folderPath) return;
  let p;
  try {
    p = path.normalize(folderPath);
  } catch {
    return;
  }
  clearShelfHistoryExclusionForNormalizedPath(storage, p);
  const prev = Array.isArray(storage.shelfFolderHistory) ? storage.shelfFolderHistory : [];
  storage.shelfFolderHistory = [p, ...prev.filter((x) => x !== p)].slice(0, MAX_SHELF_HISTORY);
}

function readFolderShelfFiles(folderPath) {
  const list = [];
  try {
    const files = fs.readdirSync(folderPath);
    for (const file of files) {
      const lower = file.toLowerCase();
      const supported = SHELF_EXTENSIONS.some((ext) => lower.endsWith(ext));
      if (!supported) continue;
      const filePath = path.join(folderPath, file);
      const stats = fs.statSync(filePath);
      list.push({
        name: file,
        path: filePath,
        size: stats.size
      });
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error('Error reading folder:', error);
  }
  return list;
}

function getAppIconPath() {
  const iconPath = path.join(__dirname, '../icons/icon.png');
  return fs.existsSync(iconPath) ? iconPath : undefined;
}

function setDockIcon() {
  if (process.platform !== 'darwin' || !app.dock) return;
  const p = getAppIconPath();
  if (!p) return;
  try {
    app.dock.setIcon(p);
  } catch (e) {
    console.warn('Could not set Dock icon:', e.message);
  }
}

/**
 * 打包后用 file:///（含 app.asar）加载本地资源时，部分响应没有正确 Content-Type，
 * .css 可能无法作为样式表应用，.js/.mjs 作为 ES module 会因 MIME 不合规而失败。
 */
function installFileUrlMimeFix() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const { url, responseHeaders } = details;
    if (!url || !url.startsWith('file:')) {
      callback({ responseHeaders });
      return;
    }

    let pathOnly;
    try {
      pathOnly = decodeURI(url.split(/[#?]/)[0]).toLowerCase();
    } catch (_e) {
      pathOnly = url.split(/[#?]/)[0].toLowerCase();
    }

    let mime = null;
    if (pathOnly.endsWith('.css')) mime = 'text/css; charset=utf-8';
    else if (pathOnly.endsWith('.mjs') || pathOnly.endsWith('.cjs') || /\.js$/i.test(pathOnly)) {
      mime = 'text/javascript; charset=utf-8';
    } else if (pathOnly.endsWith('.html') || pathOnly.endsWith('.htm')) {
      mime = 'text/html; charset=utf-8';
    }

    if (!mime) {
      callback({ responseHeaders });
      return;
    }

    const out = {};
    let replaced = false;
    if (responseHeaders && typeof responseHeaders === 'object') {
      for (const k of Object.keys(responseHeaders)) {
        if (k.toLowerCase() === 'content-type') {
          out[k] = [mime];
          replaced = true;
        } else {
          out[k] = responseHeaders[k];
        }
      }
    }
    if (!replaced) {
      out['Content-Type'] = [mime];
    }
    callback({ responseHeaders: out });
  });
}

function createWindow() {
  const iconPath = getAppIconPath();
  const initialTheme = getStorageData().theme || 'midnight';
  const bgColor = THEME_WINDOW_BG[THEME_IDS.includes(initialTheme) ? initialTheme : 'midnight'] || '#1a1a2e';

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      /** 允许本地 file:/// 脚本互引（仍会优先用 Blob import 加载 epub 包） */
      webSecurity: false,
      preload: path.join(__dirname, 'preload.js')
    },
    backgroundColor: bgColor,
    show: false,
    icon: iconPath
  });

  mainWindow.loadFile(path.join(__dirname, '../public/index.html'));

  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('[preload-error]', preloadPath, error);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();

    const storage = getStorageData();
    if (storage.shelfFolder && fs.existsSync(storage.shelfFolder)) {
      const shelfFiles = readFolderShelfFiles(storage.shelfFolder);
      mainWindow.webContents.send('folder-opened', {
        path: storage.shelfFolder,
        name: path.basename(storage.shelfFolder),
        files: shelfFiles
      });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  createMenu();
}

function safeSend(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

function setAppTheme(themeId) {
  if (!THEME_IDS.includes(themeId)) return;
  const storage = getStorageData();
  storage.theme = themeId;
  saveStorageData(storage);
  safeSend('theme-changed', themeId);
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.setBackgroundColor(THEME_WINDOW_BG[themeId] || '#1a1a2e');
    } catch (e) {}
  }
  createMenu();
}

function getFileMenuTemplate() {
  const openGroup = readingModeActive
    ? []
    : [
        {
          label: '打开…',
          accelerator: 'CmdOrCtrl+O',
          click: () => openFile()
        },
        {
          label: '打开书架文件夹',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => openFolder()
        },
        { type: 'separator' }
      ];

  return [
    ...openGroup,
    {
      label: '返回书架',
      accelerator: 'CmdOrCtrl+B',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('show-shelf');
        }
      }
    },
    { type: 'separator' },
    {
      label: '退出应用',
      accelerator: 'CmdOrCtrl+Q',
      click: () => app.quit()
    }
  ];
}

function createMenu() {
  const template = [
    {
      label: '文件',
      submenu: getFileMenuTemplate()
    },
    {
      label: '视图',
      submenu: [
        {
          label: '放大',
          accelerator: 'CmdOrCtrl+=',
          click: () => safeSend('zoom', 'in')
        },
        {
          label: '缩小',
          accelerator: 'CmdOrCtrl+-',
          click: () => safeSend('zoom', 'out')
        },
        {
          label: '适应页面宽度',
          accelerator: 'CmdOrCtrl+0',
          click: () => safeSend('zoom', 'fit-width')
        },
        {
          label: '适应窗口高度',
          accelerator: 'CmdOrCtrl+1',
          click: () => safeSend('zoom', 'fit-height')
        },
        { type: 'separator' },
        {
          label: '显示 PDF 目录侧栏（文档大纲结构）…',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => safeSend('toggle-toc-sidebar')
        },
        { type: 'separator' },
        {
          label: '主题',
          submenu: (() => {
            const cur = getStorageData().theme || 'midnight';
            const normalized = THEME_IDS.includes(cur) ? cur : 'midnight';
            return THEME_MENU_ITEMS.map(([id, label]) => ({
              label,
              type: 'radio',
              checked: normalized === id,
              click: () => setAppTheme(id)
            }));
          })()
        },
        { type: 'separator' },
        {
          label: '重新加载界面',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
          }
        }
      ]
    },
    {
      label: '书签',
      submenu: [
        {
          label: '在当前页添加阅读书签',
          accelerator: 'CmdOrCtrl+D',
          click: () => safeSend('add-bookmark')
        },
        { type: 'separator' },
        {
          label: '打开「书签列表」侧栏',
          accelerator: 'CmdOrCtrl+Shift+B',
          click: () => safeSend('toggle-bookmarks-sidebar')
        }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', accelerator: 'CmdOrCtrl+M', role: 'minimize' },
        { label: '关闭', accelerator: 'CmdOrCtrl+W', role: 'close' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

ipcMain.handle('set-reading-mode', (event, reading) => {
  readingModeActive = Boolean(reading);
  createMenu();
  return true;
});

async function openFile() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: '电子书 (PDF / EPUB)', extensions: ['pdf', 'epub'] }
    ]
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0];
    mainWindow.webContents.send('file-opened', {
      path: filePath,
      name: path.basename(filePath)
    });
  }
}

async function openFolder() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const folderPath = path.normalize(result.filePaths[0]);
    const shelfFiles = readFolderShelfFiles(folderPath);

    const storage = getStorageData();
    storage.shelfFolder = folderPath;
    pushShelfFolderHistory(storage, folderPath);
    saveStorageData(storage);

    mainWindow.webContents.send('folder-opened', {
      path: folderPath,
      name: path.basename(folderPath),
      files: shelfFiles
    });
  }
}

ipcMain.handle('open-file-dialog', async () => {
  await openFile();
});

ipcMain.handle('open-folder-dialog', async () => {
  await openFolder();
});

ipcMain.handle('get-shelf-folder-history', async () => {
  const storage = getStorageData();
  const excluded = new Set(
    (Array.isArray(storage.shelfHistoryExcluded) ? storage.shelfHistoryExcluded : [])
      .map((x) => {
        try {
          return path.normalize(x);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
  );

  let hist = Array.isArray(storage.shelfFolderHistory)
    ? storage.shelfFolderHistory
        .map((p) => {
          try {
            return path.normalize(p);
          } catch {
            return null;
          }
        })
        .filter((p) => p && !excluded.has(p))
    : [];

  hist = [...new Set(hist)];

  const cur = storage.shelfFolder;
  if (cur) {
    try {
      const n = path.normalize(cur);
      if (!excluded.has(n) && !hist.includes(n)) {
        hist.unshift(n);
        storage.shelfFolderHistory = hist.slice(0, MAX_SHELF_HISTORY);
        saveStorageData(storage);
        hist = storage.shelfFolderHistory
          .map((p) => {
            try {
              return path.normalize(p);
            } catch {
              return null;
            }
          })
          .filter((p) => p && !excluded.has(p));
        hist = [...new Set(hist)];
      }
    } catch (_) {}
  }

  return hist.map((p) => ({
    path: p,
    basename: path.basename(p),
    exists: fs.existsSync(p)
  }));
});

ipcMain.handle('remove-shelf-folder-from-history', async (event, folderPath) => {
  if (typeof folderPath !== 'string' || !folderPath.trim()) {
    return { ok: false, message: '无效路径' };
  }
  let n;
  try {
    n = path.normalize(folderPath.trim());
  } catch {
    return { ok: false, message: '无效路径' };
  }

  const storage = getStorageData();
  storage.shelfFolderHistory = (Array.isArray(storage.shelfFolderHistory)
    ? storage.shelfFolderHistory
    : []
  ).filter((x) => {
    try {
      return path.normalize(x) !== n;
    } catch {
      return true;
    }
  });

  const ex = Array.isArray(storage.shelfHistoryExcluded) ? [...storage.shelfHistoryExcluded] : [];
  const has = ex.some((x) => {
    try {
      return path.normalize(x) === n;
    } catch {
      return false;
    }
  });
  if (!has) ex.push(n);
  storage.shelfHistoryExcluded = ex.slice(-MAX_SHELF_HISTORY_EXCLUDED);

  saveStorageData(storage);
  return { ok: true };
});

ipcMain.handle('switch-shelf-folder', async (event, folderPath) => {
  if (typeof folderPath !== 'string' || !folderPath.trim()) {
    return { ok: false, message: '无效路径' };
  }
  let p;
  try {
    p = path.normalize(folderPath.trim());
  } catch {
    return { ok: false, message: '无效路径' };
  }
  if (!fs.existsSync(p)) {
    return { ok: false, message: '文件夹不存在' };
  }
  let st;
  try {
    st = fs.statSync(p);
  } catch (e) {
    return { ok: false, message: e && e.message ? e.message : String(e) };
  }
  if (!st.isDirectory()) {
    return { ok: false, message: '不是文件夹' };
  }

  const shelfFiles = readFolderShelfFiles(p);
  const storage = getStorageData();
  storage.shelfFolder = p;
  pushShelfFolderHistory(storage, p);
  saveStorageData(storage);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('folder-opened', {
      path: p,
      name: path.basename(p),
      files: shelfFiles
    });
  }
  return { ok: true };
});

ipcMain.handle('read-pdf-file', async (event, filePath) => {
  try {
    const fileBuffer = await fs.promises.readFile(filePath);
    return {
      path: filePath,
      name: path.basename(filePath),
      data: fileBuffer
    };
  } catch (error) {
    console.error('Error reading book file:', error);
    return null;
  }
});

/** file:// + 本地 import() 常被拦截；改为由主进程读盘，渲染进程用 blob URL 动态 import */
function getEpubVendorPath() {
  return path.join(__dirname, '..', 'public', 'vendor', 'epub-browser.mjs');
}

ipcMain.handle('read-epub-vendor-bundle', async () => {
  const p = getEpubVendorPath();
  try {
    if (!fs.existsSync(p)) {
      console.error('[read-epub-vendor-bundle] 文件不存在:', p);
      return '';
    }
    return await fs.promises.readFile(p, 'utf8');
  } catch (e) {
    console.error('[read-epub-vendor-bundle]', e);
    return '';
  }
});

ipcMain.handle('get-reading-position', async (event, filePath) => {
  const storage = getStorageData();
  return storage.readingPositions[filePath] || null;
});

ipcMain.handle('save-reading-position', async (event, filePath, position) => {
  const storage = getStorageData();
  storage.readingPositions[filePath] = position;
  saveStorageData(storage);
  return true;
});

ipcMain.handle('get-bookmarks', async (event, filePath) => {
  const storage = getStorageData();
  const k = normalizeBookmarkPath(filePath);
  let list = storage.bookmarks[k];
  if (list && list.length) return list;
  /** 兼容旧版未 normalize 的键：迁移到规范化键 */
  if (filePath && filePath !== k && storage.bookmarks[filePath]?.length) {
    storage.bookmarks[k] = storage.bookmarks[filePath];
    delete storage.bookmarks[filePath];
    saveStorageData(storage);
    return storage.bookmarks[k];
  }
  return [];
});

ipcMain.handle('add-bookmark', async (event, filePath, pageOrPayload, label) => {
  const storage = getStorageData();
  const k = normalizeBookmarkPath(filePath);
  if (typeof k !== 'string' || !k) {
    throw new Error('无效的文件路径');
  }
  if (!storage.bookmarks[k]) {
    storage.bookmarks[k] = [];
  }

  let page;
  let cfi;

  if (pageOrPayload && typeof pageOrPayload === 'object' && typeof pageOrPayload.cfi === 'string') {
    cfi = pageOrPayload.cfi;
  } else {
    let n;
    if (typeof pageOrPayload === 'number' && Number.isFinite(pageOrPayload)) {
      n = pageOrPayload;
    } else if (typeof pageOrPayload === 'string' && /^\d+$/.test(String(pageOrPayload).trim())) {
      n = parseInt(String(pageOrPayload).trim(), 10);
    } else {
      n = Number(pageOrPayload);
    }
    if (Number.isFinite(n)) {
      page = Math.max(1, Math.round(n));
    }
  }

  let defaultLabel;
  if (typeof page === 'number') {
    defaultLabel = `第 ${page} 页`;
  } else if (cfi) {
    defaultLabel = '阅读位置';
  } else {
    defaultLabel = '书签';
  }

  const bookmark = {
    id: Date.now().toString(),
    label: label || defaultLabel,
    createdAt: new Date().toISOString()
  };
  if (typeof page === 'number') bookmark.page = page;
  if (cfi) bookmark.cfi = cfi;

  storage.bookmarks[k].push(bookmark);
  saveStorageData(storage);
  return bookmark;
});

ipcMain.handle('remove-bookmark', async (event, filePath, bookmarkId) => {
  const storage = getStorageData();
  const k = normalizeBookmarkPath(filePath);
  let key = k;
  if (!storage.bookmarks[key]?.length && filePath && storage.bookmarks[filePath]?.length) {
    key = filePath;
  }
  if (!storage.bookmarks[key]?.length) return true;
  storage.bookmarks[key] = storage.bookmarks[key].filter((b) => b.id !== bookmarkId);
  saveStorageData(storage);
  return true;
});

ipcMain.handle('get-all-bookmarks', async () => {
  const storage = getStorageData();
  return storage.bookmarks;
});

ipcMain.handle('get-shelf-folder', async () => {
  const storage = getStorageData();
  return storage.shelfFolder;
});

ipcMain.handle('get-theme', async () => {
  const storage = getStorageData();
  const id = storage.theme || 'midnight';
  return THEME_IDS.includes(id) ? id : 'midnight';
});

ipcMain.handle('set-theme', async (event, themeId) => {
  setAppTheme(themeId);
  return true;
});

ipcMain.handle('get-pdf-spread-mode', async () => {
  const storage = getStorageData();
  const id = storage.pdfSpreadMode || 'single';
  return PDF_SPREAD_MODES.includes(id) ? id : 'single';
});

ipcMain.handle('set-pdf-spread-mode', async (event, mode) => {
  if (!PDF_SPREAD_MODES.includes(mode)) return false;
  const storage = getStorageData();
  storage.pdfSpreadMode = mode;
  saveStorageData(storage);
  return true;
});

app.whenReady().then(() => {
  installFileUrlMimeFix();
  setDockIcon();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
