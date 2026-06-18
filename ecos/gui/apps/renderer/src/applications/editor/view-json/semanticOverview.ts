import { edaPointToWorldPoint, edaRectToWorldRect, normalizeBBox } from './geometry'
import {
  aggregateViewJsonPathsForLowZoom,
  aggregateViewJsonRectsForLowZoom,
} from './rectBatch'
import type {
  ViewJsonObjectKind,
  ViewJsonPackageData,
  ViewJsonPathRenderable,
  ViewJsonRectRenderable,
  ViewJsonRenderModel,
  ViewJsonWireSegment,
  ViewJsonWorldPoint,
} from './types'
import type { ViewJsonVisibleBounds } from './renderSpatialIndex'
import { requestIdle as defaultRequestIdle } from '@/composables/requestIdle'

export const VIEW_JSON_SEMANTIC_OVERVIEW_SCREEN_CELL_PX = 14
export const VIEW_JSON_SEMANTIC_OVERVIEW_REGULAR_WIRE_SCREEN_CELL_PX = 22
export const VIEW_JSON_SEMANTIC_OVERVIEW_CHUNK_SCREEN_PX = 128
export const VIEW_JSON_SEMANTIC_OVERVIEW_PREWARM_BATCH_SIZE = 10000
export const VIEW_JSON_SEMANTIC_OVERVIEW_PREWARM_FRAME_BUDGET_MS = 4
export const VIEW_JSON_SEMANTIC_OVERVIEW_MAX_LEVELS = 4
const VIEW_JSON_SEMANTIC_OVERVIEW_MAX_CELLS_PER_ITEM = 512
const VIEW_JSON_SEMANTIC_OVERVIEW_MIN_CHUNK_SIZE = 4096
const VIEW_JSON_SEMANTIC_OVERVIEW_MACRO_MIN_SCREEN_PX = 8
const VIEW_JSON_SEMANTIC_OVERVIEW_MACRO_MIN_AREA_RATIO = 0.0004

const SEMANTIC_OVERVIEW_KINDS = new Set<ViewJsonObjectKind>([
  'instances',
  'regular_wires',
  'special_wires',
  'vias',
  'blockages',
  'fills',
  'regions',
])

export interface ViewJsonSemanticOverviewLevel {
  key: string
  cellSize: number
  chunkSize: number
  rects: ViewJsonRectRenderable[]
  chunks: Map<string, ViewJsonRectRenderable[]>
}

type SemanticOverviewCacheEntry = {
  model: ViewJsonRenderModel
  data: ViewJsonPackageData | null
  level: ViewJsonSemanticOverviewLevel
  lastUsedAt: number
}

type SemanticOverviewPendingEntry = {
  model: ViewJsonRenderModel
  data: ViewJsonPackageData | null
  level: ViewJsonSemanticOverviewLevel
}

export interface ViewJsonSemanticOverviewCacheOptions {
  requestIdle?: () => Promise<void>
  prewarmBatchSize?: number
  prewarmFrameBudgetMs?: number
  maxLevels?: number
  now?: () => number
  workerClient?: ViewJsonSemanticOverviewWorkerClientLike | null
  onLevelReady?: (level: ViewJsonSemanticOverviewLevel) => void
}

export interface ViewJsonSemanticOverviewWorkerClientLike {
  buildLevel(
    model: ViewJsonRenderModel,
    data: ViewJsonPackageData | null,
    scale: number,
  ): Promise<ViewJsonSemanticOverviewLevel>
  buildLevelFromPackage?(
    data: ViewJsonPackageData,
    scale: number,
  ): Promise<ViewJsonSemanticOverviewLevel>
  cancelPending?: () => void
  destroy(): void
}

export class ViewJsonSemanticOverviewCache {
  private readonly levels = new Map<string, SemanticOverviewCacheEntry>()
  private readonly pending = new Map<string, SemanticOverviewPendingEntry>()
  private readonly requestIdle: () => Promise<void>
  private readonly prewarmBatchSize: number
  private readonly prewarmFrameBudgetMs: number
  private readonly maxLevels: number
  private readonly now: () => number
  private readonly workerClient: ViewJsonSemanticOverviewWorkerClientLike | null
  private readonly onLevelReady: ((level: ViewJsonSemanticOverviewLevel) => void) | undefined
  private generation = 0
  private accessSequence = 0

  constructor(options: ViewJsonSemanticOverviewCacheOptions = {}) {
    this.requestIdle = options.requestIdle ?? defaultRequestIdle
    this.prewarmBatchSize = options.prewarmBatchSize ?? VIEW_JSON_SEMANTIC_OVERVIEW_PREWARM_BATCH_SIZE
    this.prewarmFrameBudgetMs = options.prewarmFrameBudgetMs ?? VIEW_JSON_SEMANTIC_OVERVIEW_PREWARM_FRAME_BUDGET_MS
    this.maxLevels = Number.isFinite(options.maxLevels) && options.maxLevels != null && options.maxLevels > 0
      ? Math.floor(options.maxLevels)
      : VIEW_JSON_SEMANTIC_OVERVIEW_MAX_LEVELS
    this.now = options.now ?? (() => performance.now())
    this.workerClient = options.workerClient ?? null
    this.onLevelReady = options.onLevelReady
  }

  get size(): number {
    return this.levels.size
  }

  getLevel(
    model: ViewJsonRenderModel,
    data: ViewJsonPackageData | null,
    scale: number,
  ): ViewJsonSemanticOverviewLevel {
    const key = getViewJsonSemanticOverviewLevelKey(scale)
    const cached = this.levels.get(key)
    if (cached?.model === model && cached.data === data) return this.touchLevel(cached)

    const level = buildViewJsonSemanticOverviewLevel(model, data, scale)
    this.storeLevel(key, model, data, level)
    return level
  }

  peekLevel(
    model: ViewJsonRenderModel,
    data: ViewJsonPackageData | null,
    scale: number,
  ): ViewJsonSemanticOverviewLevel | null {
    const key = getViewJsonSemanticOverviewLevelKey(scale)
    const cached = this.levels.get(key)
    return cached?.model === model && cached.data === data ? this.touchLevel(cached) : null
  }

  peekNearestLevel(
    model: ViewJsonRenderModel,
    data: ViewJsonPackageData | null,
    scale: number,
  ): ViewJsonSemanticOverviewLevel | null {
    const exact = this.peekLevel(model, data, scale)
    if (exact) return exact

    const targetBucket = getViewJsonSemanticOverviewLevelBucket(scale)
    if (!Number.isFinite(targetBucket)) return null

    let nearest: SemanticOverviewCacheEntry | null = null
    let nearestDistance = Number.POSITIVE_INFINITY
    for (const [key, cached] of this.levels) {
      if (cached.model !== model || cached.data !== data) continue
      const bucket = getViewJsonSemanticOverviewLevelBucketFromKey(key)
      if (!Number.isFinite(bucket)) continue
      const distance = Math.abs(bucket - targetBucket)
      if (distance < nearestDistance) {
        nearest = cached
        nearestDistance = distance
      }
    }
    return nearest ? this.touchLevel(nearest) : null
  }

  prewarm(
    model: ViewJsonRenderModel,
    data: ViewJsonPackageData | null,
    scales: number[],
  ): void {
    const generation = this.generation
    const pendingScales = scales.filter(scale => {
      const key = getViewJsonSemanticOverviewLevelKey(scale)
      const cached = this.levels.get(key)
      if (cached?.model === model && cached.data === data) {
        this.touchLevel(cached)
        return false
      }
      const pending = this.pending.get(key)
      if (pending?.model === model && pending.data === data) return false
      this.pending.set(key, { model, data, level: placeholderSemanticOverviewLevel(key) })
      return true
    })
    if (pendingScales.length === 0) return

    void this.prewarmLevels(model, data, pendingScales, generation)
  }

  clear(): void {
    this.generation += 1
    this.levels.clear()
    this.pending.clear()
    this.workerClient?.cancelPending?.()
  }

  cancelPending(): void {
    this.generation += 1
    this.pending.clear()
    this.workerClient?.cancelPending?.()
  }

  private async prewarmLevels(
    model: ViewJsonRenderModel,
    data: ViewJsonPackageData | null,
    scales: number[],
    generation: number,
  ): Promise<void> {
    for (const scale of scales) {
      if (generation !== this.generation) return
      const key = getViewJsonSemanticOverviewLevelKey(scale)
      const cached = this.levels.get(key)
      if (cached?.model === model && cached.data === data) {
        this.touchLevel(cached)
        continue
      }

      const level = await this.buildLevelWithWorkerFallback(model, data, scale, generation, key)
      if (!level || generation !== this.generation) return
      this.storeLevel(key, model, data, level)
      this.onLevelReady?.(level)
    }
  }

  private touchLevel(entry: SemanticOverviewCacheEntry): ViewJsonSemanticOverviewLevel {
    this.accessSequence += 1
    entry.lastUsedAt = this.accessSequence
    return entry.level
  }

  private storeLevel(
    key: string,
    model: ViewJsonRenderModel,
    data: ViewJsonPackageData | null,
    level: ViewJsonSemanticOverviewLevel,
  ): void {
    this.accessSequence += 1
    this.levels.set(key, { model, data, level, lastUsedAt: this.accessSequence })
    this.pruneLevels()
  }

  private pruneLevels(): void {
    if (this.levels.size <= this.maxLevels) return
    const oldest = [...this.levels.entries()]
      .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)
    for (const [key] of oldest) {
      if (this.levels.size <= this.maxLevels) return
      this.levels.delete(key)
    }
  }

  private async buildLevelWithWorkerFallback(
    model: ViewJsonRenderModel,
    data: ViewJsonPackageData | null,
    scale: number,
    generation: number,
    key: string,
  ): Promise<ViewJsonSemanticOverviewLevel | null> {
    if (this.workerClient) {
      try {
        const level = data && this.workerClient.buildLevelFromPackage
          ? await this.workerClient.buildLevelFromPackage(data, scale)
          : await this.workerClient.buildLevel(model, data, scale)
        this.pending.delete(key)
        return level
      } catch {
        this.pending.delete(key)
        if (generation !== this.generation) return null
        this.pending.set(key, { model, data, level: placeholderSemanticOverviewLevel(key) })
      }
    }

    const level = await buildViewJsonSemanticOverviewLevelAsync(model, data, scale, {
        requestIdle: this.requestIdle,
        shouldCancel: () => generation !== this.generation,
        batchSize: this.prewarmBatchSize,
        frameBudgetMs: this.prewarmFrameBudgetMs,
        now: this.now,
    })
    this.pending.delete(key)
    return level
  }
}

function placeholderSemanticOverviewLevel(key: string): ViewJsonSemanticOverviewLevel {
  return {
    key,
    cellSize: 0,
    chunkSize: 0,
    rects: [],
    chunks: new Map(),
  }
}

export function isViewJsonSemanticOverviewKind(objectKind: ViewJsonObjectKind): boolean {
  return SEMANTIC_OVERVIEW_KINDS.has(objectKind)
}

export function getViewJsonSemanticOverviewLevelKey(scale: number): string {
  const bucket = getViewJsonSemanticOverviewLevelBucket(scale)
  if (!Number.isFinite(bucket)) return 'semantic-overview:invalid'
  return `semantic-overview:${bucket}`
}

export function getViewJsonSemanticOverviewLevelBucket(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return Number.NaN
  return Math.floor(Math.log2(scale))
}

function getViewJsonSemanticOverviewLevelBucketFromKey(key: string): number {
  const [, rawBucket] = key.split(':')
  const bucket = Number(rawBucket)
  return Number.isFinite(bucket) ? bucket : Number.NaN
}

export function normalizeViewJsonSemanticOverviewPrewarmScales(
  currentScale: number,
  fallbackScales: number[],
): number[] {
  const result: number[] = []
  const keys = new Set<string>()
  for (const scale of [currentScale, ...fallbackScales]) {
    if (!Number.isFinite(scale) || scale <= 0) continue
    const key = getViewJsonSemanticOverviewLevelKey(scale)
    if (keys.has(key)) continue
    keys.add(key)
    result.push(scale)
  }
  return result
}

export function getViewJsonSemanticOverviewCellSizeForKind(
  objectKind: ViewJsonObjectKind,
  scale: number,
): number {
  if (!Number.isFinite(scale) || scale <= 0) return 0
  const screenCellPx = objectKind === 'regular_wires'
    ? VIEW_JSON_SEMANTIC_OVERVIEW_REGULAR_WIRE_SCREEN_CELL_PX
    : VIEW_JSON_SEMANTIC_OVERVIEW_SCREEN_CELL_PX
  return screenCellPx / scale
}

function isViewJsonSemanticOverviewMacroRect(
  rect: ViewJsonRectRenderable,
  model: Pick<ViewJsonRenderModel, 'worldWidth' | 'worldHeight'>,
  scale: number,
): boolean {
  if (rect.objectKind !== 'instances' || rect.world.w <= 0 || rect.world.h <= 0) return false
  const screenWidth = rect.world.w * scale
  const screenHeight = rect.world.h * scale
  if (Math.max(screenWidth, screenHeight) < VIEW_JSON_SEMANTIC_OVERVIEW_MACRO_MIN_SCREEN_PX) return false

  const worldArea = Math.max(model.worldWidth * model.worldHeight, 1)
  const rectArea = rect.world.w * rect.world.h
  return rectArea / worldArea >= VIEW_JSON_SEMANTIC_OVERVIEW_MACRO_MIN_AREA_RATIO
}

function aggregateViewJsonSemanticOverviewRectsForKind(
  model: ViewJsonRenderModel,
  objectKind: ViewJsonObjectKind,
  group: ViewJsonRectRenderable[],
  scale: number,
): ViewJsonRectRenderable[] {
  if (objectKind !== 'instances') {
    return aggregateViewJsonRectsForLowZoom(
      group,
      getViewJsonSemanticOverviewCellSizeForKind(objectKind, scale),
    )
  }

  const macroRects: ViewJsonRectRenderable[] = []
  const standardCellRects: ViewJsonRectRenderable[] = []
  for (const rect of group) {
    if (isViewJsonSemanticOverviewMacroRect(rect, model, scale)) {
      macroRects.push(rect)
    } else {
      standardCellRects.push(rect)
    }
  }

  return [
    ...macroRects,
    ...aggregateViewJsonRectsForLowZoom(
      standardCellRects,
      getViewJsonSemanticOverviewCellSizeForKind(objectKind, scale),
    ),
  ]
}

export function buildViewJsonSemanticOverviewLevel(
  model: ViewJsonRenderModel,
  data: ViewJsonPackageData | null,
  scale: number,
): ViewJsonSemanticOverviewLevel {
  const rects: ViewJsonRectRenderable[] = []
  const rectGroups = new Map<ViewJsonObjectKind, ViewJsonRectRenderable[]>()
  const pathGroups = new Map<ViewJsonObjectKind, typeof model.paths>()

  for (const rect of model.rects) {
    if (!isViewJsonSemanticOverviewKind(rect.objectKind)) continue
    const group = rectGroups.get(rect.objectKind)
    if (group) {
      group.push(rect)
    } else {
      rectGroups.set(rect.objectKind, [rect])
    }
  }

  for (const path of model.paths) {
    if (!isViewJsonSemanticOverviewKind(path.objectKind)) continue
    const group = pathGroups.get(path.objectKind)
    if (group) {
      group.push(path)
    } else {
      pathGroups.set(path.objectKind, [path])
    }
  }

  addPackageRoutingOverviewGroups(model, data, rectGroups, pathGroups, rects, scale)

  for (const [objectKind, group] of rectGroups) {
    rects.push(...aggregateViewJsonSemanticOverviewRectsForKind(model, objectKind, group, scale))
  }
  for (const [objectKind, group] of pathGroups) {
    rects.push(...aggregateViewJsonPathsForLowZoom(
      group,
      getViewJsonSemanticOverviewCellSizeForKind(objectKind, scale),
    ))
  }
  if (model.lazyGeometry?.vias.length) {
    rects.push(...aggregateViewJsonRectsForLowZoom(
      model.lazyGeometry.vias.map(source => lazyViaSemanticOverviewRect(model, data, source)),
      getViewJsonSemanticOverviewCellSizeForKind('vias', scale),
    ))
  }

  const cellSize = getViewJsonSemanticOverviewCellSizeForKind('regular_wires', scale)
  const chunkSize = getViewJsonSemanticOverviewChunkSize(scale)
  return {
    key: getViewJsonSemanticOverviewLevelKey(scale),
    cellSize,
    chunkSize,
    rects,
    chunks: buildViewJsonSemanticOverviewChunks(rects, chunkSize),
  }
}

export function buildViewJsonPackageRoutingOverviewLevel(
  data: ViewJsonPackageData,
  scale: number,
): ViewJsonSemanticOverviewLevel | null {
  if (!data.overview?.preaggregated || data.overview.routing.length === 0) return null
  const cellSize = getViewJsonSemanticOverviewCellSizeForKind('regular_wires', scale)
  const chunkSize = getViewJsonSemanticOverviewChunkSize(scale)
  return {
    key: getViewJsonSemanticOverviewLevelKey(scale),
    cellSize,
    chunkSize,
    rects: data.overview.routing,
    chunks: buildViewJsonSemanticOverviewChunks(data.overview.routing, chunkSize),
  }
}

export function buildViewJsonSemanticOverviewSeedModel(data: ViewJsonPackageData): ViewJsonRenderModel {
  const rects: ViewJsonRectRenderable[] = []

  for (const inst of data.instances) {
    rects.push(packageRectOverviewRenderable('instances', inst.id, undefined, inst.bbox, data.worldHeight))
  }
  for (const blockage of data.blockages) {
    const rect = blockage.rect ?? blockage.bbox
    if (rect) {
      rects.push(packageRectOverviewRenderable('blockages', blockage.id, blockage.layer_id, rect, data.worldHeight))
    }
  }
  for (const fill of data.fills) {
    const rect = fill.rect ?? fill.bbox
    if (rect) {
      rects.push(packageRectOverviewRenderable('fills', fill.id, fill.layer_id, rect, data.worldHeight))
    }
  }
  for (const region of data.regions) {
    const rectsForRegion = region.rects ?? (region.bbox ? [region.bbox] : [])
    for (let rectIndex = 0; rectIndex < rectsForRegion.length; rectIndex += 1) {
      rects.push(packageRectOverviewRenderable(
        'regions',
        region.id,
        undefined,
        rectsForRegion[rectIndex],
        data.worldHeight,
        rectIndex,
      ))
    }
  }

  return {
    dbuPerMicron: data.dbuPerMicron,
    worldWidth: data.worldWidth,
    worldHeight: data.worldHeight,
    layers: [...data.layers].sort((a, b) => (a.order ?? a.id) - (b.order ?? b.id)),
    layerById: data.layerById,
    rects,
    paths: [],
    guides: [],
    lazyGeometry: {
      cellInstances: [],
      vias: [],
    },
    countsByObjectKind: {
      die: 0,
      core: 0,
      rows: 0,
      tracks: 0,
      gcell_grids: 0,
      instances: data.instances.length,
      io_pins: 0,
      regular_wires: 0,
      special_wires: 0,
      vias: 0,
      blockages: data.blockages.length,
      fills: data.fills.length,
      regions: data.regions.length,
      cell_pins: 0,
      cell_obs: 0,
    },
  }
}

function packageRectOverviewRenderable(
  objectKind: 'instances' | 'blockages' | 'fills' | 'regions',
  sourceId: number,
  layerId: number | undefined,
  rect: [number, number, number, number],
  worldHeight: number,
  rectIndex?: number,
): ViewJsonRectRenderable {
  const normalized = normalizeBBox(rect)
  return {
    id: rectIndex == null ? `${objectKind}:${sourceId}` : `${objectKind}:${sourceId}:${rectIndex}`,
    objectKind,
    sourceId,
    layerId,
    eda: normalized,
    world: edaRectToWorldRect(normalized, worldHeight),
  }
}

interface SemanticOverviewAsyncBuildOptions {
  requestIdle: () => Promise<void>
  shouldCancel?: () => boolean
  batchSize: number
  frameBudgetMs: number
  now: () => number
}

interface SemanticOverviewAsyncWorkState {
  processed: number
  sliceStartedAt: number
}

interface SemanticOverviewRectAggregateCell {
  rect: ViewJsonRectRenderable
  minX: number
  minY: number
  maxX: number
  maxY: number
  weight: number
}

interface SemanticOverviewPackageAggregateOutput {
  rects: ViewJsonRectRenderable[]
  added: number
}

function addPackageRoutingOverviewGroups(
  model: ViewJsonRenderModel,
  data: ViewJsonPackageData | null,
  rectGroups: Map<ViewJsonObjectKind, ViewJsonRectRenderable[]>,
  pathGroups: Map<ViewJsonObjectKind, ViewJsonPathRenderable[]>,
  output: ViewJsonRectRenderable[],
  scale: number,
): void {
  if (!data) return
  if (data.overview?.routing?.length) {
    output.push(...(
      data.overview.preaggregated
        ? data.overview.routing
        : aggregatePackageRoutingOverview(data.overview.routing, scale)
    ))
    return
  }
  if (!hasOverviewGeometryForKind(rectGroups, pathGroups, 'regular_wires')) {
    output.push(...addPackageWireSegmentsToOverviewCells(
      model,
      data,
      data.regularWires ?? [],
      'regular_wires',
      scale,
    ).rects)
  }
  if (!hasOverviewGeometryForKind(rectGroups, pathGroups, 'special_wires')) {
    output.push(...addPackageWireSegmentsToOverviewCells(
      model,
      data,
      data.specialWires ?? [],
      'special_wires',
      scale,
    ).rects)
  }
}

async function addPackageRoutingOverviewGroupsAsync(
  model: ViewJsonRenderModel,
  data: ViewJsonPackageData | null,
  rectGroups: Map<ViewJsonObjectKind, ViewJsonRectRenderable[]>,
  pathGroups: Map<ViewJsonObjectKind, ViewJsonPathRenderable[]>,
  output: ViewJsonRectRenderable[],
  scale: number,
  options: SemanticOverviewAsyncBuildOptions,
  state: SemanticOverviewAsyncWorkState,
): Promise<boolean> {
  if (!data) return true
  if (data.overview?.routing?.length) {
    if (data.overview.preaggregated) {
      for (const rect of data.overview.routing) {
        output.push(rect)
        if (!await yieldSemanticOverviewPrewarm(options, state)) return false
      }
      return true
    }
    const aggregate = await aggregatePackageRoutingOverviewAsync(data.overview.routing, scale, options, state)
    if (!aggregate) return false
    output.push(...aggregate)
    return true
  }
  if (!hasOverviewGeometryForKind(rectGroups, pathGroups, 'regular_wires')) {
    const aggregate = await addPackageWireSegmentsToOverviewCellsAsync(
      model,
      data,
      data.regularWires ?? [],
      'regular_wires',
      scale,
      options,
      state,
    )
    if (!aggregate) return false
    output.push(...aggregate.rects)
  }
  if (!hasOverviewGeometryForKind(rectGroups, pathGroups, 'special_wires')) {
    const aggregate = await addPackageWireSegmentsToOverviewCellsAsync(
      model,
      data,
      data.specialWires ?? [],
      'special_wires',
      scale,
      options,
      state,
    )
    if (!aggregate) return false
    output.push(...aggregate.rects)
  }
  return true
}

function aggregatePackageRoutingOverview(
  routing: ViewJsonRectRenderable[],
  scale: number,
): ViewJsonRectRenderable[] {
  const groups = new Map<ViewJsonObjectKind, ViewJsonRectRenderable[]>()
  for (const rect of routing) {
    const group = groups.get(rect.objectKind)
    if (group) {
      group.push(rect)
    } else {
      groups.set(rect.objectKind, [rect])
    }
  }

  return [...groups.entries()].flatMap(([objectKind, rects]) =>
    aggregateViewJsonRectsForLowZoom(
      rects,
      getViewJsonSemanticOverviewCellSizeForKind(objectKind, scale),
    ),
  )
}

async function aggregatePackageRoutingOverviewAsync(
  routing: ViewJsonRectRenderable[],
  scale: number,
  options: SemanticOverviewAsyncBuildOptions,
  state: SemanticOverviewAsyncWorkState,
): Promise<ViewJsonRectRenderable[] | null> {
  const groups = new Map<ViewJsonObjectKind, ViewJsonRectRenderable[]>()
  for (const rect of routing) {
    const group = groups.get(rect.objectKind)
    if (group) {
      group.push(rect)
    } else {
      groups.set(rect.objectKind, [rect])
    }
    if (!await yieldSemanticOverviewPrewarm(options, state)) return null
  }

  const result: ViewJsonRectRenderable[] = []
  for (const [objectKind, rects] of groups) {
    const aggregated = await aggregateViewJsonRectsForLowZoomAsync(
      rects,
      getViewJsonSemanticOverviewCellSizeForKind(objectKind, scale),
      options,
      state,
    )
    if (!aggregated) return null
    result.push(...aggregated)
  }
  return result
}

function hasOverviewGeometryForKind(
  rectGroups: Map<ViewJsonObjectKind, ViewJsonRectRenderable[]>,
  pathGroups: Map<ViewJsonObjectKind, ViewJsonPathRenderable[]>,
  objectKind: 'regular_wires' | 'special_wires',
): boolean {
  return (rectGroups.get(objectKind)?.length ?? 0) > 0
    || (pathGroups.get(objectKind)?.length ?? 0) > 0
}

function addPackageWireSegmentsToOverviewCells(
  model: ViewJsonRenderModel,
  data: ViewJsonPackageData,
  segments: ViewJsonWireSegment[],
  objectKind: 'regular_wires' | 'special_wires',
  scale: number,
): SemanticOverviewPackageAggregateOutput {
  const rectCells = new Map<string, SemanticOverviewRectAggregateCell>()
  const pathCells = new Map<string, ViewJsonRectRenderable>()
  const routeCellSize = getViewJsonSemanticOverviewCellSizeForKind(objectKind, scale)
  const viaCellSize = getViewJsonSemanticOverviewCellSizeForKind('vias', scale)
  let added = 0
  for (const segment of segments) {
    added += addPackageWireSegmentToOverviewCells(
      model,
      data,
      segment,
      objectKind,
      routeCellSize,
      viaCellSize,
      rectCells,
      pathCells,
    )
  }
  return {
    rects: [
      ...[...rectCells.values()].map(cell => cell.rect),
      ...pathCells.values(),
    ],
    added,
  }
}

async function addPackageWireSegmentsToOverviewCellsAsync(
  model: ViewJsonRenderModel,
  data: ViewJsonPackageData,
  segments: ViewJsonWireSegment[],
  objectKind: 'regular_wires' | 'special_wires',
  scale: number,
  options: SemanticOverviewAsyncBuildOptions,
  state: SemanticOverviewAsyncWorkState,
): Promise<SemanticOverviewPackageAggregateOutput | null> {
  const rectCells = new Map<string, SemanticOverviewRectAggregateCell>()
  const pathCells = new Map<string, ViewJsonRectRenderable>()
  const routeCellSize = getViewJsonSemanticOverviewCellSizeForKind(objectKind, scale)
  const viaCellSize = getViewJsonSemanticOverviewCellSizeForKind('vias', scale)
  let added = 0
  for (const segment of segments) {
    added += addPackageWireSegmentToOverviewCells(
      model,
      data,
      segment,
      objectKind,
      routeCellSize,
      viaCellSize,
      rectCells,
      pathCells,
    )
    if (!await yieldSemanticOverviewPrewarm(options, state)) return null
  }
  return {
    rects: [
      ...[...rectCells.values()].map(cell => cell.rect),
      ...pathCells.values(),
    ],
    added,
  }
}

function addPackageWireSegmentToOverviewCells(
  model: ViewJsonRenderModel,
  data: ViewJsonPackageData,
  segment: ViewJsonWireSegment,
  objectKind: 'regular_wires' | 'special_wires',
  routeCellSize: number,
  viaCellSize: number,
  rectCells: Map<string, SemanticOverviewRectAggregateCell>,
  pathCells: Map<string, ViewJsonRectRenderable>,
): number {
  if (segment.kind === 'path') {
    return addPackageWirePathToOverviewCells(model, segment, objectKind, routeCellSize, pathCells)
  }

  if (segment.kind === 'patch' && segment.rect && typeof segment.layer_id === 'number') {
    addRectToSemanticOverviewAggregate(rectCells, packageWirePatchOverviewRect(model, segment, objectKind), routeCellSize)
    return 1
  }

  if (segment.kind === 'via' && typeof segment.via_master_id === 'number' && segment.origin) {
    addRectToSemanticOverviewAggregate(rectCells, packageWireViaOverviewRect(model, data, segment, objectKind), viaCellSize)
    return 1
  }

  return 0
}

function addPackageWirePathToOverviewCells(
  model: ViewJsonRenderModel,
  segment: ViewJsonWireSegment,
  objectKind: 'regular_wires' | 'special_wires',
  cellSize: number,
  cells: Map<string, ViewJsonRectRenderable>,
): number {
  if (
    typeof segment.layer_id !== 'number'
    || typeof segment.width !== 'number'
    || !Array.isArray(segment.points)
    || segment.points.length < 2
  ) {
    return 0
  }

  let added = 0
  let start = edaPointToWorldPoint(segment.points[0], model.worldHeight)
  for (let pointIndex = 1; pointIndex < segment.points.length; pointIndex += 1) {
    const end = edaPointToWorldPoint(segment.points[pointIndex], model.worldHeight)
    if (!start || !end) continue
    added += addWorldPathSegmentToOverviewCells(
      cells,
      `package-overview:${objectKind}:${segment.id}:${pointIndex}`,
      objectKind,
      segment.id,
      segment.layer_id,
      segment.width,
      start,
      end,
      cellSize,
    )
    start = end
  }
  return added
}

function packageWirePatchOverviewRect(
  model: ViewJsonRenderModel,
  segment: ViewJsonWireSegment,
  objectKind: 'regular_wires' | 'special_wires',
): ViewJsonRectRenderable {
  const normalized = normalizeBBox(segment.rect!)
  return {
    id: `package-overview:${objectKind}:${segment.id}:patch`,
    objectKind,
    sourceId: segment.id,
    layerId: segment.layer_id,
    eda: normalized,
    world: edaRectToWorldRect(normalized, model.worldHeight),
  }
}

function packageWireViaOverviewRect(
  model: ViewJsonRenderModel,
  data: ViewJsonPackageData,
  segment: ViewJsonWireSegment,
  objectKind: 'regular_wires' | 'special_wires',
): ViewJsonRectRenderable {
  const viaMaster = typeof segment.via_master_id === 'number'
    ? data.viaById.get(segment.via_master_id)
    : undefined
  const origin = segment.origin ?? [0, 0]
  const bbox = normalizeBBox(segment.bbox ?? [origin[0], origin[1], origin[0], origin[1]])
  return {
    id: `package-overview:${objectKind}:${segment.id}:via`,
    objectKind: 'vias',
    sourceId: segment.id,
    layerId: viaMaster?.shapes[0]?.layer_id,
    eda: bbox,
    world: edaRectToWorldRect(expandZeroAreaBBox(bbox, model), model.worldHeight),
  }
}

function expandZeroAreaBBox(bbox: [number, number, number, number], model: ViewJsonRenderModel): [number, number, number, number] {
  const minSize = Math.max(1, Math.max(model.worldWidth, model.worldHeight) / 100_000)
  const [x1, y1, x2, y2] = bbox
  return [
    x1,
    y1,
    x2 === x1 ? x2 + minSize : x2,
    y2 === y1 ? y2 + minSize : y2,
  ]
}

async function buildViewJsonSemanticOverviewLevelAsync(
  model: ViewJsonRenderModel,
  data: ViewJsonPackageData | null,
  scale: number,
  options: SemanticOverviewAsyncBuildOptions,
): Promise<ViewJsonSemanticOverviewLevel | null> {
  const state: SemanticOverviewAsyncWorkState = { processed: 0, sliceStartedAt: options.now() }
  if (!await yieldSemanticOverviewPrewarm(options, state, true)) return null

  const rects: ViewJsonRectRenderable[] = []
  const rectGroups = new Map<ViewJsonObjectKind, ViewJsonRectRenderable[]>()
  const pathGroups = new Map<ViewJsonObjectKind, ViewJsonPathRenderable[]>()

  for (const rect of model.rects) {
    if (isViewJsonSemanticOverviewKind(rect.objectKind)) {
      const group = rectGroups.get(rect.objectKind)
      if (group) {
        group.push(rect)
      } else {
        rectGroups.set(rect.objectKind, [rect])
      }
    }
    if (!await yieldSemanticOverviewPrewarm(options, state)) return null
  }

  for (const path of model.paths) {
    if (isViewJsonSemanticOverviewKind(path.objectKind)) {
      const group = pathGroups.get(path.objectKind)
      if (group) {
        group.push(path)
      } else {
        pathGroups.set(path.objectKind, [path])
      }
    }
    if (!await yieldSemanticOverviewPrewarm(options, state)) return null
  }

  if (!await addPackageRoutingOverviewGroupsAsync(model, data, rectGroups, pathGroups, rects, scale, options, state)) return null

  for (const [objectKind, group] of rectGroups) {
    const aggregated = await aggregateViewJsonSemanticOverviewRectsForKindAsync(
      model,
      objectKind,
      group,
      scale,
      options,
      state,
    )
    if (!aggregated) return null
    rects.push(...aggregated)
  }

  for (const [objectKind, group] of pathGroups) {
    const aggregated = await aggregateViewJsonPathsForLowZoomAsync(
      group,
      getViewJsonSemanticOverviewCellSizeForKind(objectKind, scale),
      options,
      state,
    )
    if (!aggregated) return null
    rects.push(...aggregated)
  }

  if (model.lazyGeometry?.vias.length) {
    const viaRects = await buildLazyViaSemanticOverviewRectsAsync(model, data, options, state)
    if (!viaRects) return null
    const aggregated = await aggregateViewJsonRectsForLowZoomAsync(
      viaRects,
      getViewJsonSemanticOverviewCellSizeForKind('vias', scale),
      options,
      state,
    )
    if (!aggregated) return null
    rects.push(...aggregated)
  }

  const cellSize = getViewJsonSemanticOverviewCellSizeForKind('regular_wires', scale)
  const chunkSize = getViewJsonSemanticOverviewChunkSize(scale)
  const chunks = await buildViewJsonSemanticOverviewChunksAsync(rects, chunkSize, options, state)
  if (!chunks) return null

  return {
    key: getViewJsonSemanticOverviewLevelKey(scale),
    cellSize,
    chunkSize,
    rects,
    chunks,
  }
}

async function yieldSemanticOverviewPrewarm(
  options: SemanticOverviewAsyncBuildOptions,
  state: SemanticOverviewAsyncWorkState,
  force = false,
): Promise<boolean> {
  if (options.shouldCancel?.()) return false

  const batchSize = Number.isFinite(options.batchSize) && options.batchSize > 0
    ? options.batchSize
    : VIEW_JSON_SEMANTIC_OVERVIEW_PREWARM_BATCH_SIZE
  const frameBudgetMs = Number.isFinite(options.frameBudgetMs) && options.frameBudgetMs > 0
    ? options.frameBudgetMs
    : VIEW_JSON_SEMANTIC_OVERVIEW_PREWARM_FRAME_BUDGET_MS
  state.processed += force ? 0 : 1
  if (
    !force
    && state.processed < batchSize
    && options.now() - state.sliceStartedAt < frameBudgetMs
  ) return true

  state.processed = 0
  await options.requestIdle()
  state.sliceStartedAt = options.now()
  return !(options.shouldCancel?.())
}

async function aggregateViewJsonRectsForLowZoomAsync(
  rects: ViewJsonRectRenderable[],
  cellSize: number,
  options: SemanticOverviewAsyncBuildOptions,
  state: SemanticOverviewAsyncWorkState,
): Promise<ViewJsonRectRenderable[] | null> {
  if (!Number.isFinite(cellSize) || cellSize <= 0) return rects

  const cells = new Map<string, SemanticOverviewRectAggregateCell>()
  for (const rect of rects) {
    if (rect.world.w > 0 && rect.world.h > 0) {
      addRectToSemanticOverviewAggregate(cells, rect, cellSize)
    }
    if (!await yieldSemanticOverviewPrewarm(options, state)) return null
  }

  return [...cells.values()].map(cell => cell.rect)
}

async function aggregateViewJsonSemanticOverviewRectsForKindAsync(
  model: ViewJsonRenderModel,
  objectKind: ViewJsonObjectKind,
  group: ViewJsonRectRenderable[],
  scale: number,
  options: SemanticOverviewAsyncBuildOptions,
  state: SemanticOverviewAsyncWorkState,
): Promise<ViewJsonRectRenderable[] | null> {
  if (objectKind !== 'instances') {
    return aggregateViewJsonRectsForLowZoomAsync(
      group,
      getViewJsonSemanticOverviewCellSizeForKind(objectKind, scale),
      options,
      state,
    )
  }

  const macroRects: ViewJsonRectRenderable[] = []
  const standardCellRects: ViewJsonRectRenderable[] = []
  for (const rect of group) {
    if (isViewJsonSemanticOverviewMacroRect(rect, model, scale)) {
      macroRects.push(rect)
    } else {
      standardCellRects.push(rect)
    }
    if (!await yieldSemanticOverviewPrewarm(options, state)) return null
  }

  const aggregated = await aggregateViewJsonRectsForLowZoomAsync(
    standardCellRects,
    getViewJsonSemanticOverviewCellSizeForKind(objectKind, scale),
    options,
    state,
  )
  if (!aggregated) return null
  return [...macroRects, ...aggregated]
}

async function aggregateViewJsonPathsForLowZoomAsync(
  paths: ViewJsonPathRenderable[],
  cellSize: number,
  options: SemanticOverviewAsyncBuildOptions,
  state: SemanticOverviewAsyncWorkState,
): Promise<ViewJsonRectRenderable[] | null> {
  if (!Number.isFinite(cellSize) || cellSize <= 0) return []

  const cells = new Map<string, ViewJsonRectRenderable>()
  for (const path of paths) {
    for (let pointIndex = 1; pointIndex < path.worldPoints.length; pointIndex += 1) {
      const start = path.worldPoints[pointIndex - 1]
      const end = path.worldPoints[pointIndex]
      if (!start || !end) continue

      addWorldPathSegmentToOverviewCells(
        cells,
        path.id,
        path.objectKind,
        path.sourceId,
        path.layerId,
        path.width,
        start,
        end,
        cellSize,
      )
    }
    if (!await yieldSemanticOverviewPrewarm(options, state)) return null
  }

  return [...cells.values()]
}

function addRectToSemanticOverviewAggregate(
  cells: Map<string, SemanticOverviewRectAggregateCell>,
  rect: ViewJsonRectRenderable,
  cellSize: number,
): void {
  const cellX = Math.floor(rect.world.x / cellSize)
  const cellY = Math.floor(rect.world.y / cellSize)
  const maxX = rect.world.x + rect.world.w
  const maxY = rect.world.y + rect.world.h
  const toCellX = Math.floor((maxX - 0.001) / cellSize)
  const toCellY = Math.floor((maxY - 0.001) / cellSize)
  const key = semanticOverviewCellRangeCount(cellX, toCellX, cellY, toCellY) > VIEW_JSON_SEMANTIC_OVERVIEW_MAX_CELLS_PER_ITEM
    ? `${rect.objectKind}:${rect.layerId ?? 'none'}:fallback:${rect.sourceId}`
    : `${rect.objectKind}:${rect.layerId ?? 'none'}:${cellX}:${cellY}`
  const existing = cells.get(key)
  if (existing) {
    existing.weight += rect.overviewWeight ?? 1
    existing.minX = Math.min(existing.minX, rect.world.x)
    existing.minY = Math.min(existing.minY, rect.world.y)
    existing.maxX = Math.max(existing.maxX, maxX)
    existing.maxY = Math.max(existing.maxY, maxY)
    existing.rect.world = {
      x: existing.minX,
      y: existing.minY,
      w: existing.maxX - existing.minX,
      h: existing.maxY - existing.minY,
    }
    existing.rect.overviewWeight = existing.weight
    return
  }

  const overviewWeight = rect.overviewWeight ?? 1
  const aggregateRect: ViewJsonRectRenderable = {
    ...rect,
    id: `aggregate:${key}`,
    sourceId: -1,
    world: { ...rect.world },
    overviewWeight,
  }
  cells.set(key, {
    rect: aggregateRect,
    minX: rect.world.x,
    minY: rect.world.y,
    maxX,
    maxY,
    weight: overviewWeight,
  })
}

function addWorldPathSegmentToOverviewCells(
  cells: Map<string, ViewJsonRectRenderable>,
  idPrefix: string,
  objectKind: 'regular_wires' | 'special_wires',
  sourceId: number,
  layerId: number,
  width: number,
  start: ViewJsonWorldPoint,
  end: ViewJsonWorldPoint,
  cellSize: number,
): number {
  if (!Number.isFinite(cellSize) || cellSize <= 0) return 0

  const halfWidth = Math.max(width, 1) / 2
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
  const cellCount = semanticOverviewCellRangeCount(fromCellX, toCellX, fromCellY, toCellY)
  let added = 0

  if (cellCount > VIEW_JSON_SEMANTIC_OVERVIEW_MAX_CELLS_PER_ITEM) {
    const key = `${objectKind}:${layerId}:${overviewDirection}:fallback:${sourceId}:${idPrefix}`
    const existing = cells.get(key)
    if (existing) {
      mergeSemanticOverviewRectBounds(existing, minX, minY, maxX, maxY)
      return 1
    }
    cells.set(key, {
      id: `overview-path:${idPrefix}:${key}`,
      objectKind,
      sourceId,
      layerId,
      eda: [minX, minY, maxX, maxY],
      overviewWeight: Math.max(1, Math.ceil(cellCount / VIEW_JSON_SEMANTIC_OVERVIEW_MAX_CELLS_PER_ITEM)),
      overviewDirection,
      world: {
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY,
      },
    })
    return 1
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

      const key = `${objectKind}:${layerId}:${overviewDirection}:${cx}:${cy}`
      const existing = cells.get(key)
      if (existing) {
        mergeSemanticOverviewRectBounds(existing, clippedMinX, clippedMinY, clippedMaxX, clippedMaxY)
        added += 1
        continue
      }

      cells.set(key, {
        id: `overview-path:${idPrefix}:${key}`,
        objectKind,
        sourceId,
        layerId,
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
      added += 1
    }
  }

  return added
}

function semanticOverviewCellRangeCount(
  fromCellX: number,
  toCellX: number,
  fromCellY: number,
  toCellY: number,
): number {
  if (![fromCellX, toCellX, fromCellY, toCellY].every(Number.isFinite)) return Number.POSITIVE_INFINITY
  const width = Math.max(0, toCellX - fromCellX + 1)
  const height = Math.max(0, toCellY - fromCellY + 1)
  return width * height
}

function mergeSemanticOverviewRectBounds(
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

async function buildLazyViaSemanticOverviewRectsAsync(
  model: ViewJsonRenderModel,
  data: ViewJsonPackageData | null,
  options: SemanticOverviewAsyncBuildOptions,
  state: SemanticOverviewAsyncWorkState,
): Promise<ViewJsonRectRenderable[] | null> {
  const rects: ViewJsonRectRenderable[] = []
  for (const source of model.lazyGeometry?.vias ?? []) {
    rects.push(lazyViaSemanticOverviewRect(model, data, source))
    if (!await yieldSemanticOverviewPrewarm(options, state)) return null
  }
  return rects
}

export function getViewJsonSemanticOverviewItemsInBounds(
  level: ViewJsonSemanticOverviewLevel,
  bounds: ViewJsonVisibleBounds,
  includeObjectKind: (objectKind: ViewJsonObjectKind) => boolean = () => true,
): ViewJsonRectRenderable[] {
  const visible = {
    x: bounds.x,
    y: bounds.y,
    w: bounds.width,
    h: bounds.height,
  }
  const range = getViewJsonSemanticOverviewChunkRange(visible, level.chunkSize)
  const result: ViewJsonRectRenderable[] = []
  const seen = new Set<string>()

  for (let cy = range.minY; cy <= range.maxY; cy += 1) {
    for (let cx = range.minX; cx <= range.maxX; cx += 1) {
      const chunk = level.chunks.get(`${cx}:${cy}`)
      if (!chunk) continue
      for (const rect of chunk) {
        if (seen.has(rect.id) || !includeObjectKind(rect.objectKind)) continue
        if (!rectIntersects(rect.world, visible)) continue
        seen.add(rect.id)
        result.push(rect)
      }
    }
  }

  return result
}

function lazyViaSemanticOverviewRect(
  model: ViewJsonRenderModel,
  data: ViewJsonPackageData | null,
  source: NonNullable<ViewJsonRenderModel['lazyGeometry']>['vias'][number],
): ViewJsonRectRenderable {
  const normalized = normalizeBBox(source.bbox)
  const viaMaster = data?.viaById.get(source.viaMasterId)
  return {
    id: `semantic-overview-via:${source.idPrefix}`,
    objectKind: 'vias',
    sourceId: source.sourceId,
    layerId: viaMaster?.shapes[0]?.layer_id,
    eda: normalized,
    world: edaRectToWorldRect(normalized, model.worldHeight),
  }
}

function getViewJsonSemanticOverviewChunkSize(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return VIEW_JSON_SEMANTIC_OVERVIEW_MIN_CHUNK_SIZE
  return Math.max(VIEW_JSON_SEMANTIC_OVERVIEW_MIN_CHUNK_SIZE, VIEW_JSON_SEMANTIC_OVERVIEW_CHUNK_SCREEN_PX / scale)
}

function buildViewJsonSemanticOverviewChunks(
  rects: ViewJsonRectRenderable[],
  chunkSize: number,
): Map<string, ViewJsonRectRenderable[]> {
  const chunks = new Map<string, ViewJsonRectRenderable[]>()
  for (const rect of rects) {
    if (rect.world.w <= 0 || rect.world.h <= 0) continue
    const range = getViewJsonSemanticOverviewChunkRange(rect.world, chunkSize)
    for (let cy = range.minY; cy <= range.maxY; cy += 1) {
      for (let cx = range.minX; cx <= range.maxX; cx += 1) {
        addRectToSemanticOverviewChunk(chunks, rect, cx, cy)
      }
    }
  }
  return chunks
}

async function buildViewJsonSemanticOverviewChunksAsync(
  rects: ViewJsonRectRenderable[],
  chunkSize: number,
  options: SemanticOverviewAsyncBuildOptions,
  state: SemanticOverviewAsyncWorkState,
): Promise<Map<string, ViewJsonRectRenderable[]> | null> {
  const chunks = new Map<string, ViewJsonRectRenderable[]>()
  for (const rect of rects) {
    if (rect.world.w > 0 && rect.world.h > 0) {
      const range = getViewJsonSemanticOverviewChunkRange(rect.world, chunkSize)
      for (let cy = range.minY; cy <= range.maxY; cy += 1) {
        for (let cx = range.minX; cx <= range.maxX; cx += 1) {
          addRectToSemanticOverviewChunk(chunks, rect, cx, cy)
        }
      }
    }
    if (!await yieldSemanticOverviewPrewarm(options, state)) return null
  }
  return chunks
}

function addRectToSemanticOverviewChunk(
  chunks: Map<string, ViewJsonRectRenderable[]>,
  rect: ViewJsonRectRenderable,
  cx: number,
  cy: number,
): void {
  const key = `${cx}:${cy}`
  const chunk = chunks.get(key)
  if (chunk) {
    chunk.push(rect)
  } else {
    chunks.set(key, [rect])
  }
}

function getViewJsonSemanticOverviewChunkRange(
  bounds: { x: number; y: number; w: number; h: number },
  chunkSize: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const right = bounds.x + Math.max(bounds.w, 0)
  const bottom = bounds.y + Math.max(bounds.h, 0)
  return {
    minX: Math.floor(bounds.x / chunkSize),
    minY: Math.floor(bounds.y / chunkSize),
    maxX: Math.floor((right - 0.001) / chunkSize),
    maxY: Math.floor((bottom - 0.001) / chunkSize),
  }
}

function rectIntersects(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x <= b.x + b.w
    && a.x + a.w >= b.x
    && a.y <= b.y + b.h
    && a.y + a.h >= b.y
}

export const __viewJsonSemanticOverviewInternals = {
  getViewJsonSemanticOverviewChunkSize,
  buildViewJsonSemanticOverviewChunks,
  getViewJsonSemanticOverviewChunkRange,
  lazyViaSemanticOverviewRect,
}
