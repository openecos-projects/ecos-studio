import { readProjectBinaryFile } from '@/utils/projectFiles'
import { edaPointToWorldPoint, edaRectToWorldRect } from './geometry'
import type {
  ViewJsonBBox,
  ViewJsonGeometryTileIndex,
  ViewJsonGeometryTilePayload,
  ViewJsonGeometryTileRef,
  ViewJsonObjectKind,
  ViewJsonPathRenderable,
  ViewJsonRectRenderable,
} from './types'
import type { ViewJsonVisibleBounds } from './renderSpatialIndex'

const TILE_MAGIC = 0x5447_4a56
const TILE_VERSION = 1
const DEFAULT_DECODED_BYTE_LIMIT = 192 * 1024 * 1024

export interface ViewJsonGeometryTileStoreOptions {
  projectPath?: string
  readBinary?: (path: string) => Promise<Uint8Array>
  decodedByteLimit?: number
  worldHeight?: number
}

export interface ViewJsonGeometryTileStoreStats {
  activeTileCount: number
  decodedBytes: number
  cacheHitCount: number
  cacheMissCount: number
  evictedTileCount: number
  pendingTileCount: number
}

interface DecodedTile {
  key: string
  rects: ViewJsonRectRenderable[]
  paths: ViewJsonPathRenderable[]
  bytes: number
  lastUsed: number
}

export interface ViewJsonGeometryTileRenderItems {
  rects: ViewJsonRectRenderable[]
  paths: ViewJsonPathRenderable[]
}

function joinPackagePath(packageRoot: string, relativePath: string): string {
  const root = packageRoot.replace(/[\\/]+$/, '')
  const rel = relativePath.replace(/^[\\/]+/, '')
  return `${root}/${rel}`
}

function bboxIntersectsVisible(bbox: ViewJsonBBox, visible: ViewJsonVisibleBounds): boolean {
  return bbox[0] <= visible.x + visible.width
    && bbox[2] >= visible.x
    && bbox[1] <= visible.y + visible.height
    && bbox[3] >= visible.y
}

function estimateDecodedBytes(tile: Pick<DecodedTile, 'rects' | 'paths'>): number {
  return tile.rects.length * 96
    + tile.paths.reduce((sum, path) => sum + 96 + path.edaPoints.length * 16, 0)
}

function isViewJsonObjectKind(value: string): value is ViewJsonObjectKind {
  return value === 'die'
    || value === 'core'
    || value === 'rows'
    || value === 'tracks'
    || value === 'gcell_grids'
    || value === 'instances'
    || value === 'io_pins'
    || value === 'regular_wires'
    || value === 'special_wires'
    || value === 'vias'
    || value === 'blockages'
    || value === 'fills'
    || value === 'regions'
    || value === 'cell_pins'
    || value === 'cell_obs'
}

export function decodeViewJsonGeometryTile(bytes: Uint8Array): ViewJsonGeometryTilePayload {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength < 16 || view.getUint32(0, true) !== TILE_MAGIC) {
    throw new Error('Invalid View JSON geometry tile magic.')
  }
  if (view.getUint16(4, true) !== TILE_VERSION) {
    throw new Error('Unsupported View JSON geometry tile version.')
  }
  const length = view.getUint32(8, true)
  const body = bytes.subarray(16, 16 + length)
  return JSON.parse(new TextDecoder().decode(body)) as ViewJsonGeometryTilePayload
}

export function encodeViewJsonGeometryTileForTest(payload: ViewJsonGeometryTilePayload): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(payload))
  const bytes = new Uint8Array(16 + body.length)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, TILE_MAGIC, true)
  view.setUint16(4, TILE_VERSION, true)
  view.setUint16(6, 0, true)
  view.setUint32(8, body.length, true)
  view.setUint32(12, 0, true)
  bytes.set(body, 16)
  return bytes
}

export class ViewJsonGeometryTileStore {
  private readonly packageRoot: string
  private readonly index: ViewJsonGeometryTileIndex
  private readonly readBinary: (path: string) => Promise<Uint8Array>
  private readonly decodedByteLimit: number
  private readonly worldHeight: number
  private readonly cache = new Map<string, DecodedTile>()
  private generation = 0
  private cacheHitCount = 0
  private cacheMissCount = 0
  private evictedTileCount = 0
  private pendingTileCount = 0
  private activeTileCount = 0
  private decodedBytes = 0
  private clock = 0

  constructor(
    packageRoot: string,
    index: ViewJsonGeometryTileIndex,
    options: ViewJsonGeometryTileStoreOptions = {},
  ) {
    this.packageRoot = packageRoot
    this.index = index
    this.decodedByteLimit = Math.max(0, options.decodedByteLimit ?? DEFAULT_DECODED_BYTE_LIMIT)
    this.worldHeight = options.worldHeight ?? Math.abs(index.world_bbox[3] - index.world_bbox[1])
    this.readBinary = options.readBinary ?? (
      path => readProjectBinaryFile(path, { projectPath: options.projectPath })
    )
  }

  async loadTilesForBounds(bounds: ViewJsonVisibleBounds): Promise<ViewJsonGeometryTileRenderItems> {
    const generation = this.generation + 1
    this.generation = generation
    const tiles = this.index.tiles.filter(tile => bboxIntersectsVisible(tile.bbox, bounds))
    this.activeTileCount = tiles.length
    this.pendingTileCount = tiles.length
    const decoded = await Promise.all(tiles.map(tile => this.loadTile(tile, generation)))
    this.pendingTileCount = 0
    if (generation !== this.generation) return { rects: [], paths: [] }
    return {
      rects: decoded.flatMap(tile => tile?.rects ?? []),
      paths: decoded.flatMap(tile => tile?.paths ?? []),
    }
  }

  clear(): void {
    this.cache.clear()
    this.decodedBytes = 0
    this.activeTileCount = 0
    this.pendingTileCount = 0
  }

  dispose(): void {
    this.generation += 1
    this.clear()
  }

  getStats(): ViewJsonGeometryTileStoreStats {
    return {
      activeTileCount: this.activeTileCount,
      decodedBytes: this.decodedBytes,
      cacheHitCount: this.cacheHitCount,
      cacheMissCount: this.cacheMissCount,
      evictedTileCount: this.evictedTileCount,
      pendingTileCount: this.pendingTileCount,
    }
  }

  private async loadTile(tile: ViewJsonGeometryTileRef, generation: number): Promise<DecodedTile | null> {
    const cached = this.cache.get(tile.id)
    if (cached) {
      cached.lastUsed = this.nextClock()
      this.cacheHitCount += 1
      return cached
    }
    this.cacheMissCount += 1
    const bytes = await this.readBinary(joinPackagePath(this.packageRoot, tile.file))
    if (generation !== this.generation) return null
    const decoded = this.decodeTile(tile, bytes)
    this.cache.set(tile.id, decoded)
    this.decodedBytes += decoded.bytes
    this.evictIfNeeded()
    return this.cache.get(tile.id) ?? null
  }

  private decodeTile(tile: ViewJsonGeometryTileRef, bytes: Uint8Array): DecodedTile {
    const payload = decodeViewJsonGeometryTile(bytes)
    const rects: ViewJsonRectRenderable[] = []
    const paths: ViewJsonPathRenderable[] = []
    for (const rect of payload.rects ?? []) {
      const objectKind = isViewJsonObjectKind(rect.objectKind) ? rect.objectKind : 'fills'
      rects.push({
        id: rect.id,
        objectKind,
        sourceId: rect.sourceId,
        layerId: rect.layerId,
        eda: rect.eda,
        world: edaRectToWorldRect(rect.eda, this.worldHeight),
      })
    }
    for (const path of payload.paths ?? []) {
      if (path.layerId == null) continue
      paths.push({
        id: path.id,
        objectKind: path.objectKind,
        sourceId: path.sourceId,
        layerId: path.layerId,
        width: path.width,
        edaPoints: path.points,
        worldPoints: path.points.map(point => edaPointToWorldPoint(point, this.worldHeight)),
      })
    }
    const decoded = {
      key: tile.id,
      rects,
      paths,
      bytes: 0,
      lastUsed: this.nextClock(),
    }
    decoded.bytes = estimateDecodedBytes(decoded)
    return decoded
  }

  private evictIfNeeded(): void {
    if (this.decodedBytes <= this.decodedByteLimit) return
    const entries = [...this.cache.values()].sort((left, right) => left.lastUsed - right.lastUsed)
    for (const entry of entries) {
      if (this.decodedBytes <= this.decodedByteLimit) break
      this.cache.delete(entry.key)
      this.decodedBytes = Math.max(0, this.decodedBytes - entry.bytes)
      this.evictedTileCount += 1
    }
  }

  private nextClock(): number {
    this.clock += 1
    return this.clock
  }
}
