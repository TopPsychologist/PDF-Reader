# PDF Reader for Mac Intel - 项目规范

## 1. 项目概述

| 项目 | 说明 |
|------|------|
| 名称 | pdf-reader-mac |
| 类型 | Electron 桌面应用 + 渲染进程 HTML/CSS/JS（ES Module） |
| 核心定位 | 轻量 PDF 单页阅读、书架聚合、大纲目录与阅读书签、阅读进度记忆 |
| 目标平台 | macOS Intel（x64），Electron 打包为 `.app`/zip |

## 2. 技术栈

| 类别 | 技术 |
|------|------|
| 宿主 | Electron 28.x，`BrowserWindow`，`contextIsolation + preload` |
| PDF | PDF.js 4.x（`pdfjs-dist/legacy`，渲染进程 **`import()`** 按需加载，`GlobalWorkerOptions.workerSrc`） |
| 打包 | electron-builder，`electron-builder.json` 配置，`build/icon.png` |
| UI | HTML5/CSS3，`public/renderer.js` ES Module，`public/styles.css` |
| 数据 | JSON 文件，`app.getPath('userData')` 下同应用配置目录 |

### 2.1 与安全

- 主进程 **`nodeIntegration: false`**，`contextBridge`** 暴露 `window.electronAPI`。  
- 内容安全策略定义于 `public/index.html` 的 CSP 标签。

## 3. 功能规格

### 3.1 文件与书架（主进程 / IPC）

- [x] 打开文件对话框选择 PDF（IPC `open-file-dialog` → `dialog` → `file-opened`）。  
- [x] 打开目录作为书架（`open-folder-dialog` → `folder-opened`，包含文件列表）。  
- [x] 按路径 **`read-pdf-file`** 读取二进制；**推荐使用异步 `fs.promises.readFile`**，避免巨量同步读阻塞主进程。  
- [x] 书架路径 **`shelfFolder`** 读写 `pdf-reader-data.json`。  
- [x] 启动时若有有效 `shelfFolder`，可向渲染进程 **`folder-opened`**，自动展示书架。

### 3.2 阅读模式（单页 + 缩放）

- [x] 上一页 / 下一页按钮、当前页数值输入、`totalPages`。  
- [x] 键盘 ← / →（输入框焦点时一般不拦截）。  
- [x] 单画布单页 **`page.render`**；非「整卷连续滚动」，而是分页。  
- [x] **适应宽度 / 高度**、放大镜级缩放、`fitMode` 与 **`scale`** 协同。  
- [x] **适应宽度**：按 CSS 可视宽度缩放整页内容；若页高度超出 `pdf-container` 可视区，**纵向 `overflow: auto`** 滚动查看未被裁切的上下内容。  
- [x] **Retina/高 DPI**：画布像素尺寸乘以 **`devicePixelRatio`**（或与 CSS 换算一致），样式宽高为逻辑像素，避免锯齿与发虚。  

### 3.3 阅读位置与书签存储

- [x] 按 **`filePath` 维度**防抖保存 **`currentPage`（约 1s）**。  
- [x] 再次打开同一文件时 **`get-reading-position`** 恢复起始页（若记录存在且在页数范围内）。  
- [x] 阅读书签（用户标注）：IPC `add-bookmark`、`remove-bookmark`、`get-bookmarks`；数据结构见第 6 节。

### 3.4 「阅读书签」与「PDF 大纲目录」（产品语义）

- **阅读书签**：用户添加的跳转点，独立于 PDF 原生大纲。  
- **PDF 大纲目录**：PDF.js **`getOutline` + `parseOutline`**（异步解析书签树，目标页跳转）。  

#### 已实现行为

- [x] `getOutline`/`parseOutline` 可在 **`loadDeferredOutline`** 中**延后**执行：先 **`renderPage`** 首屏、关闭加载层，再填充 `currentToc`，降低超大 PDF 「长时间白屏」。  
- [x] 若用户在延后完成前切换文档，`loadDeferredOutline` 内应按 **`pdfDoc` 实例**判断是否仍有效。

### 3.5 书架视图

- [x] 网格；点击项 **`readPdfFile`** → **`loadPDF`**.  
- [x] 封面：首页缩略图；同一路径已成功渲染过的 **`canvas.shelf-cover-canvas`** 在 **`renderCoversForVisibleItems`** 中可**跳过**，避免同一书架会话内重复解码。  
- [x] 阅读进度：**`get-reading-position`** 与 **`numPages`** 计算百分比（实现上可能短时二次打开文档，按需优化可作后续项）。  
- [x] 「返回书架」**不**清空网格重绘全部封面（与「更换文件夹」「首次 `renderShelfWithCovers`」区分）。

### 3.6 视图控制与快捷键

- [x] 菜单项通过 **`safeSend`** 向渲染进程派发 `zoom`、`toggle-toc-sidebar`、`toggle-bookmarks-sidebar`、`show-shelf`、`add-bookmark` 等。  
- [x] 窗口缩放 **`resize`** 时重绘当前 PDF 页；书架活动时尝试更新可见封面（已存在画布则跳过重复生成）。

### 3.7 超大 PDF / 加载体验（功能性需求）

- [x] 加载层 **`showLoading` / `setLoadingMessage`**。  
- [x] `getDocument` 返回 **`loadingTask`**：**`loadingTask.onProgress`** 在有 `loaded/total` 时刷新「解析百分比」文案。  
- [x] `getReadingPosition` 与 **`getBookmarks`**：**`Promise.all`**。  
- [x] **延后大纲**：上文 3.4。  
- [x] PDF 数据源：同一进程内通常为完整 `ArrayBuffer`/Uint8Array；远端 Range 流式不在当前规格内。

### 3.8 UI / 交互状态机

#### 书架 / 欢迎

- [x] 顶部工具栏**仅**：「打开」「书架」（外加欢迎态下隐藏的「返回书架」）。  
- [x] **`#toolbarReading`**（翻页 / 缩放 / 大纲按钮 / 阅读书签控件）施加 **`hidden`**。  
- [x] 底部状态栏 **不显示 `#fileName` 当前 PDF 文件名**（`hidden`）。

#### 阅读 PDF

- [x] 显示 **`#toolbarReading`**、**「返回书架」**、`#fileName`、书签指示等完整阅读控件。

#### 侧栏文案（与混淆项区分）

- [x] 大纲侧栏标题语义：**PDF 大纲目录**；书签侧栏：**我的书签**。

### 3.9 应用图标与 Dock

- [x] 资源：**`build/icon.png`**，`electron-builder.json` **`icon`** 字段。  
- [x] 开发：**`BrowserWindow`** 选项 **`icon`**；macOS **`app.dock.setIcon`**（路径存在且不破坏时再调用）。

## 4. UI/UX 结构（示意图）

### 4.1 阅读态工具栏（简化）

```
[ 打开 ] [ 书架 ] [ 返回书架 ] │ [ ◀ 页码 / 总数 ▶ ] │ … 缩放 │ 大纲 │ 添加书签 │ 书签列表 …
```

### 4.2 书架 / 欢迎态工具栏

```
[ 打开 ] [ 书架 ]
```

### 4.3 主内容切换

```
欢迎页 (drop-zone) ⇄ 书架 (shelf-view) ⇄ PDF (pdf-container)
```

### 4.4 配色（节选）

CSS 变量：如 `--primary-bg: #1a1a2e`，`--secondary-bg: #16213e`，书签强调色等参见 `styles.css`。

## 5. 快捷键与菜单（节选）

详见 `README.md` 与应用内菜单；与实现差异以 **`main.js`** 中 `createMenu` 模板为准。

| 快捷键 | 功能 |
|--------|------|
| Cmd/Ctrl + O | 打开… |
| Cmd/Ctrl + Shift + O | 书架文件夹 |
| Cmd/Ctrl + B | 返回书架 |
| Cmd/Ctrl + D | 添加阅读书签 |
| Cmd/Ctrl + Shift + T | PDF 大纲目录侧栏 |
| Cmd/Ctrl + Shift + B | 「我的书签」侧栏 |

## 6. 数据存储

### 6.1 路径

`~/Library/Application Support/pdf-reader-mac/pdf-reader-data.json`（与应用 `name`/`userData` 实际目录一致即可）。

### 6.2 结构（示意）

```json
{
  "readingPositions": { "/path/to/file.pdf": 12 },
  "bookmarks": {
    "/path/to/file.pdf": [
      {
        "id": "1704067200000",
        "page": 12,
        "label": "某章摘要",
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ]
  },
  "shelfFolder": "/path/to/shelf"
}
```

## 7. 构建与分发

| 配置项 | 说明 |
|--------|------|
| `electron-builder.json` | `appId`、`productName`、`directories.output`、`mac.target`、`icon` 等 |
| `package.json` `scripts.build` | 传入 `--config electron-builder.json` |

## 8. 验收标准（增补）

在满足历史版本「能读、能翻页、书架与书签可用」的前提下，增补：

1. **书架态**仅两类主操作入口：**打开** / **书架**；无翻页缩放条。  
2. **书架态**：底部不出现当前打开的 PDF **文件名**。  
3. **适应宽度**下长页：**可滚动**读到页底页顶（非仅能看局部）。  
4. **超大 PDF**：可见解析进度或可接受等待；首页优先于大纲侧栏就绪。  
5. **书架返回**后不无故全量重建已有封面画布（会话内跳过已存在 `canvas.shelf-cover-canvas`）。  
6. 菜单项与 **PDF 大纲** / **阅读书签** 语义可区分并可触发侧栏。

## 9. 非目标（当前版本）

- 连续滚动模式的整本书流式版面。  
- 注释表单填写、手写批注等非只读编排。  
- 基于 HTTP Range 的边下边播（不改变「整文件载入」前提时仍为内存侧限制）。
