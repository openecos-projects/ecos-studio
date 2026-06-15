export type TechBBox = [number, number, number, number]
export type TechPoint = [number, number]

export interface TechJsonFile {
  schema?: unknown
  kind?: unknown
  count?: unknown
  data?: unknown
  name_to_id?: Record<string, number>
}

export interface TechLayer {
  id: number
  name: string
  type: string
  order: number
  direction: string
}

export interface TechSite {
  id: number
  name: string
  class: string
  size: TechPoint
  orient: string
  symmetry: string[]
}

export interface TechLayerRects {
  layer_id: number
  rects: TechBBox[]
}

export interface TechViaMaster {
  id: number
  name: string
  type: string
  is_default: boolean
  cut_rows: number
  cut_cols: number
  shapes: TechLayerRects[]
}

export interface TechPin {
  name: string
  direction: string
  use: string
  ports: TechLayerRects[]
}

export interface TechCellMaster {
  id: number
  name: string
  type: string
  origin: TechPoint
  size: TechPoint
  site: string
  symmetry: string[]
  pins: TechPin[]
  obs: TechLayerRects[]
}

export interface TechLibrarySummary {
  pdk: string
  design: string
  packageRoot: string
  layerCount: number
  siteCount: number
  viaCount: number
  cellMasterCount: number
}

export interface TechLibraryData {
  summary: TechLibrarySummary
  layers: TechLayer[]
  sites: TechSite[]
  vias: TechViaMaster[]
  cellMasters: TechCellMaster[]
  layerById: Map<number, TechLayer>
  cellMasterById: Map<number, TechCellMaster>
}

export interface TechPreviewRect {
  layerId: number
  kind: 'pin' | 'obs' | 'via'
  name: string
  world: { x: number; y: number; w: number; h: number }
}

export interface TechPreviewGeometry {
  bounds: { x: number; y: number; w: number; h: number }
  rects: TechPreviewRect[]
}
