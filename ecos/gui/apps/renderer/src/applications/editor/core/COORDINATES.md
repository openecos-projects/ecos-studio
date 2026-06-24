# 编辑器坐标系与换算说明

本文说明 ECOS Studio 编辑器里仍在使用的坐标系、何时做转换、以及常用 API。实现见 `editorCoordinates.ts` 与 `Editor.displayToWorld` / `worldToDisplay`。

## 1. 三种坐标

| 名称 | 别名 | 原点与轴向 | 用途 |
|------|------|------------|------|
| 屏幕坐标 | client / canvas 像素 | 画布左上角为 (0,0)，X 右、Y 下 | 鼠标 `offsetX/Y`、事件、与 Pixi 画布对齐 |
| Pixi 世界坐标 | Viewport 世界、world | 与 Viewport 子节点一致：原点在世界左上角，X 右、Y 下 | 背景图片、Viewport 相机变换、屏幕反算 |
| 显示 / EDA 坐标 | display、标尺读数 | 原点在世界底边语义上的左下，X 右、Y 上 | 与标尺数字一致、用户可读 `(x, y)` |

`worldHeight` 来自 `Editor` / `setWorldBounds`，表示当前世界盒子的高度；同一套换算里必须和背景图片、标尺使用同一个 `worldHeight`。

## 2. 核心换算关系

- 点：`worldX = displayX`
- Y 轴：`displayY = worldHeight - worldY`
- 反解：`worldY = worldHeight - displayY`
- 矩形：`worldTopLeftFromDisplayBottomLeft(displayX, displayY, width, height, worldHeight)` 将 EDA 左下角 + 宽高转为 Pixi 左上锚点。

## 3. 什么时候转换

| 场景 | 从 -> 到 | 做法 |
|------|---------|------|
| 鼠标 / 触摸在画布上 | 屏幕 -> 世界 | `editor.view.toWorld(offsetX, offsetY)` |
| 状态栏显示和标尺一致的坐标 | 世界 -> 显示/EDA | `editor.worldToDisplay(world.x, world.y)` |
| 画布上实时显示鼠标位置 | 屏幕 -> 世界 -> 显示/EDA | `viewport.toWorld(offsetX, offsetY)`，再 `editor.worldToDisplay` |
| 从 EDA 坐标摆放图片或辅助图形 | 显示/EDA -> 世界 | `editor.displayToWorld` 或 `worldTopLeftFromDisplayBottomLeft` |
| 标尺绘制 | 内部用世界 + `worldHeight` 推 display 标签 | `RulerPlugin` 已封装 |

## 4. API 速查

| API | 方向 |
|-----|------|
| `viewport.toWorld(screenX, screenY)` | 屏幕 -> 世界 |
| `Editor.displayToWorld(dx, dy)` | 显示/EDA 点 -> 世界点 |
| `Editor.worldToDisplay(wx, wy)` | 世界点 -> 显示/EDA 点 |
| `worldTopLeftFromDisplayBottomLeft(..., worldHeight)` | EDA 矩形左下角 + 尺寸 -> 世界左上角 |
| `worldPointFromDisplay` / `displayPointFromWorld` | 同上，需自行传入 `worldHeight` 时 |

## 5. 与 `worldHeight` 的关系

所有显示/EDA和世界之间的 Y 换算都依赖当前的 `worldHeight`。切换工程、步骤或背景图后，若要做数值对比，应使用同一时刻的 `editor.worldHeight`。

## 6. 当前职责边界

GUI 内的 `DrawingArea` 只负责加载步骤图片预览并提供标尺/坐标显示。真实数据版图查看已经迁移到 Native Layout Viewer；GUI 仅把 `viewJsonPackageRoot` 传给桌面端打开独立查看器。
