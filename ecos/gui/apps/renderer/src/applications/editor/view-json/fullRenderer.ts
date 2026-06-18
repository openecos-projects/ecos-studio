import { Container, Graphics, Mesh, MeshGeometry, Rectangle, Sprite, Texture } from 'pixi.js'
import type { Viewport } from 'pixi-viewport'
import {
  type ViewJsonRendererStats,
  type ViewJsonFrameThrottleMode,
} from './performanceStats'
import {
  ViewJsonSemanticOverviewCache,
  type ViewJsonSemanticOverviewLevel,
  buildViewJsonPackageRoutingOverviewLevel,
  getViewJsonSemanticOverviewItemsInBounds,
  getViewJsonSemanticOverviewLevelKey,
  isViewJsonSemanticOverviewKind,
  normalizeViewJsonSemanticOverviewPrewarmScales,
} from './semanticOverview'
import {
  ViewJsonSemanticOverviewWorkerClient,
  type ViewJsonSemanticOverviewWorkerFactory,
} from './semanticOverviewWorker'
import { materializeViewJsonLazyGeometryInBounds } from './lazyGeometry'
import {
  ViewJsonGeometryTileStore,
  type ViewJsonGeometryTileRenderItems,
} from './geometryTileStore'
import {
  buildViewJsonLightweightRenderModel,
  buildViewJsonRenderModelAsync,
} from './renderModel'
import {
  ViewJsonOverviewAggregationCache,
  ViewJsonRectBatchBufferCache,
  aggregateViewJsonRectsForLowZoom,
  flattenViewJsonRectsForSingleAlphaCoverage,
} from './rectBatch'
import {
  buildViewJsonRenderSpatialIndexAsync,
  buildViewJsonRenderSpatialIndex,
  getViewJsonRenderItemsInBounds,
  VIEW_JSON_DETAIL_OBJECT_MIN_SCALE,
  VIEW_JSON_DETAIL_LOD_MIN_SCALE,
  VIEW_JSON_RENDER_QUERY_PADDING,
  type ViewJsonRenderSpatialIndex,
  type ViewJsonRenderItems,
  type ViewJsonVisibleBounds,
} from './renderSpatialIndex'
import {
  VIEW_JSON_DEFAULT_DISPLAY_PRESET,
  type ViewJsonDisplayPreset,
  getViewJsonDisplayLOD,
  getViewJsonObjectDisplayMode,
  isViewJsonObjectKindQueryableAtScale,
  isViewJsonRoutingOverviewFallbackKind,
} from './displayPolicy'
import type { ViewJsonRenderMode } from './overviewData'
import {
  createViewJsonVisibilityState,
  isViewJsonRenderableVisible,
} from './visibility'
import type {
  ViewJsonGuideRenderable,
  ViewJsonObjectKind,
  ViewJsonPackageData,
  ViewJsonPathRenderable,
  ViewJsonRectRenderable,
  ViewJsonRenderModel,
  ViewJsonRoutingDetail,
  ViewJsonVisibilityState,
} from './types'
import { EDA_OBJECT_COLORS, getEdaLayerColor } from '../layout/layerPalette'

const VIEW_JSON_INSTANCE_MESH_MAX_SCALE = VIEW_JSON_DETAIL_OBJECT_MIN_SCALE
const VIEW_JSON_INSTANCE_AGGREGATE_MAX_SCALE = 0.004
const VIEW_JSON_INSTANCE_AGGREGATE_SCREEN_CELL_PX = 4
const VIEW_JSON_DRAG_QUERY_PADDING_SCALE = 1.5
const VIEW_JSON_MIN_DRAG_QUERY_PADDING = VIEW_JSON_RENDER_QUERY_PADDING * 4
const VIEW_JSON_OVERVIEW_SCREEN_CELL_PX = 6
const VIEW_JSON_REGULAR_WIRE_OVERVIEW_SCREEN_CELL_PX = 12
const VIEW_JSON_DEBUG_CELL_INTERNAL_OVERVIEW_SCREEN_CELL_PX = 18
const VIEW_JSON_OVERVIEW_MARKER_SCREEN_PX = 10
const VIEW_JSON_IO_PIN_MARKER_MAX_SCALE = VIEW_JSON_DETAIL_OBJECT_MIN_SCALE
const VIEW_JSON_IO_PIN_MARKER_MIN_SCREEN_PX = 7
const VIEW_JSON_OVERVIEW_MACRO_MIN_SCREEN_PX = 8
const VIEW_JSON_OVERVIEW_MACRO_MIN_AREA_RATIO = 0.0004
const VIEW_JSON_INTERACTIVE_SNAPSHOT_ENABLED = false
const VIEW_JSON_INTERACTIVE_SNAPSHOT_PADDING_RATIO = 0.35
const VIEW_JSON_INTERACTIVE_SNAPSHOT_RESOLUTION_SCALE = 0.75
const VIEW_JSON_INTERACTIVE_SNAPSHOT_MIN_RESOLUTION = 0.000001
const VIEW_JSON_INTERACTIVE_SNAPSHOT_MAX_PIXELS = 12_000_000
const VIEW_JSON_INTERACTIVE_SNAPSHOT_MAX_BUILD_MS = 12
const VIEW_JSON_INTERACTIVE_SNAPSHOT_RETRY_DELAY_MS = 1000
const VIEW_JSON_INTERACTIVE_SNAPSHOT_PREWARM_DELAY_MS = 250
const VIEW_JSON_INTERACTIVE_FREEZE_IDLE_TIMEOUT_MS = 300
const VIEW_JSON_INTERACTIVE_SCALE_EPSILON = 0.000001
const VIEW_JSON_INTERACTIVE_PROXY_MAX_RECTS = 1800
const VIEW_JSON_ENGINEERING_OVERVIEW_MAX_RECTS = 6000
const VIEW_JSON_LAZY_DETAIL_MAX_RECTS = 20000
const VIEW_JSON_VISIBLE_RENDER_CACHE_MAX_ITEMS = 50000
const VIEW_JSON_FULL_DETAIL_MODEL_MIN_SCALE = 0.18
const VIEW_JSON_SEMANTIC_OVERVIEW_PREWARM_SCALE_FACTORS = [0.5, 2]
const VIEW_JSON_SEMANTIC_OVERVIEW_PREWARM_SCALES: number[] = []
const VIEW_JSON_LIGHTWEIGHT_SPATIAL_INDEX_KINDS = new Set<ViewJsonObjectKind>([
  'die',
  'core',
  'rows',
  'tracks',
  'gcell_grids',
  'instances',
  'io_pins',
  'blockages',
  'fills',
  'regions',
])
const VIEW_JSON_DEBUG_CELL_INTERNAL_LAYER_IDS_BY_DATA = new WeakMap<
  ViewJsonPackageData,
  Record<'cell_pins' | 'cell_obs', Map<number, Array<number | undefined>>>
>()

interface ViewJsonSnapshotRenderer {
  generateTexture(options: {
    target: Container
    frame?: Rectangle
    resolution?: number
    clearColor?: number[]
    antialias?: boolean
  }): Texture
}

interface ViewJsonViewportEvent {
  type?: string
}

interface GraphicsGroup {
  key: string
  objectKind: ViewJsonObjectKind
  layerId?: number
  graphics: Graphics
}

interface InstanceMeshGroup {
  key: string
  mesh: Mesh<MeshGeometry>
  buffers: ReturnType<ViewJsonRectBatchBufferCache['getBuffers']>
}

interface EngineeringOverviewMeshGroup {
  key: string
  mesh: Mesh<MeshGeometry>
  buffers: ReturnType<ViewJsonRectBatchBufferCache['getBuffers']>
}

interface ViewJsonVisibleRenderCacheEntry {
  signature: string
  direct: ReturnType<typeof getViewJsonRenderItemsInBounds>
  lazyRects: ViewJsonRectRenderable[]
}

interface ViewJsonInteractiveSnapshot {
  sprite: Sprite
  texture: Texture
  bounds: ViewJsonVisibleBounds
}

interface ViewJsonInteractiveProxy {
  container: Container
}

export interface ViewJsonFullRendererOptions {
  onModelReady?: (model: ViewJsonRenderModel) => void
  requestRenderActive?: () => void
  getFrameThrottleState?: () => { mode: ViewJsonFrameThrottleMode; maxFPS: number }
  loadRoutingDetail?: (
    data: ViewJsonPackageData,
    options?: { shouldCancel?: () => boolean },
  ) => Promise<ViewJsonRoutingDetail | null>
  semanticOverviewWorkerFactory?: ViewJsonSemanticOverviewWorkerFactory | null
  tileStoreFactory?: (data: ViewJsonPackageData) => ViewJsonGeometryTileStore | null
}

function colorForLayer(model: ViewJsonRenderModel, layerId: number | undefined): number {
  if (layerId == null) return EDA_OBJECT_COLORS.fills
  const layer = model.layerById.get(layerId)
  const index = model.layers.findIndex(item => item.id === layerId)
  return getEdaLayerColor(layer?.name, index)
}

function alphaForKind(objectKind: ViewJsonObjectKind, weight?: number): number {
  const densityBoost = Math.log2(getViewJsonOverviewWeightBucket(weight)) * 0.025
  switch (objectKind) {
    case 'die':
    case 'core':
      return 0
    case 'rows':
      return 0.08
    case 'instances':
      return Math.min(0.3, 0.14 + densityBoost)
    case 'io_pins':
      return 0.5
    case 'regular_wires':
      return 0.34
    case 'special_wires':
      return 0.28
    case 'vias':
      return 0.58
    case 'blockages':
      return 0.26
    case 'fills':
      return 0.18
    case 'regions':
      return 0.12
    case 'cell_pins':
      return 0.26
    case 'cell_obs':
      return 0.18
    case 'tracks':
    case 'gcell_grids':
      return 0.1
    default:
      return 0.28
  }
}

function getViewJsonOverviewWeightBucket(weight: number | undefined): number {
  const normalized = Number.isFinite(weight) && weight != null ? Math.max(1, weight) : 1
  if (normalized >= 256) return 256
  if (normalized >= 64) return 64
  if (normalized >= 16) return 16
  if (normalized >= 4) return 4
  return 1
}

function alphaForOverviewKind(objectKind: ViewJsonObjectKind, weight?: number): number {
  const densityBoost = Math.log2(getViewJsonOverviewWeightBucket(weight)) * 0.04
  switch (objectKind) {
    case 'instances':
      return Math.min(0.42, 0.22 + densityBoost)
    case 'io_pins':
      return 0.72
    case 'special_wires':
      return Math.min(0.66, 0.48 + densityBoost)
    case 'regular_wires':
      return Math.min(0.6, 0.34 + densityBoost)
    case 'vias':
      return Math.min(0.64, 0.42 + densityBoost)
    case 'blockages':
    case 'regions':
      return Math.min(0.46, 0.24 + densityBoost)
    case 'fills':
      return Math.min(0.36, 0.16 + densityBoost)
    case 'cell_pins':
      return Math.min(0.4, 0.2 + densityBoost)
    case 'cell_obs':
      return Math.min(0.34, 0.16 + densityBoost)
    default:
      return alphaForKind(objectKind)
  }
}

function colorForOverviewKind(
  model: ViewJsonRenderModel,
  objectKind: ViewJsonObjectKind,
  layerId?: number,
): number {
  switch (objectKind) {
    case 'instances':
      return EDA_OBJECT_COLORS.instances
    case 'io_pins':
      return EDA_OBJECT_COLORS.ioPins
    case 'regular_wires':
      return colorForLayer(model, layerId)
    case 'special_wires':
      return EDA_OBJECT_COLORS.specialWires
    case 'vias':
      return EDA_OBJECT_COLORS.vias
    case 'blockages':
      return EDA_OBJECT_COLORS.blockages
    case 'regions':
      return EDA_OBJECT_COLORS.regions
    case 'fills':
      return EDA_OBJECT_COLORS.fills
    case 'cell_pins':
      return EDA_OBJECT_COLORS.cellPins
    case 'cell_obs':
      return EDA_OBJECT_COLORS.cellObs
    default:
      return colorForLayer(model, layerId)
  }
}

function strokeAlphaForKind(objectKind: ViewJsonObjectKind): number {
  switch (objectKind) {
    case 'die':
    case 'core':
      return 0.95
    case 'tracks':
    case 'gcell_grids':
      return 0.22
    case 'cell_obs':
      return 0.35
    default:
      return 0.65
  }
}

function strokeWidthForKind(objectKind: ViewJsonObjectKind): number {
  switch (objectKind) {
    case 'die':
    case 'core':
      return 1
    case 'tracks':
    case 'gcell_grids':
      return 1
    default:
      return 0.5
  }
}

function drawViewJsonRect(
  graphics: Graphics,
  rect: ViewJsonRectRenderable,
  model: ViewJsonRenderModel,
): void {
  const color = rect.objectKind === 'die'
    ? EDA_OBJECT_COLORS.die
    : rect.objectKind === 'core'
      ? EDA_OBJECT_COLORS.core
      : colorForLayer(model, rect.layerId)
  const fillAlpha = alphaForKind(rect.objectKind)
  graphics.rect(rect.world.x, rect.world.y, rect.world.w, rect.world.h)
  if (fillAlpha > 0) {
    graphics.fill({ color, alpha: fillAlpha })
  }
  graphics.stroke({
    color,
    alpha: strokeAlphaForKind(rect.objectKind),
    width: strokeWidthForKind(rect.objectKind),
    pixelLine: rect.objectKind === 'die' || rect.objectKind === 'core',
  })
}

function drawViewJsonOutlineRect(
  graphics: Graphics,
  rect: ViewJsonRectRenderable,
  model: ViewJsonRenderModel,
): void {
  const color = rect.objectKind === 'rows' ? EDA_OBJECT_COLORS.rows : colorForLayer(model, rect.layerId)
  graphics.rect(rect.world.x, rect.world.y, rect.world.w, rect.world.h)
  graphics.stroke({
    color,
    alpha: rect.objectKind === 'rows' ? 0.12 : 0.22,
    width: 1,
    pixelLine: true,
  })
}

function drawViewJsonPath(
  graphics: Graphics,
  path: ViewJsonPathRenderable,
  model: ViewJsonRenderModel,
): void {
  const [first, ...rest] = path.worldPoints
  if (!first) return
  graphics.moveTo(first.x, first.y)
  for (const point of rest) {
    graphics.lineTo(point.x, point.y)
  }
  graphics.stroke({
    color: colorForLayer(model, path.layerId),
    alpha: path.objectKind === 'special_wires' ? 0.78 : 0.7,
    width: Math.max(path.width, 1),
  })
}

function drawViewJsonGuide(
  graphics: Graphics,
  guide: ViewJsonGuideRenderable,
  model: ViewJsonRenderModel,
): void {
  const [first, second] = guide.worldPoints
  if (!first || !second) return
  graphics.moveTo(first.x, first.y)
  graphics.lineTo(second.x, second.y)
  graphics.stroke({
    color: colorForLayer(model, guide.layerId),
    alpha: guide.objectKind === 'tracks' ? 0.22 : 0.16,
    width: 1,
    pixelLine: true,
  })
}

function getViewJsonOverviewMarkerSize(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 0
  return VIEW_JSON_OVERVIEW_MARKER_SCREEN_PX / scale
}

function isViewJsonOverviewMacroRect(
  rect: ViewJsonRectRenderable,
  model: Pick<ViewJsonRenderModel, 'worldWidth' | 'worldHeight'>,
  scale: number,
): boolean {
  if (rect.objectKind !== 'instances' || rect.world.w <= 0 || rect.world.h <= 0) return false
  const screenWidth = rect.world.w * scale
  const screenHeight = rect.world.h * scale
  if (Math.max(screenWidth, screenHeight) < VIEW_JSON_OVERVIEW_MACRO_MIN_SCREEN_PX) return false

  const worldArea = Math.max(model.worldWidth * model.worldHeight, 1)
  const rectArea = rect.world.w * rect.world.h
  return rectArea / worldArea >= VIEW_JSON_OVERVIEW_MACRO_MIN_AREA_RATIO
}

function drawViewJsonMacroOutline(graphics: Graphics, rect: ViewJsonRectRenderable): void {
  graphics.rect(rect.world.x, rect.world.y, rect.world.w, rect.world.h)
  graphics.fill({ color: EDA_OBJECT_COLORS.instances, alpha: 0.035 })
  graphics.stroke({
    color: EDA_OBJECT_COLORS.macro,
    alpha: 0.78,
    width: 1,
    pixelLine: true,
  })
}

function drawViewJsonIoPinMarker(
  graphics: Graphics,
  rect: ViewJsonRectRenderable,
  scale: number,
): void {
  const markerSize = getViewJsonOverviewMarkerSize(scale)
  if (markerSize <= 0) return
  const cx = rect.world.x + rect.world.w / 2
  const cy = rect.world.y + rect.world.h / 2
  const width = Math.max(rect.world.w, markerSize)
  const height = Math.max(rect.world.h, markerSize)
  graphics.rect(cx - width / 2, cy - height / 2, width, height)
  graphics.fill({ color: EDA_OBJECT_COLORS.ioPins, alpha: 0.3 })
  graphics.stroke({
    color: EDA_OBJECT_COLORS.ioPins,
    alpha: 0.9,
    width: 1,
    pixelLine: true,
  })
}

function shouldDrawViewJsonIoPinMarker(rect: ViewJsonRectRenderable, scale: number): boolean {
  if (rect.objectKind !== 'io_pins') return false
  if (!Number.isFinite(scale) || scale <= 0) return true
  if (scale > VIEW_JSON_IO_PIN_MARKER_MAX_SCALE) return false
  const screenWidth = Math.max(rect.world.w, 0) * scale
  const screenHeight = Math.max(rect.world.h, 0) * scale
  return Math.max(screenWidth, screenHeight) < VIEW_JSON_IO_PIN_MARKER_MIN_SCREEN_PX
}

function groupKey(objectKind: ViewJsonObjectKind, layerId?: number, suffix?: string | number): string {
  return `${objectKind}:${layerId ?? 'none'}${suffix == null ? '' : `:${suffix}`}`
}

function groupViewJsonRectsForBatchingByKind(
  rects: ViewJsonRectRenderable[],
): Map<string, ViewJsonRectRenderable[]> {
  const groups = new Map<string, ViewJsonRectRenderable[]>()
  for (const rect of rects) {
    const key = groupKey(rect.objectKind, rect.layerId)
    const group = groups.get(key)
    if (group) {
      group.push(rect)
    } else {
      groups.set(key, [rect])
    }
  }
  return groups
}

function groupViewJsonInstanceRectsForBatching(
  rects: ViewJsonRectRenderable[],
): Map<string, ViewJsonRectRenderable[]> {
  const groups = new Map<string, ViewJsonRectRenderable[]>()
  for (const rect of rects) {
    if (rect.objectKind !== 'instances') continue
    const key = groupKey(rect.objectKind, rect.layerId)
    const group = groups.get(key)
    if (group) {
      group.push(rect)
    } else {
      groups.set(key, [rect])
    }
  }
  return groups
}

function flattenViewJsonRectsForGraphicsFillCoverage(
  rects: ViewJsonRectRenderable[],
): ViewJsonRectRenderable[] {
  return [...groupViewJsonRectsForBatchingByKind(rects).values()]
    .flatMap(group => flattenViewJsonRectsForSingleAlphaCoverage(group))
}

function expandVisibleBounds(bounds: ViewJsonVisibleBounds, padding: number): ViewJsonVisibleBounds {
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
  }
}

function isVisibleBoundsInside(inner: ViewJsonVisibleBounds, outer: ViewJsonVisibleBounds): boolean {
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height
}

function detailScaleEnabled(scale: number): boolean {
  return !Number.isFinite(scale) || scale >= VIEW_JSON_DETAIL_OBJECT_MIN_SCALE
}

function shouldRenderInstancesAsMesh(scale: number): boolean {
  return Number.isFinite(scale) && scale < VIEW_JSON_INSTANCE_MESH_MAX_SCALE
}

function getViewJsonInstanceAggregateCellSize(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0 || scale >= VIEW_JSON_INSTANCE_AGGREGATE_MAX_SCALE) return 0
  return VIEW_JSON_INSTANCE_AGGREGATE_SCREEN_CELL_PX / scale
}

function getViewJsonRenderQueryPadding(bounds: Pick<ViewJsonVisibleBounds, 'width' | 'height'>, scale: number): number {
  if (!shouldRenderInstancesAsMesh(scale)) return VIEW_JSON_RENDER_QUERY_PADDING
  const visibleSpan = Math.max(bounds.width, bounds.height, 0)
  const dragPadding = visibleSpan * (VIEW_JSON_DRAG_QUERY_PADDING_SCALE - 1)
  return Math.max(VIEW_JSON_RENDER_QUERY_PADDING, VIEW_JSON_MIN_DRAG_QUERY_PADDING, dragPadding)
}

function shouldRenderEngineeringOverview(scale: number): boolean {
  return Number.isFinite(scale) && scale < VIEW_JSON_DETAIL_LOD_MIN_SCALE
}

function shouldUseViewJsonFullDetailModel(
  scale: number,
  preset: ViewJsonDisplayPreset,
): boolean {
  return preset === 'debug'
    && (!Number.isFinite(scale) || scale >= VIEW_JSON_FULL_DETAIL_MODEL_MIN_SCALE)
}

function hasViewJsonGeometryTiles(data: ViewJsonPackageData | null | undefined): boolean {
  return Boolean(data?.geometryTileIndex?.tiles)
}

function shouldUseLegacyFullDetailModel(
  data: ViewJsonPackageData | null | undefined,
  scale: number,
  preset: ViewJsonDisplayPreset,
): boolean {
  return !hasViewJsonGeometryTiles(data) && shouldUseViewJsonFullDetailModel(scale, preset)
}

function shouldReleaseViewJsonFullDetailModel(
  scale: number,
  preset: ViewJsonDisplayPreset,
  hasFullRenderModel: boolean,
): boolean {
  return hasFullRenderModel && !shouldUseViewJsonFullDetailModel(scale, preset)
}

function shouldCancelViewJsonFullDetailModelBuild(
  scale: number,
  preset: ViewJsonDisplayPreset,
  interactionFrozen: boolean,
  hasPendingBuild: boolean,
): boolean {
  return hasPendingBuild
    && (
      interactionFrozen
      || !shouldUseViewJsonFullDetailModel(scale, preset)
    )
}

function shouldSwitchViewJsonFullDetailModelToLightweight(
  scale: number,
  preset: ViewJsonDisplayPreset,
  interactionFrozen: boolean,
  isShowingFullModel: boolean,
): boolean {
  return isShowingFullModel
    && !interactionFrozen
    && !shouldUseViewJsonFullDetailModel(scale, preset)
}

function viewJsonPackageWithRoutingDetail(
  data: ViewJsonPackageData,
  detail: ViewJsonRoutingDetail,
): ViewJsonPackageData {
  return {
    ...data,
    regularWires: detail.regularWires,
    specialWires: detail.specialWires,
    overview: detail.overview,
    routingDetailAvailable: false,
  }
}

function getViewJsonFullRendererRenderMode(
  scale: number,
  model: ViewJsonRenderModel | null,
  interactionFrozen: boolean,
  tiledDetailActive = false,
): ViewJsonRenderMode {
  if (interactionFrozen) return 'snapshot'
  if (tiledDetailActive) return 'tiled-detail'
  if (!model) return 'idle'
  switch (getViewJsonDisplayLOD(scale)) {
    case 'overview':
      return 'overview'
    case 'balanced':
      return 'hybrid'
    case 'detail':
      return 'detail'
  }
}

function getViewJsonOverviewCellSize(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 0
  return VIEW_JSON_OVERVIEW_SCREEN_CELL_PX / scale
}

function getViewJsonOverviewCellSizeForKind(objectKind: ViewJsonObjectKind, scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 0
  if (objectKind === 'regular_wires') {
    return VIEW_JSON_REGULAR_WIRE_OVERVIEW_SCREEN_CELL_PX / scale
  }
  if (objectKind === 'cell_pins' || objectKind === 'cell_obs') {
    return VIEW_JSON_DEBUG_CELL_INTERNAL_OVERVIEW_SCREEN_CELL_PX / scale
  }
  return getViewJsonOverviewCellSize(scale)
}

function shouldRenderDebugCellInternalOverview(
  preset: ViewJsonDisplayPreset,
  scale: number,
): boolean {
  return preset === 'debug' && getViewJsonDisplayLOD(scale) !== 'detail'
}

function buildViewJsonDebugCellInternalOverviewRects(
  instanceRects: ViewJsonRectRenderable[],
  objectKind: 'cell_pins' | 'cell_obs',
  scale: number,
  options: {
    layerIdsByInstanceId?: Map<number, Array<number | undefined>>
    layerVisible?: (layerId?: number) => boolean
  } = {},
): ViewJsonRectRenderable[] {
  const proxySourceRects: ViewJsonRectRenderable[] = []
  const layerVisible = options.layerVisible ?? (() => true)
  const hasLayerIdsByInstanceId = options.layerIdsByInstanceId != null
  for (const rect of instanceRects) {
    if (rect.objectKind !== 'instances' || rect.world.w <= 0 || rect.world.h <= 0) continue
    const layerIds = hasLayerIdsByInstanceId
      ? options.layerIdsByInstanceId?.get(rect.sourceId)
      : [undefined]
    if (!layerIds?.length) continue
    if (!layerIds.some(layerVisible)) continue
    proxySourceRects.push({
      ...rect,
      id: `${objectKind}:debug-overview-source:${rect.sourceId}`,
      objectKind,
      layerId: undefined,
      overviewWeight: 1,
    })
  }
  return aggregateViewJsonRectsForLowZoom(
    proxySourceRects,
    getViewJsonOverviewCellSizeForKind(objectKind, scale),
  )
}

function buildViewJsonDebugCellInternalLayerIdsByInstanceId(
  data: ViewJsonPackageData | null,
  objectKind: 'cell_pins' | 'cell_obs',
): Map<number, Array<number | undefined>> {
  if (!data) return new Map()
  const cached = VIEW_JSON_DEBUG_CELL_INTERNAL_LAYER_IDS_BY_DATA.get(data)
  if (cached) return cached[objectKind]

  const result: Record<'cell_pins' | 'cell_obs', Map<number, Array<number | undefined>>> = {
    cell_pins: new Map(),
    cell_obs: new Map(),
  }
  const layerIdsByMasterId = new Map<number, Array<number | undefined>>()
  const obsLayerIdsByMasterId = new Map<number, Array<number | undefined>>()
  for (const master of data.cellMasters) {
    const layerIds = new Set<number | undefined>()
    for (const pin of master.pins) {
      for (const port of pin.ports) {
        layerIds.add(port.layer_id)
      }
    }
    if (layerIds.size > 0) {
      layerIdsByMasterId.set(master.id, [...layerIds])
    }

    const obsLayerIds = new Set<number | undefined>()
    for (const obs of master.obs) {
      obsLayerIds.add(obs.layer_id)
    }
    if (obsLayerIds.size > 0) {
      obsLayerIdsByMasterId.set(master.id, [...obsLayerIds])
    }
  }

  for (const inst of data.instances) {
    const pinLayerIds = layerIdsByMasterId.get(inst.master_id)
    if (pinLayerIds?.length) {
      result.cell_pins.set(inst.id, pinLayerIds)
    }
    const obsLayerIds = obsLayerIdsByMasterId.get(inst.master_id)
    if (obsLayerIds?.length) {
      result.cell_obs.set(inst.id, obsLayerIds)
    }
  }

  VIEW_JSON_DEBUG_CELL_INTERNAL_LAYER_IDS_BY_DATA.set(data, result)
  return result[objectKind]
}

function getVisibleDebugCellInternalOverviewKinds(
  visibility: ViewJsonVisibilityState,
  preset: ViewJsonDisplayPreset,
  scale: number,
): Array<'cell_pins' | 'cell_obs'> {
  if (!shouldRenderDebugCellInternalOverview(preset, scale)) return []
  return (['cell_pins', 'cell_obs'] as const).filter(kind =>
    visibility.objectKinds[kind]
    && getViewJsonObjectDisplayMode(kind, scale, preset) === 'overview',
  )
}

function aggregateViewJsonOverviewRectsForKind(
  cache: ViewJsonOverviewAggregationCache,
  rects: ViewJsonRectRenderable[],
  scale: number,
): ViewJsonRectRenderable[] {
  const groups = new Map<ViewJsonObjectKind, ViewJsonRectRenderable[]>()
  for (const rect of rects) {
    const group = groups.get(rect.objectKind)
    if (group) {
      group.push(rect)
    } else {
      groups.set(rect.objectKind, [rect])
    }
  }
  return [...groups.entries()].flatMap(([objectKind, group]) =>
    cache.getRects(
      `overview-rects:${objectKind}`,
      group,
      getViewJsonOverviewCellSizeForKind(objectKind, scale),
    ),
  )
}

function splitViewJsonEngineeringOverviewRects(
  rects: ViewJsonRectRenderable[],
  model: Pick<ViewJsonRenderModel, 'worldWidth' | 'worldHeight'>,
  scale: number,
): {
  batchRects: ViewJsonRectRenderable[]
  macroOutlineRects: ViewJsonRectRenderable[]
  ioPinMarkerRects: ViewJsonRectRenderable[]
} {
  const batchRects: ViewJsonRectRenderable[] = []
  const macroOutlineRects: ViewJsonRectRenderable[] = []
  const ioPinMarkerRects: ViewJsonRectRenderable[] = []

  for (const rect of rects) {
    if (rect.objectKind === 'io_pins') {
      ioPinMarkerRects.push(rect)
      continue
    }
    if (isViewJsonOverviewMacroRect(rect, model, scale)) {
      macroOutlineRects.push(rect)
      continue
    }
    batchRects.push(rect)
  }

  return {
    batchRects,
    macroOutlineRects,
    ioPinMarkerRects,
  }
}

function getViewJsonInteractiveSnapshotBounds(bounds: ViewJsonVisibleBounds): ViewJsonVisibleBounds {
  const visibleSpan = Math.max(bounds.width, bounds.height, 0)
  return expandVisibleBounds(bounds, visibleSpan * VIEW_JSON_INTERACTIVE_SNAPSHOT_PADDING_RATIO)
}

function getViewJsonInteractiveSnapshotResolution(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return VIEW_JSON_INTERACTIVE_SNAPSHOT_MIN_RESOLUTION
  return Math.min(
    1,
    Math.max(
      VIEW_JSON_INTERACTIVE_SNAPSHOT_MIN_RESOLUTION,
      scale * VIEW_JSON_INTERACTIVE_SNAPSHOT_RESOLUTION_SCALE,
    ),
  )
}

function getViewJsonInteractiveSnapshotPixelCount(
  bounds: Pick<ViewJsonVisibleBounds, 'width' | 'height'>,
  scale: number,
): number {
  const resolution = getViewJsonInteractiveSnapshotResolution(scale)
  return Math.ceil(Math.max(0, bounds.width) * resolution)
    * Math.ceil(Math.max(0, bounds.height) * resolution)
}

function isProgrammaticViewportEvent(event?: ViewJsonViewportEvent): boolean {
  return event?.type === 'animate'
}

function shouldForceRedrawAfterInteractiveFreeze(
  startScale: number | null,
  endScale: number,
): boolean {
  if (
    startScale == null
    || !Number.isFinite(startScale)
    || !Number.isFinite(endScale)
  ) {
    return true
  }
  const tolerance = Math.max(1, Math.abs(startScale), Math.abs(endScale)) * VIEW_JSON_INTERACTIVE_SCALE_EPSILON
  return Math.abs(startScale - endScale) > tolerance
}

function shouldExpireViewJsonInteractiveFreeze(
  lastInteractionAt: number | null,
  now: number,
  timeoutMs = VIEW_JSON_INTERACTIVE_FREEZE_IDLE_TIMEOUT_MS,
): boolean {
  return lastInteractionAt != null
    && Number.isFinite(lastInteractionAt)
    && Number.isFinite(now)
    && now - lastInteractionAt >= timeoutMs
}

function getSemanticOverviewPrewarmScalesForScale(scale: number): number[] {
  if (!Number.isFinite(scale) || scale <= 0) return []
  return [
    scale,
    ...VIEW_JSON_SEMANTIC_OVERVIEW_PREWARM_SCALE_FACTORS.map(factor => scale * factor),
  ]
}

interface ViewJsonInteractiveProxyLimitOptions {
  model?: Pick<ViewJsonRenderModel, 'worldWidth' | 'worldHeight'>
  scale?: number
}

function interactiveProxyPriority(
  rect: ViewJsonRectRenderable,
  options: ViewJsonInteractiveProxyLimitOptions = {},
): number {
  switch (rect.objectKind) {
    case 'special_wires':
      return 0
    case 'vias':
      return 1
    case 'io_pins':
      return 2
    case 'instances':
      return options.model && options.scale != null && isViewJsonOverviewMacroRect(rect, options.model, options.scale)
        ? 3
        : 5
    case 'regular_wires':
      return 4
    default:
      return 5
  }
}

function limitViewJsonInteractiveProxyRects(
  rects: ViewJsonRectRenderable[],
  limit = VIEW_JSON_INTERACTIVE_PROXY_MAX_RECTS,
  options: ViewJsonInteractiveProxyLimitOptions = {},
): ViewJsonRectRenderable[] {
  if (rects.length <= limit) return rects
  return [...rects]
    .sort((a, b) =>
      interactiveProxyPriority(a, options) - interactiveProxyPriority(b, options)
      || (b.overviewWeight ?? 1) - (a.overviewWeight ?? 1)
      || a.id.localeCompare(b.id),
    )
    .slice(0, limit)
}

function limitViewJsonEngineeringOverviewRects(
  rects: ViewJsonRectRenderable[],
  limit = VIEW_JSON_ENGINEERING_OVERVIEW_MAX_RECTS,
  options: ViewJsonInteractiveProxyLimitOptions = {},
): ViewJsonRectRenderable[] {
  return limitViewJsonInteractiveProxyRects(rects, limit, options)
}

function destroyViewJsonInteractiveSnapshot(
  snapshot: ViewJsonInteractiveSnapshot,
  viewport: Viewport,
): void {
  const { sprite, texture } = snapshot
  if (sprite.parent === viewport) {
    viewport.removeChild(sprite)
  }
  sprite.destroy()
  if (!texture.destroyed) {
    texture.destroy(true)
  }
}

function destroyViewJsonInteractiveProxy(proxy: ViewJsonInteractiveProxy, viewport: Viewport): void {
  if (proxy.container.parent === viewport) {
    viewport.removeChild(proxy.container)
  }
  proxy.container.destroy({ children: true })
}

function isViewJsonLightweightSpatialIndexKind(objectKind: ViewJsonObjectKind): boolean {
  return VIEW_JSON_LIGHTWEIGHT_SPATIAL_INDEX_KINDS.has(objectKind)
}

function buildViewJsonLightweightSpatialIndex(model: ViewJsonRenderModel): ViewJsonRenderSpatialIndex {
  return buildViewJsonRenderSpatialIndex(model, undefined, {
    includeObjectKind: isViewJsonLightweightSpatialIndexKind,
  })
}

function countViewJsonVisibleRenderItems(direct: Pick<ViewJsonRenderItems, 'rects' | 'paths' | 'guides'>): number {
  return direct.rects.length + direct.paths.length + direct.guides.length
}

function shouldCacheVisibleRenderResult(
  direct: Pick<ViewJsonRenderItems, 'rects' | 'paths' | 'guides'>,
  lazyRects: ViewJsonRectRenderable[],
): boolean {
  if (lazyRects.length >= VIEW_JSON_LAZY_DETAIL_MAX_RECTS) return false
  return countViewJsonVisibleRenderItems(direct) + lazyRects.length <= VIEW_JSON_VISIBLE_RENDER_CACHE_MAX_ITEMS
}

export class ViewJsonFullRenderer {
  readonly container = new Container()
  private readonly viewport: Viewport
  private readonly snapshotRenderer: ViewJsonSnapshotRenderer | null
  private readonly options: ViewJsonFullRendererOptions
  private groups = new Map<string, GraphicsGroup>()
  private instanceMeshes = new Map<string, InstanceMeshGroup>()
  private engineeringOverviewMeshes = new Map<string, EngineeringOverviewMeshGroup>()
  private currentModel: ViewJsonRenderModel | null = null
  private lightweightRenderModel: ViewJsonRenderModel | null = null
  private fullRenderModel: ViewJsonRenderModel | null = null
  private currentVisibility: ViewJsonVisibilityState | null = null
  private spatialIndex: ViewJsonRenderSpatialIndex | null = null
  private lastDrawnQueryBounds: ViewJsonVisibleBounds | null = null
  private lastDrawnDetailScaleEnabled: boolean | null = null
  private redrawFrame = 0
  private progressiveDrawFrame = 0
  private forceNextRedraw = false
  private pendingDetailRects: ViewJsonRectRenderable[] = []
  private pendingDetailCursor = 0
  private detachViewportListeners: (() => void) | null = null
  private lastRebuildMs = 0
  private buildModelMs = 0
  private buildSpatialIndexMs = 0
  private queryMs = 0
  private lazyMaterializeMs = 0
  private drawMs = 0
  private rasterTileCacheHitCount = 0
  private rasterTileCacheMissCount = 0
  private readonly rectBatchCache = new ViewJsonRectBatchBufferCache()
  private readonly engineeringOverviewBatchCache = new ViewJsonRectBatchBufferCache()
  private readonly engineeringOverviewAggregationCache = new ViewJsonOverviewAggregationCache()
  private readonly semanticOverviewWorkerClient: ViewJsonSemanticOverviewWorkerClient | null
  private readonly semanticOverviewCache: ViewJsonSemanticOverviewCache
  private visibleRenderCache: ViewJsonVisibleRenderCacheEntry | null = null
  private visibleInstanceCount = 0
  private visibleVectorItemCount = 0
  private currentData: ViewJsonPackageData | null = null
  private geometryTileStore: ViewJsonGeometryTileStore | null = null
  private geometryTileRequestId = 0
  private geometryTileActive = false
  private geometryTilePendingCount = 0
  private interactiveSnapshot: ViewJsonInteractiveSnapshot | null = null
  private interactiveProxy: ViewJsonInteractiveProxy | null = null
  private prewarmedInteractiveSnapshot: ViewJsonInteractiveSnapshot | null = null
  private interactiveSnapshotPrewarmTimer: ReturnType<typeof setTimeout> | null = null
  private interactiveFreezeWatchdogTimer: ReturnType<typeof setTimeout> | null = null
  private interactionFrozen = false
  private interactiveFreezeStartScale: number | null = null
  private lastInteractiveViewportEventAt: number | null = null
  private lastInteractiveSnapshotMs = 0
  private interactiveSnapshotSkippedCount = 0
  private interactiveSnapshotCooldownUntil = 0
  private displayPreset: ViewJsonDisplayPreset = VIEW_JSON_DEFAULT_DISPLAY_PRESET
  private rebuildRenderModelGeneration = 0
  private rebuildSpatialIndexGeneration = 0
  private fullRenderModelBuildGeneration: number | null = null
  private fullRenderModelRequestId = 0
  private routingDetailRequestId = 0

  constructor(
    viewport: Viewport,
    renderer: ViewJsonSnapshotRenderer | null = null,
    options: ViewJsonFullRendererOptions = {},
  ) {
    this.viewport = viewport
    this.snapshotRenderer = renderer
    this.options = options
    this.semanticOverviewWorkerClient = options.semanticOverviewWorkerFactory
      ? new ViewJsonSemanticOverviewWorkerClient(options.semanticOverviewWorkerFactory)
      : null
    this.semanticOverviewCache = new ViewJsonSemanticOverviewCache({
      workerClient: this.semanticOverviewWorkerClient,
      onLevelReady: () => {
        if (!this.currentModel || !this.spatialIndex) return
        this.lastDrawnQueryBounds = null
        this.visibleRenderCache = null
        this.requestRedraw({ force: true })
      },
    })
    this.container.label = 'view-json-full-root'
    viewport.addChild(this.container)

    const onViewportChanged = (event?: ViewJsonViewportEvent): void => {
      if (!isProgrammaticViewportEvent(event) && this.beginInteractiveFreeze()) {
        this.scheduleInteractiveFreezeWatchdog()
        return
      }
      this.ensureRenderModelForCurrentScale()
      this.requestRedraw()
    }
    const onViewportChangeEnded = (): void => {
      this.clearInteractiveFreezeWatchdogTimer()
      const forceRedraw = this.endInteractiveFreeze()
      this.ensureRenderModelForCurrentScale()
      this.requestRedraw({ force: forceRedraw })
    }
    this.viewport.on('moved', onViewportChanged)
    this.viewport.on('zoomed', onViewportChanged)
    this.viewport.on('moved-end', onViewportChangeEnded)
    this.viewport.on('zoomed-end', onViewportChangeEnded)
    this.detachViewportListeners = () => {
      this.viewport.off('moved', onViewportChanged)
      this.viewport.off('zoomed', onViewportChanged)
      this.viewport.off('moved-end', onViewportChangeEnded)
      this.viewport.off('zoomed-end', onViewportChangeEnded)
    }
  }

  render(data: ViewJsonPackageData, visibility = createViewJsonVisibilityState(data.layers)): ViewJsonRenderModel {
    const startedAt = performance.now()
    this.releaseRenderCaches()
    this.rebuildRenderModelGeneration += 1
    const renderModelGeneration = this.rebuildRenderModelGeneration
    const model = buildViewJsonLightweightRenderModel(data)
    this.buildModelMs = performance.now() - startedAt
    this.currentData = data
    this.destroyGeometryTileStore()
    this.geometryTileStore = data.geometryTileIndex
      ? this.options.tileStoreFactory?.(data) ?? null
      : null
    this.lightweightRenderModel = model
    this.fullRenderModel = null
    this.fullRenderModelBuildGeneration = null
    this.fullRenderModelRequestId += 1
    this.geometryTileRequestId += 1
    this.geometryTileActive = false
    this.renderModel(model, visibility)
    if (renderModelGeneration === this.rebuildRenderModelGeneration) {
      this.ensureRenderModelForCurrentScale()
    }
    return model
  }

  renderModel(model: ViewJsonRenderModel, visibility = createViewJsonVisibilityState(model.layers)): ViewJsonRenderModel {
    const startedAt = performance.now()
    this.endInteractiveFreeze()
    this.cancelProgressiveDraw()
    this.destroyPrewarmedInteractiveSnapshot()
    this.currentModel = model
    this.currentVisibility = visibility
    this.options.onModelReady?.(model)
    const indexStartedAt = performance.now()
    this.rebuildSpatialIndexGeneration += 1
    const spatialIndexGeneration = this.rebuildSpatialIndexGeneration
    this.spatialIndex = buildViewJsonLightweightSpatialIndex(model)
    this.buildSpatialIndexMs = performance.now() - indexStartedAt
    this.lastDrawnQueryBounds = null
    this.lastDrawnDetailScaleEnabled = null
    this.visibleRenderCache = null
    this.semanticOverviewCache.clear()
    this.semanticOverviewCache.prewarm(model, this.currentData, this.getSemanticOverviewPrewarmScales(this.viewport.scale.x))
    if (this.currentModel === this.fullRenderModel && shouldUseViewJsonFullDetailModel(this.viewport.scale.x, this.displayPreset)) {
      void this.rebuildFullSpatialIndexInBackground(model, spatialIndexGeneration)
    }
    this.redrawVisible(startedAt)
    return model
  }

  applyVisibility(visibility: ViewJsonVisibilityState): void {
    this.endInteractiveFreeze()
    this.currentVisibility = visibility
    this.lastDrawnQueryBounds = null
    this.visibleRenderCache = null
    this.redrawVisible()
  }

  setDisplayPreset(preset: ViewJsonDisplayPreset): void {
    this.displayPreset = preset
    this.lastDrawnQueryBounds = null
    this.visibleRenderCache = null
    this.ensureRenderModelForCurrentScale()
    this.requestRedraw({ force: true })
  }

  updateAdaptiveFrameRate(_fps: number): void {
    // Full renderer intentionally does not switch modes; completeness is the priority.
  }

  getPerformanceStats(): ViewJsonRendererStats {
    const model = this.currentModel
    const frameThrottle = this.options.getFrameThrottleState?.() ?? { mode: 'active' as const, maxFPS: 60 }
    return {
      renderMode: getViewJsonFullRendererRenderMode(
        this.viewport.scale.x,
        model,
        this.interactionFrozen,
        this.geometryTileActive,
      ),
      frameThrottle: frameThrottle.mode,
      frameThrottleFps: frameThrottle.maxFPS,
      visibleInstanceCount: this.visibleInstanceCount,
      visibleChunkCount: 0,
      activeRasterTileCount: this.geometryTileStore?.getStats().activeTileCount ?? 0,
      activeVectorChunkCount: this.visibleVectorItemCount,
      adaptiveDetailInstanceLimit: 0,
      pendingRasterTileCount: this.geometryTilePendingCount,
      buildingRasterTileCount: 0,
      rasterTileCacheHitCount: this.rasterTileCacheHitCount + (this.geometryTileStore?.getStats().cacheHitCount ?? 0),
      rasterTileCacheMissCount: this.rasterTileCacheMissCount + (this.geometryTileStore?.getStats().cacheMissCount ?? 0),
      rasterTileCacheHitRate: this.rasterTileCacheHitCount + this.rasterTileCacheMissCount + (this.geometryTileStore?.getStats().cacheHitCount ?? 0) + (this.geometryTileStore?.getStats().cacheMissCount ?? 0) > 0
        ? (this.rasterTileCacheHitCount + (this.geometryTileStore?.getStats().cacheHitCount ?? 0))
          / (this.rasterTileCacheHitCount + this.rasterTileCacheMissCount + (this.geometryTileStore?.getStats().cacheHitCount ?? 0) + (this.geometryTileStore?.getStats().cacheMissCount ?? 0))
        : 0,
      rasterTileFallbackCount: 0,
      rasterTileFallbackRate: 0,
      lastRasterTileWorkerMs: 0,
      gpuChunkBufferCacheSize: this.rectBatchCache.size + (this.geometryTileStore?.getStats().decodedBytes ?? 0),
      interactiveSnapshotMs: this.lastInteractiveSnapshotMs,
      interactiveSnapshotSkippedCount: this.interactiveSnapshotSkippedCount,
      scale: this.viewport.scale.x,
      rebuildMs: this.lastRebuildMs,
      buildModelMs: this.buildModelMs,
      buildSpatialIndexMs: this.buildSpatialIndexMs,
      queryMs: this.queryMs,
      lazyMaterializeMs: this.lazyMaterializeMs,
      drawMs: this.drawMs,
    }
  }

  destroy(): void {
    this.rebuildRenderModelGeneration += 1
    this.rebuildSpatialIndexGeneration += 1
    this.fullRenderModelBuildGeneration = null
    this.fullRenderModelRequestId += 1
    if (this.redrawFrame !== 0) {
      cancelAnimationFrame(this.redrawFrame)
      this.redrawFrame = 0
    }
    this.clearInteractiveSnapshotPrewarmTimer()
    this.clearInteractiveFreezeWatchdogTimer()
    this.cancelProgressiveDraw()
    this.endInteractiveFreeze()
    this.destroyInteractiveProxy()
    this.destroyPrewarmedInteractiveSnapshot()
    this.detachViewportListeners?.()
    this.detachViewportListeners = null
    this.releaseRenderCaches()
    this.currentModel = null
    this.lightweightRenderModel = null
    this.fullRenderModel = null
    this.currentVisibility = null
    this.spatialIndex = null
    this.visibleRenderCache = null
    this.currentData = null
    this.destroyGeometryTileStore()
    this.pendingDetailRects = []
    this.pendingDetailCursor = 0
    this.visibleInstanceCount = 0
    this.visibleVectorItemCount = 0
    this.forceNextRedraw = false
    this.interactionFrozen = false
    this.interactiveFreezeStartScale = null
    this.routingDetailRequestId += 1
    this.geometryTileRequestId += 1
    this.semanticOverviewWorkerClient?.destroy()
    if (this.container.parent === this.viewport) {
      this.viewport.removeChild(this.container)
    }
    this.container.destroy({ children: true })
  }

  private releaseRenderCaches(): void {
    this.clearInteractiveSnapshotPrewarmTimer()
    this.clearInteractiveFreezeWatchdogTimer()
    this.cancelProgressiveDraw()
    this.endInteractiveFreeze()
    this.destroyInteractiveProxy()
    this.destroyPrewarmedInteractiveSnapshot()
    this.rectBatchCache.clear()
    this.engineeringOverviewBatchCache.clear()
    this.engineeringOverviewAggregationCache.clear()
    this.semanticOverviewCache.clear()
    this.clearGroups()
  }

  private destroyGeometryTileStore(): void {
    this.geometryTileRequestId += 1
    this.geometryTileStore?.dispose()
    this.geometryTileStore = null
    this.geometryTileActive = false
    this.geometryTilePendingCount = 0
  }

  private async rebuildFullRenderModelInBackground(
    data: ViewJsonPackageData,
    fallbackVisibility: ViewJsonVisibilityState,
    generation: number,
    requestId: number,
  ): Promise<void> {
    try {
      const detail = await this.ensureRoutingDetailLoaded(data, generation, requestId)
      if (
        generation !== this.rebuildRenderModelGeneration
        || requestId !== this.fullRenderModelRequestId
        || this.currentData !== data
      ) return
      const renderData = detail && data.routingDetailAvailable
        ? viewJsonPackageWithRoutingDetail(data, detail)
        : data
      const startedAt = performance.now()
      const model = await buildViewJsonRenderModelAsync(renderData, {
        shouldCancel: () =>
          generation !== this.rebuildRenderModelGeneration
          || requestId !== this.fullRenderModelRequestId,
      })
      if (
        generation !== this.rebuildRenderModelGeneration
        || requestId !== this.fullRenderModelRequestId
        || this.currentData !== data
      ) return
      this.buildModelMs = performance.now() - startedAt
      this.fullRenderModelBuildGeneration = null
      this.fullRenderModel = model
      if (shouldUseViewJsonFullDetailModel(this.viewport.scale.x, this.displayPreset)) {
        this.renderModel(model, this.currentVisibility ?? fallbackVisibility)
      }
    } catch {
      if (
        generation === this.fullRenderModelBuildGeneration
        && requestId === this.fullRenderModelRequestId
      ) {
        this.fullRenderModelBuildGeneration = null
      }
      return
    }
  }

  private async ensureRoutingDetailLoaded(
    data: ViewJsonPackageData,
    generation: number,
    requestId: number,
  ): Promise<ViewJsonRoutingDetail | null> {
    if (!data.routingDetailAvailable || !this.options.loadRoutingDetail) return null
    const detailRequestId = this.routingDetailRequestId + 1
    this.routingDetailRequestId = detailRequestId
    const detail = await this.options.loadRoutingDetail(data, {
      shouldCancel: () =>
        generation !== this.rebuildRenderModelGeneration
        || requestId !== this.fullRenderModelRequestId
        || detailRequestId !== this.routingDetailRequestId
        || this.currentData !== data,
    })
    if (
      generation !== this.rebuildRenderModelGeneration
      || requestId !== this.fullRenderModelRequestId
      || detailRequestId !== this.routingDetailRequestId
      || this.currentData !== data
    ) return null
    return detail
  }

  private ensureRenderModelForCurrentScale(): void {
    if (!this.currentData || !this.lightweightRenderModel) return

    if (shouldCancelViewJsonFullDetailModelBuild(
      this.viewport.scale.x,
      this.displayPreset,
      this.interactionFrozen,
      this.fullRenderModelBuildGeneration != null,
    )) {
      this.cancelPendingFullRenderModelBuild()
    }

    if (this.interactionFrozen) {
      this.semanticOverviewCache.prewarm(
        this.lightweightRenderModel,
        this.currentData,
        this.getSemanticOverviewPrewarmScales(this.viewport.scale.x),
      )
      return
    }

    if (this.shouldUseGeometryTilesForCurrentScale()) {
      if (this.fullRenderModel) {
        this.releaseFullDetailModel()
      } else {
        this.cancelPendingFullRenderModelBuild()
      }
      this.requestGeometryTilesForCurrentViewport()
      return
    }

    if (shouldUseLegacyFullDetailModel(this.currentData, this.viewport.scale.x, this.displayPreset)) {
      this.requestFullRenderModelForDetail()
      return
    }

    const isShowingFullModel = this.currentModel === this.fullRenderModel
    this.releaseFullDetailModel()
    if (shouldSwitchViewJsonFullDetailModelToLightweight(
      this.viewport.scale.x,
      this.displayPreset,
      this.interactionFrozen,
      isShowingFullModel,
    )) {
      this.renderModel(this.lightweightRenderModel, this.currentVisibility ?? createViewJsonVisibilityState(this.lightweightRenderModel.layers))
      return
    }

    this.semanticOverviewCache.prewarm(
      this.lightweightRenderModel,
      this.currentData,
      this.getSemanticOverviewPrewarmScales(this.viewport.scale.x),
    )
  }

  private requestFullRenderModelForDetail(): void {
    if (!this.currentData || !this.lightweightRenderModel) return

    if (this.fullRenderModel) {
      if (this.currentModel !== this.fullRenderModel) {
        this.renderModel(this.fullRenderModel, this.currentVisibility ?? createViewJsonVisibilityState(this.fullRenderModel.layers))
      }
      return
    }

    if (this.fullRenderModelBuildGeneration != null) return

    const generation = this.rebuildRenderModelGeneration
    const requestId = this.fullRenderModelRequestId + 1
    this.fullRenderModelRequestId = requestId
    this.fullRenderModelBuildGeneration = generation
    void this.rebuildFullRenderModelInBackground(
      this.currentData,
      this.currentVisibility ?? createViewJsonVisibilityState(this.lightweightRenderModel.layers),
      generation,
      requestId,
    )
  }

  private shouldUseGeometryTilesForCurrentScale(): boolean {
    return Boolean(this.geometryTileStore)
      && shouldUseViewJsonFullDetailModel(this.viewport.scale.x, this.displayPreset)
  }

  private requestGeometryTilesForCurrentViewport(): void {
    const model = this.lightweightRenderModel
    const visibility = this.currentVisibility
    const store = this.geometryTileStore
    if (!model || !visibility || !store) return
    const requestId = this.geometryTileRequestId + 1
    this.geometryTileRequestId = requestId
    const bounds = this.getVisibleBounds(model)
    this.geometryTilePendingCount = 1
    void store.loadTilesForBounds(expandVisibleBounds(bounds, getViewJsonRenderQueryPadding(bounds, this.viewport.scale.x)))
      .then((items) => {
        this.geometryTilePendingCount = 0
        if (
          requestId !== this.geometryTileRequestId
          || store !== this.geometryTileStore
          || model !== this.lightweightRenderModel
        ) return
        this.geometryTileActive = true
        this.drawGeometryTileItems(items, model, visibility)
        this.options.requestRenderActive?.()
      })
      .catch(() => {
        if (requestId === this.geometryTileRequestId) {
          this.geometryTilePendingCount = 0
        }
      })
  }

  private drawGeometryTileItems(
    items: ViewJsonGeometryTileRenderItems,
    model: ViewJsonRenderModel,
    visibility: ViewJsonVisibilityState,
  ): void {
    const scale = this.viewport.scale.x
    let drawn = 0
    for (const rect of flattenViewJsonRectsForGraphicsFillCoverage(items.rects)) {
      if (!this.isDetailVisible(visibility, rect.objectKind, rect.layerId, scale)) continue
      drawViewJsonRect(this.getGroup(rect.objectKind, rect.layerId).graphics, rect, model)
      drawn += 1
    }
    for (const path of items.paths) {
      if (!this.isDetailVisible(visibility, path.objectKind, path.layerId, scale)) continue
      drawViewJsonPath(this.getGroup(path.objectKind, path.layerId).graphics, path, model)
      drawn += 1
    }
    this.visibleVectorItemCount += drawn
  }

  private cancelPendingFullRenderModelBuild(): void {
    if (this.fullRenderModelBuildGeneration == null) return
    this.fullRenderModelRequestId += 1
    this.routingDetailRequestId += 1
    this.fullRenderModelBuildGeneration = null
  }

  private releaseFullDetailModel(): void {
    this.cancelPendingFullRenderModelBuild()
    const wasShowingFullModel = this.currentModel === this.fullRenderModel
    this.fullRenderModel = null
    if (wasShowingFullModel && this.lightweightRenderModel) {
      this.renderModel(
        this.lightweightRenderModel,
        this.currentVisibility ?? createViewJsonVisibilityState(this.lightweightRenderModel.layers),
      )
    }
  }

  private getSemanticOverviewPrewarmScales(scale: number): number[] {
    return normalizeViewJsonSemanticOverviewPrewarmScales(
      scale,
      [
        ...getSemanticOverviewPrewarmScalesForScale(scale),
        ...VIEW_JSON_SEMANTIC_OVERVIEW_PREWARM_SCALES,
      ],
    )
  }

  private async rebuildFullSpatialIndexInBackground(
    model: ViewJsonRenderModel,
    generation: number,
  ): Promise<void> {
    try {
      const startedAt = performance.now()
      const index = await buildViewJsonRenderSpatialIndexAsync(model, {
        shouldCancel: () => generation !== this.rebuildSpatialIndexGeneration,
      })
      if (generation !== this.rebuildSpatialIndexGeneration || this.currentModel !== model) return
      this.spatialIndex = index
      this.buildSpatialIndexMs = performance.now() - startedAt
      this.lastDrawnQueryBounds = null
      this.visibleRenderCache = null
      this.requestRedraw({ force: true })
    } catch {
      return
    }
  }

  private requestRedraw({ force = false }: { force?: boolean } = {}): void {
    if (!this.currentModel || !this.spatialIndex) return
    this.options.requestRenderActive?.()
    this.clearInteractiveSnapshotPrewarmTimer()
    if (!this.interactionFrozen) {
      this.destroyPrewarmedInteractiveSnapshot()
    }
    if (this.interactionFrozen) {
      if (force) {
        this.forceNextRedraw = true
      }
      return
    }
    if (force) {
      this.forceNextRedraw = true
    }
    if (this.redrawFrame !== 0) return

    const visibleBounds = this.getVisibleBounds(this.currentModel)
    if (
      !this.forceNextRedraw
      &&
      this.lastDrawnQueryBounds
      && this.lastDrawnDetailScaleEnabled === detailScaleEnabled(this.viewport.scale.x)
      && isVisibleBoundsInside(visibleBounds, this.lastDrawnQueryBounds)
    ) {
      return
    }

    this.redrawFrame = requestAnimationFrame(() => {
      this.redrawFrame = 0
      this.forceNextRedraw = false
      this.redrawVisible()
    })
  }

  private redrawVisible(startedAt = performance.now()): void {
    const model = this.currentModel
    const visibility = this.currentVisibility
    const index = this.spatialIndex
    if (!model || !visibility || !index) return

    this.options.requestRenderActive?.()
    this.container.visible = true
    this.cancelProgressiveDraw()
    this.destroyPrewarmedInteractiveSnapshot()
    this.clearGroups({ keepInstanceMeshes: true })
    const scale = this.viewport.scale.x
    const visibleBounds = this.getVisibleBounds(model)
    const queryBounds = expandVisibleBounds(
      visibleBounds,
      getViewJsonRenderQueryPadding(visibleBounds, scale),
    )
    const renderEngineeringOverview = shouldRenderEngineeringOverview(scale)
    const renderRoutingOverviewFallback = this.shouldRenderRoutingOverviewFallback(model)
    const renderSemanticOverview = renderEngineeringOverview || renderRoutingOverviewFallback
    const debugCellInternalOverviewKinds = getVisibleDebugCellInternalOverviewKinds(
      visibility,
      this.displayPreset,
      scale,
    )
    const needsDebugCellInternalOverviewSources = debugCellInternalOverviewKinds.length > 0
    if (renderSemanticOverview) {
      this.semanticOverviewCache.prewarm(model, this.currentData, this.getSemanticOverviewPrewarmScales(scale))
    }
    const lazyKinds = this.getVisibleLazyKinds(visibility, scale)
    const querySignature = this.getVisibleRenderCacheSignature(
      queryBounds,
      visibility,
      lazyKinds,
      scale,
      renderRoutingOverviewFallback,
    )
    const queryStartedAt = performance.now()
    const cacheHit = this.visibleRenderCache?.signature === querySignature
    if (cacheHit) {
      this.rasterTileCacheHitCount += 1
    } else {
      this.rasterTileCacheMissCount += 1
    }
    const visible = cacheHit
      ? this.visibleRenderCache!.direct
      : getViewJsonRenderItemsInBounds(
        index,
        queryBounds,
        0,
        {
          includeObjectKind: objectKind => {
            const isDebugCellInternalOverviewSource = needsDebugCellInternalOverviewSources
              && objectKind === 'instances'
            return (
              this.isRenderableVisible(visibility, objectKind, undefined, scale)
              || isDebugCellInternalOverviewSource
            )
              && !(
                renderEngineeringOverview
                && isViewJsonSemanticOverviewKind(objectKind)
                && !isDebugCellInternalOverviewSource
              )
          },
        },
      )
    this.queryMs = performance.now() - queryStartedAt
    const lazyStartedAt = performance.now()
    const lazyRects = cacheHit
      ? this.visibleRenderCache!.lazyRects
      : materializeViewJsonLazyGeometryInBounds(
        model,
        this.currentData,
        { x: queryBounds.x, y: queryBounds.y, w: queryBounds.width, h: queryBounds.height },
        {
          objectKinds: lazyKinds,
          layerVisible: layerId => layerId == null || (visibility.layers.get(layerId) ?? true),
          maxRects: VIEW_JSON_LAZY_DETAIL_MAX_RECTS,
        },
      )
    this.lazyMaterializeMs = performance.now() - lazyStartedAt
    if (!cacheHit && shouldCacheVisibleRenderResult(visible, lazyRects)) {
      this.visibleRenderCache = {
        signature: querySignature,
        direct: visible,
        lazyRects,
      }
    } else if (!cacheHit) {
      this.visibleRenderCache = null
    }
    const drawStartedAt = performance.now()
    let visibleInstanceCount = 0
    let visibleVectorItemCount = 0
    const useInstanceMeshes = shouldRenderInstancesAsMesh(scale)
    const instanceMeshRects: ViewJsonRectRenderable[] = []
    const overviewRects: ViewJsonRectRenderable[] = []
    const semanticOverviewRects: ViewJsonRectRenderable[] = []
    const graphicsRects: ViewJsonRectRenderable[] = []
    const outlineRects: ViewJsonRectRenderable[] = []
    const macroOutlineRects: ViewJsonRectRenderable[] = []
    const ioPinMarkerRects: ViewJsonRectRenderable[] = []
    const debugCellInternalOverviewSourceRects: ViewJsonRectRenderable[] = []

    for (const rect of visible.rects) {
      if (
        needsDebugCellInternalOverviewSources
        && rect.objectKind === 'instances'
      ) {
        debugCellInternalOverviewSourceRects.push(rect)
      }
      if (!this.isQueryableVisible(visibility, rect.objectKind, rect.layerId, scale)) continue
      const displayMode = getViewJsonObjectDisplayMode(rect.objectKind, scale, this.displayPreset)
      if (displayMode === 'hidden' || displayMode === 'deferred') continue
      if (renderEngineeringOverview && isViewJsonSemanticOverviewKind(rect.objectKind)) continue
      if (displayMode === 'outline') {
        outlineRects.push(rect)
        continue
      }
      if (shouldDrawViewJsonIoPinMarker(rect, scale)) {
        ioPinMarkerRects.push(rect)
        continue
      }
      if (rect.objectKind === 'instances') {
        visibleInstanceCount += 1
        if (useInstanceMeshes) {
          instanceMeshRects.push(rect)
          continue
        }
      }
      if (displayMode === 'overview') {
        if (renderEngineeringOverview && rect.objectKind === 'io_pins') {
          ioPinMarkerRects.push(rect)
          continue
        }
        if (renderEngineeringOverview && isViewJsonOverviewMacroRect(rect, model, scale)) {
          macroOutlineRects.push(rect)
        }
        overviewRects.push(rect)
        continue
      }
      graphicsRects.push(rect)
    }

    if (debugCellInternalOverviewSourceRects.length > 0) {
      for (const objectKind of debugCellInternalOverviewKinds) {
        overviewRects.push(...buildViewJsonDebugCellInternalOverviewRects(
          debugCellInternalOverviewSourceRects,
          objectKind,
          scale,
          {
            layerIdsByInstanceId: buildViewJsonDebugCellInternalLayerIdsByInstanceId(this.currentData, objectKind),
            layerVisible: layerId => layerId == null || (visibility.layers.get(layerId) ?? true),
          },
        ))
      }
    }

    const instanceMeshInput = useInstanceMeshes
      ? aggregateViewJsonRectsForLowZoom(
        instanceMeshRects,
        getViewJsonInstanceAggregateCellSize(scale),
      )
      : []
    visibleVectorItemCount += useInstanceMeshes
      ? this.renderInstanceMeshBatches(instanceMeshInput, model)
      : this.reconcileInstanceMeshes(new Set())

    for (const rect of flattenViewJsonRectsForGraphicsFillCoverage(graphicsRects)) {
      drawViewJsonRect(this.getGroup(rect.objectKind, rect.layerId).graphics, rect, model)
      visibleVectorItemCount += 1
    }
    for (const rect of outlineRects) {
      drawViewJsonOutlineRect(this.getGroup(rect.objectKind, rect.layerId).graphics, rect, model)
      visibleVectorItemCount += 1
    }
    for (const path of visible.paths) {
      if (!this.isQueryableVisible(visibility, path.objectKind, path.layerId, scale)) continue
      const displayMode = getViewJsonObjectDisplayMode(path.objectKind, scale, this.displayPreset)
      if (displayMode === 'hidden' || displayMode === 'deferred') continue
      if (renderEngineeringOverview && isViewJsonSemanticOverviewKind(path.objectKind)) continue
      if (displayMode === 'overview') continue
      drawViewJsonPath(this.getGroup(path.objectKind, path.layerId).graphics, path, model)
      visibleVectorItemCount += 1
    }
    if (renderSemanticOverview) {
      const semanticOverviewLevel = this.getSemanticOverviewLevelForCurrentFrame(model, scale)
      if (semanticOverviewLevel) {
        semanticOverviewRects.push(...getViewJsonSemanticOverviewItemsInBounds(
          semanticOverviewLevel,
          queryBounds,
          objectKind => this.isQueryableVisible(visibility, objectKind, undefined, scale)
            && (renderEngineeringOverview || isViewJsonRoutingOverviewFallbackKind(objectKind)),
        ).filter(rect => rect.layerId == null || (visibility.layers.get(rect.layerId) ?? true)))
      }
    }
    const engineeringOverviewSplit = renderEngineeringOverview
      ? splitViewJsonEngineeringOverviewRects(overviewRects, model, scale)
      : null
    const semanticOverviewSplit = renderEngineeringOverview
      ? splitViewJsonEngineeringOverviewRects(semanticOverviewRects, model, scale)
      : null
    const engineeringOverviewBatchRects = renderSemanticOverview
      ? limitViewJsonEngineeringOverviewRects(
        [
          ...aggregateViewJsonOverviewRectsForKind(
            this.engineeringOverviewAggregationCache,
            engineeringOverviewSplit?.batchRects ?? overviewRects,
            scale,
          ),
          ...(semanticOverviewSplit?.batchRects ?? semanticOverviewRects),
        ],
        undefined,
        { model, scale },
      )
      : []
    visibleVectorItemCount += renderSemanticOverview
      ? this.renderEngineeringOverviewBatches(engineeringOverviewBatchRects, model, scale)
      : this.reconcileEngineeringOverviewMeshes(new Set())
    for (const rect of [
      ...macroOutlineRects,
      ...(engineeringOverviewSplit?.macroOutlineRects ?? []),
      ...(semanticOverviewSplit?.macroOutlineRects ?? []),
    ]) {
      drawViewJsonMacroOutline(this.getGroup(rect.objectKind, rect.layerId).graphics, rect)
      visibleVectorItemCount += 1
    }
    for (const rect of [
      ...ioPinMarkerRects,
      ...(engineeringOverviewSplit?.ioPinMarkerRects ?? []),
      ...(semanticOverviewSplit?.ioPinMarkerRects ?? []),
    ]) {
      drawViewJsonIoPinMarker(this.getGroup(rect.objectKind, rect.layerId).graphics, rect, scale)
      visibleVectorItemCount += 1
    }
    for (const guide of visible.guides) {
      if (!this.isQueryableVisible(visibility, guide.objectKind, guide.layerId, scale)) continue
      const displayMode = getViewJsonObjectDisplayMode(guide.objectKind, scale, this.displayPreset)
      if (displayMode === 'hidden' || displayMode === 'deferred' || displayMode === 'overview') continue
      drawViewJsonGuide(this.getGroup(guide.objectKind, guide.layerId).graphics, guide, model)
      visibleVectorItemCount += 1
    }

    this.pendingDetailRects = lazyRects.filter(rect =>
      this.isDetailVisible(visibility, rect.objectKind, rect.layerId, scale),
    ).slice(0, VIEW_JSON_LAZY_DETAIL_MAX_RECTS)
    visibleVectorItemCount += this.pendingDetailRects.length
    this.visibleInstanceCount = visibleInstanceCount
    this.visibleVectorItemCount = visibleVectorItemCount
    this.lastDrawnQueryBounds = queryBounds
    this.lastDrawnDetailScaleEnabled = detailScaleEnabled(scale)
    this.drawMs = performance.now() - drawStartedAt
    this.lastRebuildMs = performance.now() - startedAt
    this.scheduleProgressiveDraw()
    this.scheduleInteractiveSnapshotPrewarm()
    if (this.shouldUseGeometryTilesForCurrentScale()) {
      this.requestGeometryTilesForCurrentViewport()
    } else {
      this.geometryTileActive = false
    }
  }

  private getSemanticOverviewLevelForCurrentFrame(
    model: ViewJsonRenderModel,
    scale: number,
  ): ViewJsonSemanticOverviewLevel | null {
    const cached = this.semanticOverviewCache.peekLevel(model, this.currentData, scale)
    if (cached) return cached
    const nearest = this.semanticOverviewCache.peekNearestLevel(model, this.currentData, scale)
    if (nearest) return nearest
    return this.currentData ? buildViewJsonPackageRoutingOverviewLevel(this.currentData, scale) : null
  }

  private shouldRenderRoutingOverviewFallback(model: ViewJsonRenderModel): boolean {
    return model === this.lightweightRenderModel
      && (this.currentData?.routingDetailAvailable ?? false)
      && (this.currentData?.overview?.routing.length ?? 0) > 0
  }

  private beginInteractiveFreeze(): boolean {
    if (!this.currentModel) return false
    this.lastInteractiveViewportEventAt = performance.now()
    if (this.interactionFrozen) return true
    this.interactiveFreezeStartScale = this.viewport.scale.x
    this.semanticOverviewCache.cancelPending()
    this.clearInteractiveSnapshotPrewarmTimer()
    const snapshot = VIEW_JSON_INTERACTIVE_SNAPSHOT_ENABLED && this.snapshotRenderer
      ? this.consumePrewarmedInteractiveSnapshot() ?? this.createInteractiveSnapshot()
      : null
    const proxy = snapshot ? null : this.createInteractiveProxy()
    if (this.redrawFrame !== 0) {
      cancelAnimationFrame(this.redrawFrame)
      this.redrawFrame = 0
      this.forceNextRedraw = false
    }

    this.cancelProgressiveDraw()
    this.interactionFrozen = true
    if (snapshot) {
      this.interactiveSnapshot = snapshot
      this.container.visible = false
    }
    if (proxy) {
      this.interactiveProxy = proxy
      this.container.visible = false
    }
    return true
  }

  private scheduleInteractiveFreezeWatchdog(): void {
    this.clearInteractiveFreezeWatchdogTimer()
    this.interactiveFreezeWatchdogTimer = setTimeout(() => {
      this.interactiveFreezeWatchdogTimer = null
      if (!this.interactionFrozen) return
      if (!shouldExpireViewJsonInteractiveFreeze(
        this.lastInteractiveViewportEventAt,
        performance.now(),
      )) {
        this.scheduleInteractiveFreezeWatchdog()
        return
      }
      this.endInteractiveFreeze()
      this.ensureRenderModelForCurrentScale()
      this.requestRedraw({ force: true })
    }, VIEW_JSON_INTERACTIVE_FREEZE_IDLE_TIMEOUT_MS)
  }

  private clearInteractiveFreezeWatchdogTimer(): void {
    if (!this.interactiveFreezeWatchdogTimer) return
    clearTimeout(this.interactiveFreezeWatchdogTimer)
    this.interactiveFreezeWatchdogTimer = null
  }

  private createInteractiveProxy(): ViewJsonInteractiveProxy | null {
    const model = this.currentModel
    const visibility = this.currentVisibility
    if (!model || !visibility) return null

    const scale = this.viewport.scale.x
    const proxyContainer = new Container()
    proxyContainer.label = 'view-json-interactive-proxy'
    const groups = new Map<string, Graphics>()
    const getProxyGroup = (objectKind: ViewJsonObjectKind, layerId?: number): Graphics => {
      const key = groupKey(objectKind, layerId, 'interactive-proxy')
      let graphics = groups.get(key)
      if (!graphics) {
        graphics = new Graphics()
        graphics.label = `view-json-interactive-proxy-${key}`
        groups.set(key, graphics)
        proxyContainer.addChild(graphics)
      }
      return graphics
    }

    const overviewLevel = this.getSemanticOverviewLevelForCurrentFrame(model, scale)
    if (overviewLevel) {
      const visibleBounds = this.getVisibleBounds(model)
      const index = this.spatialIndex
      const debugCellInternalOverviewKinds = getVisibleDebugCellInternalOverviewKinds(
        visibility,
        this.displayPreset,
        scale,
      )
      const items = getViewJsonSemanticOverviewItemsInBounds(
        overviewLevel,
        visibleBounds,
        objectKind => this.isQueryableVisible(visibility, objectKind, undefined, scale),
      ).filter(rect => rect.layerId == null || (visibility.layers.get(rect.layerId) ?? true))
      if (index && debugCellInternalOverviewKinds.length > 0) {
        const visibleInstanceSources = getViewJsonRenderItemsInBounds(
          index,
          visibleBounds,
          0,
          { includeObjectKind: objectKind => objectKind === 'instances' },
        ).rects
        for (const objectKind of debugCellInternalOverviewKinds) {
          items.push(...buildViewJsonDebugCellInternalOverviewRects(
            visibleInstanceSources,
            objectKind,
            scale,
            {
              layerIdsByInstanceId: buildViewJsonDebugCellInternalLayerIdsByInstanceId(this.currentData, objectKind),
              layerVisible: layerId => layerId == null || (visibility.layers.get(layerId) ?? true),
            },
          ))
        }
      }
      const split = splitViewJsonEngineeringOverviewRects(items, model, scale)
      const overviewItems = [
        ...aggregateViewJsonOverviewRectsForKind(
          this.engineeringOverviewAggregationCache,
          split.batchRects,
          scale,
        ),
        ...split.macroOutlineRects,
        ...split.ioPinMarkerRects,
      ]
      for (const rect of limitViewJsonInteractiveProxyRects(overviewItems, undefined, { model, scale })) {
        if (rect.objectKind === 'io_pins') {
          drawViewJsonIoPinMarker(getProxyGroup(rect.objectKind, rect.layerId), rect, scale)
        } else if (rect.objectKind === 'instances' && isViewJsonOverviewMacroRect(rect, model, scale)) {
          drawViewJsonMacroOutline(getProxyGroup(rect.objectKind, rect.layerId), rect)
        } else {
          drawViewJsonRect(getProxyGroup(rect.objectKind, rect.layerId), rect, model)
        }
      }
    }

    for (const rect of model.rects) {
      if (!this.isQueryableVisible(visibility, rect.objectKind, rect.layerId, scale)) continue
      if (rect.objectKind !== 'die' && rect.objectKind !== 'core') continue
      drawViewJsonRect(getProxyGroup(rect.objectKind, rect.layerId), rect, model)
    }

    if (proxyContainer.children.length === 0) {
      proxyContainer.destroy({ children: true })
      return null
    }

    const containerIndex = this.viewport.children.indexOf(this.container)
    if (containerIndex >= 0) {
      this.viewport.addChildAt(proxyContainer, containerIndex + 1)
    } else {
      this.viewport.addChild(proxyContainer)
    }
    return { container: proxyContainer }
  }

  private createInteractiveSnapshot(): ViewJsonInteractiveSnapshot | null {
    const model = this.currentModel
    const renderer = this.snapshotRenderer
    if (!model || !renderer || !this.isInteractiveSnapshotSafe()) return null
    if (performance.now() < this.interactiveSnapshotCooldownUntil) {
      this.interactiveSnapshotSkippedCount += 1
      return null
    }

    const visibleBounds = this.getVisibleBounds(model)
    const snapshotBounds = getViewJsonInteractiveSnapshotBounds(visibleBounds)
    if (snapshotBounds.width <= 0 || snapshotBounds.height <= 0) return null
    if (getViewJsonInteractiveSnapshotPixelCount(snapshotBounds, this.viewport.scale.x) > VIEW_JSON_INTERACTIVE_SNAPSHOT_MAX_PIXELS) {
      this.interactiveSnapshotSkippedCount += 1
      this.interactiveSnapshotCooldownUntil = performance.now() + VIEW_JSON_INTERACTIVE_SNAPSHOT_RETRY_DELAY_MS
      return null
    }

    let snapshotTexture: Texture
    try {
      const snapshotStartedAt = performance.now()
      snapshotTexture = renderer.generateTexture({
        target: this.container,
        frame: new Rectangle(
          snapshotBounds.x,
          snapshotBounds.y,
          snapshotBounds.width,
          snapshotBounds.height,
        ),
        resolution: getViewJsonInteractiveSnapshotResolution(this.viewport.scale.x),
        clearColor: [0, 0, 0, 0],
        antialias: false,
      })
      const snapshotMs = performance.now() - snapshotStartedAt
      this.lastInteractiveSnapshotMs = snapshotMs
      if (snapshotMs > VIEW_JSON_INTERACTIVE_SNAPSHOT_MAX_BUILD_MS) {
        snapshotTexture.destroy(true)
        this.interactiveSnapshotSkippedCount += 1
        this.interactiveSnapshotCooldownUntil = performance.now() + VIEW_JSON_INTERACTIVE_SNAPSHOT_RETRY_DELAY_MS
        return null
      }
    } catch {
      this.interactiveSnapshotSkippedCount += 1
      this.interactiveSnapshotCooldownUntil = performance.now() + VIEW_JSON_INTERACTIVE_SNAPSHOT_RETRY_DELAY_MS
      return null
    }
    const snapshotSprite = new Sprite(snapshotTexture)
    snapshotSprite.label = 'view-json-interactive-snapshot'
    snapshotSprite.position.set(snapshotBounds.x, snapshotBounds.y)
    snapshotSprite.width = snapshotBounds.width
    snapshotSprite.height = snapshotBounds.height

    const containerIndex = this.viewport.children.indexOf(this.container)
    if (containerIndex >= 0) {
      this.viewport.addChildAt(snapshotSprite, containerIndex + 1)
    } else {
      this.viewport.addChild(snapshotSprite)
    }

    return {
      sprite: snapshotSprite,
      texture: snapshotTexture,
      bounds: snapshotBounds,
    }
  }

  private scheduleInteractiveSnapshotPrewarm(): void {
    if (!VIEW_JSON_INTERACTIVE_SNAPSHOT_ENABLED) return
    if (!this.snapshotRenderer || !this.currentModel || !this.isInteractiveSnapshotSafe()) return
    this.clearInteractiveSnapshotPrewarmTimer()
    this.interactiveSnapshotPrewarmTimer = setTimeout(() => {
      this.interactiveSnapshotPrewarmTimer = null
      if (this.prewarmedInteractiveSnapshot || !this.currentModel || !this.isInteractiveSnapshotSafe()) return
      const snapshot = this.createInteractiveSnapshot()
      if (!snapshot) return
      this.prewarmedInteractiveSnapshot = snapshot
      if (snapshot.sprite.parent === this.viewport) {
        this.viewport.removeChild(snapshot.sprite)
      }
    }, VIEW_JSON_INTERACTIVE_SNAPSHOT_PREWARM_DELAY_MS)
  }

  private isInteractiveSnapshotSafe(): boolean {
    return this.container.visible
      && this.container.children.length > 0
      && !this.interactionFrozen
      && this.redrawFrame === 0
      && this.progressiveDrawFrame === 0
      && this.pendingDetailCursor >= this.pendingDetailRects.length
  }

  private clearInteractiveSnapshotPrewarmTimer(): void {
    if (!this.interactiveSnapshotPrewarmTimer) return
    clearTimeout(this.interactiveSnapshotPrewarmTimer)
    this.interactiveSnapshotPrewarmTimer = null
  }

  private consumePrewarmedInteractiveSnapshot(): ViewJsonInteractiveSnapshot | null {
    const model = this.currentModel
    const snapshot = this.prewarmedInteractiveSnapshot
    if (!model || !snapshot) return null
    this.prewarmedInteractiveSnapshot = null

    const currentBounds = this.getVisibleBounds(model)
    if (!isVisibleBoundsInside(currentBounds, snapshot.bounds)) {
      destroyViewJsonInteractiveSnapshot(snapshot, this.viewport)
      this.interactiveSnapshotSkippedCount += 1
      return null
    }

    const containerIndex = this.viewport.children.indexOf(this.container)
    if (containerIndex >= 0) {
      this.viewport.addChildAt(snapshot.sprite, containerIndex + 1)
    } else {
      this.viewport.addChild(snapshot.sprite)
    }
    return snapshot
  }

  private destroyPrewarmedInteractiveSnapshot(): void {
    this.clearInteractiveSnapshotPrewarmTimer()
    if (!this.prewarmedInteractiveSnapshot) return
    destroyViewJsonInteractiveSnapshot(this.prewarmedInteractiveSnapshot, this.viewport)
    this.prewarmedInteractiveSnapshot = null
  }

  private endInteractiveFreeze(): boolean {
    this.clearInteractiveFreezeWatchdogTimer()
    const forceRedraw = shouldForceRedrawAfterInteractiveFreeze(
      this.interactiveFreezeStartScale,
      this.viewport.scale.x,
    )
    this.interactiveFreezeStartScale = null
    this.lastInteractiveViewportEventAt = null
    this.interactionFrozen = false
    this.destroyInteractiveProxy()
    if (!this.interactiveSnapshot) {
      this.container.visible = true
      return forceRedraw
    }

    destroyViewJsonInteractiveSnapshot(this.interactiveSnapshot, this.viewport)
    this.interactiveSnapshot = null
    this.container.visible = true
    return forceRedraw
  }

  private destroyInteractiveProxy(): void {
    if (!this.interactiveProxy) return
    destroyViewJsonInteractiveProxy(this.interactiveProxy, this.viewport)
    this.interactiveProxy = null
  }

  private getVisibleBounds(model: ViewJsonRenderModel): ViewJsonVisibleBounds {
    const viewportBounds = this.viewport.getVisibleBounds()
    return {
      x: Number.isFinite(viewportBounds.x) ? viewportBounds.x : 0,
      y: Number.isFinite(viewportBounds.y) ? viewportBounds.y : 0,
      width: Number.isFinite(viewportBounds.width) && viewportBounds.width > 0
        ? viewportBounds.width
        : model.worldWidth,
      height: Number.isFinite(viewportBounds.height) && viewportBounds.height > 0
        ? viewportBounds.height
        : model.worldHeight,
    }
  }

  private isRenderableVisible(
    visibility: ViewJsonVisibilityState,
    objectKind: ViewJsonObjectKind,
    layerId: number | undefined,
    scale: number,
  ): boolean {
    return this.isQueryableVisible(visibility, objectKind, layerId, scale)
  }

  private isQueryableVisible(
    visibility: ViewJsonVisibilityState,
    objectKind: ViewJsonObjectKind,
    layerId: number | undefined,
    scale: number,
  ): boolean {
    return isViewJsonRenderableVisible(visibility, objectKind, layerId)
      && isViewJsonObjectKindQueryableAtScale(objectKind, scale, this.displayPreset)
  }

  private isDetailVisible(
    visibility: ViewJsonVisibilityState,
    objectKind: ViewJsonObjectKind,
    layerId: number | undefined,
    scale: number,
  ): boolean {
    return isViewJsonRenderableVisible(visibility, objectKind, layerId)
      && getViewJsonObjectDisplayMode(objectKind, scale, this.displayPreset) === 'detail'
  }

  private getVisibleLazyKinds(
    visibility: ViewJsonVisibilityState,
    scale: number,
  ): Set<ViewJsonObjectKind> {
    const visibleLazyKinds = new Set<ViewJsonObjectKind>()
    for (const kind of ['vias', 'cell_pins', 'cell_obs'] as const) {
      if (this.isDetailVisible(visibility, kind, undefined, scale)) {
        visibleLazyKinds.add(kind)
      }
    }
    return visibleLazyKinds
  }

  private getVisibleRenderCacheSignature(
    bounds: ViewJsonVisibleBounds,
    visibility: ViewJsonVisibilityState,
    lazyKinds: Set<ViewJsonObjectKind>,
    scale: number,
    renderRoutingOverviewFallback: boolean,
  ): string {
    const layers = [...visibility.layers.entries()]
      .filter(([, visible]) => !visible)
      .map(([layerId]) => layerId)
      .join(',')
    return [
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      detailScaleEnabled(scale),
      shouldRenderEngineeringOverview(scale),
      renderRoutingOverviewFallback,
      getViewJsonSemanticOverviewLevelKey(scale),
      this.displayPreset,
      [...lazyKinds].sort().join(','),
      layers,
    ].join(':')
  }

  private getGroup(objectKind: ViewJsonObjectKind, layerId?: number): GraphicsGroup {
    const key = groupKey(objectKind, layerId)
    const existing = this.groups.get(key)
    if (existing) return existing

    const graphics = new Graphics()
    graphics.label = `view-json-${key}`
    const group = { key, objectKind, layerId, graphics }
    this.groups.set(key, group)
    this.container.addChild(graphics)
    return group
  }

  private renderInstanceMeshBatches(rects: ViewJsonRectRenderable[], model: ViewJsonRenderModel): number {
    let meshCount = 0
    const activeKeys = new Set<string>()
    const flatCoverageCellSize = getViewJsonInstanceAggregateCellSize(this.viewport.scale.x)
    for (const [key, batchRects] of groupViewJsonInstanceRectsForBatching(rects)) {
      const buffers = this.rectBatchCache.getBuffers(key, batchRects, {
        flattenSingleAlphaCoverage: true,
        flatCoverageCellSize,
      })
      if (buffers.rectCount === 0) continue

      activeKeys.add(key)
      const existing = this.instanceMeshes.get(key)
      if (existing?.buffers === buffers) {
        if (existing.mesh.parent !== this.container) {
          this.container.addChild(existing.mesh)
        }
        meshCount += 1
        continue
      }

      if (existing) {
        this.destroyInstanceMesh(existing)
      }

      const geometry = new MeshGeometry({
        positions: buffers.positions,
        uvs: buffers.uvs,
        indices: buffers.indices,
        shrinkBuffersToFit: true,
      })
      const objectKind = batchRects[0]?.objectKind ?? 'instances'
      const mesh = new Mesh({
        geometry,
        texture: Texture.WHITE,
        label: `view-json-instance-mesh-${key}`,
        tint: colorForLayer(model, undefined),
        alpha: alphaForKind(objectKind),
      })
      this.container.addChild(mesh)
      this.instanceMeshes.set(key, { key, mesh, buffers })
      meshCount += 1
    }
    this.reconcileInstanceMeshes(activeKeys)
    return meshCount
  }

  private renderEngineeringOverviewBatches(
    rects: ViewJsonRectRenderable[],
    model: ViewJsonRenderModel,
    scale: number,
  ): number {
    let meshCount = 0
    const activeKeys = new Set<string>()
    const renderable = rects.filter(rect => rect.world.w > 0 && rect.world.h > 0)
    for (const [key, batchRects] of groupViewJsonRectsForBatchingByKind(renderable)) {
      const objectKind = batchRects[0]?.objectKind ?? 'instances'
      const buffers = this.engineeringOverviewBatchCache.getBuffers(key, batchRects, {
        flattenSingleAlphaCoverage: true,
        flatCoverageCellSize: getViewJsonOverviewCellSizeForKind(objectKind, scale),
      })
      if (buffers.rectCount === 0) continue

      activeKeys.add(key)
      const existing = this.engineeringOverviewMeshes.get(key)
      if (existing?.buffers === buffers) {
        if (existing.mesh.parent !== this.container) {
          this.container.addChild(existing.mesh)
        }
        meshCount += 1
        continue
      }

      if (existing) {
        this.destroyEngineeringOverviewMesh(existing)
      }

      const geometry = new MeshGeometry({
        positions: buffers.positions,
        uvs: buffers.uvs,
        indices: buffers.indices,
        shrinkBuffersToFit: true,
      })
      const mesh = new Mesh({
        geometry,
        texture: Texture.WHITE,
        label: `view-json-overview-mesh-${key}`,
        tint: colorForOverviewKind(model, objectKind, batchRects[0]?.layerId),
        alpha: alphaForOverviewKind(objectKind),
      })
      this.container.addChild(mesh)
      this.engineeringOverviewMeshes.set(key, { key, mesh, buffers })
      meshCount += 1
    }
    this.reconcileEngineeringOverviewMeshes(activeKeys)
    return meshCount
  }

  private reconcileInstanceMeshes(activeKeys: Set<string>): number {
    for (const meshGroup of this.instanceMeshes.values()) {
      if (!activeKeys.has(meshGroup.key)) {
        this.destroyInstanceMesh(meshGroup)
        this.instanceMeshes.delete(meshGroup.key)
      }
    }
    return activeKeys.size
  }

  private reconcileEngineeringOverviewMeshes(activeKeys: Set<string>): number {
    for (const meshGroup of this.engineeringOverviewMeshes.values()) {
      if (!activeKeys.has(meshGroup.key)) {
        this.destroyEngineeringOverviewMesh(meshGroup)
        this.engineeringOverviewMeshes.delete(meshGroup.key)
      }
    }
    return activeKeys.size
  }

  private clearInstanceMeshes(): void {
    for (const meshGroup of this.instanceMeshes.values()) {
      this.destroyInstanceMesh(meshGroup)
    }
    this.instanceMeshes.clear()
  }

  private clearEngineeringOverviewMeshes(): void {
    for (const meshGroup of this.engineeringOverviewMeshes.values()) {
      this.destroyEngineeringOverviewMesh(meshGroup)
    }
    this.engineeringOverviewMeshes.clear()
  }

  private destroyInstanceMesh(meshGroup: InstanceMeshGroup): void {
    const { mesh } = meshGroup
    const { geometry } = mesh
    if (mesh.parent === this.container) {
      this.container.removeChild(mesh)
    }
    mesh.destroy()
    geometry.destroy()
  }

  private destroyEngineeringOverviewMesh(meshGroup: EngineeringOverviewMeshGroup): void {
    const { mesh } = meshGroup
    const { geometry } = mesh
    if (mesh.parent === this.container) {
      this.container.removeChild(mesh)
    }
    mesh.destroy()
    geometry.destroy()
  }

  private clearGroups({ keepInstanceMeshes = false }: { keepInstanceMeshes?: boolean } = {}): void {
    if (!keepInstanceMeshes) {
      this.clearInstanceMeshes()
      this.clearEngineeringOverviewMeshes()
    }
    for (const group of this.groups.values()) {
      group.graphics.destroy()
    }
    this.groups.clear()
    if (keepInstanceMeshes) {
      for (const child of [...this.container.children]) {
        if (child instanceof Graphics) {
          this.container.removeChild(child)
        }
      }
    } else {
      this.container.removeChildren()
    }
  }

  private scheduleProgressiveDraw(): void {
    if (this.progressiveDrawFrame !== 0) return
    if (this.pendingDetailCursor >= this.pendingDetailRects.length) {
      this.scheduleInteractiveSnapshotPrewarm()
      return
    }
    this.progressiveDrawFrame = requestAnimationFrame(() => {
      this.progressiveDrawFrame = 0
      this.drawProgressiveDetailFrame()
    })
  }

  private drawProgressiveDetailFrame(): void {
    const model = this.currentModel
    if (!model) return
    this.options.requestRenderActive?.()
    const startedAt = performance.now()
    const frameBudgetMs = 6
    while (
      this.pendingDetailCursor < this.pendingDetailRects.length
      && performance.now() - startedAt < frameBudgetMs
    ) {
      const rect = this.pendingDetailRects[this.pendingDetailCursor]
      this.pendingDetailCursor += 1
      drawViewJsonRect(this.getGroup(rect.objectKind, rect.layerId).graphics, rect, model)
    }
    this.drawMs += performance.now() - startedAt
    this.scheduleProgressiveDraw()
  }

  private cancelProgressiveDraw(): void {
    if (this.progressiveDrawFrame !== 0) {
      cancelAnimationFrame(this.progressiveDrawFrame)
      this.progressiveDrawFrame = 0
    }
    this.pendingDetailRects = []
    this.pendingDetailCursor = 0
  }
}

export const __viewJsonFullRendererInternals = {
  drawViewJsonGuide,
  drawViewJsonOutlineRect,
  drawViewJsonPath,
  drawViewJsonRect,
  expandVisibleBounds,
  isVisibleBoundsInside,
  shouldRenderInstancesAsMesh,
  VIEW_JSON_INSTANCE_MESH_MAX_SCALE,
  getViewJsonInstanceAggregateCellSize,
  VIEW_JSON_INSTANCE_AGGREGATE_MAX_SCALE,
  getViewJsonRenderQueryPadding,
  VIEW_JSON_DRAG_QUERY_PADDING_SCALE,
  VIEW_JSON_MIN_DRAG_QUERY_PADDING,
  shouldRenderEngineeringOverview,
  getViewJsonOverviewCellSize,
  VIEW_JSON_OVERVIEW_SCREEN_CELL_PX,
  getViewJsonOverviewCellSizeForKind,
  VIEW_JSON_REGULAR_WIRE_OVERVIEW_SCREEN_CELL_PX,
  VIEW_JSON_DEBUG_CELL_INTERNAL_OVERVIEW_SCREEN_CELL_PX,
  shouldRenderDebugCellInternalOverview,
  buildViewJsonDebugCellInternalOverviewRects,
  buildViewJsonDebugCellInternalLayerIdsByInstanceId,
  getVisibleDebugCellInternalOverviewKinds,
  aggregateViewJsonOverviewRectsForKind,
  splitViewJsonEngineeringOverviewRects,
  getViewJsonOverviewMarkerSize,
  shouldDrawViewJsonIoPinMarker,
  isViewJsonOverviewMacroRect,
  getViewJsonInteractiveSnapshotBounds,
  getViewJsonInteractiveSnapshotResolution,
  getViewJsonInteractiveSnapshotPixelCount,
  VIEW_JSON_INTERACTIVE_SNAPSHOT_MAX_PIXELS,
  VIEW_JSON_INTERACTIVE_SNAPSHOT_ENABLED,
  shouldForceRedrawAfterInteractiveFreeze,
  VIEW_JSON_INTERACTIVE_SNAPSHOT_PADDING_RATIO,
  VIEW_JSON_INTERACTIVE_SNAPSHOT_RESOLUTION_SCALE,
  VIEW_JSON_INTERACTIVE_SNAPSHOT_MAX_BUILD_MS,
  VIEW_JSON_INTERACTIVE_SNAPSHOT_RETRY_DELAY_MS,
  VIEW_JSON_INTERACTIVE_SNAPSHOT_PREWARM_DELAY_MS,
  VIEW_JSON_INTERACTIVE_FREEZE_IDLE_TIMEOUT_MS,
  VIEW_JSON_INTERACTIVE_PROXY_MAX_RECTS,
  limitViewJsonInteractiveProxyRects,
  VIEW_JSON_ENGINEERING_OVERVIEW_MAX_RECTS,
  VIEW_JSON_LAZY_DETAIL_MAX_RECTS,
  VIEW_JSON_VISIBLE_RENDER_CACHE_MAX_ITEMS,
  VIEW_JSON_FULL_DETAIL_MODEL_MIN_SCALE,
  shouldCacheVisibleRenderResult,
  limitViewJsonEngineeringOverviewRects,
  VIEW_JSON_SEMANTIC_OVERVIEW_PREWARM_SCALES,
  getSemanticOverviewPrewarmScalesForScale,
  shouldUseViewJsonFullDetailModel,
  shouldUseLegacyFullDetailModel,
  hasViewJsonGeometryTiles,
  shouldReleaseViewJsonFullDetailModel,
  shouldCancelViewJsonFullDetailModelBuild,
  shouldSwitchViewJsonFullDetailModelToLightweight,
  shouldExpireViewJsonInteractiveFreeze,
  viewJsonPackageWithRoutingDetail,
  isViewJsonRoutingOverviewFallbackKind,
  getViewJsonFullRendererRenderMode,
  VIEW_JSON_DETAIL_LOD_MIN_SCALE,
  alphaForKind,
  alphaForOverviewKind,
  colorForLayer,
  colorForOverviewKind,
  getViewJsonOverviewWeightBucket,
}
