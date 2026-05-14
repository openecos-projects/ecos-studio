# 编辑器坐标系与换算说明

本文说明 ECOS Studio 编辑器里涉及的坐标系、何时做转换、以及常用 API。实现见 `editorCoordinates.ts` 与 `Editor.displayToWorld` / `worldToDisplay`。

---

## 1. 三种坐标

| 名称 | 别名 | 原点与轴向 | 用途 |
|------|------|------------|------|
| **屏幕坐标** | client / canvas 像素 | 画布左上角为 (0,0)，X 右、Y **下** | 鼠标 `offsetX/Y`、事件、与 Pixi 画布对齐 |
| **Pixi 世界坐标** | Viewport 世界、world | 与 Viewport 子节点一致：原点在**世界左上角**，X 右、Y **下** | 版图 `Graphics.rect`、Sprite、`viewport.toWorld`、空间索引、相机变换 |
| **显示 / EDA 坐标** | display、标尺读数 | 原点在**世界底边偏左**语义上的「左下」，X 右、Y **上** | 与标尺数字一致、常见版图库落库、用户可读 `(x, y)` |

> **注意**：`worldHeight` 来自 `Editor` / `setWorldBounds`，表示当前「世界盒子」的高度；同一套换算里必须和渲染、标尺使用**同一个** `worldHeight`。

---

## 2. 核心换算关系（2D）

- **点**
  - `worldX = displayX`
  - `displayY = worldHeight - worldY`（显示 Y 向上 ↔ 世界 Y 向下）
  - 反解：`worldY = worldHeight - displayY`

- **矩形（EDA 左下角 + 宽高 → Pixi 左上锚点）**  
  见 `worldTopLeftFromDisplayBottomLeft(displayX, displayY, width, height, worldHeight)`。

---

## 3. 什么时候要转？转成什么？

| 场景 | 从 → 到 | 做法 |
|------|---------|------|
| 鼠标 / 触摸在画布上 | 屏幕 → **世界** | `editor.view.toWorld(offsetX, offsetY)` |
| 版图拾取、框选、与 `SpatialIndex` 查询 | 保持 **世界** | 用 `toWorld` 得到的 `world.x/y`，与 `box.rect` 同系 |
| 状态栏、提示框显示「和标尺一致」的坐标 | 世界 → **显示/EDA** | `editor.worldToDisplay(world.x, world.y)` |
| 画布上实时显示鼠标位置（如 `DrawingArea` 右上角） | 屏幕 → 世界 → **显示/EDA** | `viewport.toWorld(offsetX, offsetY)`，再 `editor.worldToDisplay` |
| 从 EDA/DB 读「左下角 + 宽高」要画图 | **显示/EDA** → 世界 | `editor.displayToWorld`（点）或 `worldTopLeftFromDisplayBottomLeft`（矩形左上） |
| 写入数据库、导出 GDSII 等要左下原点 | 世界 → **显示/EDA** | `editor.worldToDisplay` 或 `displayPointFromWorld` |
| 标尺绘制 | 内部用世界 + `worldHeight` 推 display 标签 | `RulerPlugin` 已封装 |

---

## 4. API 速查

| API | 方向 |
|-----|------|
| `viewport.toWorld(screenX, screenY)` | 屏幕 → 世界 |
| `Editor.displayToWorld(dx, dy)` | 显示/EDA 点 → 世界点 |
| `Editor.worldToDisplay(wx, wy)` | 世界点 → 显示/EDA 点 |
| `worldTopLeftFromDisplayBottomLeft(..., worldHeight)` | EDA 矩形左下角 + 尺寸 → 世界左上角（Pixi 摆放用） |
| `worldPointFromDisplay` / `displayPointFromWorld` | 同上，需自行传入 `worldHeight` 时 |

---

## 5. 常见疑问：拾取要不要先转成 EDA？

**不需要。** 只要版图里的 `box.rect` 与 `LayoutRenderer` 画在 Viewport 里用的是**同一套 Pixi 世界坐标**，空间索引也是按**世界**建的，则：

1. `toWorld` 得到的就是与几何、命中测试一致的坐标；
2. **拾取、拖拽、框选**全程在**世界坐标**下做即可；
3. **只有**需要和**标尺数字、数据库里的 EDA 约定、用户界面文案**对齐时，再把该点或矩形用 `worldToDisplay` / `displayToWorld` 转一层。

若将来数据管线改为「内存里只存 EDA、每帧转成世界再画」，则应在**进入渲染/索引之前**统一转到世界，拾取仍应对齐**最终画在屏幕上的那套世界坐标**。

---

## 6. 与 `worldHeight` 的关系

所有「显示 ↔ 世界」的 Y 换算都依赖当前的 `worldHeight`（`setWorldBounds`、背景图尺寸、die 等会改它）。切换版图或换底图后，若要做数值对比，应使用**同一时刻**的 `editor.worldHeight`。

---

## 7. 为啥总提到「转成世界坐标」？和 EDA 数学坐标系谁说了算？

**不是因为「EDA 错、世界才对」。** Pixi Viewport 里子节点的 `x,y`、以及 `toWorld` 给出的，是**同一套连续空间里的数**——文档里把它叫做 **Pixi 世界坐标**，只是给这套**渲染 + 相机 + 屏幕反算**用的名字。

- **EDA / 数学坐标系**（常见：左下为原点、Y 向上、X 向右）：适合**你收到的数据、库表、和纸面几何**对齐，这是**业务真值**。
- **世界坐标**：适合**当前引擎**里「所有 Sprite/Graphics 放在同一个父节点下、用同一套变换画到屏上」——是**实现层选用的内部表示**，和屏幕之间只差 Viewport 的矩阵。

所以流程是：**EDA 真值 →（在边界做一次线性变换）→ 世界 → 渲染 / 拾取**；或反过来导出时再转回 EDA。**拾取要和「画出来用的那套数」一致**，当前实现里画用的是世界，所以鼠标先 `toWorld` 与 `box.rect` 对齐；若你全程在内存里用 EDA 存几何，则要么：

- **仍在边界转世界**再画（推荐，改动小），要么  
- **重写**渲染与索引，使内部统一用 EDA，并在与 `toWorld` 衔接处集中做一次变换（工作量大，要改 `LayoutRenderer`、`SpatialIndex`、`InteractionManager` 等）。

---

## 8. 以前方案变了要不要改代码？

- 若**仍约定**：落库是 EDA 数学坐标 → **加载时**转成当前引擎用的世界（或 display 再转世界）→ **渲染 / 索引 / 拾取**用世界：则**只需保证「转换公式」和 `worldHeight` 与版图范围一致**，不必为「文档里写过旧说法」而改业务。  
- 若你**改成**「内存里只保留 EDA、不再转世界存 rect」：则**必须**同步改：画图用的坐标、空间索引的坐标、以及鼠标是 `toWorld` 后再转 EDA 再比较，或自定义 `toEda` 与索引一致——**不能只改一半**。

**结论**：以 **EDA 数学坐标系**为准作为**数据源**没问题；**世界**是引擎内部为了和 Pixi 一致而选的**一套数**，用 `editorCoordinates` 在边界换算即可。方案切换时，改**数据进入渲染与索引的那条链路**，保证「画的、点的、存的」三处自洽。

---

## 9. 瓦片模式（`TileManager` / Electron `tile-helper`）

- 桌面端由 Electron `tile-helper`（`packages/tile-helper/src/generate.ts`）把布局 JSON 里的几何**先**按与 `LayoutRenderer` 一致的约定放进 **Pixi 世界**：在 die 局部范围内 Y 轴向下（解析时用 `dieH - y` 翻转），`manifest.dieArea` 一般为 `{ x:0, y:0, w, h }`，瓦片与实例坐标都在 **`[0, w) × [0, h)`** 世界坐标里。
- `TileManager.init()` 会把 **Viewport** 的 `worldWidth` / `worldHeight` 设为 `dieArea.w` / `dieArea.h`，但 **`Editor` 内部的 `worldWidth` / `worldHeight`（`setWorldBounds`）不会自动跟着变**。
- 因此进入瓦片视图时（例如 `DrawingArea` 里 `loadTileLayout` 在 `tileManager.init()` 之后）必须再调用 **`editor.setWorldBounds(dieArea.w, dieArea.h)`**，这样 `worldToDisplay`、状态栏/鼠标 EDA 坐标与 `worldHeight` 才与瓦片几何、标尺一致。
