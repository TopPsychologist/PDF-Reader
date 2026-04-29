# PDF Reader for macOS Intel

轻量级 PDF 阅读器，基于 Electron + PDF.js 构建，支持单页翻页、书架功能、书签管理、目录导航和阅读位置记忆。

## 功能特性

- 单页 PDF 渲染，逐页翻阅
- 适应窗口高度显示
- 书架模式：指定文件夹作为书架，自动扫描展示 PDF
- 书架封面预览：第一页缩略图
- 书架阅读进度显示
- 书架路径持久化保存
- 阅读位置记忆：自动保存阅读进度，重新打开自动跳转
- 书签功能：添加书签、删除书签、书签列表快速跳转
- 目录功能：解析 PDF 大纲/目录，快速跳转章节
- 缩放控制：放大、缩小、适应宽度、适应高度
- 键盘快捷键翻页
- 拖拽打开 PDF 文件
- 深色主题界面
- 加载动画优化

## 开发环境

- **Node.js**: v18.x 或更高
- **npm**: v9.x 或更高
- **Electron**: v28.x
- **PDF.js**: v4.x
- **electron-builder**: v24.x

## 安装依赖

```bash
npm install
```

## 开发运行

```bash
npm run dev
```

启动开发模式，在 Electron 窗口中预览应用。

## 构建打包

### macOS Intel 版本 (zip)

```bash
npm run build
```

构建完成后，输出文件位于 `dist/PDF Reader-1.0.0-mac.zip`

### macOS Intel 版本 (目录)

```bash
npm run build:dir
```

构建完成后，应用位于 `dist/mac/PDF Reader.app`

## 目录结构

```
pdf-reader-mac/
├── src/
│   ├── main.js          # Electron 主进程
│   └── preload.js       # 预加载脚本
├── public/
│   ├── index.html       # 主页面
│   ├── styles.css       # 样式
│   └── renderer.js      # PDF 渲染逻辑
├── dist/                # 构建输出目录
├── node_modules/        # 依赖包
├── package.json         # 项目配置
├── SPEC.md             # 项目规范
└── README.md           # 项目说明
```

## 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| ← | 上一页 |
| → | 下一页 |
| Cmd/Ctrl + O | 打开文件 |
| Cmd/Ctrl + Shift + O | 打开书架文件夹 |
| Cmd/Ctrl + B | 返回书架 |
| Cmd/Ctrl + D | 添加书签 |
| Cmd/Ctrl + = | 放大 |
| Cmd/Ctrl + - | 缩小 |
| Cmd/Ctrl + 0 | 适应页面宽度 |
| Cmd/Ctrl + 1 | 适应窗口高度 |

## 使用说明

### 书架功能

1. 点击工具栏「书架」
2. 选择包含 PDF 文件的文件夹
3. 书架路径会自动保存，下次启动自动加载
4. 点击书架中的 PDF 封面即可阅读
5. 书架会显示封面预览和阅读进度

### 从文件打开

1. 点击工具栏「打开文件」
2. 选择 PDF 文件即可阅读
3. 使用 ← → 键或按钮翻页

### 返回书架

阅读 PDF 时，点击工具栏「返回书架」按钮即可返回书架视图。

### 拖拽打开

直接将 PDF 文件拖入窗口即可打开。

### 阅读位置记忆

- 应用会自动保存当前阅读页码
- 重新打开同一 PDF 时，会自动跳转到上次阅读位置
- 无需手动保存书签

### 书签功能

- 点击工具栏「书签」按钮添加当前页书签
- 点击「书签列表」按钮查看所有书签
- 点击书签可快速跳转
- 点击书签旁的「删除」删除书签
- 当前页已添加书签时，状态栏会显示提示

### 目录功能

- 点击工具栏「目录」按钮打开目录侧边栏
- 点击目录项可快速跳转到对应页面
- 支持 PDF 大纲/书签解析

### 视图模式

- 适应宽度：PDF 宽度适应窗口宽度
- 适应高度：PDF 高度适应窗口高度（默认模式）

## 数据存储

阅读位置、书签和书架路径数据存储在:

```
~/Library/Application Support/pdf-reader-mac/pdf-reader-data.json
```

## 构建配置说明

项目使用 electron-builder 进行打包，主要配置在 `package.json` 的 `build` 字段：

```json
{
  "build": {
    "appId": "com.pdfreader.mac",
    "productName": "PDF Reader",
    "mac": {
      "target": [
        {
          "target": "zip",
          "arch": ["x64"]
        }
      ],
      "category": "public.app-category.productivity"
    },
    "directories": {
      "output": "dist"
    }
  }
}
```

- `appId`: 应用的唯一标识
- `productName`: 应用名称
- `mac.target`: 目标格式 (zip/dmg)
- `mac.arch`: 目标架构 (x64 = Intel)
- `mac.category`: macOS 应用类别

## 常见问题

### 构建失败：dmg-license 错误

如果遇到 `Cannot find module 'dmg-license'` 错误，修改 `package.json` 将 `target` 改为 `zip`：

```json
"target": [
  {
    "target": "zip",
    "arch": ["x64"]
  }
]
```

### 开发模式无法运行

Electron 需要 GUI 环境，在无头服务器上只能进行打包构建。

### 加载超大 PDF 时可能卡顿

应用已优化为单页渲染，每次只加载一页内容。如遇卡顿，请耐心等待。

### 封面预览加载慢

封面预览会在书架打开时异步加载，可能会稍有延迟。

## License

MIT
