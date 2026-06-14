import type { TechLayer, TechPreviewGeometry, TechPreviewRect } from './types'

type PreviewWorldRect = TechPreviewRect['world']

interface TechPreviewStyle {
  color: number
  fillAlpha: number
  strokeAlpha: number
}

export interface TechPreviewRenderGroup extends TechPreviewStyle {
  key: string
  layerId: number
  kind: TechPreviewRect['kind']
  rects: TechPreviewRect[]
  drawRects: PreviewWorldRect[]
}

const VIEW_JSON_LAYER_COLORS: Record<string, number> = {
  OVERLAP: 0x888888,
  ACT: 0xcc8844,
  NP: 0x88cc44,
  PP: 0x44cc88,
  NW1: 0x44cccc,
  POLY: 0xff8844,
  CT: 0x999999,
  MET1: 0x4444ff,
  VIA1: 0xaaaaaa,
  MET2: 0xff4444,
  VIA2: 0xbbbbbb,
  MET3: 0x44ff44,
  VIA3: 0xcccccc,
  MET4: 0xffff44,
  VIA4: 0xdddddd,
  MET5: 0xff44ff,
  T4V2: 0x777777,
  T4M2: 0x998877,
  RV: 0x666666,
  RDL: 0x559988,
}

const FALLBACK_COLORS = [
  0x4444ff,
  0xff4444,
  0x44cc88,
  0xff8844,
  0x44cccc,
  0xffff44,
  0xff44ff,
]

export function colorForTechLayer(layer: TechLayer | undefined, fallbackIndex: number): number {
  const layerName = layer?.name.toUpperCase()
  if (layerName && VIEW_JSON_LAYER_COLORS[layerName] !== undefined) {
    return VIEW_JSON_LAYER_COLORS[layerName]
  }
  return FALLBACK_COLORS[fallbackIndex % FALLBACK_COLORS.length]
}

function styleForRect(rect: TechPreviewRect, layer: TechLayer | undefined, fallbackIndex: number): TechPreviewStyle {
  if (rect.kind === 'obs') {
    return { color: 0x64748b, fillAlpha: 0.26, strokeAlpha: 0.82 }
  }
  return {
    color: colorForTechLayer(layer, fallbackIndex),
    fillAlpha: 0.35,
    strokeAlpha: 0.8,
  }
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)]
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)
}

function rectContains(rect: PreviewWorldRect, x: number, y: number, w: number, h: number): boolean {
  return rect.x <= x &&
    rect.y <= y &&
    rect.x + rect.w >= x + w &&
    rect.y + rect.h >= y + h
}

function mergeHorizontal(cells: PreviewWorldRect[]): PreviewWorldRect[] {
  const byBand = new Map<string, PreviewWorldRect[]>()
  for (const cell of cells) {
    const key = `${cell.y}:${cell.h}`
    const band = byBand.get(key)
    if (band) band.push(cell)
    else byBand.set(key, [cell])
  }

  const merged: PreviewWorldRect[] = []
  const sortedBands = [...byBand.values()]
    .sort((a, b) => a[0].y - b[0].y || a[0].h - b[0].h)
  for (const band of sortedBands) {
    const sorted = [...band].sort((a, b) => a.x - b.x)
    let current: PreviewWorldRect | null = null
    for (const cell of sorted) {
      if (current && Math.abs(current.x + current.w - cell.x) < 0.001) {
        current.w += cell.w
      } else {
        if (current) merged.push(current)
        current = { ...cell }
      }
    }
    if (current) merged.push(current)
  }
  return merged
}

function decomposeToNonOverlappingRects(rects: PreviewWorldRect[]): PreviewWorldRect[] {
  const validRects = rects.filter((rect) => rect.w > 0 && rect.h > 0)
  if (validRects.length <= 1) return validRects.map((rect) => ({ ...rect }))

  const xs = uniqueSorted(validRects.flatMap((rect) => [rect.x, rect.x + rect.w]))
  const ys = uniqueSorted(validRects.flatMap((rect) => [rect.y, rect.y + rect.h]))
  const cells: PreviewWorldRect[] = []

  for (let yi = 0; yi < ys.length - 1; yi += 1) {
    const y = ys[yi]
    const h = ys[yi + 1] - y
    if (h <= 0) continue

    for (let xi = 0; xi < xs.length - 1; xi += 1) {
      const x = xs[xi]
      const w = xs[xi + 1] - x
      if (w <= 0) continue

      if (validRects.some((rect) => rectContains(rect, x, y, w, h))) {
        cells.push({ x, y, w, h })
      }
    }
  }

  return mergeHorizontal(cells)
}

export function buildTechPreviewRenderGroups(
  geometry: TechPreviewGeometry,
  layers: TechLayer[] = [],
): TechPreviewRenderGroup[] {
  const layerById = new Map(layers.map((layer) => [layer.id, layer]))
  const layerOrder = new Map(
    [...layers]
      .sort((a, b) => a.order - b.order)
      .map((layer, index) => [layer.id, index]),
  )
  const groups = new Map<string, TechPreviewRenderGroup>()

  for (const rect of geometry.rects) {
    const fallbackIndex = layerOrder.get(rect.layerId) ?? groups.size
    const style = styleForRect(rect, layerById.get(rect.layerId), fallbackIndex)
    const key = `${rect.layerId}:${rect.kind}`
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        layerId: rect.layerId,
        kind: rect.kind,
        rects: [],
        drawRects: [],
        ...style,
      }
      groups.set(key, group)
    }
    group.rects.push(rect)
  }

  return [...groups.values()].map((group) => ({
    ...group,
    drawRects: decomposeToNonOverlappingRects(group.rects.map((rect) => rect.world)),
  }))
}
