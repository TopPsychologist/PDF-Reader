const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

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

function getStorageData() {
  const defaults = {
    readingPositions: {},
    bookmarks: {},
    shelfFolder: null,
    theme: 'midnight'
  };
  try {
    if (fs.existsSync(storagePath)) {
      const raw = fs.readFileSync(storagePath, 'utf8');
      const data = JSON.parse(raw);
      return {
        ...defaults,
        ...data,
        readingPositions: data.readingPositions || {},
        bookmarks: data.bookmarks || {}
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

/** 书架支持的电子书扩展名（小写比对） */
const SHELF_EXTENSIONS = ['.pdf', '.epub'];

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

function createMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
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
        { type: 'separator' },
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
      ]
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
    const folderPath = result.filePaths[0];
    const shelfFiles = readFolderShelfFiles(folderPath);

    const storage = getStorageData();
    storage.shelfFolder = folderPath;
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
  return storage.bookmarks[filePath] || [];
});

ipcMain.handle('add-bookmark', async (event, filePath, pageOrPayload, label) => {
  const storage = getStorageData();
  if (!storage.bookmarks[filePath]) {
    storage.bookmarks[filePath] = [];
  }

  let page;
  let cfi;
  if (typeof pageOrPayload === 'number') {
    page = pageOrPayload;
  } else if (pageOrPayload && typeof pageOrPayload === 'object' && typeof pageOrPayload.cfi === 'string') {
    cfi = pageOrPayload.cfi;
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

  storage.bookmarks[filePath].push(bookmark);
  saveStorageData(storage);
  return bookmark;
});

ipcMain.handle('remove-bookmark', async (event, filePath, bookmarkId) => {
  const storage = getStorageData();
  if (storage.bookmarks[filePath]) {
    storage.bookmarks[filePath] = storage.bookmarks[filePath].filter(
      b => b.id !== bookmarkId
    );
    saveStorageData(storage);
  }
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

app.whenReady().then(() => {
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
