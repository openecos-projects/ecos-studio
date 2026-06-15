import { edaBBoxToWorldRect } from '@/applications/editor/core/editorCoordinates'

export type ViewJsonBBox = [number, number, number, number]

export interface ViewJsonOverviewInstance {
  id: number
  name: string
  bbox: ViewJsonBBox
  world: { x: number; y: number; w: number; h: number }
  status: string
  masterId: number | null
  origin: [number, number] | null
  orient: string
}

export interface ViewJsonRasterInstance {
  id: number
  x: number
  y: number
  w: number
  h: number
  status: string
}

export interface ViewJsonOverviewData {
  dbuPerMicron: number
  dieArea: ViewJsonBBox
  coreArea: ViewJsonBBox | null
  dieWorld: { x: number; y: number; w: number; h: number }
  coreWorld: { x: number; y: number; w: number; h: number } | null
  worldWidth: number
  worldHeight: number
  chunks: Map<string, ViewJsonInstanceChunk>
  rasterTileBuckets: Map<string, ViewJsonRasterInstance[]>
  totalInstanceCount: number
  maxChunkInstanceCount: number
  loadStats: ViewJsonLoadStats
}

export interface ViewJsonLoadStats {
  readMs: number
  parseMs: number
  transformMs: number
  chunkMs: number
  totalMs: number
}

export type ViewJsonRenderMode = 'idle' | 'preview' | 'raster' | 'gpu' | 'vector'

export interface ViewJsonInstanceChunk {
  key: string
  x: number
  y: number
  instances: ViewJsonOverviewInstance[]
}

export interface ViewJsonChunkRange {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface ViewJsonInstanceChunkIndex {
  chunks: Map<string, ViewJsonInstanceChunk>
  rasterTileBuckets: Map<string, ViewJsonRasterInstance[]>
  totalInstanceCount: number
  maxChunkInstanceCount: number
}

export interface BuildViewJsonInstanceChunkIndexOptions {
  batchSize?: number
  yieldToMainThread?: () => Promise<void>
  shouldCancel?: () => boolean
}

export interface ViewJsonOverviewPackageTexts {
  manifestPath: string
  diePath: string
  instancesPath: string
  manifestText: string
  dieText: string
  instancesText: string
}

export interface ViewJsonOverviewWorkerRequest {
  id: number
  type: 'load-view-json-overview'
  input: ViewJsonOverviewPackageTexts
  readMs: number
}

export type ViewJsonOverviewWorkerResponse =
  | {
    id: number
    ok: true
    overview: ViewJsonOverviewData
  }
  | {
    id: number
    ok: false
    error: string
  }

export interface ViewJsonOverviewWorkerLike {
  onmessage: ((event: MessageEvent<ViewJsonOverviewWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: ViewJsonOverviewWorkerRequest): void
  terminate(): void
}

export type ViewJsonOverviewWorkerFactory = () => ViewJsonOverviewWorkerLike | null

export interface ViewJsonRasterTileWorkerRequest {
  id: number
  type: 'render-view-json-raster-tile'
  tileX: number
  tileY: number
  rasterInstances: ViewJsonRasterInstance[]
}

export type ViewJsonRasterTileWorkerResponse =
  | {
    id: number
    ok: true
    tileX: number
    tileY: number
    bitmap: ImageBitmap
  }
  | {
    id: number
    ok: false
    error: string
  }

export interface ViewJsonRasterTileWorkerLike {
  onmessage: ((event: MessageEvent<ViewJsonRasterTileWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: ViewJsonRasterTileWorkerRequest, transfer?: Transferable[]): void
  terminate(): void
}

export type ViewJsonRasterTileWorkerFactory = () => ViewJsonRasterTileWorkerLike | null

export const VIEW_JSON_INSTANCE_HATCH_MIN_SCALE = 0.05
export const VIEW_JSON_INSTANCE_CHUNK_SIZE = 8000
export const VIEW_JSON_CHUNK_OVERVIEW_SCALE = 0.02
export const VIEW_JSON_CHUNK_OVERVIEW_MAX_DETAIL_CHUNKS = 80
export const VIEW_JSON_CHUNK_OVERVIEW_MAX_DETAIL_INSTANCES = 12000
export const VIEW_JSON_RASTER_TILE_WORLD_SIZE = 32000
export const VIEW_JSON_RASTER_TILE_PIXEL_SIZE = 512
export const VIEW_JSON_INSTANCE_INDEX_BATCH_SIZE = 5000

interface ViewJsonOverviewManifest {
  schema?: unknown
  format?: unknown
  unit?: { dbu_per_micron?: unknown }
  files?: Record<string, unknown>
}

interface ViewJsonDieFile {
  schema?: unknown
  kind?: unknown
  data?: {
    die_area?: unknown
    core_area?: unknown
  }
}

interface ViewJsonInstancesFile {
  schema?: unknown
  kind?: unknown
  data?: unknown
}

export function viewJsonBBoxToWorldRect(
  bbox: ViewJsonBBox,
  worldHeight: number,
): { x: number; y: number; w: number; h: number } {
  return edaBBoxToWorldRect(bbox[0], bbox[1], bbox[2], bbox[3], worldHeight)
}

export function shouldRenderInstanceHatch(scale: number): boolean {
  return Number.isFinite(scale) && scale >= VIEW_JSON_INSTANCE_HATCH_MIN_SCALE
}

export function shouldRenderChunkOverviewBase(
  scale: number,
  visibleChunkCount: number,
): boolean {
  return (
    !Number.isFinite(scale)
    || scale < VIEW_JSON_CHUNK_OVERVIEW_SCALE
    || visibleChunkCount > VIEW_JSON_CHUNK_OVERVIEW_MAX_DETAIL_CHUNKS
  )
}

export function shouldRenderChunkOverview(
  scale: number,
  visibleChunkCount: number,
  visibleInstanceCount = 0,
  detailInstanceLimit = VIEW_JSON_CHUNK_OVERVIEW_MAX_DETAIL_INSTANCES,
): boolean {
  return (
    shouldRenderChunkOverviewBase(scale, visibleChunkCount)
    || visibleInstanceCount > detailInstanceLimit
  )
}

export function buildViewJsonInstanceChunks(
  instances: ViewJsonOverviewInstance[],
  chunkSize = VIEW_JSON_INSTANCE_CHUNK_SIZE,
): Map<string, ViewJsonInstanceChunk> {
  const chunks = new Map<string, ViewJsonInstanceChunk>()

  for (const inst of instances) {
    const cx = Math.floor(inst.world.x / chunkSize)
    const cy = Math.floor(inst.world.y / chunkSize)
    const key = `${cx}:${cy}`
    let chunk = chunks.get(key)
    if (!chunk) {
      chunk = { key, x: cx, y: cy, instances: [] }
      chunks.set(key, chunk)
    }
    chunk.instances.push(inst)
  }

  return chunks
}

export function getMaxViewJsonChunkInstanceCount(chunks: Map<string, ViewJsonInstanceChunk>): number {
  let max = 1

  for (const chunk of chunks.values()) {
    max = Math.max(max, chunk.instances.length)
  }

  return max
}

function defaultYieldToMainThread(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

function assertViewJsonLoadNotCancelled(shouldCancel?: () => boolean): void {
  if (shouldCancel?.()) {
    throw new Error('View JSON load cancelled.')
  }
}

export async function buildViewJsonInstanceChunkIndex(
  rawInstances: unknown[],
  worldHeight: number,
  options: BuildViewJsonInstanceChunkIndexOptions = {},
  chunkSize = VIEW_JSON_INSTANCE_CHUNK_SIZE,
): Promise<ViewJsonInstanceChunkIndex> {
  const chunks = new Map<string, ViewJsonInstanceChunk>()
  const rasterTileBuckets = new Map<string, ViewJsonRasterInstance[]>()
  let maxChunkInstanceCount = 1
  const batchSize = Math.max(1, options.batchSize ?? VIEW_JSON_INSTANCE_INDEX_BATCH_SIZE)
  const yieldToMainThread = options.yieldToMainThread ?? defaultYieldToMainThread
  const { shouldCancel } = options

  assertViewJsonLoadNotCancelled(shouldCancel)

  for (let index = 0; index < rawInstances.length; index += 1) {
    const raw = rawInstances[index]
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error(`Invalid instance at index ${index}.`)
    }
    const inst = raw as Record<string, unknown>
    const id = inst.id
    if (typeof id !== 'number' || !Number.isInteger(id)) {
      throw new Error(`Invalid instance id at index ${index}.`)
    }
    const bbox = asBBox(inst.bbox, `instance ${id}`)
    const instance: ViewJsonOverviewInstance = {
      id,
      name: typeof inst.name === 'string' ? inst.name : String(id),
      bbox,
      world: viewJsonBBoxToWorldRect(bbox, worldHeight),
      status: typeof inst.status === 'string' ? inst.status : '',
      masterId: typeof inst.master_id === 'number' && Number.isInteger(inst.master_id) ? inst.master_id : null,
      origin: asPoint(inst.origin),
      orient: typeof inst.orient === 'string' ? inst.orient : 'N',
    }
    maxChunkInstanceCount = Math.max(
      maxChunkInstanceCount,
      indexInstanceDetailChunks(instance, chunks, chunkSize),
    )
    indexInstanceRasterTileBuckets(instance, rasterTileBuckets)

    if ((index + 1) % batchSize === 0 && index + 1 < rawInstances.length) {
      await yieldToMainThread()
      assertViewJsonLoadNotCancelled(shouldCancel)
    }
  }

  sortRasterTileBucketsForPaint(rasterTileBuckets)

  return {
    chunks,
    rasterTileBuckets,
    totalInstanceCount: rawInstances.length,
    maxChunkInstanceCount,
  }
}

function sortRasterTileBucketsForPaint(
  buckets: Map<string, ViewJsonRasterInstance[]>,
): void {
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => Number(a.status === 'FIXED') - Number(b.status === 'FIXED'))
  }
}

function indexInstanceDetailChunks(
  instance: ViewJsonOverviewInstance,
  chunks: Map<string, ViewJsonInstanceChunk>,
  chunkSize: number,
): number {
  if (instance.world.w <= 0 || instance.world.h <= 0) return 0

  const range = getViewJsonChunkRangeForBounds({
    x: instance.world.x,
    y: instance.world.y,
    width: instance.world.w,
    height: instance.world.h,
  }, 0, chunkSize)
  let maxChunkInstanceCount = 0

  for (let chunkY = range.minY; chunkY <= range.maxY; chunkY += 1) {
    for (let chunkX = range.minX; chunkX <= range.maxX; chunkX += 1) {
      const key = `${chunkX}:${chunkY}`
      let chunk = chunks.get(key)
      if (!chunk) {
        chunk = { key, x: chunkX, y: chunkY, instances: [] }
        chunks.set(key, chunk)
      }
      chunk.instances.push(instance)
      maxChunkInstanceCount = Math.max(maxChunkInstanceCount, chunk.instances.length)
    }
  }

  return maxChunkInstanceCount
}

function indexInstanceRasterTileBuckets(
  instance: ViewJsonOverviewInstance,
  buckets: Map<string, ViewJsonRasterInstance[]>,
): void {
  if (instance.world.w <= 0 || instance.world.h <= 0) return

  const range = getViewJsonRasterTileRangeForBounds({
    x: instance.world.x,
    y: instance.world.y,
    width: instance.world.w,
    height: instance.world.h,
  })

  for (let tileY = range.minY; tileY <= range.maxY; tileY += 1) {
    for (let tileX = range.minX; tileX <= range.maxX; tileX += 1) {
      const key = `${tileX}:${tileY}`
      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = []
        buckets.set(key, bucket)
      }
      bucket.push({
        id: instance.id,
        x: instance.world.x,
        y: instance.world.y,
        w: instance.world.w,
        h: instance.world.h,
        status: instance.status,
      })
    }
  }
}

export function getViewJsonChunkRangeForBounds(
  visible: { x: number; y: number; width: number; height: number },
  padding: number,
  chunkSize = VIEW_JSON_INSTANCE_CHUNK_SIZE,
): ViewJsonChunkRange {
  const left = visible.x - padding
  const top = visible.y - padding
  const right = Math.max(left, visible.x + visible.width + padding)
  const bottom = Math.max(top, visible.y + visible.height + padding)

  return {
    minX: Math.floor(left / chunkSize),
    minY: Math.floor(top / chunkSize),
    maxX: Math.floor((right - 0.001) / chunkSize),
    maxY: Math.floor((bottom - 0.001) / chunkSize),
  }
}

export function getViewJsonRasterTileRangeForBounds(
  visible: { x: number; y: number; width: number; height: number },
  padding = 0,
  tileSize = VIEW_JSON_RASTER_TILE_WORLD_SIZE,
): ViewJsonChunkRange {
  return getViewJsonChunkRangeForBounds(visible, padding, tileSize)
}

export function estimateChunkCountForRange(range: ViewJsonChunkRange): number {
  const width = Math.max(0, range.maxX - range.minX + 1)
  const height = Math.max(0, range.maxY - range.minY + 1)
  return width * height
}

export function getViewJsonOverviewManifestFilePath(
  manifestText: string,
  manifestPath: string,
  key: string,
): string {
  const manifest = parseJson<ViewJsonOverviewManifest>(manifestText, manifestPath)
  validateManifest(manifest)
  return filePath(manifest, key)
}

function parseJson<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T
  } catch (error) {
    throw new Error(`Failed to parse ${label}: ${String(error)}`)
  }
}

function asBBox(value: unknown, label: string): ViewJsonBBox {
  if (
    !Array.isArray(value)
    || value.length !== 4
    || !value.every(v => typeof v === 'number' && Number.isFinite(v))
  ) {
    throw new Error(`Invalid ${label} bbox in view JSON package.`)
  }
  return [value[0], value[1], value[2], value[3]]
}

function filePath(manifest: ViewJsonOverviewManifest, key: string): string {
  const value = manifest.files?.[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`View JSON manifest is missing files.${key}.`)
  }
  return value
}

function validateManifest(manifest: ViewJsonOverviewManifest): void {
  if (manifest.schema !== 'ieda.view.v1' || manifest.format !== 'layout_view_package') {
    throw new Error('Unsupported view JSON manifest.')
  }
}

function asPoint(value: unknown): [number, number] | null {
  if (
    !Array.isArray(value)
    || value.length !== 2
    || !value.every(v => typeof v === 'number' && Number.isFinite(v))
  ) {
    return null
  }
  return [value[0], value[1]]
}

export async function parseViewJsonOverviewPackageTexts(
  input: ViewJsonOverviewPackageTexts,
  readMs: number,
  options: BuildViewJsonInstanceChunkIndexOptions = {},
): Promise<ViewJsonOverviewData> {
  const totalStartedAt = performance.now()
  let parseMs = 0
  let transformMs = 0
  let chunkMs = 0

  assertViewJsonLoadNotCancelled(options.shouldCancel)
  const parseStartedAt = performance.now()
  const manifest = parseJson<ViewJsonOverviewManifest>(
    input.manifestText,
    input.manifestPath,
  )
  const dieFile = parseJson<ViewJsonDieFile>(input.dieText, input.diePath)
  const instancesFile = parseJson<ViewJsonInstancesFile>(input.instancesText, input.instancesPath)
  parseMs += performance.now() - parseStartedAt
  validateManifest(manifest)

  if (dieFile.schema !== 'ieda.view.v1' || dieFile.kind !== 'die') {
    throw new Error('Unsupported view JSON die file.')
  }
  if (instancesFile.schema !== 'ieda.view.v1' || instancesFile.kind !== 'instances') {
    throw new Error('Unsupported view JSON instances file.')
  }

  const transformStartedAt = performance.now()
  const dieArea = asBBox(dieFile.data?.die_area, 'die_area')
  const coreArea = dieFile.data?.core_area == null
    ? null
    : asBBox(dieFile.data.core_area, 'core_area')
  const worldWidth = Math.abs(dieArea[2] - dieArea[0])
  const worldHeight = Math.abs(dieArea[3] - dieArea[1])
  const dieWorld = viewJsonBBoxToWorldRect(dieArea, worldHeight)
  const coreWorld = coreArea ? viewJsonBBoxToWorldRect(coreArea, worldHeight) : null

  if (!Array.isArray(instancesFile.data)) {
    throw new Error('Invalid instances data array in view JSON package.')
  }
  transformMs += performance.now() - transformStartedAt
  assertViewJsonLoadNotCancelled(options.shouldCancel)

  const chunkStartedAt = performance.now()
  const chunkIndex = await buildViewJsonInstanceChunkIndex(instancesFile.data, worldHeight, {
    batchSize: options.batchSize,
    yieldToMainThread: options.yieldToMainThread,
    shouldCancel: options.shouldCancel,
  })
  const { chunks, rasterTileBuckets } = chunkIndex
  chunkMs += performance.now() - chunkStartedAt

  return {
    dbuPerMicron: typeof manifest.unit?.dbu_per_micron === 'number'
      ? manifest.unit.dbu_per_micron
      : 1000,
    dieArea,
    coreArea,
    dieWorld,
    coreWorld,
    worldWidth,
    worldHeight,
    chunks,
    rasterTileBuckets,
    totalInstanceCount: chunkIndex.totalInstanceCount,
    maxChunkInstanceCount: chunkIndex.maxChunkInstanceCount,
    loadStats: {
      readMs,
      parseMs,
      transformMs,
      chunkMs,
      totalMs: performance.now() - totalStartedAt + readMs,
    },
  }
}
