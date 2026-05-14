export interface DieArea {
  x: number
  y: number
  w: number
  h: number
}

export interface TileConfig {
  tilePixelSize: number
  minZ: number
  maxZ: number
  rasterMaxZ: number
  rasterFormat: string
  vectorFormat: string
}

export interface LayerDef {
  id: number
  name: string
  originalLayerId: number
  zOrder: number
  color: string
  alpha: number
}

export interface FileRef {
  path: string
  size: number
  hash: string
}

export interface TileManifest {
  version: number
  designName: string
  dbuPerMicron: number
  dieArea: DieArea
  tileConfig: TileConfig
  layers: LayerDef[]
  cellsFile: FileRef
  globalFile: FileRef
  stats: {
    totalInstances: number
    uniqueCellTypes: number
    totalBoxes: number
    minFeatureDbu: number
    generatedAt: string
  }
}
