# `ecc chipview` / `ecc gdsview` 设计方案

日期：2026-10-15

## 目标

新增 `ecc chipview` 命令，从 workspace 的指定 step 打开
`chip-viewer-native`，效果与 ECOS Studio 点击版图缩略图后的查看模式一致。
公开 CLI 不再提供 `ecc layout-image`。需要查看 step 的 GDS 时使用
`ecc gdsview`，命令启动 KLayout GUI，不生成 PNG。

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

## GDS 查看

`ecc gdsview --workspace <workspace> --step <step>` 从选定 step 的 `output`
目录中查找唯一的 `*.gds` 或 `*.gds.gz`，并将其传给 KLayout 交互式 GUI。
不是所有 step 都发布 GDS；缺少 GDS 时列出当前 workspace 中可用的 step，多个
候选文件时返回歧义错误。KLayout GUI 可执行文件优先取 `KLAYOUT_BIN`，否则从
PATH 查找；KLayout 自带 Qt 运行时，ECC 不额外引入 PyQt/PySide。

缺少 KLayout GUI、Linux 图形环境或目标 GDS 时，命令返回明确的错误码和修复
建议。该命令不影响 ECOS Studio AppImage 的打包和启动；AppImage 只负责提供
原有 `chip-viewer-native`，供 `ecc chipview` 使用。

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
- 不恢复已删除的 `ecc layout-image` 公共命令；流程内部仍可保留已有缩略图产物
  兼容逻辑，避免影响 ECOS Studio 现有 artifact 读取。
