# PDF Reader for macOS Intel

轻量级 PDF 阅读器，基于 Electron + PDF.js：单页阅读、书架、阅读书签、PDF 大纲目录、阅读进度与快捷键；深色主题界面。

## 功能特性

### 文件与书架

- 「**打开…**」：通过系统对话框选择单个 PDF。
- 「**书架…**」：选择文件夹作为书架，自动列出其中 PDF。
- 书架路径持久保存，下次启动可自动恢复书架。
- 拖拽 PDF 到窗口即可打开。
- 支持拖拽到欢迎页的放置区。

### 阅读视图

- 单页渲染；翻页（按钮、页码跳转、快捷键）。
- **适应宽度**：整页横向适配窗口宽度，纵向可在内容区内**滚动**，查看超长页面。
- **适应高度**、按需**放大 / 缩小**（自定义缩放比例）。
- **高分辨率屏**：画布按设备像素比渲染，减少模糊。
- PDF **大纲目录**与原书书签树（侧栏，与下文「阅读书签」区分）。
- **阅读书签**：当前页添加、列表跳转、删除；状态栏可显示当前页是否已书签。

### 性能与超大 PDF

- 主进程异步读取磁盘文件（`async readFile`），减轻大文件拷贝时界面冻结感。
- 解析阶段通过 PDF.js **`onProgress`** 显示**解析进度百分比**（数据可用时）。
- **延后加载大纲**：先完成首页渲染并关闭遮挡层，再在后台解析目录，超大文件可先读页再出目录。
- 阅读进度、书签加载与解析并行调度，缩短就绪时间。
- PDF 引擎（pdfjs）按需动态加载，避免启动阶段失败拖垮整页脚本。

### 书架视图

- 网格展示、首屏封面缩略图、阅读进度百分比（若已记录）。
- 从阅读页**返回书架**后，已生成封面**不重复解码**（同一会话内保留 DOM 与画布）。
- 更换书架文件夹会重新扫描并刷新列表。

### 界面与菜单

- **书架 / 欢迎页**：工具栏仅保留「**打开**」与「**书架**」；不显示翻页与缩放等阅读控件。
- **阅读 PDF 时**：工具栏包含「返回书架」「打开」「书架」以及完整阅读控件；底部状态栏显示**当前文件名**；在书架或未打开文件时**不显示**底部文件名。
- **应用菜单**（节选）：文件「打开…」、书架文件夹、返回书架；视图含缩放、「**PDF 目录侧栏**」（大纲，⌘⇧T）、界面重载；「**书签**」菜单含添加阅读书签、打开书签列表侧栏（⌘⇧B）。
- Dock / 开发与打包：**`build/icon.png`** 用作窗口与应用图标参考（参见构建说明）。

### 其它

- 阅读位置防抖保存（约 1 秒）与重新打开跳转。
- 深色主题、`electron-builder` 打包为 `.app` / zip。

## 开发环境

- **Node.js**：v18.x 或更高  
- **npm**：v9.x 或更高  
- **Electron**：v28.x  
- **PDF.js**：v4.x（legacy ES 模块，`public/renderer.js` 中动态导入）  
- **electron-builder**：v24.x  

## 安装依赖

```bash
npm install
```

## 开发运行

```bash
npm run dev
```

或直接：

```bash
npm start
```

请在图形界面环境下运行 Electron。应用图标会使用项目内 **`build/icon.png`**（若存在）。

## 构建打包

配置见根目录 **`electron-builder.json`**（含 **`icon`: `build/icon.png`**）及 **`package.json`** 中的 `scripts`。

### zip

```bash
npm run build
```

输出一般在 `dist/`，文件名随版本而定（例如 `PDF Reader-1.0.0-mac.zip`）。

### 可直接运行的 .app 目录

```bash
npm run build:dir
```

输出通常在 `dist/mac/PDF Reader.app`。

## 目录结构（概要）

```
pdf-reader-mac/
├── src/
│   ├── main.js          # Electron 主进程（窗口、IPC、菜单、Dock 图标）
│   └── preload.js       # 预加载与安全桥接
├── public/
│   ├── index.html
│   ├── styles.css
│   └── renderer.js      # 渲染进程：PDF/UI 逻辑（ES Module）
├── build/
│   └── icon.png         # 应用图标（electron-builder / 运行时 Dock 等）
├── dist/                # 构建产出
├── electron-builder.json
├── package.json
├── SPEC.md
└── README.md
```

## 键盘与应用菜单快捷键（节选）

| 快捷键 | 功能 |
|--------|------|
| ← / → | 上一页 / 下一页（焦点不在输入框时） |
| Cmd/Ctrl + O | 打开 PDF 文件 |
| Cmd/Ctrl + Shift + O | 选择书架文件夹 |
| Cmd/Ctrl + B | 返回书架 |
| Cmd/Ctrl + D | 添加阅读书签 |
| Cmd/Ctrl + Shift + T | 显示/切换 PDF 大纲目录侧栏 |
| Cmd/Ctrl + Shift + B | 显示/切换「我的书签」侧栏 |
| Cmd/Ctrl + = / Cmd/Ctrl + - | 放大 / 缩小 |
| Cmd/Ctrl + 0 | 适应页面宽度 |
| Cmd/Ctrl + 1 | 适应窗口高度 |
| Cmd/Ctrl + R | 重新加载渲染进程界面 |

## 使用说明

### 书架

1. 点击「书架」，选择一个包含 PDF 的文件夹。  
2. 路径会保存；下次可从菜单或上次状态进入书架网格。  
3. 单击某书的封面卡片打开阅读。  
4. 「更换文件夹」可重新指定书架目录。  
5. 阅读页点击「返回书架」回到网格（同一会话下不强制重绘已有封面）。

### 打开单个文件

点击「打开…」选择 PDF；或在欢迎页拖拽文件到指示区域。

### 阅读位置与书签

- 切换页码会自动保存进度（防抖），下次从书架或菜单打开同一文件会尝试恢复页码。  
- 阅读书签在侧栏统一管理；PDF 自带的**大纲目录**在另一侧栏，二者在菜单与工具栏上已区分。

### 视图

- 「适应宽度」下若一页高于可视区域，请在中间 PDF 区域**上下滚动**查看全文。  

## 数据存储

用户数据保存在（应用名与 `productName`/`name` 相关，以实际 `userData` 为准）：

`~/Library/Application Support/pdf-reader-mac/pdf-reader-data.json`

内包含：阅读位置、各文件阅读书签、shelfFolder 书架路径等。

## 构建与图标

- **`electron-builder.json`**：`appId`、`productName`、`icon`（指向 `build/icon.png`）、`directories.output` 等。  
- 打包前请放置合适尺寸的 **`build/icon.png`**（常用 512×512 或更大）。  
- 开发时 **`main.js`** 会在可用时设置 macOS Dock 图标与窗口 `icon`。

## 常见问题

**构建报错或目标格式**：以 `electron-builder.json` 为准；若为 `zip`/`dir` 等，勿混用陈旧 `dmg` 相关依赖。

**超大 PDF 仍较慢**：已通过进度提示、延后大纲、异步读盘等缓解；全文解析仍取决于 PDF.js 与本机性能。

**必须安装 Node 并重装依赖**：首次克隆后执行 `npm install`。

## License

MIT
