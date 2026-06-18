import {
  edaRectToWorldRect,
  materializeLocalRect,
  materializeMasterLocalRect,
  normalizeBBox,
} from './geometry'
import type {
  ViewJsonBBox,
  ViewJsonLazyCellGeometrySource,
  ViewJsonLazyViaGeometrySource,
  ViewJsonObjectKind,
  ViewJsonPackageData,
  ViewJsonRectRenderable,
  ViewJsonRenderModel,
  ViewJsonWorldRect,
} from './types'

interface MaterializeLazyGeometryOptions {
  objectKinds: Set<ViewJsonObjectKind>
  layerVisible?: (layerId?: number) => boolean
  maxRects?: number
}

const VIEW_JSON_LAZY_GEOMETRY_CHUNK_SIZE = 12000
const VIEW_JSON_LAZY_GEOMETRY_MAX_CHUNKS_PER_SOURCE = 256
const VIEW_JSON_LAZY_GEOMETRY_FALLBACK_CHUNK_KEY = '__fallback__'

interface LazyGeometryIndexedSource<T> {
  source: T
  bounds: ViewJsonWorldRect
}

interface LazyGeometryIndexChunk {
  cellInstances: Array<LazyGeometryIndexedSource<ViewJsonLazyCellGeometrySource>>
  vias: Array<LazyGeometryIndexedSource<ViewJsonLazyViaGeometrySource>>
}

interface LazyGeometrySpatialIndex {
  chunkSize: number
  chunks: Map<string, LazyGeometryIndexChunk>
}

const lazyGeometryIndexCache = new WeakMap<ViewJsonRenderModel, LazyGeometrySpatialIndex>()

function emptyLazyGeometryIndexChunk(): LazyGeometryIndexChunk {
  return {
    cellInstances: [],
    vias: [],
  }
}

function lazyChunkKey(x: number, y: number): string {
  return `${x}:${y}`
}

function getOrCreateLazyChunk(
  chunks: Map<string, LazyGeometryIndexChunk>,
  key: string,
): LazyGeometryIndexChunk {
  let chunk = chunks.get(key)
  if (!chunk) {
    chunk = emptyLazyGeometryIndexChunk()
    chunks.set(key, chunk)
  }
  return chunk
}

function lazyRangeForBounds(bounds: ViewJsonWorldRect, chunkSize: number): {
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

function lazyRangeChunkCount(range: {
  minX: number
  minY: number
  maxX: number
  maxY: number
}): number {
  const columns = range.maxX - range.minX + 1
  const rows = range.maxY - range.minY + 1
  return columns > 0 && rows > 0 ? columns * rows : 0
}

function bboxToWorldBounds(bbox: ViewJsonBBox, worldHeight: number): ViewJsonWorldRect {
  return edaRectToWorldRect(normalizeBBox(bbox), worldHeight)
}

function worldRectIntersects(a: ViewJsonWorldRect, b: ViewJsonWorldRect): boolean {
  return a.x <= b.x + b.w
    && a.x + a.w >= b.x
    && a.y <= b.y + b.h
    && a.y + a.h >= b.y
}

function rectRenderable(
  id: string,
  objectKind: ViewJsonObjectKind,
  sourceId: number,
  layerId: number | undefined,
  eda: ViewJsonBBox,
  worldHeight: number,
): ViewJsonRectRenderable {
  const normalized = normalizeBBox(eda)
  return {
    id,
    objectKind,
    sourceId,
    layerId,
    eda: normalized,
    world: edaRectToWorldRect(normalized, worldHeight),
  }
}

function addLazyIndexedSource<T>(
  chunks: Map<string, LazyGeometryIndexChunk>,
  source: T,
  bounds: ViewJsonWorldRect,
  chunkSize: number,
  bucket: keyof LazyGeometryIndexChunk,
): void {
  if (
    !Number.isFinite(bounds.x)
    || !Number.isFinite(bounds.y)
    || !Number.isFinite(bounds.w)
    || !Number.isFinite(bounds.h)
    || bounds.w < 0
    || bounds.h < 0
  ) {
    return
  }
  const range = lazyRangeForBounds(bounds, chunkSize)
  const chunkCount = lazyRangeChunkCount(range)
  if (!Number.isFinite(chunkCount) || chunkCount <= 0) return
  if (chunkCount > VIEW_JSON_LAZY_GEOMETRY_MAX_CHUNKS_PER_SOURCE) {
    const chunk = getOrCreateLazyChunk(chunks, VIEW_JSON_LAZY_GEOMETRY_FALLBACK_CHUNK_KEY)
    ;(chunk[bucket] as Array<LazyGeometryIndexedSource<T>>).push({ source, bounds })
    return
  }
  for (let cy = range.minY; cy <= range.maxY; cy += 1) {
    for (let cx = range.minX; cx <= range.maxX; cx += 1) {
      const chunk = getOrCreateLazyChunk(chunks, lazyChunkKey(cx, cy))
      ;(chunk[bucket] as Array<LazyGeometryIndexedSource<T>>).push({ source, bounds })
    }
  }
}

function buildLazyGeometrySpatialIndex(model: ViewJsonRenderModel): LazyGeometrySpatialIndex {
  const chunks = new Map<string, LazyGeometryIndexChunk>()
  const chunkSize = VIEW_JSON_LAZY_GEOMETRY_CHUNK_SIZE
  const lazyGeometry = model.lazyGeometry
  if (!lazyGeometry) return { chunkSize, chunks }

  for (const source of lazyGeometry.cellInstances) {
    addLazyIndexedSource(chunks, source, bboxToWorldBounds(source.bbox, model.worldHeight), chunkSize, 'cellInstances')
  }
  for (const source of lazyGeometry.vias) {
    addLazyIndexedSource(chunks, source, bboxToWorldBounds(source.bbox, model.worldHeight), chunkSize, 'vias')
  }

  return { chunkSize, chunks }
}

function getLazyGeometrySpatialIndex(model: ViewJsonRenderModel): LazyGeometrySpatialIndex {
  const cached = lazyGeometryIndexCache.get(model)
  if (cached) return cached
  const index = buildLazyGeometrySpatialIndex(model)
  lazyGeometryIndexCache.set(model, index)
  return index
}

function getLazySourcesInBounds<T>(
  index: LazyGeometrySpatialIndex,
  visibleBounds: ViewJsonWorldRect,
  bucket: keyof LazyGeometryIndexChunk,
  getId: (source: T) => string | number,
): T[] {
  const range = lazyRangeForBounds(visibleBounds, index.chunkSize)
  const result: T[] = []
  const seen = new Set<string | number>()

  const addChunkSources = (chunk: LazyGeometryIndexChunk | undefined): void => {
    if (!chunk) return
    for (const item of chunk[bucket] as Array<LazyGeometryIndexedSource<T>>) {
      const id = getId(item.source)
      if (seen.has(id) || !worldRectIntersects(item.bounds, visibleBounds)) continue
      seen.add(id)
      result.push(item.source)
    }
  }

  for (let cy = range.minY; cy <= range.maxY; cy += 1) {
    for (let cx = range.minX; cx <= range.maxX; cx += 1) {
      addChunkSources(index.chunks.get(lazyChunkKey(cx, cy)))
    }
  }
  addChunkSources(index.chunks.get(VIEW_JSON_LAZY_GEOMETRY_FALLBACK_CHUNK_KEY))

  return result
}

function getLazyCellSourcesInBounds(
  index: LazyGeometrySpatialIndex,
  visibleBounds: ViewJsonWorldRect,
): ViewJsonLazyCellGeometrySource[] {
  return getLazySourcesInBounds<ViewJsonLazyCellGeometrySource>(
    index,
    visibleBounds,
    'cellInstances',
    source => source.instanceId,
  )
}

function getLazyViaSourcesInBounds(
  index: LazyGeometrySpatialIndex,
  visibleBounds: ViewJsonWorldRect,
): ViewJsonLazyViaGeometrySource[] {
  return getLazySourcesInBounds<ViewJsonLazyViaGeometrySource>(
    index,
    visibleBounds,
    'vias',
    source => source.idPrefix,
  )
}

function addLazyViaRects(
  target: ViewJsonRectRenderable[],
  pkg: ViewJsonPackageData,
  source: ViewJsonLazyViaGeometrySource,
  worldHeight: number,
  visibleBounds: ViewJsonWorldRect,
  layerVisible: (layerId?: number) => boolean,
  maxRects = Number.POSITIVE_INFINITY,
): void {
  if (!worldRectIntersects(bboxToWorldBounds(source.bbox, worldHeight), visibleBounds)) return
  const via = pkg.viaById.get(source.viaMasterId)
  if (!via) return
  const transform = {
    origin: source.origin,
    orient: source.orient,
    width: 0,
    height: 0,
  }

  for (let shapeIndex = 0; shapeIndex < via.shapes.length; shapeIndex += 1) {
    const shape = via.shapes[shapeIndex]
    if (!layerVisible(shape.layer_id)) continue
    for (let rectIndex = 0; rectIndex < shape.rects.length; rectIndex += 1) {
      const eda = materializeLocalRect(shape.rects[rectIndex], transform)
      const rect = rectRenderable(
        `${source.idPrefix}:${shapeIndex}:${rectIndex}`,
        'vias',
        source.sourceId,
        shape.layer_id,
        eda,
        worldHeight,
      )
      if (worldRectIntersects(rect.world, visibleBounds)) {
        target.push(rect)
        if (target.length >= maxRects) return
      }
    }
  }
}

function addLazyCellRects(
  target: ViewJsonRectRenderable[],
  pkg: ViewJsonPackageData,
  source: ViewJsonLazyCellGeometrySource,
  worldHeight: number,
  visibleBounds: ViewJsonWorldRect,
  objectKinds: Set<ViewJsonObjectKind>,
  layerVisible: (layerId?: number) => boolean,
  maxRects = Number.POSITIVE_INFINITY,
): void {
  if (!worldRectIntersects(bboxToWorldBounds(source.bbox, worldHeight), visibleBounds)) return
  const master = pkg.cellMasterById.get(source.masterId)
  if (!master) return
  const transform = {
    origin: source.origin,
    orient: source.orient,
    width: master.size[0],
    height: master.size[1],
  }

  if (objectKinds.has('cell_pins')) {
    for (let pinIndex = 0; pinIndex < master.pins.length; pinIndex += 1) {
      const pin = master.pins[pinIndex]
      for (let portIndex = 0; portIndex < pin.ports.length; portIndex += 1) {
        const port = pin.ports[portIndex]
        if (!layerVisible(port.layer_id)) continue
        for (let rectIndex = 0; rectIndex < port.rects.length; rectIndex += 1) {
          const rect = rectRenderable(
            `cell_pins:${source.instanceId}:${pinIndex}:${portIndex}:${rectIndex}`,
            'cell_pins',
            source.instanceId,
            port.layer_id,
            materializeMasterLocalRect(port.rects[rectIndex], transform, master.origin),
            worldHeight,
          )
          if (worldRectIntersects(rect.world, visibleBounds)) {
            target.push(rect)
            if (target.length >= maxRects) return
          }
        }
      }
    }
  }

  if (objectKinds.has('cell_obs')) {
    for (let obsIndex = 0; obsIndex < master.obs.length; obsIndex += 1) {
      const obs = master.obs[obsIndex]
      if (!layerVisible(obs.layer_id)) continue
      for (let rectIndex = 0; rectIndex < obs.rects.length; rectIndex += 1) {
        const rect = rectRenderable(
          `cell_obs:${source.instanceId}:${obsIndex}:${rectIndex}`,
          'cell_obs',
          source.instanceId,
          obs.layer_id,
          materializeMasterLocalRect(obs.rects[rectIndex], transform, master.origin),
          worldHeight,
        )
        if (worldRectIntersects(rect.world, visibleBounds)) {
          target.push(rect)
          if (target.length >= maxRects) return
        }
      }
    }
  }
}

export function materializeViewJsonLazyGeometryInBounds(
  model: ViewJsonRenderModel,
  pkg: ViewJsonPackageData | null,
  visibleBounds: ViewJsonWorldRect,
  options: MaterializeLazyGeometryOptions,
): ViewJsonRectRenderable[] {
  if (!pkg || !model.lazyGeometry) return []
  const rects: ViewJsonRectRenderable[] = []
  const layerVisible = options.layerVisible ?? (() => true)
  const maxRects = Number.isFinite(options.maxRects) && options.maxRects != null
    ? Math.max(0, options.maxRects)
    : Number.POSITIVE_INFINITY
  const index = getLazyGeometrySpatialIndex(model)

  if (options.objectKinds.has('vias')) {
    for (const via of getLazyViaSourcesInBounds(index, visibleBounds)) {
      addLazyViaRects(rects, pkg, via, model.worldHeight, visibleBounds, layerVisible, maxRects)
      if (rects.length >= maxRects) return rects
    }
  }

  if (options.objectKinds.has('cell_pins') || options.objectKinds.has('cell_obs')) {
    for (const source of getLazyCellSourcesInBounds(index, visibleBounds)) {
      addLazyCellRects(
        rects,
        pkg,
        source,
        model.worldHeight,
        visibleBounds,
        options.objectKinds,
        layerVisible,
        maxRects,
      )
      if (rects.length >= maxRects) return rects
    }
  }

  return rects
}

export const __viewJsonLazyGeometryInternals = {
  buildLazyGeometrySpatialIndex,
  VIEW_JSON_LAZY_GEOMETRY_MAX_CHUNKS_PER_SOURCE,
  bboxToWorldBounds,
  getLazyCellSourcesInBounds,
  getLazyViaSourcesInBounds,
  worldRectIntersects,
}
