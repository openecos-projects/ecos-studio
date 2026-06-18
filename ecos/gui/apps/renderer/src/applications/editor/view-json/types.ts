export type ViewJsonPoint = [number, number]
export type ViewJsonBBox = [number, number, number, number]
export type ViewJsonOrient =
  | 'N_R0'
  | 'S_R180'
  | 'W_R90'
  | 'E_R270'
  | 'FN_MY'
  | 'FS_MX'
  | 'FW_MX90'
  | 'FE_MY90'
  | 'N'
  | 'S'
  | 'W'
  | 'E'
  | 'FN'
  | 'FS'
  | 'FW'
  | 'FE'
  | string

export type ViewJsonObjectKind =
  | 'die'
  | 'core'
  | 'rows'
  | 'tracks'
  | 'gcell_grids'
  | 'instances'
  | 'io_pins'
  | 'regular_wires'
  | 'special_wires'
  | 'vias'
  | 'blockages'
  | 'fills'
  | 'regions'
  | 'cell_pins'
  | 'cell_obs'

export interface ViewJsonVisibilityState {
  objectKinds: Record<ViewJsonObjectKind, boolean>
  layers: Map<number, boolean>
}

export interface ViewJsonWorldRect {
  x: number
  y: number
  w: number
  h: number
}

export interface ViewJsonWorldPoint {
  x: number
  y: number
}

export interface ViewJsonLayerShape {
  layer_id: number
  rects: ViewJsonBBox[]
}

export interface ViewJsonPort extends ViewJsonLayerShape {}

export interface ViewJsonViaPlacement {
  via_master_id: number
  origin: ViewJsonPoint
  orient?: ViewJsonOrient
}

export interface ViewJsonLayer {
  id: number
  name: string
  type?: string
  order?: number
  direction?: string
}

export interface ViewJsonViaMaster {
  id: number
  name: string
  type?: string
  shapes: ViewJsonLayerShape[]
}

export interface ViewJsonCellMasterPin {
  name: string
  direction?: string
  use?: string
  ports: ViewJsonPort[]
}

export interface ViewJsonCellMasterObs {
  layer_id: number
  rects: ViewJsonBBox[]
}

export interface ViewJsonCellMaster {
  id: number
  name: string
  type?: string
  origin?: ViewJsonPoint
  size: ViewJsonPoint
  pins: ViewJsonCellMasterPin[]
  obs: ViewJsonCellMasterObs[]
}

export interface ViewJsonDieData {
  die_area: ViewJsonBBox
  core_area?: ViewJsonBBox | null
}

export interface ViewJsonInstance {
  id: number
  name: string
  master_id: number
  origin: ViewJsonPoint
  orient: ViewJsonOrient
  status?: string
  type?: string
  bbox: ViewJsonBBox
  region?: string
}

export interface ViewJsonIoPin {
  id: number
  name: string
  net_id?: number | null
  special_net_id?: number | null
  location?: ViewJsonPoint
  orient?: ViewJsonOrient
  ports: ViewJsonPort[]
  vias?: ViewJsonViaPlacement[]
  bbox?: ViewJsonBBox
  layers?: number[]
}

export type ViewJsonWireSegmentKind = 'path' | 'patch' | 'via' | string

export interface ViewJsonWireSegment {
  id: number
  net_id?: number
  special_net_id?: number
  wire_index?: number
  segment_index?: number
  wire_state?: string
  kind: ViewJsonWireSegmentKind
  layer_id?: number
  width?: number
  points?: ViewJsonPoint[]
  rect?: ViewJsonBBox
  via_master_id?: number
  origin?: ViewJsonPoint
  orient?: ViewJsonOrient
  bbox?: ViewJsonBBox
  layers?: number[]
}

export interface ViewJsonRow {
  id: number
  name?: string
  site?: string
  origin?: ViewJsonPoint
  orient?: ViewJsonOrient
  num?: ViewJsonPoint
  step?: ViewJsonPoint
  bbox: ViewJsonBBox
}

export interface ViewJsonTrackGrid {
  id: number
  direction: 'X' | 'Y' | string
  start: number
  count: number
  step: number
  width?: number
  layer_ids?: number[]
  layer_id?: number
}

export interface ViewJsonGCellGrid {
  id: number
  direction: 'X' | 'Y' | string
  start: number
  count: number
  step: number
}

export interface ViewJsonRectObject {
  id: number
  layer_id?: number
  rect?: ViewJsonBBox
  bbox?: ViewJsonBBox
}

export interface ViewJsonRegion {
  id: number
  name?: string
  rects?: ViewJsonBBox[]
  bbox?: ViewJsonBBox
}

export interface ViewJsonManifest {
  schema: string
  format: string
  version?: number
  design_name?: string
  unit?: {
    coord?: string
    dbu_per_micron?: number
    micron_per_dbu?: number
  }
  bbox?: ViewJsonBBox
  files: Record<string, string>
  counts?: Record<string, number>
  capabilities?: Record<string, unknown>
}

export interface ViewJsonGeometryTileRef {
  id: string
  bbox: ViewJsonBBox
  file: string
  byte_size?: number
  hash?: string
  counts?: Partial<Record<ViewJsonObjectKind, number>>
  layers?: number[]
}

export interface ViewJsonGeometryTileIndex {
  schema: 'ieda.view.v1'
  kind: 'geometry_tile_index'
  version: number
  encoding: 'ecostudio.view_geometry_tile.bin.v1' | string
  world_bbox: ViewJsonBBox
  tile_config?: {
    columns?: number
    rows?: number
    max_tile_primitives?: number
    max_tile_bytes?: number
    max_tiles_per_object?: number
  }
  tiles: ViewJsonGeometryTileRef[]
  large_objects?: {
    file: string
    count: number
    byte_size?: number
    hash?: string
  }
  source?: {
    manifest_hash?: string
    generated_at?: string
    generator?: string
  }
}

export interface ViewJsonGeometryTileRect {
  id: string
  objectKind: ViewJsonObjectKind | string
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
  rects: ViewJsonGeometryTileRect[]
  paths: ViewJsonGeometryTilePath[]
}

export interface ViewJsonPackageData {
  packageRoot?: string
  manifest: ViewJsonManifest
  dbuPerMicron: number
  die: ViewJsonDieData
  worldWidth: number
  worldHeight: number
  layers: ViewJsonLayer[]
  vias: ViewJsonViaMaster[]
  cellMasters: ViewJsonCellMaster[]
  rows: ViewJsonRow[]
  tracks: ViewJsonTrackGrid[]
  gcellGrids: ViewJsonGCellGrid[]
  instances: ViewJsonInstance[]
  ioPins: ViewJsonIoPin[]
  regularWires: ViewJsonWireSegment[]
  specialWires: ViewJsonWireSegment[]
  blockages: ViewJsonRectObject[]
  fills: ViewJsonRectObject[]
  regions: ViewJsonRegion[]
  layerById: Map<number, ViewJsonLayer>
  viaById: Map<number, ViewJsonViaMaster>
  cellMasterById: Map<number, ViewJsonCellMaster>
  overview?: ViewJsonPackageOverview
  routingDetailAvailable?: boolean
  geometryTileIndex?: ViewJsonGeometryTileIndex
  loadStats: ViewJsonCompleteLoadStats
}

export interface ViewJsonPackageOverview {
  routing: ViewJsonRectRenderable[]
  countsByObjectKind: Partial<Record<ViewJsonObjectKind, number>>
  preaggregated?: boolean
}

export interface ViewJsonRoutingDetail {
  regularWires: ViewJsonWireSegment[]
  specialWires: ViewJsonWireSegment[]
  overview: ViewJsonPackageOverview
  countsByObjectKind: Partial<Record<ViewJsonObjectKind, number>>
}

export interface ViewJsonCompleteLoadStats {
  readMs: number
  parseMs: number
  transformMs: number
  chunkMs: number
  totalMs: number
}

export interface ViewJsonRectRenderable {
  id: string
  objectKind: ViewJsonObjectKind
  sourceId: number
  layerId?: number
  eda: ViewJsonBBox
  world: ViewJsonWorldRect
  overviewWeight?: number
  overviewDirection?: 'horizontal' | 'vertical' | 'point' | 'mixed'
}

export interface ViewJsonLazyCellGeometrySource {
  instanceId: number
  masterId: number
  origin: ViewJsonPoint
  orient: ViewJsonOrient
  bbox: ViewJsonBBox
}

export interface ViewJsonLazyViaGeometrySource {
  idPrefix: string
  sourceId: number
  viaMasterId: number
  origin: ViewJsonPoint
  orient?: ViewJsonOrient
  bbox: ViewJsonBBox
}

export interface ViewJsonLazyGeometry {
  cellInstances: ViewJsonLazyCellGeometrySource[]
  vias: ViewJsonLazyViaGeometrySource[]
}

export interface ViewJsonPathRenderable {
  id: string
  objectKind: 'regular_wires' | 'special_wires'
  sourceId: number
  layerId: number
  width: number
  edaPoints: ViewJsonPoint[]
  worldPoints: ViewJsonWorldPoint[]
}

export interface ViewJsonGuideRenderable {
  id: string
  objectKind: 'tracks' | 'gcell_grids'
  sourceId: number
  layerId?: number
  direction: string
  worldPoints: ViewJsonWorldPoint[]
}

export interface ViewJsonRenderModel {
  dbuPerMicron: number
  worldWidth: number
  worldHeight: number
  layers: ViewJsonLayer[]
  layerById: Map<number, ViewJsonLayer>
  rects: ViewJsonRectRenderable[]
  paths: ViewJsonPathRenderable[]
  guides: ViewJsonGuideRenderable[]
  lazyGeometry?: ViewJsonLazyGeometry
  countsByObjectKind: Record<ViewJsonObjectKind, number>
}
