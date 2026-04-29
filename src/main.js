const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

const userDataPath = app.getPath('userData');
const storagePath = path.join(userDataPath, 'pdf-reader-data.json');

function getStorageData() {
  try {
    if (fs.existsSync(storagePath)) {
      const data = fs.readFileSync(storagePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error reading storage:', error);
  }
  return { readingPositions: {}, bookmarks: {}, shelfFolder: null };
}

function saveStorageData(data) {
  try {
    fs.writeFileSync(storagePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving storage:', error);
  }
}

function readFolderPdfFiles(folderPath) {
  const pdfFiles = [];
  try {
    const files = fs.readdirSync(folderPath);
    for (const file of files) {
      if (file.toLowerCase().endsWith('.pdf')) {
        const filePath = path.join(folderPath, file);
        const stats = fs.statSync(filePath);
        pdfFiles.push({
          name: file,
          path: filePath,
          size: stats.size
        });
      }
    }
    pdfFiles.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error('Error reading folder:', error);
  }
  return pdfFiles;
}

function getAppIconPath() {
  const iconPath = path.join(__dirname, '../build/icon.png');
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

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    backgroundColor: '#1a1a2e',
    show: false,
    icon: iconPath
  });

  mainWindow.loadFile(path.join(__dirname, '../public/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();

    const storage = getStorageData();
    if (storage.shelfFolder && fs.existsSync(storage.shelfFolder)) {
      const pdfFiles = readFolderPdfFiles(storage.shelfFolder);
      mainWindow.webContents.send('folder-opened', {
        path: storage.shelfFolder,
        name: path.basename(storage.shelfFolder),
        files: pdfFiles
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
      { name: 'PDF 文件', extensions: ['pdf'] }
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
    const pdfFiles = readFolderPdfFiles(folderPath);

    const storage = getStorageData();
    storage.shelfFolder = folderPath;
    saveStorageData(storage);

    mainWindow.webContents.send('folder-opened', {
      path: folderPath,
      name: path.basename(folderPath),
      files: pdfFiles
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
    const fileBuffer = fs.readFileSync(filePath);
    return {
      path: filePath,
      name: path.basename(filePath),
      data: fileBuffer
    };
  } catch (error) {
    console.error('Error reading PDF file:', error);
    return null;
  }
});

ipcMain.handle('get-reading-position', async (event, filePath) => {
  const storage = getStorageData();
  return storage.readingPositions[filePath] || null;
});

ipcMain.handle('save-reading-position', async (event, filePath, page) => {
  const storage = getStorageData();
  storage.readingPositions[filePath] = page;
  saveStorageData(storage);
  return true;
});

ipcMain.handle('get-bookmarks', async (event, filePath) => {
  const storage = getStorageData();
  return storage.bookmarks[filePath] || [];
});

ipcMain.handle('add-bookmark', async (event, filePath, page, label) => {
  const storage = getStorageData();
  if (!storage.bookmarks[filePath]) {
    storage.bookmarks[filePath] = [];
  }
  const bookmark = {
    id: Date.now().toString(),
    page,
    label: label || `第 ${page} 页`,
    createdAt: new Date().toISOString()
  };
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
