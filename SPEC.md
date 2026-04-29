# PDF Reader for Mac Intel - 项目规范

## 1. 项目概述

| 项目 | 说明 |
|------|------|
| 名称 | pdf-reader-mac |
| 类型 | Electron 桌面应用 + 渲染进程 HTML/CSS/JS（ES Module） |
| 核心定位 | 轻量 **PDF / EPUB** 阅读、书架聚合、大纲与阅读书签、阅读进度与界面主题记忆 |
| 目标平台 | macOS Intel（x64），Electron 打包为 `.app`/zip |

## 2. 技术栈

| 类别 | 技术 |
|------|------|
| 宿主 | Electron 28.x，`BrowserWindow`，`contextIsolation` + preload；`webPreferences` 含 `preload`、`webSecurity`、`sandbox` 等（以 `main.js` 为准） |
| PDF | PDF.js 4.x（`pdfjs-dist/legacy`，渲染进程 `import()`，`GlobalWorkerOptions.workerSrc`） |
| EPUB | npm `epubjs`；运行时装载 `public/vendor/epub-browser.mjs`（`npm run bundle:epub` + esbuild）；**不在 preload 内向渲染进程传递 Epub.js `Book` 实例**，避免 contextBridge 克隆损坏；后备：主进程读 `public/vendor/epub-browser.mjs` → IPC → 渲染进程 Blob URL 动态 import |
| 打包 | electron-builder，`electron-builder.json`，`icons/icon.png` |
| UI | HTML5/CSS3，`public/renderer.js` ES Module |
| 数据 | JSON，`app.getPath('userData')` 下同应用目录 |
| EPUB 工具链 | esbuild（开发依赖）：`bundle:epub` 写入 `public/vendor/epub-browser.mjs` |

### 2.1 与安全

- `nodeIntegration: false`；preload 经 `contextBridge` 暴露 `window.electronAPI`（以实现为准）；不通过桥传递 Epub 运行时对象。
- CSP 定义于 `public/index.html`。Epub Book / Rendition 仅存在于渲染进程。

### 2.2 版本库与图标资源

- 应用图标路径为 **`icons/icon.png`**。目录名 **`icons/`** 不被通用 **`**/build/`** 规则匹配，**无需**在 `.gitignore` 中用 **`!`** 解除忽略；直接使用 **`git add icons/icon.png`** 即可纳入版本库。

## 3. 功能规格

### 3.1 文件与书架（主进程 / IPC）

- [x] 打开文件：`pdf`、`epub`（`open-file-dialog` → `file-opened`）。
- [x] 书架目录（`open-folder-dialog` → `folder-opened`）。
- [x] `read-pdf-file`（与书籍二进制读取共用）。
- [x] `shelfFolder` 持久化。
- [x] 启动恢复书架（可选 `folder-opened`）。
- [x] `read-epub-vendor-bundle`：主进程读出 EPUB vendor 捆绑文件供 Blob 后备。

### 3.2 阅读模式 — PDF（单页 + 缩放）

- [x] 翻页控件、当前页、`totalPages`；键盘 ← / →（输入框焦点时行为以实现为准）。
- [x] 单页渲染；分页非整卷流式。
- [x] 适应宽高、步进缩放、`fitMode` 与 `scale`。
- [x] 适应宽度：可视宽度缩放；超长页在 `pdf-container` 内纵向滚动。
- [x] 工具栏缩放为 `<input>`，可编辑百分比（Enter 或失焦提交）；PDF 自定义缩放约 **25%–500%**；适应宽度/高度显示语义为 **100%**。
- [x] 高 DPI：`devicePixelRatio`。

### 3.3 阅读模式 — EPUB（Epub.js）

- [x] `renderTo` 与分页流；细节以 `renderer.js` / Epub.js 为准。
- [x] 字体缩放等与工具栏缩放输入同步（约 **60%–220%**）。
- [x] 阅读位置可为 CFI 字符串；书签可含 `cfi`。

### 3.4 阅读位置与书签

- [x] 按路径防抖保存；IPC `get-reading-position`、`save-reading-position`、`add/remove/get bookmarks`。

### 3.5 阅读书签与目录（语义）

- 阅读书签与 PDF `getOutline` 解析大纲、EPUB `navigation`/自定义目录侧栏区分（实现文案见 UI）。

### 3.6 书架视图

- [x] 网格列表；封面（PDF 首页 / EPUB 封面）；进度百分比；会话内跳过已绘封面画布。

### 3.7 快捷键与视图

- [x] 菜单经 `safeSend` 派发 `zoom`、侧栏、`show-shelf`、`add-bookmark` 等。
- [x] 窗口 resize：PDF 重绘；EPUB `rendition.resize`；书架封面按需更新。

### 3.8 超大文档 / 加载

- [x] 加载文案；PDF `loadingTask.onProgress`；延后大纲；进度与书签可并行加载。

### 3.9 主题与设置

- [x] 主题 ID：`midnight`、`graphite`、`ocean`、`amber`、`paper`；存于 JSON；`get-theme`、`set-theme`、`theme-changed`。
- [x] 设置面板中选主题；`data-theme` 与 CSS 变量；窗口背景 `THEME_WINDOW_BG`。

### 3.10 UI 状态机（节选）

- [x] 书架/欢迎：精简工具栏；`#toolbarReading` 在非阅读态隐藏。
- [x] 阅读：展开阅读工具栏；缩放输入按 PDF/EPUB 状态启用。
- [x] 适应宽度图标：竖线 + 左右箭头；适应高度图标：横线 + 上下箭头（见 `index.html`）。

### 3.11 应用图标与 Dock

- [x] **`icons/icon.png`**；electron-builder `icon`；开发时窗口与 Dock；参见 **§2.2**。

## 4. UI/UX 结构（示意图）

```
阅读态：[ 打开 ][ 书架 ][ 返回书架 ] │ 翻页 │ 缩放 ± │ 缩放% │ 适应宽高 │ 目录 │ 书签 │ 设置
书架态：[ 打开 ][ 书架 ]
内容区：drop-zone ⇄ shelf-view ⇄ pdf-container / epub-container
```

配色：多套 `[data-theme=…]` 与 CSS 变量（`styles.css`）。

## 5. 快捷键与菜单（节选）

与 `README.md`、`main.js` 中 `createMenu` 一致。

| 快捷键 | 功能 |
|--------|------|
| Cmd/Ctrl + O | 打开书籍 |
| Cmd/Ctrl + Shift + O | 书架文件夹 |
| Cmd/Ctrl + B | 返回书架 |
| Cmd/Ctrl + D | 添加阅读书签 |
| Cmd/Ctrl + Shift + T | PDF 大纲侧栏 |
| Cmd/Ctrl + Shift + B | 「我的书签」侧栏 |

## 6. 数据存储

### 6.1 路径

`~/Library/Application Support/pdf-reader-mac/pdf-reader-data.json`

### 6.2 结构（示意）

```json
{
  "readingPositions": {
    "/path/to/book.pdf": 12,
    "/path/to/book.epub": "epubcfi(...)"
  },
  "bookmarks": {},
  "shelfFolder": "/path/to/shelf",
  "theme": "midnight"
}
```

书签项可包含 `page` 或 `cfi`（见 IPC 实现）。

## 7. 构建与分发

| 配置项 | 说明 |
|--------|------|
| `electron-builder.json` | `appId`、`productName`、`mac.target`、`icon` 等 |
| `package.json` | `build`、`build:dir`、`bundle:epub` |

## 8. 验收标准（增补）

1. 书架态仅保留打开/书架等入口；无完整阅读条。  
2. 书架态底部不出现当前文件名。  
3. PDF 适应宽度下长页可纵向滚读。  
4. 超大 PDF：可见解析进度或合理首屏。  
5. 书架会话尽量不重复解码已绘封面。  
6. PDF 大纲与阅读书签语义可区分。  
7. PDF 与 EPUB 均可打开与放回书架。  
8. 工具栏缩放百分比可编辑并与实际缩放一致。  
9. `npm run bundle:epub` 后存在 `public/vendor/epub-browser.mjs`。  
10. `icons/icon.png` 在版本库中常驻（路径 **`icons/`**，不受 **`**/build/`** 忽略）。

## 9. 非目标（当前版本）

- 云端同步与多端实时协作。  
- PDF 复杂表单手写批注（以只读为主）。  
- 单流连续滚动铺满整本书的 PDF（当前为分页）。  
- Epub.js 之外的全出版特性扩展。
