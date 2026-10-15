# `ecc chipview` 设计方案

日期：2026-10-15

## 目标

新增 `ecc chipview` 命令，从 workspace 的指定 step 打开
`chip-viewer-native`，效果与 ECOS Studio 点击版图缩略图后的查看模式一致。
现有 `ecc layout-image` 继续负责 GDS 转 PNG。

```bash
ecc chipview --project /path/to/project --workspace <workspace> --step route_ecc
```

`--project` 和 `--workspace` 沿用 ECC CLI 的项目/workspace 解析规则；
`--workspace` 可省略以使用当前 workspace，`--step` 必须提供。

## 数据来源

命令不读取 GDS，也不生成 PNG。它从 workspace 的 `home/flow.json` 解析 step
目录，然后打开：

```text
<workspace>/<step-directory>/output/geometry/geometry.manifest
```

Viewer 根据 manifest 读取同一 geometry 目录下的 shapes、payload、layers、
names 等 sidecar 文件。DRC step 若有 `analysis/drc_statis.csv`，会追加
`--drc-statis`；若有 `feature` 目录，会追加 `--map-root`。

## AppImage 和 Viewer 前置条件

正常场景是从正在运行的 ECOS Studio AppImage 内置终端执行命令。Electron
运行环境会设置：

```text
ECOS_CHIP_VIEWER_BIN=<AppImage resources>/binaries/chip-viewer-native
```

ECC CLI 按以下顺序查找 Viewer：

1. `ECOS_CHIP_VIEWER_BIN`；
2. `ECOS_ELECTRON_RESOURCES_PATH/binaries/chip-viewer-native`；
3. PATH 中的 `chip-viewer-native`，用于开发环境或显式安装的 Viewer。

如果找不到可执行文件，命令返回 `chipview_viewer_unavailable`，提示从
AppImage 内置终端运行或设置 `ECOS_CHIP_VIEWER_BIN`。命令不会回退到 GDS/PNG
渲染。Linux 下还必须存在 `DISPLAY`、`WAYLAND_DISPLAY` 或 `WAYLAND_SOCKET`。

## 防呆校验

启动前检查 Linux 平台、项目/workspace、flow ledger、指定 step、geometry
manifest、manifest sidecar、Viewer 可执行文件和图形环境。错误记录包含稳定
错误码、路径和修复建议，覆盖未知 step、geometry 不完整、Viewer 缺失、显示
环境缺失以及 Viewer 启动后立即退出。

## 启动行为

命令使用与 GUI 相同的原生参数：

```text
chip-viewer-native --manifest <manifest> --mode view
```

可选追加 `--drc-statis` 和 `--map-root`。Viewer 以独立 session 启动，日志写入
workspace 下的 `.chip-viewer/logs/`，CLI 在短暂启动健康检查通过后返回成功。

## 实现边界

- ECC CLI 负责项目/step 解析、前置检查和进程启动。
- ECOS GUI 负责在内置终端运行环境中注入 AppImage Viewer 路径。
- `chip-viewer-native` 负责 geometry manifest 读取、渲染和窗口生命周期。
- 不修改 `ecc layout-image` 的现有行为。
