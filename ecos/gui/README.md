# ECOS Studio (GUI)

基于 **Tauri + Vue 3 + TypeScript** 构建的高性能桌面端芯片设计应用程序。

## 快速开始

### 安装依赖
```bash
pnpm install
```

### 开发调试
```bash
# 运行前端和 Tauri 后端 (推荐)
pnpm run tauri:dev

# 仅在浏览器中预览前端
pnpm run dev
```

### 项目构建
```bash
# 生成对应平台的安装包 (dmg, exe, deb, AppImage 等)
pnpm run tauri:build
```

## 技术栈

- **Tauri 1.5** - Rust 后端
- **Vue 3** - 前端框架 (Composition API)
- **PixiJS 8** - 高性能 WebGL/WebGPU 渲染
- **PrimeVue 4** - UI 组件 (Aura 主题)
- **Tailwind CSS v4** - 样式方案
- **Vite 7** - 构建工具

## 环境准备

详细的环境配置和开发指南，请参阅：

**[GUI Development Guide](../docs/gui-develop-guide.md)**

包含：
- Node.js、pnpm、Rust 安装
- 系统依赖配置 (macOS/Windows/Linux)
- 项目结构说明
- 开发指南和最佳实践
- 构建和分发说明

## 相关文档

- [GUI Development Guide](../docs/gui-develop-guide.md) - 完整 GUI 开发指南
- [项目主 README](../README.md) - 项目概览和快速开始
- [开发指南](../docs/development.md) - 完整开发环境配置
- [架构文档](../docs/architecture.md) - 系统架构设计

---

Built by the ECOS Team
