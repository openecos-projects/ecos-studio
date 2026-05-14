/**
 * 编辑器 Pixi 世界坐标与「显示 / EDA / 标尺」坐标的换算。
 *
 * - **Pixi 世界**：原点在左上，X 向右，Y **向下**（与 Viewport 子节点一致）。
 * - **显示 / EDA**：左下角为 (0,0)，X 向右，Y **向上**（与 RulerPlugin、常见版图库一致）。
 *
 * 关系：`displayY = worldHeight - worldY`（对同一世界高度 `worldHeight`）。
 */

export interface Vec2 {
  x: number
  y: number
}

/** 显示坐标系下的一点 → Pixi 世界坐标（点） */
export function worldPointFromDisplay(
  displayX: number,
  displayY: number,
  worldHeight: number
): Vec2 {
  return {
    x: displayX,
    y: worldHeight - displayY
  }
}

/** Pixi 世界坐标 → 显示坐标系下的一点 */
export function displayPointFromWorld(
  worldX: number,
  worldY: number,
  worldHeight: number
): Vec2 {
  return {
    x: worldX,
    y: worldHeight - worldY
  }
}

/**
 * 显示/EDA 坐标系下矩形 **左下角** 为 (displayX, displayY) 时，Pixi 里 **左上角** 的世界坐标。
 * 适用于锚点在左上角的 Sprite、Graphics.rect、Container 等（与具体节点类型无关）。
 * `worldHeight` 使用与 `Editor` 一致的世界高度，例如 `editor.worldHeight`。
 */
export function worldTopLeftFromDisplayBottomLeft(
  displayX: number,
  displayY: number,
  _contentWidth: number,
  contentHeight: number,
  worldHeight: number
): Vec2 {
  const bottomWorldY = worldHeight - displayY
  return {
    x: displayX,
    y: bottomWorldY - contentHeight
  }
}

/**
 * DRC/EDA 轴对齐框（llx,lly,urx,ury 为显示坐标：左下原点、Y 向上）→ Pixi 世界 rect（左上 + 宽高，Y 向下）。
 * 与 `COORDINATES.md`、瓦片生成（Rust `gen_layout_tiles`）中 `dieH - y` 翻转一致；`worldHeight` 为 die 高度（与 `Editor.worldHeight` / `dieArea.h` 一致）。
 */
export function edaBBoxToWorldRect(
  llx: number,
  lly: number,
  urx: number,
  ury: number,
  worldHeight: number,
): { x: number; y: number; w: number; h: number } {
  const minX = Math.min(llx, urx)
  const maxX = Math.max(llx, urx)
  const minY = Math.min(lly, ury)
  const maxY = Math.max(lly, ury)
  return {
    x: minX,
    y: worldHeight - maxY,
    w: maxX - minX,
    h: maxY - minY,
  }
}
