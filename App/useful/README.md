# 音乐播放器桌面版 (Tauri)

使用 Tauri 将网页版音乐播放器打包成桌面应用。

## 项目结构

```
App/useful/
├── index.html              # 主页面
├── main.js                 # Vue 应用入口
├── App.js                  # 主应用组件
├── styles.css              # 样式文件
├── components/             # 组件目录
│   ├── MusicPlayer.js      # 音乐播放器组件
│   └── Upload.js           # 上传组件
├── package.json            # Node.js 配置
└── src-tauri/              # Tauri 后端代码
    ├── Cargo.toml          # Rust 配置
    ├── tauri.conf.json     # Tauri 配置
    ├── build.rs            # 构建脚本
    └── src/
        └── main.rs         # Rust 主程序
```

## 环境要求

1. **Node.js** (v16 或更高)
2. **Rust** (v1.70 或更高)
3. **Tauri CLI**

### 安装 Rust
```powershell
# Windows
winget install Rustlang.Rustup
```

### 安装 Tauri CLI
```bash
npm install -g @tauri-apps/cli
```

## 使用方法

### 安装依赖
```bash
cd App/useful
npm install
```

### 开发模式
```bash
npm run tauri:dev
```

### 构建 Windows 应用
```bash
npm run tauri:build
```

构建完成后，可执行文件将位于 `src-tauri/target/release/` 目录下。

## 注意事项

1. **图标**: 在首次构建前，需要在 `src-tauri/icons/` 目录放置应用图标文件：
   - `32x32.png`
   - `128x128.png`
   - `128x128@2x.png`
   - `icon.icns` (macOS)
   - `icon.ico` (Windows)

2. **API 配置**: 前端代码中的 `API_BASE_URL` 默认为空字符串，需要根据实际情况修改为后端服务器地址。

3. **跨平台**: Tauri 支持 Windows、macOS 和 Linux。
