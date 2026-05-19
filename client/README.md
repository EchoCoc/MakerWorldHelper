# MakerWorld Helper CN Desktop

这是桌面客户端第一版骨架，技术栈为：

- `Electron`
- `React`
- `Vite`

当前已完成：

- Electron 主进程和 preload 桥接
- React 客户端入口
- 本地资源库首页布局
- 仓库、项目列表、项目详情三栏骨架
- 目录选择与系统打开能力的 IPC 占位
- 使用 mock 数据驱动页面，便于后续替换成真实本地扫描

## 目录结构

```text
client/
  electron/
    main.js
    preload.js
  src/
    pages/
      LibraryPage.jsx
    App.jsx
    main.jsx
    mock-data.js
    styles.css
  index.html
  package.json
  vite.config.js
```

## 本地启动

在 `client/` 目录下执行：

```powershell
npm install
npm run dev:desktop
```

## 下一步开发顺序

1. 用真实本地目录扫描替换 `mock-data.js`
2. 读取 `metadata.json` 和 `save-manifest.json`
3. 接入仓库管理、项目移动、打开目录、打开原网页
4. 增加 SQLite 本地索引，减少全量扫描

## 当前 IPC 能力

- `window.desktopAPI.pickDirectory()`
- `window.desktopAPI.openPath(targetPath)`
- `window.desktopAPI.openExternal(url)`

后续可以继续增加：

- 扫描目录
- 读取文件内容
- 移动项目目录
- 打开 3MF / 调用 Bambu Studio
