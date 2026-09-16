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

/** Pixi 世界坐标 → 显示坐标系下的一点 */
export function displayPointFromWorld(
  worldX: number,
  worldY: number,
  worldHeight: number,
): Vec2 {
  return {
    x: worldX,
    y: worldHeight - worldY,
  }
}

/**
 * DRC/EDA 轴对齐框（llx,lly,urx,ury 为显示坐标：左下原点、Y 向上）→ Pixi 世界 rect（左上 + 宽高，Y 向下）。
 * 与 `COORDINATES.md` 中的显示/世界 Y 轴翻转一致；`worldHeight` 为当前编辑器世界高度。
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
