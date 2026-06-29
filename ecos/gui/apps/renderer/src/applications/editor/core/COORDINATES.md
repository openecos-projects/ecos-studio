# 编辑器坐标系与换算说明

本文说明 ECOS Studio 步骤预览里使用的坐标系、何时做转换、以及常用 API。实现见 `editorCoordinates.ts` 与 `ImagePreviewController.screenToWorld` / `worldToDisplay`。

## 1. 三种坐标

| 名称 | 别名 | 原点与轴向 | 用途 |
|------|------|------------|------|
| 屏幕坐标 | client / canvas 像素 | 画布左上角为 (0,0)，X 右、Y 下 | 鼠标 `offsetX/Y`、事件、与 canvas 对齐 |
| 世界坐标 | world | 与世界内容一致：原点在世界左上角，X 右、Y 下 | 背景图片、视口变换、屏幕反算 |
| 显示 / EDA 坐标 | display、标尺读数 | 原点在世界底边语义上的左下，X 右、Y 上 | 与标尺数字一致、用户可读 `(x, y)` |

`worldHeight` 来自预览控制器 / `setWorldBounds`，表示当前世界盒子的高度；同一套换算里必须和背景图片、标尺使用同一个 `worldHeight`。

## 2. 核心换算关系

- 点：`worldX = displayX`
- Y 轴：`displayY = worldHeight - worldY`
- 反解：`worldY = worldHeight - displayY`
- 矩形：`worldTopLeftFromDisplayBottomLeft(displayX, displayY, width, height, worldHeight)` 将 EDA 左下角 + 宽高转为世界左上锚点。

## 3. 什么时候转换

| 场景 | 从 -> 到 | 做法 |
|------|---------|------|
| 鼠标 / 触摸在画布上 | 屏幕 -> 世界 | `controller.screenToWorld(offsetX, offsetY)` |
| 状态栏显示和标尺一致的坐标 | 世界 -> 显示/EDA | `controller.worldToDisplay(world.x, world.y)` |
| 画布上实时显示鼠标位置 | 屏幕 -> 世界 -> 显示/EDA | `screenToWorld`，再 `worldToDisplay` |
| 从 EDA 坐标摆放图片或辅助图形 | 显示/EDA -> 世界 | `worldPointFromDisplay` 或 `worldTopLeftFromDisplayBottomLeft` |
| 标尺绘制 | 内部用世界 + `worldHeight` 推 display 标签 | `rulerDrawing.ts` 已封装 |

## 4. API 速查

| API | 方向 |
|-----|------|
| `ImagePreviewController.screenToWorld(screenX, screenY)` | 屏幕 -> 世界 |
| `worldPointFromDisplay(dx, dy, worldHeight)` | 显示/EDA 点 -> 世界点 |
| `displayPointFromWorld(wx, wy, worldHeight)` | 世界点 -> 显示/EDA 点 |
| `worldTopLeftFromDisplayBottomLeft(..., worldHeight)` | EDA 矩形左下角 + 尺寸 -> 世界左上角 |

## 5. 与 `worldHeight` 的关系

所有显示/EDA和世界之间的 Y 换算都依赖当前的 `worldHeight`。切换工程、步骤或背景图后，若要做数值对比，应使用同一时刻的 `worldHeight`。

## 6. 当前职责边界

GUI 内的 `DrawingArea` 只负责加载步骤图片预览并提供标尺/坐标显示（Canvas 2D，无 WebGL 依赖）。真实数据版图查看在 Native Layout Viewer；GUI 仅把 `viewJsonPackageRoot` 传给桌面端打开独立查看器。
