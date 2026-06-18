import type { ViewJsonObjectKind, ViewJsonPathRenderable, ViewJsonRectRenderable } from './types'

export interface ViewJsonRectBatchBuffers {
  positions: Float32Array
  uvs: Float32Array
  indices: Uint32Array
  rectCount: number
}

interface CachedViewJsonRectBatch {
  signature: string
  buffers: ViewJsonRectBatchBuffers
}

interface CachedViewJsonOverviewAggregation {
  signature: string
  rects: ViewJsonRectRenderable[]
}

export interface ViewJsonRectBatchBufferOptions {
  flattenSingleAlphaCoverage?: boolean
  flatCoverageCellSize?: number
}

const VIEW_JSON_FLAT_COVERAGE_MAX_EXACT_RECTS = 2400
const VIEW_JSON_BATCH_SIGNATURE_SAMPLE_LIMIT = 256
const VIEW_JSON_FNV_OFFSET = 2166136261
const VIEW_JSON_FNV_PRIME = 16777619
const VIEW_JSON_MAX_CELLS_PER_OVERVIEW_ITEM = 512

export class ViewJsonRectBatchBufferCache {
  private readonly batches = new Map<string, CachedViewJsonRectBatch>()

  get size(): number {
    return this.batches.size
  }

  getBuffers(
    key: string,
    rects: ViewJsonRectRenderable[],
    options: ViewJsonRectBatchBufferOptions = {},
  ): ViewJsonRectBatchBuffers {
    const signature = [
      options.flattenSingleAlphaCoverage ? 'flat' : 'raw',
      Number.isFinite(options.flatCoverageCellSize) ? options.flatCoverageCellSize : 'auto',
      getViewJsonRectBatchSignature(rects),
    ].join(':')
    const cached = this.batches.get(key)
    if (cached?.signature === signature) return cached.buffers
    const batchRects = options.flattenSingleAlphaCoverage
      ? flattenViewJsonRectsForSingleAlphaCoverage(rects, {
        cellSize: options.flatCoverageCellSize,
      })
      : rects
    const buffers = buildViewJsonRectBatchBuffers(batchRects)
    this.batches.set(key, { signature, buffers })
    return buffers
  }

  clear(): void {
    this.batches.clear()
  }
}

export class ViewJsonOverviewAggregationCache {
  private readonly batches = new Map<string, CachedViewJsonOverviewAggregation>()

  get size(): number {
    return this.batches.size
  }

  getRects(key: string, rects: ViewJsonRectRenderable[], cellSize: number): ViewJsonRectRenderable[] {
    const signature = `${cellSize}:${getViewJsonRectBatchSignature(rects)}`
    const cached = this.batches.get(key)
    if (cached?.signature === signature) return cached.rects
    const aggregated = aggregateViewJsonRectsForLowZoom(rects, cellSize)
    this.batches.set(key, { signature, rects: aggregated })
    return aggregated
  }

  getPaths(key: string, paths: ViewJsonPathRenderable[], cellSize: number): ViewJsonRectRenderable[] {
    const signature = `${cellSize}:${getViewJsonPathBatchSignature(paths)}`
    const cached = this.batches.get(key)
    if (cached?.signature === signature) return cached.rects
    const aggregated = aggregateViewJsonPathsForLowZoom(paths, cellSize)
    this.batches.set(key, { signature, rects: aggregated })
    return aggregated
  }

  clear(): void {
    this.batches.clear()
  }
}

export function buildViewJsonRectBatchBuffers(
  rects: ViewJsonRectRenderable[],
): ViewJsonRectBatchBuffers {
  const renderable = rects.filter(rect => rect.world.w > 0 && rect.world.h > 0)
  const positions = new Float32Array(renderable.length * 8)
  const uvs = new Float32Array(renderable.length * 8)
  const indices = new Uint32Array(renderable.length * 6)

  for (let index = 0; index < renderable.length; index += 1) {
    const rect = renderable[index]
    const vertexOffset = index * 8
    const indexOffset = index * 6
    const base = index * 4
    const x1 = rect.world.x
    const y1 = rect.world.y
    const x2 = rect.world.x + rect.world.w
    const y2 = rect.world.y + rect.world.h

    positions.set([x1, y1, x2, y1, x2, y2, x1, y2], vertexOffset)
    uvs.set([0, 0, 1, 0, 1, 1, 0, 1], vertexOffset)
    indices.set([base, base + 1, base + 2, base, base + 2, base + 3], indexOffset)
  }

  return {
    positions,
    uvs,
    indices,
    rectCount: renderable.length,
  }
}

interface ViewJsonFlatCoverageOptions {
  cellSize?: number
  maxExactRects?: number
}

interface ViewJsonNormalizedCoverageRect {
  rect: ViewJsonRectRenderable
  index: number
  x1: number
  y1: number
  x2: number
  y2: number
}

interface ViewJsonCoverageEvent {
  y: number
  type: 'start' | 'end'
  rect: ViewJsonNormalizedCoverageRect
}

interface ViewJsonCoverageInterval {
  x1: number
  x2: number
}

export function flattenViewJsonRectsForSingleAlphaCoverage(
  rects: ViewJsonRectRenderable[],
  options: ViewJsonFlatCoverageOptions = {},
): ViewJsonRectRenderable[] {
  const normalized = normalizeCoverageRects(rects)
  if (normalized.length <= 1) return rects
  if (normalized.length > (options.maxExactRects ?? VIEW_JSON_FLAT_COVERAGE_MAX_EXACT_RECTS)) {
    return flattenViewJsonRectsByCoverageGrid(normalized, options.cellSize)
  }

  const events: ViewJsonCoverageEvent[] = []
  for (const rect of normalized) {
    events.push({ y: rect.y1, type: 'start', rect })
    events.push({ y: rect.y2, type: 'end', rect })
  }
  events.sort((left, right) => left.y - right.y)

  const active = new Map<number, ViewJsonNormalizedCoverageRect>()
  const flattened: ViewJsonRectRenderable[] = []
  let previousY = events[0]?.y ?? 0
  let eventIndex = 0
  while (eventIndex < events.length) {
    const currentY = events[eventIndex].y
    appendCoverageBand(flattened, normalized[0].rect, previousY, currentY, [...active.values()])

    while (eventIndex < events.length && events[eventIndex].y === currentY) {
      const event = events[eventIndex]
      if (event.type === 'end') {
        active.delete(event.rect.index)
      } else {
        active.set(event.rect.index, event.rect)
      }
      eventIndex += 1
    }
    previousY = currentY
  }

  return flattened
}

function normalizeCoverageRects(rects: ViewJsonRectRenderable[]): ViewJsonNormalizedCoverageRect[] {
  const normalized: ViewJsonNormalizedCoverageRect[] = []
  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects[index]
    if (!rect || rect.world.w <= 0 || rect.world.h <= 0) continue
    normalized.push({
      rect,
      index,
      x1: rect.world.x,
      y1: rect.world.y,
      x2: rect.world.x + rect.world.w,
      y2: rect.world.y + rect.world.h,
    })
  }
  return normalized
}

function appendCoverageBand(
  flattened: ViewJsonRectRenderable[],
  baseRect: ViewJsonRectRenderable,
  y1: number,
  y2: number,
  activeRects: ViewJsonNormalizedCoverageRect[],
): void {
  if (y2 <= y1 || activeRects.length === 0) return
  const intervals = mergeCoverageIntervals(activeRects.map(rect => ({ x1: rect.x1, x2: rect.x2 })))
  for (const interval of intervals) {
    appendFlatCoverageRect(flattened, baseRect, interval.x1, y1, interval.x2, y2)
  }
}

function mergeCoverageIntervals(intervals: ViewJsonCoverageInterval[]): ViewJsonCoverageInterval[] {
  const sorted = intervals
    .filter(interval => interval.x2 > interval.x1)
    .sort((left, right) => left.x1 - right.x1 || left.x2 - right.x2)
  const merged: ViewJsonCoverageInterval[] = []
  for (const interval of sorted) {
    const previous = merged[merged.length - 1]
    if (previous && interval.x1 <= previous.x2) {
      previous.x2 = Math.max(previous.x2, interval.x2)
      continue
    }
    merged.push({ ...interval })
  }
  return merged
}

function appendFlatCoverageRect(
  flattened: ViewJsonRectRenderable[],
  baseRect: ViewJsonRectRenderable,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  if (x2 <= x1 || y2 <= y1) return
  const previous = flattened[flattened.length - 1]
  if (
    previous
    && previous.layerId === baseRect.layerId
    && previous.objectKind === baseRect.objectKind
    && previous.world.x === x1
    && previous.world.w === x2 - x1
    && previous.world.y + previous.world.h === y1
  ) {
    previous.world.h = y2 - previous.world.y
    previous.eda = [
      previous.world.x,
      previous.world.y,
      previous.world.x + previous.world.w,
      previous.world.y + previous.world.h,
    ]
    return
  }

  flattened.push({
    ...baseRect,
    id: `flat-coverage:${baseRect.objectKind}:${baseRect.layerId ?? 'none'}:${flattened.length}`,
    sourceId: -1,
    eda: [x1, y1, x2, y2],
    world: {
      x: x1,
      y: y1,
      w: x2 - x1,
      h: y2 - y1,
    },
    overviewWeight: 1,
    overviewDirection: undefined,
  })
}

function flattenViewJsonRectsByCoverageGrid(
  rects: ViewJsonNormalizedCoverageRect[],
  requestedCellSize?: number,
): ViewJsonRectRenderable[] {
  void requestedCellSize
  return rects.map(rect => rect.rect)
}

function clipViewJsonRectToCells(
  rect: ViewJsonRectRenderable,
  cellSize: number,
  idPrefix: string,
): ViewJsonRectRenderable[] {
  const maxX = rect.world.x + rect.world.w
  const maxY = rect.world.y + rect.world.h
  const edgeEpsilon = cellSize * 1e-9
  const fromCellX = Math.floor(rect.world.x / cellSize)
  const toCellX = Math.floor((maxX - edgeEpsilon) / cellSize)
  const fromCellY = Math.floor(rect.world.y / cellSize)
  const toCellY = Math.floor((maxY - edgeEpsilon) / cellSize)
  if (cellRangeCount(fromCellX, toCellX, fromCellY, toCellY) > VIEW_JSON_MAX_CELLS_PER_OVERVIEW_ITEM) {
    return [overviewFallbackRect(rect, `${idPrefix}:fallback:${rect.id}`)]
  }
  const clippedRects: ViewJsonRectRenderable[] = []

  for (let cy = fromCellY; cy <= toCellY; cy += 1) {
    for (let cx = fromCellX; cx <= toCellX; cx += 1) {
      const cellMinX = cx * cellSize
      const cellMinY = cy * cellSize
      const cellMaxX = cellMinX + cellSize
      const cellMaxY = cellMinY + cellSize
      const x1 = Math.max(rect.world.x, cellMinX)
      const y1 = Math.max(rect.world.y, cellMinY)
      const x2 = Math.min(maxX, cellMaxX)
      const y2 = Math.min(maxY, cellMaxY)
      if (x2 <= x1 || y2 <= y1) continue
      clippedRects.push({
        ...rect,
        id: `${idPrefix}:${rect.objectKind}:${rect.layerId ?? 'none'}:${cx}:${cy}:${clippedRects.length}`,
        eda: [x1, y1, x2, y2],
        world: {
          x: x1,
          y: y1,
          w: x2 - x1,
          h: y2 - y1,
        },
        overviewWeight: rect.overviewWeight ?? 1,
      })
    }
  }

  return clippedRects
}

export function groupViewJsonRectsForBatching(
  rects: ViewJsonRectRenderable[],
  objectKind: ViewJsonObjectKind,
): Map<string, ViewJsonRectRenderable[]> {
  const groups = new Map<string, ViewJsonRectRenderable[]>()
  for (const rect of rects) {
    if (rect.objectKind !== objectKind) continue
    const key = `${rect.objectKind}:${rect.layerId ?? 'none'}`
    const group = groups.get(key)
    if (group) {
      group.push(rect)
    } else {
      groups.set(key, [rect])
    }
  }
  return groups
}

export function aggregateViewJsonRectsForLowZoom(
  rects: ViewJsonRectRenderable[],
  cellSize: number,
): ViewJsonRectRenderable[] {
  if (!Number.isFinite(cellSize) || cellSize <= 0) return rects

  const cells = new Map<string, ViewJsonRectRenderable>()
  for (const rect of rects) {
    if (rect.world.w <= 0 || rect.world.h <= 0) continue

    for (const clipped of clipViewJsonRectToCells(rect, cellSize, 'aggregate-rect')) {
      const key = [
        clipped.objectKind,
        clipped.layerId ?? 'none',
        clipped.overviewDirection ?? 'none',
        clipped.world.x,
        clipped.world.y,
        clipped.world.w,
        clipped.world.h,
      ].join(':')
      const existing = cells.get(key)
      if (existing) {
        existing.overviewWeight = (existing.overviewWeight ?? 1) + (rect.overviewWeight ?? 1)
      } else {
        cells.set(key, {
          ...clipped,
          sourceId: -1,
        })
      }
    }
  }

  return [...cells.values()]
}

export function aggregateViewJsonPathsForLowZoom(
  paths: ViewJsonPathRenderable[],
  cellSize: number,
): ViewJsonRectRenderable[] {
  if (!Number.isFinite(cellSize) || cellSize <= 0) return []

  const cells = new Map<string, ViewJsonRectRenderable>()
  for (const path of paths) {
    for (let pointIndex = 1; pointIndex < path.worldPoints.length; pointIndex += 1) {
      const start = path.worldPoints[pointIndex - 1]
      const end = path.worldPoints[pointIndex]
      if (!start || !end) continue

      const halfWidth = Math.max(path.width, 1) / 2
      const horizontal = start.y === end.y
      const vertical = start.x === end.x
      const overviewDirection = horizontal
        ? 'horizontal'
        : vertical
          ? 'vertical'
          : 'mixed'
      const minX = Math.min(start.x, end.x) - (vertical ? halfWidth : 0)
      const maxX = Math.max(start.x, end.x) + (vertical ? halfWidth : 0)
      const minY = Math.min(start.y, end.y) - (horizontal ? halfWidth : 0)
      const maxY = Math.max(start.y, end.y) + (horizontal ? halfWidth : 0)
      const fromCellX = Math.floor(minX / cellSize)
      const toCellX = Math.floor((maxX - 0.001) / cellSize)
      const fromCellY = Math.floor(minY / cellSize)
      const toCellY = Math.floor((maxY - 0.001) / cellSize)
      if (cellRangeCount(fromCellX, toCellX, fromCellY, toCellY) > VIEW_JSON_MAX_CELLS_PER_OVERVIEW_ITEM) {
        const key = [
          path.objectKind,
          path.layerId,
          overviewDirection,
          'fallback',
          path.sourceId,
          pointIndex,
        ].join(':')
        const existing = cells.get(key)
        if (existing) {
          mergeOverviewCellBounds(existing, minX, minY, maxX, maxY)
        } else {
          cells.set(key, {
            id: `overview-path:${key}`,
            objectKind: path.objectKind,
            sourceId: path.sourceId,
            layerId: path.layerId,
            eda: [minX, minY, maxX, maxY],
            overviewWeight: Math.max(1, Math.ceil(cellRangeCount(fromCellX, toCellX, fromCellY, toCellY) / VIEW_JSON_MAX_CELLS_PER_OVERVIEW_ITEM)),
            overviewDirection,
            world: {
              x: minX,
              y: minY,
              w: maxX - minX,
              h: maxY - minY,
            },
          })
        }
        continue
      }

      for (let cy = fromCellY; cy <= toCellY; cy += 1) {
        for (let cx = fromCellX; cx <= toCellX; cx += 1) {
          const cellMinX = cx * cellSize
          const cellMinY = cy * cellSize
          const cellMaxX = cellMinX + cellSize
          const cellMaxY = cellMinY + cellSize
          const clippedMinX = Math.max(minX, cellMinX)
          const clippedMinY = Math.max(minY, cellMinY)
          const clippedMaxX = Math.min(maxX, cellMaxX)
          const clippedMaxY = Math.min(maxY, cellMaxY)
          if (clippedMaxX <= clippedMinX || clippedMaxY <= clippedMinY) continue

          const key = [
            path.objectKind,
            path.layerId,
            overviewDirection,
            clippedMinX,
            clippedMinY,
            clippedMaxX - clippedMinX,
            clippedMaxY - clippedMinY,
          ].join(':')
          const existing = cells.get(key)
          if (existing) {
            mergeOverviewCellBounds(existing, clippedMinX, clippedMinY, clippedMaxX, clippedMaxY)
            continue
          }

          cells.set(key, {
            id: `overview-path:${key}`,
            objectKind: path.objectKind,
            sourceId: path.sourceId,
            layerId: path.layerId,
            eda: [clippedMinX, clippedMinY, clippedMaxX, clippedMaxY],
            overviewWeight: 1,
            overviewDirection,
            world: {
              x: clippedMinX,
              y: clippedMinY,
              w: clippedMaxX - clippedMinX,
              h: clippedMaxY - clippedMinY,
            },
          })
        }
      }
    }
  }

  return [...cells.values()]
}

function cellRangeCount(fromCellX: number, toCellX: number, fromCellY: number, toCellY: number): number {
  if (![fromCellX, toCellX, fromCellY, toCellY].every(Number.isFinite)) return Number.POSITIVE_INFINITY
  const width = Math.max(0, toCellX - fromCellX + 1)
  const height = Math.max(0, toCellY - fromCellY + 1)
  return width * height
}

function overviewFallbackRect(rect: ViewJsonRectRenderable, id: string): ViewJsonRectRenderable {
  return {
    ...rect,
    id,
    sourceId: -1,
    overviewWeight: Math.max(rect.overviewWeight ?? 1, VIEW_JSON_MAX_CELLS_PER_OVERVIEW_ITEM),
    world: { ...rect.world },
    eda: [...rect.eda],
  }
}

function mergeOverviewCellBounds(
  rect: ViewJsonRectRenderable,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): void {
  const x1 = Math.min(rect.world.x, minX)
  const y1 = Math.min(rect.world.y, minY)
  const x2 = Math.max(rect.world.x + rect.world.w, maxX)
  const y2 = Math.max(rect.world.y + rect.world.h, maxY)
  rect.world = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
  rect.eda = [x1, y1, x2, y2]
  rect.overviewWeight = (rect.overviewWeight ?? 1) + 1
}

export function getViewJsonRectBatchSignature(rects: ViewJsonRectRenderable[]): string {
  let hash = VIEW_JSON_FNV_OFFSET
  for (const rect of sampleViewJsonBatchItems(rects)) {
    const { x, y, w, h } = rect.world
    hash = hashString(hash, `${rect.id}:${rect.layerId ?? 'none'}:${x}:${y}:${w}:${h}`)
  }
  return `${rects.length}:${hash >>> 0}`
}

export function getViewJsonPathBatchSignature(paths: ViewJsonPathRenderable[]): string {
  let hash = VIEW_JSON_FNV_OFFSET
  for (const path of sampleViewJsonBatchItems(paths)) {
    hash = hashString(hash, `${path.id}:${path.layerId}:${path.width}`)
    for (const point of path.worldPoints) {
      hash = hashString(hash, `${point.x},${point.y}`)
    }
  }
  return `${paths.length}:${hash >>> 0}`
}

function sampleViewJsonBatchItems<T>(items: T[]): T[] {
  if (items.length <= VIEW_JSON_BATCH_SIGNATURE_SAMPLE_LIMIT) return items
  const sampled: T[] = []
  const lastIndex = items.length - 1
  for (let index = 0; index < VIEW_JSON_BATCH_SIGNATURE_SAMPLE_LIMIT; index += 1) {
    sampled.push(items[Math.round((index / (VIEW_JSON_BATCH_SIGNATURE_SAMPLE_LIMIT - 1)) * lastIndex)])
  }
  return sampled
}

function hashString(seed: number, value: string): number {
  let hash = seed
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, VIEW_JSON_FNV_PRIME)
  }
  return hash >>> 0
}
