import { readOptionalProjectTextFile, readProjectTextFile } from '@/utils/projectFiles'
import type {
  ViewJsonCellMaster,
  ViewJsonDieData,
  ViewJsonGCellGrid,
  ViewJsonGeometryTileIndex,
  ViewJsonInstance,
  ViewJsonIoPin,
  ViewJsonLayer,
  ViewJsonManifest,
  ViewJsonObjectKind,
  ViewJsonPackageData,
  ViewJsonRectObject,
  ViewJsonRectRenderable,
  ViewJsonRegion,
  ViewJsonRoutingDetail,
  ViewJsonRow,
  ViewJsonTrackGrid,
  ViewJsonViaMaster,
  ViewJsonWireSegment,
  ViewJsonWorldPoint,
} from './types'
import {
  edaPointToWorldPoint,
  edaRectToWorldRect,
  normalizeBBox,
} from './geometry'

export interface ViewJsonPackageReader {
  readText(path: string): Promise<string>
  readOptionalText?: (path: string) => Promise<string | null>
}

export interface LoadViewJsonPackageDataOptions {
  projectPath?: string
  reader?: ViewJsonPackageReader
  workerClient?: ViewJsonPackageDataWorkerClientLike | null
  workerFactory?: ViewJsonPackageDataWorkerFactory | null
  deferRoutingDetail?: boolean
  shouldCancel?: () => boolean
}

export interface LoadViewJsonRoutingDetailOptions {
  projectPath?: string
  reader?: ViewJsonPackageReader
  workerClient?: ViewJsonPackageDataWorkerClientLike | null
  workerFactory?: ViewJsonPackageDataWorkerFactory | null
  shouldCancel?: () => boolean
}

export interface ViewJsonPackageDataTextFile {
  path: string
  text: string
}

export interface ViewJsonPackageDataParseRequest {
  packageRoot: string
  manifestPath: string
  manifestText: string
  files: Partial<Record<string, ViewJsonPackageDataTextFile>>
  readMs: number
  totalStartedAt: number
  deferRoutingDetail?: boolean
}

export interface ViewJsonRoutingDetailParseRequest {
  diePath: string
  dieText: string
  viasPath?: string
  viasText?: string
  regularWiresPath?: string
  regularWiresText?: string
  specialWiresPath?: string
  specialWiresText?: string
}

export interface ViewJsonPackageDataWorkerClientLike {
  parsePackage(request: ViewJsonPackageDataParseRequest): Promise<ViewJsonPackageData>
  parseRoutingDetail(request: ViewJsonRoutingDetailParseRequest): Promise<ViewJsonRoutingDetail>
  cancelPending?: () => void
  destroy(): void
}

export type ViewJsonPackageDataWorkerFactory = () => {
  onmessage: ((event: MessageEvent<ViewJsonPackageDataWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: ViewJsonPackageDataWorkerRequest): void
  terminate(): void
} | null

export type ViewJsonPackageDataWorkerRequest =
  | {
    id: number
    type: 'parse-view-json-package-data'
    request: ViewJsonPackageDataParseRequest
  }
  | {
    id: number
    type: 'parse-view-json-routing-detail'
    request: ViewJsonRoutingDetailParseRequest
  }

export type ViewJsonPackageDataWorkerResponse =
  | {
    id: number
    ok: true
    packageData: ViewJsonPackageData
  }
  | {
    id: number
    ok: true
    routingDetail: ViewJsonRoutingDetail
  }
  | {
    id: number
    ok: false
    error: string
  }

interface ViewJsonArrayFile<T> {
  schema?: unknown
  kind?: unknown
  data?: T[]
}

interface ViewJsonDieFile {
  schema?: unknown
  kind?: unknown
  data?: ViewJsonDieData
}

interface ViewJsonSpatialIndexFile {
  schema?: unknown
  kind?: unknown
  tiles?: ViewJsonSpatialIndexTile[]
}

interface ViewJsonRoutingOverviewFile {
  schema?: unknown
  kind?: unknown
  data?: ViewJsonRoutingOverviewItem[]
  counts?: Partial<Record<ViewJsonObjectKind, unknown>>
  preaggregated?: unknown
}

interface ViewJsonGeometryTileIndexFile {
  schema?: unknown
  kind?: unknown
  version?: unknown
  encoding?: unknown
  world_bbox?: unknown
  tile_config?: unknown
  tiles?: unknown
  large_objects?: unknown
  source?: unknown
}

interface ViewJsonRoutingOverviewItem {
  id?: unknown
  object_kind?: unknown
  layer_id?: unknown
  bbox?: unknown
  weight?: unknown
  direction?: unknown
}

interface ViewJsonSpatialIndexTile {
  bbox?: unknown
  objects?: Partial<Record<'regular_wires' | 'special_wires', ViewJsonSpatialIndexObjectRef[]>>
}

interface ViewJsonSpatialIndexObjectRef {
  id?: unknown
  bbox?: unknown
  layers?: unknown
  semantic_kind?: unknown
}

function joinPackagePath(packageRoot: string, relativePath: string): string {
  const root = packageRoot.replace(/[\\/]+$/, '')
  const rel = relativePath.replace(/^[\\/]+/, '')
  return `${root}/${rel}`
}

function parseJson<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T
  } catch (error) {
    throw new Error(`Failed to parse ${label}: ${String(error)}`)
  }
}

function validateManifest(manifest: ViewJsonManifest): void {
  if (manifest.schema !== 'ieda.view.v1' || manifest.format !== 'layout_view_package') {
    throw new Error('Unsupported view JSON manifest.')
  }
}

function assertViewJsonLoadNotCancelled(shouldCancel?: () => boolean): void {
  if (shouldCancel?.()) {
    throw new Error('View JSON load cancelled.')
  }
}

async function withViewJsonWorkerCancellation<T>(
  work: Promise<T>,
  workerClient: Pick<ViewJsonPackageDataWorkerClientLike, 'cancelPending'>,
  shouldCancel?: () => boolean,
): Promise<T> {
  if (!shouldCancel) return work
  let timer: ReturnType<typeof setTimeout> | null = null
  let settled = false
  const cancellation = new Promise<never>((_resolve, reject) => {
    const poll = (): void => {
      if (settled) return
      if (shouldCancel()) {
        settled = true
        workerClient.cancelPending?.()
        reject(new Error('View JSON load cancelled.'))
        return
      }
      timer = setTimeout(poll, 10)
    }
    timer = setTimeout(poll, 10)
  })

  try {
    return await Promise.race([work, cancellation])
  } finally {
    settled = true
    if (timer) clearTimeout(timer)
  }
}

function filePath(manifest: ViewJsonManifest, key: string): string | null {
  const value = manifest.files?.[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function packageFilePathFromManifest(packageRoot: string, manifest: ViewJsonManifest, key: string): string | null {
  const rel = filePath(manifest, key)
  return rel ? joinPackagePath(packageRoot, rel) : null
}

function conventionalPackageFilePath(packageRoot: string, relativePath: string): string {
  return joinPackagePath(packageRoot, relativePath)
}

function isMissingPackageFileError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  const code = (error as Error & { code?: unknown }).code
  return code === 'ENOENT'
    || message.includes('enoent')
    || message.includes('no such file')
    || message.includes('not found')
}

async function readOptionalArrayFile<T>(
  root: string,
  reader: ViewJsonPackageReader,
  manifest: ViewJsonManifest,
  key: string,
  expectedKind: string,
): Promise<T[]> {
  const rel = filePath(manifest, key)
  if (!rel) return []
  const path = joinPackagePath(root, rel)
  const parsed = parseJson<ViewJsonArrayFile<T>>(await reader.readText(path), path)
  if (parsed.schema !== 'ieda.view.v1' || parsed.kind !== expectedKind) {
    throw new Error(`Unsupported view JSON ${expectedKind} file.`)
  }
  if (!Array.isArray(parsed.data)) {
    throw new Error(`Invalid ${expectedKind} data array in view JSON package.`)
  }
  return parsed.data
}

function denseMapById<T extends { id: number }>(items: T[], label: string): Map<number, T> {
  const map = new Map<number, T>()
  for (const item of items) {
    if (!Number.isInteger(item.id)) {
      throw new Error(`Invalid ${label} id in view JSON package.`)
    }
    map.set(item.id, item)
  }
  return map
}

function wirePathBounds(points: ViewJsonWorldPoint[], width = 0): {
  world: { x: number; y: number; w: number; h: number }
  direction: ViewJsonRectRenderable['overviewDirection']
} | null {
  if (points.length < 2) return null

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let horizontalCount = 0
  let verticalCount = 0
  let mixedCount = 0
  const halfWidth = Math.max(width, 1) / 2

  for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
    const start = points[pointIndex - 1]
    const end = points[pointIndex]
    if (!start || !end) continue
    const horizontal = start.y === end.y
    const vertical = start.x === end.x
    if (horizontal) horizontalCount += 1
    else if (vertical) verticalCount += 1
    else mixedCount += 1
    const segmentMinX = Math.min(start.x, end.x) - (vertical ? halfWidth : 0)
    const segmentMaxX = Math.max(start.x, end.x) + (vertical ? halfWidth : 0)
    const segmentMinY = Math.min(start.y, end.y) - (horizontal ? halfWidth : 0)
    const segmentMaxY = Math.max(start.y, end.y) + (horizontal ? halfWidth : 0)
    minX = Math.min(minX, segmentMinX)
    maxX = Math.max(maxX, segmentMaxX)
    minY = Math.min(minY, segmentMinY)
    maxY = Math.max(maxY, segmentMaxY)
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null
  }

  const direction = mixedCount > 0 || (horizontalCount > 0 && verticalCount > 0)
    ? 'mixed'
    : horizontalCount > 0
      ? 'horizontal'
      : verticalCount > 0
        ? 'vertical'
        : 'mixed'
  return {
    world: {
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
    },
    direction,
  }
}

function wireSegmentOverviewRect(
  segment: ViewJsonWireSegment,
  objectKind: 'regular_wires' | 'special_wires',
  worldHeight: number,
  viaById: Map<number, ViewJsonViaMaster>,
): ViewJsonRectRenderable | null {
  if (
    segment.kind === 'path'
    && typeof segment.layer_id === 'number'
    && typeof segment.width === 'number'
    && Array.isArray(segment.points)
    && segment.points.length >= 2
  ) {
    const worldPoints = segment.points.map(point => edaPointToWorldPoint(point, worldHeight))
    const bounds = wirePathBounds(worldPoints, segment.width)
    if (!bounds || bounds.world.w <= 0 || bounds.world.h <= 0) return null
    return {
      id: `package-routing-overview:${objectKind}:${segment.id}:path`,
      objectKind,
      sourceId: segment.id,
      layerId: segment.layer_id,
      eda: normalizeBBox(segment.bbox ?? [
        Math.min(...segment.points.map(point => point[0])),
        Math.min(...segment.points.map(point => point[1])),
        Math.max(...segment.points.map(point => point[0])),
        Math.max(...segment.points.map(point => point[1])),
      ]),
      world: bounds.world,
      overviewWeight: Math.max(1, segment.points.length - 1),
      overviewDirection: bounds.direction,
    }
  }

  if (segment.kind === 'patch' && typeof segment.layer_id === 'number' && segment.rect) {
    const rect = normalizeBBox(segment.rect)
    return {
      id: `package-routing-overview:${objectKind}:${segment.id}:patch`,
      objectKind,
      sourceId: segment.id,
      layerId: segment.layer_id,
      eda: rect,
      world: edaRectToWorldRect(rect, worldHeight),
      overviewWeight: 1,
    }
  }

  if (segment.kind === 'via' && typeof segment.via_master_id === 'number' && segment.origin) {
    const viaMaster = viaById.get(segment.via_master_id)
    const bbox = normalizeBBox(segment.bbox ?? [
      segment.origin[0],
      segment.origin[1],
      segment.origin[0] + 1,
      segment.origin[1] + 1,
    ])
    return {
      id: `package-routing-overview:${objectKind}:${segment.id}:via`,
      objectKind: 'vias',
      sourceId: segment.id,
      layerId: viaMaster?.shapes[0]?.layer_id,
      eda: bbox,
      world: edaRectToWorldRect(bbox, worldHeight),
      overviewWeight: 1,
      overviewDirection: 'point',
    }
  }

  return null
}

function countRoutingOverview(routing: ViewJsonRectRenderable[]): Partial<Record<ViewJsonObjectKind, number>> {
  const counts: Partial<Record<ViewJsonObjectKind, number>> = {}
  for (const rect of routing) {
    counts[rect.objectKind] = (counts[rect.objectKind] ?? 0) + 1
  }
  return counts
}

function incrementOverviewCount(
  counts: Partial<Record<ViewJsonObjectKind, number>>,
  objectKind: ViewJsonObjectKind,
): void {
  counts[objectKind] = (counts[objectKind] ?? 0) + 1
}

function buildRoutingOverview(
  regularWires: ViewJsonWireSegment[],
  specialWires: ViewJsonWireSegment[],
  worldHeight: number,
  viaById: Map<number, ViewJsonViaMaster>,
): ViewJsonRoutingDetail['overview'] {
  const routing: ViewJsonRectRenderable[] = []
  for (const segment of regularWires) {
    const rect = wireSegmentOverviewRect(segment, 'regular_wires', worldHeight, viaById)
    if (rect) routing.push(rect)
  }
  for (const segment of specialWires) {
    const rect = wireSegmentOverviewRect(segment, 'special_wires', worldHeight, viaById)
    if (rect) routing.push(rect)
  }
  return {
    routing,
    countsByObjectKind: countRoutingOverview(routing),
  }
}

function bboxFromSpatialIndexRef(ref: ViewJsonSpatialIndexObjectRef): [number, number, number, number] | null {
  if (!Array.isArray(ref.bbox) || ref.bbox.length < 4) return null
  const [x1, y1, x2, y2] = ref.bbox
  if (
    typeof x1 !== 'number'
    || typeof y1 !== 'number'
    || typeof x2 !== 'number'
    || typeof y2 !== 'number'
  ) return null
  return normalizeBBox([x1, y1, x2, y2])
}

function bboxFromSpatialIndexTile(tile: ViewJsonSpatialIndexTile): [number, number, number, number] | null {
  if (!Array.isArray(tile.bbox) || tile.bbox.length < 4) return null
  const [x1, y1, x2, y2] = tile.bbox
  if (
    typeof x1 !== 'number'
    || typeof y1 !== 'number'
    || typeof x2 !== 'number'
    || typeof y2 !== 'number'
  ) return null
  return normalizeBBox([x1, y1, x2, y2])
}

function layerIdFromSpatialIndexRef(ref: ViewJsonSpatialIndexObjectRef): number | undefined {
  if (Array.isArray(ref.layers) && typeof ref.layers[0] === 'number') return ref.layers[0]
  return undefined
}

function objectKindFromSpatialIndexRef(
  objectKind: 'regular_wires' | 'special_wires',
  ref: ViewJsonSpatialIndexObjectRef,
  bbox: [number, number, number, number],
): ViewJsonObjectKind {
  if (ref.semantic_kind === 'vias') return 'vias'
  return bbox[0] === bbox[2] && bbox[1] === bbox[3] ? 'vias' : objectKind
}

function intersectBBox(
  a: [number, number, number, number],
  b: [number, number, number, number],
): [number, number, number, number] | null {
  const lx = Math.max(a[0], b[0])
  const ly = Math.max(a[1], b[1])
  const ux = Math.min(a[2], b[2])
  const uy = Math.min(a[3], b[3])
  if (ux <= lx || uy <= ly) return null
  return [lx, ly, ux, uy]
}

interface SpatialIndexRoutingAggregateCell {
  objectKind: ViewJsonObjectKind
  layerId?: number
  eda: [number, number, number, number]
  weight: number
  direction?: ViewJsonRectRenderable['overviewDirection']
}

function buildRoutingOverviewFromSpatialIndex(
  spatialIndex: ViewJsonSpatialIndexFile | null,
  worldHeight: number,
): ViewJsonRoutingDetail['overview'] | null {
  if (!spatialIndex) return null
  if (spatialIndex.schema !== 'ieda.view.v1' || spatialIndex.kind !== 'spatial_index' || !Array.isArray(spatialIndex.tiles)) {
    throw new Error('Unsupported view JSON spatial_index file.')
  }

  const countedSourceIds = new Set<string>()
  const cells = new Map<string, SpatialIndexRoutingAggregateCell>()
  const countsByObjectKind: Partial<Record<ViewJsonObjectKind, number>> = {}
  const addRef = (
    tile: ViewJsonSpatialIndexTile,
    objectKind: 'regular_wires' | 'special_wires',
    ref: ViewJsonSpatialIndexObjectRef,
  ): void => {
    if (typeof ref.id !== 'number') return
    const bbox = bboxFromSpatialIndexRef(ref)
    if (!bbox) return
    const key = `${objectKind}:${ref.id}`
    const renderKind = objectKindFromSpatialIndexRef(objectKind, ref, bbox)
    const pointRef = renderKind === 'vias'
    if (!countedSourceIds.has(key)) {
      countedSourceIds.add(key)
      incrementOverviewCount(countsByObjectKind, renderKind)
    }
    const eda = [
      bbox[0],
      bbox[1],
      bbox[0] === bbox[2] ? bbox[2] + 1 : bbox[2],
      bbox[1] === bbox[3] ? bbox[3] + 1 : bbox[3],
    ] as [number, number, number, number]
    const tileBbox = bboxFromSpatialIndexTile(tile)
    const normalizedCellEda = pointRef ? eda : (tileBbox ? intersectBBox(eda, tileBbox) : eda)
    if (!normalizedCellEda) return
    const layerId = layerIdFromSpatialIndexRef(ref)
    const tileKey = tileBbox
      ? `${tileBbox[0]}:${tileBbox[1]}:${tileBbox[2]}:${tileBbox[3]}`
      : `${normalizedCellEda[0]}:${normalizedCellEda[1]}:${normalizedCellEda[2]}:${normalizedCellEda[3]}`
    const aggregateKey = `${renderKind}:${layerId ?? 'none'}:${pointRef ? 'point' : 'area'}:${tileKey}`
    const existing = cells.get(aggregateKey)
    if (existing) {
      existing.weight += 1
      existing.eda = [
        Math.min(existing.eda[0], normalizedCellEda[0]),
        Math.min(existing.eda[1], normalizedCellEda[1]),
        Math.max(existing.eda[2], normalizedCellEda[2]),
        Math.max(existing.eda[3], normalizedCellEda[3]),
      ]
      return
    }
    cells.set(aggregateKey, {
      objectKind: renderKind,
      layerId,
      eda: normalizedCellEda,
      weight: 1,
      direction: pointRef ? 'point' : undefined,
    })
  }

  for (const tile of spatialIndex.tiles) {
    for (const ref of tile.objects?.regular_wires ?? []) {
      addRef(tile, 'regular_wires', ref)
    }
    for (const ref of tile.objects?.special_wires ?? []) {
      addRef(tile, 'special_wires', ref)
    }
  }

  const routing: ViewJsonRectRenderable[] = []
  let index = 0
  for (const cell of cells.values()) {
    routing.push({
      id: `spatial-index-routing-overview-cell:${index}`,
      objectKind: cell.objectKind,
      sourceId: -1,
      layerId: cell.layerId,
      eda: cell.eda,
      world: edaRectToWorldRect(cell.eda, worldHeight),
      overviewWeight: cell.weight,
      overviewDirection: cell.direction,
    })
    index += 1
  }

  return {
    routing,
    countsByObjectKind,
    preaggregated: true,
  }
}

function parseRoutingOverviewCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function buildRoutingOverviewFromFile(
  routingOverview: ViewJsonRoutingOverviewFile | null,
  worldHeight: number,
): ViewJsonRoutingDetail['overview'] | null {
  if (!routingOverview) return null
  if (routingOverview.schema !== 'ieda.view.v1' || routingOverview.kind !== 'routing_overview' || !Array.isArray(routingOverview.data)) {
    throw new Error('Unsupported view JSON routing_overview file.')
  }

  const routing: ViewJsonRectRenderable[] = []
  for (let index = 0; index < routingOverview.data.length; index += 1) {
    const item = routingOverview.data[index]
    const bbox = bboxFromSpatialIndexRef({ bbox: item.bbox })
    if (!bbox) continue
    const objectKind = typeof item.object_kind === 'string' ? item.object_kind as ViewJsonObjectKind : undefined
    if (objectKind !== 'regular_wires' && objectKind !== 'special_wires' && objectKind !== 'vias') continue
    const layerId = typeof item.layer_id === 'number' ? item.layer_id : undefined
    const sourceId = typeof item.id === 'number' ? item.id : index
    const weight = typeof item.weight === 'number' && Number.isFinite(item.weight) ? Math.max(1, item.weight) : 1
    const direction = item.direction === 'horizontal'
      || item.direction === 'vertical'
      || item.direction === 'point'
      || item.direction === 'mixed'
      ? item.direction
      : undefined
    const eda = [
      bbox[0],
      bbox[1],
      bbox[0] === bbox[2] ? bbox[2] + 1 : bbox[2],
      bbox[1] === bbox[3] ? bbox[3] + 1 : bbox[3],
    ] as [number, number, number, number]
    routing.push({
      id: `routing-overview:${sourceId}`,
      objectKind,
      sourceId: -1,
      layerId,
      eda,
      world: edaRectToWorldRect(eda, worldHeight),
      overviewWeight: weight,
      overviewDirection: direction,
    })
  }

  const countsByObjectKind = routingOverview.counts
    ? {
        regular_wires: parseRoutingOverviewCount(routingOverview.counts.regular_wires),
        special_wires: parseRoutingOverviewCount(routingOverview.counts.special_wires),
        vias: parseRoutingOverviewCount(routingOverview.counts.vias),
      }
    : countRoutingOverview(routing)

  return {
    routing,
    countsByObjectKind,
    preaggregated: routingOverview.preaggregated !== false,
  }
}

function emptyRoutingOverview(): ViewJsonRoutingDetail['overview'] {
  return {
    routing: [],
    countsByObjectKind: {},
  }
}

function parseGeometryTileIndexFile(
  geometryTileIndex: ViewJsonGeometryTileIndexFile | null,
): ViewJsonGeometryTileIndex | undefined {
  if (!geometryTileIndex) return undefined
  if (
    geometryTileIndex.schema !== 'ieda.view.v1'
    || geometryTileIndex.kind !== 'geometry_tile_index'
    || !Array.isArray(geometryTileIndex.tiles)
  ) {
    throw new Error('Unsupported view JSON geometry_tile_index file.')
  }
  const worldBBox = bboxFromSpatialIndexRef({ bbox: geometryTileIndex.world_bbox })
  if (!worldBBox) {
    throw new Error('Invalid view JSON geometry_tile_index world_bbox.')
  }
  const tiles = geometryTileIndex.tiles.map((tileValue, index) => {
    if (!tileValue || typeof tileValue !== 'object' || Array.isArray(tileValue)) {
      throw new Error(`Invalid view JSON geometry_tile_index tile at ${index}.`)
    }
    const tile = tileValue as Record<string, unknown>
    const bbox = bboxFromSpatialIndexRef({ bbox: tile.bbox })
    if (!bbox) throw new Error(`Invalid view JSON geometry_tile_index tile bbox at ${index}.`)
    if (typeof tile.file !== 'string' || tile.file.length === 0) {
      throw new Error(`Invalid view JSON geometry_tile_index tile file at ${index}.`)
    }
    const counts: Partial<Record<ViewJsonObjectKind, number>> = {}
    if (tile.counts && typeof tile.counts === 'object' && !Array.isArray(tile.counts)) {
      for (const [key, value] of Object.entries(tile.counts as Record<string, unknown>)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
          counts[key as ViewJsonObjectKind] = value
        }
      }
    }
    return {
      id: typeof tile.id === 'string' ? tile.id : `${index}`,
      bbox,
      file: tile.file,
      byte_size: typeof tile.byte_size === 'number' ? tile.byte_size : undefined,
      hash: typeof tile.hash === 'string' ? tile.hash : undefined,
      counts,
      layers: Array.isArray(tile.layers)
        ? tile.layers.filter((value): value is number => typeof value === 'number')
        : undefined,
    }
  })
  const largeObjects = geometryTileIndex.large_objects
    && typeof geometryTileIndex.large_objects === 'object'
    && !Array.isArray(geometryTileIndex.large_objects)
    ? geometryTileIndex.large_objects as Record<string, unknown>
    : null
  return {
    schema: 'ieda.view.v1',
    kind: 'geometry_tile_index',
    version: typeof geometryTileIndex.version === 'number' ? geometryTileIndex.version : 1,
    encoding: typeof geometryTileIndex.encoding === 'string'
      ? geometryTileIndex.encoding
      : 'ecostudio.view_geometry_tile.bin.v1',
    world_bbox: worldBBox,
    tile_config: geometryTileIndex.tile_config && typeof geometryTileIndex.tile_config === 'object'
      ? geometryTileIndex.tile_config as ViewJsonGeometryTileIndex['tile_config']
      : undefined,
    tiles,
    large_objects: largeObjects && typeof largeObjects.file === 'string' && typeof largeObjects.count === 'number'
      ? {
          file: largeObjects.file,
          count: largeObjects.count,
          byte_size: typeof largeObjects.byte_size === 'number' ? largeObjects.byte_size : undefined,
          hash: typeof largeObjects.hash === 'string' ? largeObjects.hash : undefined,
        }
      : undefined,
    source: geometryTileIndex.source && typeof geometryTileIndex.source === 'object'
      ? geometryTileIndex.source as ViewJsonGeometryTileIndex['source']
      : undefined,
  }
}

export function parseViewJsonPackageDataFromTexts(
  request: ViewJsonPackageDataParseRequest,
  now: () => number = () => performance.now(),
): ViewJsonPackageData {
  const parseStartedAt = now()
  const manifest = parseJson<ViewJsonManifest>(request.manifestText, request.manifestPath)
  validateManifest(manifest)

  const dieSource = request.files.die
  const dieText = dieSource?.text
  if (!dieSource || dieText == null) throw new Error('View JSON manifest is missing files.die.')

  const diePath = dieSource.path
  const dieFile = parseJson<ViewJsonDieFile>(dieText, diePath)
  if (dieFile.schema !== 'ieda.view.v1' || dieFile.kind !== 'die' || !dieFile.data) {
    throw new Error('Unsupported view JSON die file.')
  }

  const parseArrayText = <T>(key: string, expectedKind: string): T[] => {
    const file = request.files[key]
    if (!file) return []
    const parsed = parseJson<ViewJsonArrayFile<T>>(file.text, file.path)
    if (parsed.schema !== 'ieda.view.v1' || parsed.kind !== expectedKind) {
      throw new Error(`Unsupported view JSON ${expectedKind} file.`)
    }
    if (!Array.isArray(parsed.data)) {
      throw new Error(`Invalid ${expectedKind} data array in view JSON package.`)
    }
    return parsed.data
  }

  const layers = parseArrayText<ViewJsonLayer>('layers', 'layers')
  const vias = parseArrayText<ViewJsonViaMaster>('vias', 'via_masters')
  const cellMasters = parseArrayText<ViewJsonCellMaster>('cell_masters', 'cell_masters')
  const rows = parseArrayText<ViewJsonRow>('rows', 'rows')
  const tracks = parseArrayText<ViewJsonTrackGrid>('tracks', 'tracks')
  const gcellGrids = parseArrayText<ViewJsonGCellGrid>('gcell_grids', 'gcell_grids')
  const instances = parseArrayText<ViewJsonInstance>('instances', 'instances')
  const ioPins = parseArrayText<ViewJsonIoPin>('io_pins', 'io_pins')
  const regularWires = parseArrayText<ViewJsonWireSegment>('regular_wires', 'regular_wires')
  const specialWires = parseArrayText<ViewJsonWireSegment>('special_wires', 'special_wires')
  const routingOverviewFile = request.files.routing_overview
    ? parseJson<ViewJsonRoutingOverviewFile>(request.files.routing_overview.text, request.files.routing_overview.path)
    : null
  const spatialIndexFile = request.files.spatial_index
    ? parseJson<ViewJsonSpatialIndexFile>(request.files.spatial_index.text, request.files.spatial_index.path)
    : null
  const geometryTileIndex = parseGeometryTileIndexFile(
    request.files.geometry_tile_index
      ? parseJson<ViewJsonGeometryTileIndexFile>(request.files.geometry_tile_index.text, request.files.geometry_tile_index.path)
      : null,
  )
  const blockages = parseArrayText<ViewJsonRectObject>('blockages', 'blockages')
  const fills = parseArrayText<ViewJsonRectObject>('fills', 'fills')
  const regions = parseArrayText<ViewJsonRegion>('regions', 'regions')
  const parseMs = now() - parseStartedAt

  const dieArea = dieFile.data.die_area
  const worldWidth = Math.abs(dieArea[2] - dieArea[0])
  const worldHeight = Math.abs(dieArea[3] - dieArea[1])
  const viaById = denseMapById(vias, 'via master')
  const overview = buildRoutingOverviewFromFile(routingOverviewFile, worldHeight)
    ?? buildRoutingOverviewFromSpatialIndex(spatialIndexFile, worldHeight)
    ?? (request.deferRoutingDetail
      ? emptyRoutingOverview()
      : buildRoutingOverview(regularWires, specialWires, worldHeight, viaById))

  return {
    packageRoot: request.packageRoot,
    manifest,
    dbuPerMicron: typeof manifest.unit?.dbu_per_micron === 'number'
      ? manifest.unit.dbu_per_micron
      : 1000,
    die: dieFile.data,
    worldWidth,
    worldHeight,
    layers,
    vias,
    cellMasters,
    rows,
    tracks,
    gcellGrids,
    instances,
    ioPins,
    regularWires: request.deferRoutingDetail ? [] : regularWires,
    specialWires: request.deferRoutingDetail ? [] : specialWires,
    blockages,
    fills,
    regions,
    layerById: denseMapById(layers, 'layer'),
    viaById,
    cellMasterById: denseMapById(cellMasters, 'cell master'),
    overview,
    routingDetailAvailable: geometryTileIndex
      ? false
      : request.deferRoutingDetail && Boolean(
        regularWires.length > 0
        || specialWires.length > 0
        || request.files.regular_wires
        || request.files.special_wires
        || filePath(manifest, 'regular_wires')
        || filePath(manifest, 'special_wires'),
      ),
    geometryTileIndex,
    loadStats: {
      readMs: request.readMs,
      parseMs,
      transformMs: 0,
      chunkMs: 0,
      totalMs: now() - request.totalStartedAt,
    },
  }
}

export async function loadViewJsonPackageData(
  packageRoot: string,
  options: LoadViewJsonPackageDataOptions = {},
): Promise<ViewJsonPackageData> {
  const totalStartedAt = performance.now()
  let readMs = 0
  let parseMs = 0
  const deps = options.reader ?? {
    readText: (path: string) => readProjectTextFile(path, { projectPath: options.projectPath }),
    readOptionalText: (path: string) => readOptionalProjectTextFile(path, { projectPath: options.projectPath }),
  }

  const manifestPath = joinPackagePath(packageRoot, 'manifest.json')
  const manifestReadStartedAt = performance.now()
  const manifestText = await deps.readText(manifestPath)
  readMs += performance.now() - manifestReadStartedAt
  assertViewJsonLoadNotCancelled(options.shouldCancel)

  const parseStartedAt = performance.now()
  const manifest = parseJson<ViewJsonManifest>(manifestText, manifestPath)
  validateManifest(manifest)
  parseMs += performance.now() - parseStartedAt

  const diePath = packageFilePathFromManifest(packageRoot, manifest, 'die')
  if (!diePath) throw new Error('View JSON manifest is missing files.die.')

  const readFile = async (key: string): Promise<ViewJsonPackageDataTextFile | undefined> => {
    const path = packageFilePathFromManifest(packageRoot, manifest, key)
    if (!path) return undefined
    return { path, text: await deps.readText(path) }
  }
  const readOptionalConventionalFile = async (relativePath: string): Promise<ViewJsonPackageDataTextFile | undefined> => {
    const path = conventionalPackageFilePath(packageRoot, relativePath)
    if (deps.readOptionalText) {
      const text = await deps.readOptionalText(path)
      return text == null ? undefined : { path, text }
    }

    try {
      return { path, text: await deps.readText(path) }
    } catch (error) {
      if (isMissingPackageFileError(error)) return undefined
      throw error
    }
  }

  const contentReadStartedAt = performance.now()
  const shouldProbeConventionalRoutingOverview = options.deferRoutingDetail && !filePath(manifest, 'routing_overview')
  const shouldUseGeometryTiles = options.deferRoutingDetail && Boolean(filePath(manifest, 'geometry_tile_index'))
  const shouldDeferRoutingWithOverview = options.deferRoutingDetail && Boolean(filePath(manifest, 'routing_overview'))
  const [
    dieFile,
    layersFile,
    viasFile,
    cellMastersFile,
    rowsFile,
    tracksFile,
    gcellGridsFile,
    instancesFile,
    ioPinsFile,
    manifestRoutingOverviewFile,
    conventionalRoutingOverviewFile,
    geometryTileIndexFile,
    blockagesFile,
    fillsFile,
    regionsFile,
  ] = await Promise.all([
    deps.readText(diePath).then(text => ({ path: diePath, text })),
    readFile('layers'),
    readFile('vias'),
    readFile('cell_masters'),
    readFile('rows'),
    readFile('tracks'),
    readFile('gcell_grids'),
    readFile('instances'),
    readFile('io_pins'),
    shouldDeferRoutingWithOverview ? readFile('routing_overview') : Promise.resolve(undefined),
    shouldProbeConventionalRoutingOverview ? readOptionalConventionalFile('design/routing_overview.json') : Promise.resolve(undefined),
    shouldUseGeometryTiles ? readFile('geometry_tile_index') : Promise.resolve(undefined),
    readFile('blockages'),
    readFile('fills'),
    readFile('regions'),
  ])
  const routingOverviewFile = manifestRoutingOverviewFile ?? conventionalRoutingOverviewFile
  const shouldDeferRoutingWithAnyOverview = options.deferRoutingDetail && Boolean(routingOverviewFile)
  const shouldDeferRoutingWithSpatialIndex = options.deferRoutingDetail
    && !shouldUseGeometryTiles
    && !shouldDeferRoutingWithAnyOverview
    && Boolean(filePath(manifest, 'spatial_index'))
  const shouldDeferRoutingWithoutOverview = options.deferRoutingDetail
    && !shouldUseGeometryTiles
    && !shouldDeferRoutingWithAnyOverview
    && !shouldDeferRoutingWithSpatialIndex
  const [regularWiresFile, specialWiresFile, spatialIndexFile] = await Promise.all([
    (shouldUseGeometryTiles || shouldDeferRoutingWithAnyOverview || shouldDeferRoutingWithSpatialIndex || shouldDeferRoutingWithoutOverview) ? Promise.resolve(undefined) : readFile('regular_wires'),
    (shouldUseGeometryTiles || shouldDeferRoutingWithAnyOverview || shouldDeferRoutingWithSpatialIndex || shouldDeferRoutingWithoutOverview) ? Promise.resolve(undefined) : readFile('special_wires'),
    shouldDeferRoutingWithSpatialIndex ? readFile('spatial_index') : Promise.resolve(undefined),
  ])
  readMs += performance.now() - contentReadStartedAt
  assertViewJsonLoadNotCancelled(options.shouldCancel)

  const parseRequest: ViewJsonPackageDataParseRequest = {
    packageRoot,
    manifestPath,
    manifestText,
    readMs,
    totalStartedAt,
    deferRoutingDetail: options.deferRoutingDetail,
    files: {
      die: dieFile,
      layers: layersFile,
      vias: viasFile,
      cell_masters: cellMastersFile,
      rows: rowsFile,
      tracks: tracksFile,
      gcell_grids: gcellGridsFile,
      instances: instancesFile,
      io_pins: ioPinsFile,
      regular_wires: regularWiresFile,
      special_wires: specialWiresFile,
      routing_overview: routingOverviewFile,
      spatial_index: spatialIndexFile,
      geometry_tile_index: geometryTileIndexFile,
      blockages: blockagesFile,
      fills: fillsFile,
      regions: regionsFile,
    },
  }

  if (options.workerClient || options.workerFactory) {
    const workerClient = options.workerClient ?? (
      options.workerFactory ? new ViewJsonPackageDataWorkerClient(options.workerFactory) : null
    )
    if (workerClient) {
      try {
        const pkg = await withViewJsonWorkerCancellation(
          workerClient.parsePackage(parseRequest),
          workerClient,
          options.shouldCancel,
        )
        assertViewJsonLoadNotCancelled(options.shouldCancel)
        return {
          ...pkg,
          loadStats: {
            ...pkg.loadStats,
            readMs,
            totalMs: performance.now() - totalStartedAt,
          },
        }
      } finally {
        if (!options.workerClient) workerClient.destroy()
      }
    }
  }

  const pkg = parseViewJsonPackageDataFromTexts(parseRequest)
  return {
    ...pkg,
    loadStats: {
      ...pkg.loadStats,
      parseMs: parseMs + pkg.loadStats.parseMs,
      totalMs: performance.now() - totalStartedAt,
    },
  }
}

export async function loadViewJsonRoutingDetail(
  packageRoot: string,
  options: LoadViewJsonRoutingDetailOptions = {},
): Promise<ViewJsonRoutingDetail> {
  assertViewJsonLoadNotCancelled(options.shouldCancel)
  const deps = options.reader ?? {
    readText: (path: string) => readProjectTextFile(path, { projectPath: options.projectPath }),
  }
  const manifestPath = joinPackagePath(packageRoot, 'manifest.json')
  const manifestText = await deps.readText(manifestPath)
  assertViewJsonLoadNotCancelled(options.shouldCancel)
  const manifest = parseJson<ViewJsonManifest>(manifestText, manifestPath)
  validateManifest(manifest)

  const diePath = packageFilePathFromManifest(packageRoot, manifest, 'die')
  if (!diePath) throw new Error('View JSON manifest is missing files.die.')
  const viasPath = packageFilePathFromManifest(packageRoot, manifest, 'vias') ?? undefined
  const regularWiresPath = packageFilePathFromManifest(packageRoot, manifest, 'regular_wires') ?? undefined
  const specialWiresPath = packageFilePathFromManifest(packageRoot, manifest, 'special_wires') ?? undefined
  const [dieText, viasText, regularWiresText, specialWiresText] = await Promise.all([
    deps.readText(diePath),
    viasPath ? deps.readText(viasPath) : Promise.resolve(undefined),
    regularWiresPath ? deps.readText(regularWiresPath) : Promise.resolve(undefined),
    specialWiresPath ? deps.readText(specialWiresPath) : Promise.resolve(undefined),
  ])
  assertViewJsonLoadNotCancelled(options.shouldCancel)
  const parseRequest: ViewJsonRoutingDetailParseRequest = {
    diePath,
    dieText,
    viasPath,
    viasText,
    regularWiresPath,
    regularWiresText,
    specialWiresPath,
    specialWiresText,
  }

  if (options.workerClient || options.workerFactory) {
    const workerClient = options.workerClient ?? (
      options.workerFactory ? new ViewJsonPackageDataWorkerClient(options.workerFactory) : null
    )
    if (workerClient) {
      try {
        const detail = await withViewJsonWorkerCancellation(
          workerClient.parseRoutingDetail(parseRequest),
          workerClient,
          options.shouldCancel,
        )
        assertViewJsonLoadNotCancelled(options.shouldCancel)
        return detail
      } finally {
        if (!options.workerClient) workerClient.destroy()
      }
    }
  }

  assertViewJsonLoadNotCancelled(options.shouldCancel)
  return parseViewJsonRoutingDetailFromTexts(parseRequest)
}

export function parseViewJsonRoutingDetailFromTexts(
  request: ViewJsonRoutingDetailParseRequest,
): ViewJsonRoutingDetail {
  const dieFile = parseJson<ViewJsonDieFile>(request.dieText, request.diePath)
  if (dieFile.schema !== 'ieda.view.v1' || dieFile.kind !== 'die' || !dieFile.data) {
    throw new Error('Unsupported view JSON die file.')
  }
  const parseArrayText = <T>(text: string | undefined, path: string | undefined, expectedKind: string): T[] => {
    if (!text || !path) return []
    const parsed = parseJson<ViewJsonArrayFile<T>>(text, path)
    if (parsed.schema !== 'ieda.view.v1' || parsed.kind !== expectedKind || !Array.isArray(parsed.data)) {
      throw new Error(`Unsupported view JSON ${expectedKind} file.`)
    }
    return parsed.data
  }

  const vias = parseArrayText<ViewJsonViaMaster>(request.viasText, request.viasPath, 'via_masters')
  const regularWires = parseArrayText<ViewJsonWireSegment>(request.regularWiresText, request.regularWiresPath, 'regular_wires')
  const specialWires = parseArrayText<ViewJsonWireSegment>(request.specialWiresText, request.specialWiresPath, 'special_wires')
  const worldHeight = Math.abs(dieFile.data.die_area[3] - dieFile.data.die_area[1])
  const overview = buildRoutingOverview(regularWires, specialWires, worldHeight, denseMapById(vias, 'via master'))

  return {
    regularWires,
    specialWires,
    overview,
    countsByObjectKind: overview.countsByObjectKind,
  }
}

export class ViewJsonPackageDataWorkerClient implements ViewJsonPackageDataWorkerClientLike {
  private worker: ReturnType<ViewJsonPackageDataWorkerFactory>
  private readonly pending = new Map<number, {
    resolve: (value: ViewJsonPackageData | ViewJsonRoutingDetail) => void
    reject: (error: Error) => void
  }>()
  private nextRequestId = 0
  private destroyed = false
  private readonly workerFactory: ViewJsonPackageDataWorkerFactory

  constructor(workerFactory: ViewJsonPackageDataWorkerFactory) {
    this.workerFactory = workerFactory
    this.worker = this.createWorker()
  }

  parsePackage(request: ViewJsonPackageDataParseRequest): Promise<ViewJsonPackageData> {
    const worker = this.ensureWorker()
    if (!worker) {
      return Promise.reject(new Error('View JSON package data worker is not available.'))
    }

    const id = this.nextRequestId += 1
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: ViewJsonPackageData | ViewJsonRoutingDetail) => void, reject })
      worker.postMessage({
        id,
        type: 'parse-view-json-package-data',
        request,
      })
    })
  }

  parseRoutingDetail(request: ViewJsonRoutingDetailParseRequest): Promise<ViewJsonRoutingDetail> {
    const worker = this.ensureWorker()
    if (!worker) {
      return Promise.reject(new Error('View JSON package data worker is not available.'))
    }

    const id = this.nextRequestId += 1
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: ViewJsonPackageData | ViewJsonRoutingDetail) => void, reject })
      worker.postMessage({
        id,
        type: 'parse-view-json-routing-detail',
        request,
      })
    })
  }

  cancelPending(): void {
    if (this.pending.size === 0) return
    this.rejectAll(new Error('View JSON package data worker request was cancelled.'))
    this.worker?.terminate()
    this.worker = null
  }

  destroy(): void {
    this.destroyed = true
    this.rejectAll(new Error('View JSON package data worker was destroyed.'))
    this.worker?.terminate()
    this.worker = null
  }

  private createWorker(): ReturnType<ViewJsonPackageDataWorkerFactory> {
    const worker = this.workerFactory()
    if (!worker) return null
    worker.onmessage = event => {
      this.handleMessage(event.data)
    }
    worker.onerror = event => {
      this.rejectAll(new Error(event.message || 'View JSON package data worker failed.'))
      worker.terminate()
      if (this.worker === worker) this.worker = null
    }
    return worker
  }

  private ensureWorker(): ReturnType<ViewJsonPackageDataWorkerFactory> {
    if (this.destroyed) return null
    if (!this.worker) this.worker = this.createWorker()
    return this.worker
  }

  private handleMessage(message: ViewJsonPackageDataWorkerResponse): void {
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)

    if (!message.ok) {
      pending.reject(new Error(message.error))
      return
    }

    if ('packageData' in message) {
      pending.resolve(message.packageData)
      return
    }

    pending.resolve(message.routingDetail)
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error)
    }
    this.pending.clear()
  }
}

export const __viewJsonPackageDataInternals = {
  readOptionalArrayFile,
}
