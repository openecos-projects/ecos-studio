/**
 * 解析 DRC 步骤输出的 `drc.step.json`（见模板 `drc.distribution.*.layers.*.list`）。
 * JSON 中 llx/lly/urx/ury 按 **EDA 显示坐标**（左下原点、Y 向上）；需传入与版图一致的 `worldHeight`（die 高）转为 Pixi 世界坐标。
 * 见 `COORDINATES.md` §9、`editorCoordinates.edaBBoxToWorldRect`。
 */

import type { Rect } from '@/applications/editor/tile/manifest'
import { edaBBoxToWorldRect } from '@/applications/editor/core/editorCoordinates'

export interface DrcViolation {
  /** Pixi 世界坐标 DBU：轴对齐包围盒左上角（Y 向下，与瓦片/TileManager 一致） */
  x: number
  y: number
  w: number
  h: number
  category: string
  layerName: string
  /** 来自 `net` 数组，逗号分隔，供列表展示 */
  netSummary?: string
}

/** 极小 bbox 时放大到至少 `minSide` DBU，便于视口 zoom-to-fit */
export function violationToFitRect(v: DrcViolation, minSideDbu = 400): Rect {
  const w = Math.max(v.w, minSideDbu)
  const h = Math.max(v.h, minSideDbu)
  const cx = v.x + v.w / 2
  const cy = v.y + v.h / 2
  return { x: cx - w / 2, y: cy - h / 2, w, h }
}

export function parseDrcStepJson(raw: unknown, worldHeight: number): DrcViolation[] {
  const out: DrcViolation[] = []
  if (!Number.isFinite(worldHeight) || worldHeight <= 0) return out
  if (!raw || typeof raw !== 'object') return out
  const root = raw as Record<string, unknown>
  const drc = root.drc
  if (!drc || typeof drc !== 'object') return out
  const dist = (drc as Record<string, unknown>).distribution
  if (!dist || typeof dist !== 'object') return out

  for (const [category, catVal] of Object.entries(dist)) {
    if (!catVal || typeof catVal !== 'object') continue
    const layers = (catVal as Record<string, unknown>).layers
    if (!layers || typeof layers !== 'object') continue
    for (const [layerName, layerVal] of Object.entries(layers)) {
      if (!layerVal || typeof layerVal !== 'object') continue
      const list = (layerVal as Record<string, unknown>).list
      if (!Array.isArray(list)) continue
      for (const item of list) {
        if (!item || typeof item !== 'object') continue
        const o = item as Record<string, unknown>
        const llx = Number(o.llx)
        const lly = Number(o.lly)
        const urx = Number(o.urx)
        const ury = Number(o.ury)
        if (![llx, lly, urx, ury].every(Number.isFinite)) continue
        const { x, y, w, h } = edaBBoxToWorldRect(llx, lly, urx, ury, worldHeight)
        let netSummary: string | undefined
        const netArr = o.net
        if (Array.isArray(netArr) && netArr.length > 0) {
          const parts = netArr.filter((n): n is string => typeof n === 'string')
          if (parts.length > 0) netSummary = parts.join(', ')
        }
        out.push({ x, y, w, h, category, layerName, netSummary })
      }
    }
  }
  return out
}
