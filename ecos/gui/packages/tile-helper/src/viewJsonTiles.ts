import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const TILE_MAGIC = 0x5447_4a56 // VJGT
const TILE_VERSION = 1
const TILE_ENCODING = 'ecostudio.view_geometry_tile.bin.v1'
const DEFAULT_MAX_TILE_PRIMITIVES = 6000
const DEFAULT_MAX_TILE_BYTES = 1024 * 1024
const DEFAULT_MAX_TILES_PER_OBJECT = 16
const DATA_ARRAY_KEY = '"data"'
const SCAN_HEADER_LIMIT = 64 * 1024
const TILE_KIND_KEYS = [
  'regular_wires',
  'special_wires',
  'instances',
  'io_pins',
  'blockages',
  'fills',
  'regions',
] as const

type TileObjectKind = typeof TILE_KIND_KEYS[number]
type ViewJsonBBox = [number, number, number, number]
type ViewJsonPoint = [number, number]

interface ViewJsonManifest {
  schema: string
  format: string
  files?: Record<string, string>
  capabilities?: Record<string, unknown>
  bbox?: ViewJsonBBox
  [key: string]: unknown
}

interface ViewJsonDieFile {
  schema?: unknown
  kind?: unknown
  data?: {
    die_area?: unknown
  }
}

export interface ViewJsonGeometryTilePrimitive {
  id: string
  objectKind: string
  sourceId: number
  layerId?: number
  eda: ViewJsonBBox
  payload?: unknown
}

export interface ViewJsonGeometryTilePath {
  id: string
  objectKind: 'regular_wires' | 'special_wires'
  sourceId: number
  layerId?: number
  width: number
  points: ViewJsonPoint[]
  eda: ViewJsonBBox
  payload?: unknown
}

export interface ViewJsonGeometryTilePayload {
  rects: ViewJsonGeometryTilePrimitive[]
  paths: ViewJsonGeometryTilePath[]
}

interface TileBucket extends ViewJsonGeometryTilePayload {
  id: string
  bbox: ViewJsonBBox
  keys: Set<string>
  layers: Set<number>
  counts: Partial<Record<TileObjectKind, number>>
}

interface TileMeta {
  id: string
  bbox: ViewJsonBBox
  file: string
  byte_size: number
  hash: string
  counts: Partial<Record<TileObjectKind, number>>
  layers: number[]
}

export interface ViewJsonGeometryTileIndex {
  schema: 'ieda.view.v1'
  kind: 'geometry_tile_index'
  version: 1
  encoding: typeof TILE_ENCODING
  world_bbox: ViewJsonBBox
  tile_config: {
    columns: number
    rows: number
    max_tile_primitives: number
    max_tile_bytes: number
    max_tiles_per_object: number
  }
  tiles: TileMeta[]
  large_objects?: {
    file: string
    count: number
    byte_size: number
    hash: string
  }
  source: {
    manifest_hash: string
    generated_at: string
    generator: string
  }
}

export interface GenerateViewJsonGeometryTilesOptions {
  packageRoot: string
  force?: boolean
  memoryBudgetMb?: number
  maxTilePrimitives?: number
  maxTileBytes?: number
  maxTilesPerObject?: number
}

export interface GenerateViewJsonGeometryTilesResult {
  tileCount: number
  largeObjectCount: number
  indexPath: string
}

interface SourceObject {
  objectKind: TileObjectKind
  sourceId: number
  layerId?: number
  layers: number[]
  bbox: ViewJsonBBox
  primitiveCount: number
  byteEstimate: number
  item: Record<string, unknown>
}

interface TileGrid {
  columns: number
  rows: number
  worldBBox: ViewJsonBBox
  tileWidth: number
  tileHeight: number
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function normalizeBBox(value: unknown): ViewJsonBBox | null {
  if (!Array.isArray(value) || value.length < 4) return null
  const [x1, y1, x2, y2] = value
  if (
    typeof x1 !== 'number'
    || typeof y1 !== 'number'
    || typeof x2 !== 'number'
    || typeof y2 !== 'number'
  ) return null
  return [
    Math.min(x1, x2),
    Math.min(y1, y2),
    Math.max(x1, x2),
    Math.max(y1, y2),
  ]
}

function bboxFromPoints(points: unknown, width = 0): ViewJsonBBox | null {
  if (!Array.isArray(points) || points.length === 0) return null
  let lx = Number.POSITIVE_INFINITY
  let ly = Number.POSITIVE_INFINITY
  let ux = Number.NEGATIVE_INFINITY
  let uy = Number.NEGATIVE_INFINITY
  for (const point of points) {
    if (!Array.isArray(point) || point.length < 2) continue
    const [x, y] = point
    if (typeof x !== 'number' || typeof y !== 'number') continue
    lx = Math.min(lx, x)
    ly = Math.min(ly, y)
    ux = Math.max(ux, x)
    uy = Math.max(uy, y)
  }
  if (!Number.isFinite(lx) || !Number.isFinite(ly) || !Number.isFinite(ux) || !Number.isFinite(uy)) return null
  const half = Math.max(width, 0) / 2
  return [lx - half, ly - half, ux + half, uy + half]
}

function bboxFromLayerShapes(item: Record<string, unknown>): ViewJsonBBox | null {
  const rects: ViewJsonBBox[] = []
  for (const port of Array.isArray(item.ports) ? item.ports : []) {
    const portRecord = asRecord(port, 'port')
    for (const rect of Array.isArray(portRecord.rects) ? portRecord.rects : []) {
      const bbox = normalizeBBox(rect)
      if (bbox) rects.push(bbox)
    }
  }
  if (rects.length === 0) return null
  return unionBBoxes(rects)
}

function unionBBoxes(rects: ViewJsonBBox[]): ViewJsonBBox {
  let lx = Number.POSITIVE_INFINITY
  let ly = Number.POSITIVE_INFINITY
  let ux = Number.NEGATIVE_INFINITY
  let uy = Number.NEGATIVE_INFINITY
  for (const rect of rects) {
    lx = Math.min(lx, rect[0])
    ly = Math.min(ly, rect[1])
    ux = Math.max(ux, rect[2])
    uy = Math.max(uy, rect[3])
  }
  return [lx, ly, ux, uy]
}

function bboxForItem(objectKind: TileObjectKind, item: Record<string, unknown>): ViewJsonBBox | null {
  return normalizeBBox(item.bbox)
    ?? normalizeBBox(item.rect)
    ?? (objectKind === 'regular_wires' || objectKind === 'special_wires'
      ? bboxFromPoints(item.points, typeof item.width === 'number' ? item.width : 0)
      : null)
    ?? (objectKind === 'regions' && Array.isArray(item.rects)
      ? unionBBoxes(item.rects.map(normalizeBBox).filter((bbox): bbox is ViewJsonBBox => Boolean(bbox)))
      : null)
    ?? (objectKind === 'io_pins' ? bboxFromLayerShapes(item) : null)
}

function layerIdsForItem(item: Record<string, unknown>): number[] {
  const layers = new Set<number>()
  if (typeof item.layer_id === 'number') layers.add(item.layer_id)
  if (Array.isArray(item.layers)) {
    for (const layer of item.layers) {
      if (typeof layer === 'number') layers.add(layer)
    }
  }
  if (Array.isArray(item.ports)) {
    for (const port of item.ports) {
      const portRecord = asRecord(port, 'port')
      if (typeof portRecord.layer_id === 'number') layers.add(portRecord.layer_id)
    }
  }
  return [...layers].sort((left, right) => left - right)
}

function sourceObjectFromItem(objectKind: TileObjectKind, item: unknown): SourceObject | null {
  const record = asRecord(item, `${objectKind} item`)
  const bbox = bboxForItem(objectKind, record)
  if (!bbox) return null
  const sourceId = typeof record.id === 'number' ? record.id : -1
  const points = Array.isArray(record.points) ? record.points : []
  return {
    objectKind,
    sourceId,
    layerId: typeof record.layer_id === 'number' ? record.layer_id : undefined,
    layers: layerIdsForItem(record),
    bbox,
    primitiveCount: Math.max(1, points.length - 1),
    byteEstimate: JSON.stringify(record).length,
    item: record,
  }
}

function rectsIntersect(a: ViewJsonBBox, b: ViewJsonBBox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
}

function tileBounds(grid: TileGrid, x: number, y: number): ViewJsonBBox {
  const [lx, ly] = grid.worldBBox
  return [
    lx + x * grid.tileWidth,
    ly + y * grid.tileHeight,
    lx + (x + 1) * grid.tileWidth,
    ly + (y + 1) * grid.tileHeight,
  ]
}

function tileRangeForBBox(grid: TileGrid, bbox: ViewJsonBBox): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  const [worldLx, worldLy] = grid.worldBBox
  const minX = Math.max(0, Math.floor((bbox[0] - worldLx) / grid.tileWidth))
  const minY = Math.max(0, Math.floor((bbox[1] - worldLy) / grid.tileHeight))
  const maxX = Math.min(grid.columns - 1, Math.floor((bbox[2] - worldLx - 0.001) / grid.tileWidth))
  const maxY = Math.min(grid.rows - 1, Math.floor((bbox[3] - worldLy - 0.001) / grid.tileHeight))
  return {
    minX,
    minY,
    maxX: Math.max(minX, maxX),
    maxY: Math.max(minY, maxY),
  }
}

function tileIdsForObject(grid: TileGrid, object: SourceObject): string[] {
  const range = tileRangeForBBox(grid, object.bbox)
  const ids: string[] = []
  for (let y = range.minY; y <= range.maxY; y += 1) {
    for (let x = range.minX; x <= range.maxX; x += 1) {
      const bbox = tileBounds(grid, x, y)
      if (rectsIntersect(bbox, object.bbox)) ids.push(`${x}:${y}`)
    }
  }
  return ids
}

function createGrid(worldBBox: ViewJsonBBox, objectCount: number, maxTilePrimitives: number): TileGrid {
  const targetTiles = Math.max(1, Math.ceil(objectCount / Math.max(1, maxTilePrimitives)))
  const side = Math.max(1, Math.ceil(Math.sqrt(targetTiles)))
  return {
    columns: side,
    rows: side,
    worldBBox,
    tileWidth: Math.max(1, (worldBBox[2] - worldBBox[0]) / side),
    tileHeight: Math.max(1, (worldBBox[3] - worldBBox[1]) / side),
  }
}

function getTileBucket(buckets: Map<string, TileBucket>, grid: TileGrid, id: string): TileBucket {
  const existing = buckets.get(id)
  if (existing) return existing
  const [x, y] = id.split(':').map(value => Number.parseInt(value, 10))
  const bucket: TileBucket = {
    id,
    bbox: tileBounds(grid, x, y),
    keys: new Set(),
    layers: new Set(),
    counts: {},
    rects: [],
    paths: [],
  }
  buckets.set(id, bucket)
  return bucket
}

function countBucketObject(bucket: TileBucket, object: SourceObject): void {
  bucket.counts[object.objectKind] = (bucket.counts[object.objectKind] ?? 0) + 1
  for (const layer of object.layers) bucket.layers.add(layer)
}

function toTilePath(object: SourceObject): ViewJsonGeometryTilePath | null {
  if (object.objectKind !== 'regular_wires' && object.objectKind !== 'special_wires') return null
  if (object.item.kind !== 'path' || !Array.isArray(object.item.points)) return null
  const points = object.item.points.filter((point): point is ViewJsonPoint =>
    Array.isArray(point)
    && point.length >= 2
    && typeof point[0] === 'number'
    && typeof point[1] === 'number',
  )
  if (points.length < 2) return null
  return {
    id: `${object.objectKind}:${object.sourceId}:path`,
    objectKind: object.objectKind,
    sourceId: object.sourceId,
    layerId: object.layerId,
    width: typeof object.item.width === 'number' ? object.item.width : 1,
    points,
    eda: object.bbox,
    payload: object.item,
  }
}

function toTileRects(object: SourceObject): ViewJsonGeometryTilePrimitive[] {
  if (object.objectKind === 'regular_wires' || object.objectKind === 'special_wires') {
    if (object.item.kind === 'path') return []
    return [{
      id: `${object.objectKind}:${object.sourceId}:${String(object.item.kind ?? 'rect')}`,
      objectKind: object.item.kind === 'via' ? 'vias' : object.objectKind,
      sourceId: object.sourceId,
      layerId: object.layerId,
      eda: object.bbox,
      payload: object.item,
    }]
  }
  if (object.objectKind === 'regions' && Array.isArray(object.item.rects)) {
    return object.item.rects
      .map(normalizeBBox)
      .filter((bbox): bbox is ViewJsonBBox => Boolean(bbox))
      .map((bbox, index) => ({
        id: `${object.objectKind}:${object.sourceId}:${index}`,
        objectKind: object.objectKind,
        sourceId: object.sourceId,
        layerId: object.layerId,
        eda: bbox,
        payload: object.item,
      }))
  }
  if (object.objectKind === 'io_pins' && Array.isArray(object.item.ports)) {
    const rects: ViewJsonGeometryTilePrimitive[] = []
    object.item.ports.forEach((port, portIndex) => {
      const portRecord = asRecord(port, 'port')
      const layerId = typeof portRecord.layer_id === 'number' ? portRecord.layer_id : object.layerId
      const portRects = Array.isArray(portRecord.rects) ? portRecord.rects : []
      portRects.forEach((rect, rectIndex) => {
        const bbox = normalizeBBox(rect)
        if (!bbox) return
        rects.push({
          id: `${object.objectKind}:${object.sourceId}:${portIndex}:${rectIndex}`,
          objectKind: object.objectKind,
          sourceId: object.sourceId,
          layerId,
          eda: bbox,
          payload: object.item,
        })
      })
    })
    if (rects.length > 0) return rects
  }
  return [{
    id: `${object.objectKind}:${object.sourceId}`,
    objectKind: object.objectKind,
    sourceId: object.sourceId,
    layerId: object.layerId,
    eda: object.bbox,
    payload: object.item,
  }]
}

function addObjectToBucket(bucket: TileBucket, object: SourceObject): void {
  const key = `${object.objectKind}:${object.sourceId}`
  if (bucket.keys.has(key)) return
  bucket.keys.add(key)
  countBucketObject(bucket, object)
  const path = toTilePath(object)
  if (path) {
    bucket.paths.push(path)
    return
  }
  bucket.rects.push(...toTileRects(object))
}

function encodeTilePayload(payload: ViewJsonGeometryTilePayload): Buffer {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  const header = Buffer.alloc(16)
  header.writeUInt32LE(TILE_MAGIC, 0)
  header.writeUInt16LE(TILE_VERSION, 4)
  header.writeUInt16LE(0, 6)
  header.writeUInt32LE(body.length, 8)
  header.writeUInt32LE(0, 12)
  return Buffer.concat([header, body])
}

export function decodeViewJsonGeometryTile(bytes: Uint8Array): ViewJsonGeometryTilePayload {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength < 16 || view.getUint32(0, true) !== TILE_MAGIC) {
    throw new Error('Invalid View JSON geometry tile magic.')
  }
  if (view.getUint16(4, true) !== TILE_VERSION) {
    throw new Error('Unsupported View JSON geometry tile version.')
  }
  const bodyLength = view.getUint32(8, true)
  const bodyStart = 16
  const bodyEnd = bodyStart + bodyLength
  if (bodyEnd > bytes.byteLength) {
    throw new Error('Invalid View JSON geometry tile payload length.')
  }
  return JSON.parse(Buffer.from(bytes.subarray(bodyStart, bodyEnd)).toString('utf8')) as ViewJsonGeometryTilePayload
}

export function encodeViewJsonGeometryTileForTest(payload: ViewJsonGeometryTilePayload): Uint8Array {
  return encodeTilePayload(payload)
}

function sha256Tag(data: Uint8Array | string): string {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`
}

async function writeOutputFile(path: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}

function packagePath(packageRoot: string, relativePath: string): string {
  return join(packageRoot, relativePath)
}

function validateManifest(manifest: ViewJsonManifest): void {
  if (manifest.schema !== 'ieda.view.v1' || manifest.format !== 'layout_view_package') {
    throw new Error('Unsupported View JSON manifest.')
  }
}

async function readManifest(packageRoot: string): Promise<{ manifest: ViewJsonManifest; text: string }> {
  const text = await readFile(packagePath(packageRoot, 'manifest.json'), 'utf8')
  const manifest = JSON.parse(text) as ViewJsonManifest
  validateManifest(manifest)
  return { manifest, text }
}

async function readWorldBBox(packageRoot: string, manifest: ViewJsonManifest): Promise<ViewJsonBBox> {
  const manifestBBox = normalizeBBox(manifest.bbox)
  if (manifestBBox) return manifestBBox
  const dieRel = manifest.files?.die
  if (!dieRel) throw new Error('View JSON manifest is missing files.die.')
  const dieFile = JSON.parse(await readFile(packagePath(packageRoot, dieRel), 'utf8')) as ViewJsonDieFile
  if (dieFile.schema !== 'ieda.view.v1' || dieFile.kind !== 'die') {
    throw new Error('Unsupported View JSON die file.')
  }
  const bbox = normalizeBBox(dieFile.data?.die_area)
  if (!bbox) throw new Error('View JSON die file is missing data.die_area.')
  return bbox
}

async function sourceFileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function* readSourceObjects(
  packageRoot: string,
  manifest: ViewJsonManifest,
): AsyncGenerator<SourceObject> {
  for (const key of TILE_KIND_KEYS) {
    const rel = manifest.files?.[key]
    if (!rel) continue
    const path = packagePath(packageRoot, rel)
    if (!(await sourceFileExists(path))) {
      throw new Error(`View JSON geometry tile generation failed: files.${key} is missing at ${rel}`)
    }
    for await (const item of scanViewJsonDataArray(path)) {
      const sourceObject = sourceObjectFromItem(key, item)
      if (sourceObject) yield sourceObject
    }
  }
}

async function collectSourceStats(
  packageRoot: string,
  manifest: ViewJsonManifest,
): Promise<{
  objectCount: number
  primitiveCount: number
  byteEstimate: number
}> {
  let objectCount = 0
  let primitiveCount = 0
  let byteEstimate = 0
  for await (const object of readSourceObjects(packageRoot, manifest)) {
    objectCount += 1
    primitiveCount += object.primitiveCount
    byteEstimate += object.byteEstimate
  }
  return { objectCount, primitiveCount, byteEstimate }
}

async function buildTileBuckets(
  packageRoot: string,
  manifest: ViewJsonManifest,
  grid: TileGrid,
  maxTilesPerObject: number,
): Promise<{
  buckets: Map<string, TileBucket>
  largeObjects: ViewJsonGeometryTilePayload
}> {
  const buckets = new Map<string, TileBucket>()
  const largeObjects: ViewJsonGeometryTilePayload = { rects: [], paths: [] }
  for await (const object of readSourceObjects(packageRoot, manifest)) {
    const tileIds = tileIdsForObject(grid, object)
    if (tileIds.length > maxTilesPerObject) {
      const path = toTilePath(object)
      if (path) {
        largeObjects.paths.push(path)
      } else {
        largeObjects.rects.push(...toTileRects(object))
      }
      continue
    }
    for (const tileId of tileIds) {
      addObjectToBucket(getTileBucket(buckets, grid, tileId), object)
    }
  }
  return { buckets, largeObjects }
}

async function writeTiles(
  packageRoot: string,
  buckets: Map<string, TileBucket>,
): Promise<TileMeta[]> {
  const metas: TileMeta[] = []
  for (const bucket of [...buckets.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    if (bucket.rects.length === 0 && bucket.paths.length === 0) continue
    const [x, y] = bucket.id.split(':')
    const relativePath = `design/geometry_tiles/${x}/${y}.bin`
    const payload = { rects: bucket.rects, paths: bucket.paths }
    const bytes = encodeTilePayload(payload)
    await writeOutputFile(packagePath(packageRoot, relativePath), bytes)
    metas.push({
      id: bucket.id,
      bbox: bucket.bbox,
      file: relativePath,
      byte_size: bytes.length,
      hash: sha256Tag(bytes),
      counts: bucket.counts,
      layers: [...bucket.layers].sort((left, right) => left - right),
    })
  }
  return metas
}

async function writeLargeObjects(
  packageRoot: string,
  payload: ViewJsonGeometryTilePayload,
): Promise<ViewJsonGeometryTileIndex['large_objects'] | undefined> {
  const count = payload.rects.length + payload.paths.length
  if (count === 0) return undefined
  const relativePath = 'design/geometry_tiles/large_objects.bin'
  const bytes = encodeTilePayload(payload)
  await writeOutputFile(packagePath(packageRoot, relativePath), bytes)
  return {
    file: relativePath,
    count,
    byte_size: bytes.length,
    hash: sha256Tag(bytes),
  }
}

async function updateManifest(packageRoot: string, manifest: ViewJsonManifest): Promise<void> {
  const nextManifest: ViewJsonManifest = {
    ...manifest,
    files: {
      ...(manifest.files ?? {}),
      geometry_tile_index: 'design/geometry_tile_index.json',
    },
    capabilities: {
      ...(manifest.capabilities ?? {}),
      geometry_tiles: true,
    },
  }
  const manifestPath = packagePath(packageRoot, 'manifest.json')
  const tempPath = `${manifestPath}.tmp`
  await writeFile(tempPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8')
  await rename(tempPath, manifestPath)
}

export async function generateViewJsonGeometryTiles(
  options: GenerateViewJsonGeometryTilesOptions,
): Promise<GenerateViewJsonGeometryTilesResult> {
  const packageRoot = options.packageRoot
  const maxTilePrimitives = Math.max(1, Math.floor(options.maxTilePrimitives ?? DEFAULT_MAX_TILE_PRIMITIVES))
  const maxTileBytes = Math.max(1024, Math.floor(options.maxTileBytes ?? DEFAULT_MAX_TILE_BYTES))
  const maxTilesPerObject = Math.max(1, Math.floor(options.maxTilesPerObject ?? DEFAULT_MAX_TILES_PER_OBJECT))
  const indexPath = packagePath(packageRoot, 'design/geometry_tile_index.json')
  if (!options.force && await sourceFileExists(indexPath)) {
    const existing = JSON.parse(await readFile(indexPath, 'utf8')) as ViewJsonGeometryTileIndex
    return {
      tileCount: existing.tiles.length,
      largeObjectCount: existing.large_objects?.count ?? 0,
      indexPath,
    }
  }

  const { manifest, text: manifestText } = await readManifest(packageRoot)
  const worldBBox = await readWorldBBox(packageRoot, manifest)
  const stats = await collectSourceStats(packageRoot, manifest)
  const objectCountForGrid = Math.max(stats.objectCount, Math.ceil(stats.byteEstimate / maxTileBytes))
  const grid = createGrid(worldBBox, objectCountForGrid, maxTilePrimitives)
  const { buckets, largeObjects } = await buildTileBuckets(packageRoot, manifest, grid, maxTilesPerObject)
  const tiles = await writeTiles(packageRoot, buckets)
  const largeObjectMeta = await writeLargeObjects(packageRoot, largeObjects)
  const index: ViewJsonGeometryTileIndex = {
    schema: 'ieda.view.v1',
    kind: 'geometry_tile_index',
    version: 1,
    encoding: TILE_ENCODING,
    world_bbox: worldBBox,
    tile_config: {
      columns: grid.columns,
      rows: grid.rows,
      max_tile_primitives: maxTilePrimitives,
      max_tile_bytes: maxTileBytes,
      max_tiles_per_object: maxTilesPerObject,
    },
    tiles,
    large_objects: largeObjectMeta,
    source: {
      manifest_hash: sha256Tag(manifestText),
      generated_at: new Date().toISOString(),
      generator: '@ecos-studio/tile-helper:view-json-geometry-tiles',
    },
  }
  await writeOutputFile(indexPath, `${JSON.stringify(index, null, 2)}\n`)
  await updateManifest(packageRoot, manifest)
  return {
    tileCount: tiles.length,
    largeObjectCount: largeObjectMeta?.count ?? 0,
    indexPath,
  }
}

export async function* scanViewJsonDataArray(path: string): AsyncGenerator<unknown> {
  let state: 'seek-key' | 'seek-array' | 'scan-array' = 'seek-key'
  let buffer = ''
  for await (const chunk of createReadStream(path, { encoding: 'utf8' })) {
    buffer += chunk
    while (buffer.length > 0) {
      if (state === 'seek-key') {
        const keyIndex = buffer.indexOf(DATA_ARRAY_KEY)
        if (keyIndex < 0) {
          buffer = buffer.slice(-Math.max(0, DATA_ARRAY_KEY.length - 1))
          break
        }
        buffer = buffer.slice(keyIndex + DATA_ARRAY_KEY.length)
        state = 'seek-array'
        continue
      }

      if (state === 'seek-array') {
        const arrayStart = buffer.indexOf('[')
        if (arrayStart < 0) {
          if (buffer.length > SCAN_HEADER_LIMIT) {
            throw new Error(`${path}: missing data array`)
          }
          break
        }
        buffer = buffer.slice(arrayStart + 1)
        state = 'scan-array'
        continue
      }

      const result = consumeDataArrayItem(buffer, path)
      buffer = buffer.slice(result.consumed)
      if (result.kind === 'done') return
      if (result.kind === 'need-more') break
      yield result.value
    }
  }

  if (state !== 'scan-array') {
    throw new Error(`${path}: missing data array`)
  }
  const result = consumeDataArrayItem(buffer, path, true)
  if (result.kind !== 'done') {
    throw new Error(`${path}: unterminated data item`)
  }
}

type DataArrayConsumeResult =
  | { kind: 'item'; consumed: number; value: unknown }
  | { kind: 'need-more'; consumed: number }
  | { kind: 'done'; consumed: number }

function consumeDataArrayItem(
  buffer: string,
  path: string,
  endOfFile = false,
): DataArrayConsumeResult {
  let index = 0
  while (index < buffer.length && /[\s,]/u.test(buffer[index])) index += 1
  if (index >= buffer.length) {
    return endOfFile
      ? { kind: 'need-more', consumed: index }
      : { kind: 'need-more', consumed: index }
  }
  if (buffer[index] === ']') {
    return { kind: 'done', consumed: index + 1 }
  }

  const valueStart = index
  const first = buffer[valueStart]
  if (first !== '{' && first !== '[') {
    throw new Error(`${path}: expected object in data array`)
  }

  let depth = 0
  let inString = false
  let escaped = false
  for (; index < buffer.length; index += 1) {
    const char = buffer[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{' || char === '[') {
      depth += 1
      continue
    }
    if (char === '}' || char === ']') {
      depth -= 1
      if (depth === 0) {
        const valueEnd = index + 1
        return {
          kind: 'item',
          consumed: valueEnd,
          value: JSON.parse(buffer.slice(valueStart, valueEnd)),
        }
      }
    }
  }

  return { kind: 'need-more', consumed: valueStart }
}
