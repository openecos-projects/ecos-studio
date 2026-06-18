import type {
  ViewJsonGuideRenderable,
  ViewJsonObjectKind,
  ViewJsonPathRenderable,
  ViewJsonRectRenderable,
  ViewJsonRenderModel,
  ViewJsonWorldRect,
} from './types'
import { requestIdle as defaultRequestIdle } from '@/composables/requestIdle'

export const VIEW_JSON_RENDER_CHUNK_SIZE = 12000
export const VIEW_JSON_RENDER_QUERY_PADDING = 12000
export const VIEW_JSON_GUIDE_OBJECT_MIN_SCALE = 0.01
export const VIEW_JSON_PIN_OBJECT_MIN_SCALE = 0.01
export const VIEW_JSON_WIRE_OBJECT_MIN_SCALE = 0.01
export const VIEW_JSON_DETAIL_OBJECT_MIN_SCALE = 0.08
export const VIEW_JSON_OVERVIEW_LOD_MAX_SCALE = 0.01
export const VIEW_JSON_DETAIL_LOD_MIN_SCALE = VIEW_JSON_DETAIL_OBJECT_MIN_SCALE
const VIEW_JSON_RENDER_MAX_CHUNKS_PER_ITEM = 256
const VIEW_JSON_RENDER_FALLBACK_CHUNK_KEY = '__fallback__'

export interface ViewJsonVisibleBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ViewJsonRenderItems {
  rects: ViewJsonRectRenderable[]
  paths: ViewJsonPathRenderable[]
  guides: ViewJsonGuideRenderable[]
}

export interface ViewJsonRenderItemsQueryOptions {
  includeObjectKind?: (objectKind: ViewJsonObjectKind) => boolean
}

export interface ViewJsonRenderSpatialIndexBuildOptions {
  includeObjectKind?: (objectKind: ViewJsonObjectKind) => boolean
}

export interface ViewJsonRenderSpatialIndexAsyncBuildOptions extends ViewJsonRenderSpatialIndexBuildOptions {
  chunkSize?: number
  batchSize?: number
  requestIdle?: () => Promise<void>
  shouldCancel?: () => boolean
}

interface ViewJsonRenderChunk {
  rects: ViewJsonRectRenderable[]
  paths: ViewJsonPathRenderable[]
  guides: ViewJsonGuideRenderable[]
}

export interface ViewJsonRenderSpatialIndex {
  chunkSize: number
  chunks: Map<string, ViewJsonRenderChunk>
}

type IndexedRenderable = ViewJsonRectRenderable | ViewJsonPathRenderable | ViewJsonGuideRenderable

function emptyChunk(): ViewJsonRenderChunk {
  return {
    rects: [],
    paths: [],
    guides: [],
  }
}

function chunkKey(x: number, y: number): string {
  return `${x}:${y}`
}

function getOrCreateChunk(chunks: Map<string, ViewJsonRenderChunk>, key: string): ViewJsonRenderChunk {
  let chunk = chunks.get(key)
  if (!chunk) {
    chunk = emptyChunk()
    chunks.set(key, chunk)
  }
  return chunk
}

function rangeForBounds(bounds: ViewJsonWorldRect, chunkSize: number): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  const right = bounds.x + Math.max(bounds.w, 0)
  const bottom = bounds.y + Math.max(bounds.h, 0)
  return {
    minX: Math.floor(bounds.x / chunkSize),
    minY: Math.floor(bounds.y / chunkSize),
    maxX: Math.floor((right - 0.001) / chunkSize),
    maxY: Math.floor((bottom - 0.001) / chunkSize),
  }
}

function rangeChunkCount(range: {
  minX: number
  minY: number
  maxX: number
  maxY: number
}): number {
  const columns = range.maxX - range.minX + 1
  const rows = range.maxY - range.minY + 1
  return columns > 0 && rows > 0 ? columns * rows : 0
}

function pathWorldBounds(points: Array<{ x: number; y: number }>, width = 0): ViewJsonWorldRect | null {
  if (points.length === 0) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const point of points) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  const half = Math.max(width, 0) / 2
  return {
    x: minX - half,
    y: minY - half,
    w: maxX - minX + half * 2,
    h: maxY - minY + half * 2,
  }
}

function rectIntersects(a: ViewJsonWorldRect, b: ViewJsonWorldRect): boolean {
  return a.x <= b.x + b.w
    && a.x + a.w >= b.x
    && a.y <= b.y + b.h
    && a.y + a.h >= b.y
}

function boundsForRect(rect: ViewJsonRectRenderable): ViewJsonWorldRect {
  return rect.world
}

function boundsForPath(path: ViewJsonPathRenderable): ViewJsonWorldRect | null {
  return pathWorldBounds(path.worldPoints, path.width)
}

function boundsForGuide(guide: ViewJsonGuideRenderable): ViewJsonWorldRect | null {
  return pathWorldBounds(guide.worldPoints, 1)
}

function addToChunks<T extends IndexedRenderable>(
  chunks: Map<string, ViewJsonRenderChunk>,
  item: T,
  bounds: ViewJsonWorldRect | null,
  chunkSize: number,
  bucket: keyof ViewJsonRenderChunk,
): void {
  if (
    !bounds
    || !Number.isFinite(bounds.x)
    || !Number.isFinite(bounds.y)
    || !Number.isFinite(bounds.w)
    || !Number.isFinite(bounds.h)
    || bounds.w < 0
    || bounds.h < 0
  ) {
    return
  }
  const range = rangeForBounds(bounds, chunkSize)
  const chunkCount = rangeChunkCount(range)
  if (!Number.isFinite(chunkCount) || chunkCount <= 0) return
  if (chunkCount > VIEW_JSON_RENDER_MAX_CHUNKS_PER_ITEM) {
    ;(getOrCreateChunk(chunks, VIEW_JSON_RENDER_FALLBACK_CHUNK_KEY)[bucket] as T[]).push(item)
    return
  }
  for (let cy = range.minY; cy <= range.maxY; cy += 1) {
    for (let cx = range.minX; cx <= range.maxX; cx += 1) {
      const chunk = getOrCreateChunk(chunks, chunkKey(cx, cy))
      ;(chunk[bucket] as T[]).push(item)
    }
  }
}

export function buildViewJsonRenderSpatialIndex(
  model: ViewJsonRenderModel,
  chunkSize = VIEW_JSON_RENDER_CHUNK_SIZE,
  options: ViewJsonRenderSpatialIndexBuildOptions = {},
): ViewJsonRenderSpatialIndex {
  const chunks = new Map<string, ViewJsonRenderChunk>()
  for (const rect of model.rects) {
    if (options.includeObjectKind && !options.includeObjectKind(rect.objectKind)) continue
    addToChunks(chunks, rect, boundsForRect(rect), chunkSize, 'rects')
  }
  for (const path of model.paths) {
    if (options.includeObjectKind && !options.includeObjectKind(path.objectKind)) continue
    addToChunks(chunks, path, boundsForPath(path), chunkSize, 'paths')
  }
  for (const guide of model.guides) {
    if (options.includeObjectKind && !options.includeObjectKind(guide.objectKind)) continue
    addToChunks(chunks, guide, boundsForGuide(guide), chunkSize, 'guides')
  }
  return { chunkSize, chunks }
}

export async function buildViewJsonRenderSpatialIndexAsync(
  model: ViewJsonRenderModel,
  options: ViewJsonRenderSpatialIndexAsyncBuildOptions = {},
): Promise<ViewJsonRenderSpatialIndex> {
  const chunkSize = options.chunkSize ?? VIEW_JSON_RENDER_CHUNK_SIZE
  const batchSize = Number.isFinite(options.batchSize) && options.batchSize != null && options.batchSize > 0
    ? options.batchSize
    : 5000
  const requestIdle = options.requestIdle ?? defaultRequestIdle
  const chunks = new Map<string, ViewJsonRenderChunk>()
  let processed = 0

  const yieldIfNeeded = async (force = false): Promise<void> => {
    if (options.shouldCancel?.()) throw new Error('View JSON spatial index build cancelled.')
    processed += force ? 0 : 1
    if (!force && processed < batchSize) return
    processed = 0
    await requestIdle()
    if (options.shouldCancel?.()) throw new Error('View JSON spatial index build cancelled.')
  }

  await yieldIfNeeded(true)

  for (const rect of model.rects) {
    if (!options.includeObjectKind || options.includeObjectKind(rect.objectKind)) {
      addToChunks(chunks, rect, boundsForRect(rect), chunkSize, 'rects')
    }
    await yieldIfNeeded()
  }
  for (const path of model.paths) {
    if (!options.includeObjectKind || options.includeObjectKind(path.objectKind)) {
      addToChunks(chunks, path, boundsForPath(path), chunkSize, 'paths')
    }
    await yieldIfNeeded()
  }
  for (const guide of model.guides) {
    if (!options.includeObjectKind || options.includeObjectKind(guide.objectKind)) {
      addToChunks(chunks, guide, boundsForGuide(guide), chunkSize, 'guides')
    }
    await yieldIfNeeded()
  }

  return { chunkSize, chunks }
}

function visibleRectFromBounds(bounds: ViewJsonVisibleBounds, padding = 0): ViewJsonWorldRect {
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    w: bounds.width + padding * 2,
    h: bounds.height + padding * 2,
  }
}

function addUnique<T extends { id: string }>(
  target: T[],
  seen: Set<string>,
  item: T,
  visible: ViewJsonWorldRect,
  bounds: ViewJsonWorldRect | null,
): void {
  if (seen.has(item.id) || !bounds || !rectIntersects(bounds, visible)) return
  seen.add(item.id)
  target.push(item)
}

export function getViewJsonRenderItemsInBounds(
  index: ViewJsonRenderSpatialIndex,
  bounds: ViewJsonVisibleBounds,
  padding = 0,
  options: ViewJsonRenderItemsQueryOptions = {},
): ViewJsonRenderItems {
  const visible = visibleRectFromBounds(bounds, padding)
  const range = rangeForBounds(visible, index.chunkSize)
  const rects: ViewJsonRectRenderable[] = []
  const paths: ViewJsonPathRenderable[] = []
  const guides: ViewJsonGuideRenderable[] = []
  const seenRects = new Set<string>()
  const seenPaths = new Set<string>()
  const seenGuides = new Set<string>()

  const addChunkItems = (chunk: ViewJsonRenderChunk | undefined): void => {
    if (!chunk) return
    for (const rect of chunk.rects) {
      if (options.includeObjectKind && !options.includeObjectKind(rect.objectKind)) continue
      addUnique(rects, seenRects, rect, visible, boundsForRect(rect))
    }
    for (const path of chunk.paths) {
      if (options.includeObjectKind && !options.includeObjectKind(path.objectKind)) continue
      addUnique(paths, seenPaths, path, visible, boundsForPath(path))
    }
    for (const guide of chunk.guides) {
      if (options.includeObjectKind && !options.includeObjectKind(guide.objectKind)) continue
      addUnique(guides, seenGuides, guide, visible, boundsForGuide(guide))
    }
  }

  for (let cy = range.minY; cy <= range.maxY; cy += 1) {
    for (let cx = range.minX; cx <= range.maxX; cx += 1) {
      addChunkItems(index.chunks.get(chunkKey(cx, cy)))
    }
  }
  addChunkItems(index.chunks.get(VIEW_JSON_RENDER_FALLBACK_CHUNK_KEY))

  return { rects, paths, guides }
}

export function isViewJsonObjectKindRenderableAtScale(
  objectKind: ViewJsonObjectKind,
  scale: number,
): boolean {
  if (!Number.isFinite(scale) || scale <= 0) return true
  switch (objectKind) {
    case 'tracks':
    case 'gcell_grids':
      return scale >= VIEW_JSON_GUIDE_OBJECT_MIN_SCALE
    case 'io_pins':
      return scale >= VIEW_JSON_PIN_OBJECT_MIN_SCALE
    case 'regular_wires':
    case 'special_wires':
      return scale >= VIEW_JSON_WIRE_OBJECT_MIN_SCALE
    case 'vias':
    case 'cell_pins':
    case 'cell_obs':
      return scale >= VIEW_JSON_DETAIL_OBJECT_MIN_SCALE
    default:
      return true
  }
}

export const __viewJsonRenderSpatialIndexInternals = {
  VIEW_JSON_RENDER_MAX_CHUNKS_PER_ITEM,
  pathWorldBounds,
  rectIntersects,
  rangeForBounds,
}
