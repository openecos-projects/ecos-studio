// manifest.json 的 TypeScript 类型定义
// 对应后端生成的 manifest.json 格式

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
  rasterFormat: string  // 'png' | 'webp'
  vectorFormat: string  // 'bin'
}

export interface LayerDef {
  id: number           // 0-based index = layerIdx in bin files
  name: string
  originalLayerId?: number
  zOrder: number
  color: string        // hex, e.g. '#4169e1'
  alpha: number        // 0-1
}

export interface FileRef {
  path: string
  size: number
  hash: string
}

export interface Manifest {
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
    uniqueCellTypes?: number
    totalBoxes?: number
    generatedAt: string
  }
}

// cells.bin 解析出的 cell 定义
export interface LocalRect {
  lx: number
  ly: number
  lw: number
  lh: number
}

export interface CellLayerData {
  layerIdx: number    // 0-based index into manifest.layers
  rects: LocalRect[]
}

export interface CellDef {
  cellId:   number
  bboxW:    number
  bboxH:    number
  layers:   CellLayerData[]
  /** layerIdx → rects，O(1) 查找，由 CellDefStore 在解析时构建 */
  layerMap: Map<number, LocalRect[]>
}

// vector tile 解析出的 instance
export interface TileInstance {
  instanceId: number
  cellId:     number
  originX:    number
  originY:    number
  orient:     number  // 0=N, 1=S, 2=E, 3=W, 4=FN, 5=FS, 6=FE, 7=FW
}

// Section C: flat geometry (routing wires 等无层次几何)
export interface FlatRect {
  x: number; y: number; w: number; h: number
}

export interface FlatLayerGroup {
  layerIdx:  number
  direction: number   // 0=H, 1=V, 2=mixed
  wireWidth: number
  rects:     FlatRect[]
}

// vector tile 解析结果
export interface ParsedVectorTile {
  instances:  TileInstance[]
  flatLayers: FlatLayerGroup[]
}

// global.bin 解析出的大跨度形状
export interface GlobalShape {
  shapeId:  number
  layerIdx: number
  type:     number  // 0=power_stripe, 1=ground_stripe, 2=io_pin, 3=blockage
  nameIdx:  number
  x: number; y: number; w: number; h: number
}

export const GLOBAL_SHAPE_TYPE = {
  POWER_STRIPE:  0,
  GROUND_STRIPE: 1,
  IO_PIN:        2,
  BLOCKAGE:      3,
} as const

// Rect utility used across the tile system
export interface Rect {
  x: number; y: number; w: number; h: number
}

// RBush node for instance-level spatial index
export interface InstanceRef {
  minX: number; minY: number; maxX: number; maxY: number
  cellId:      number
  instanceId:  number
  instanceIdx: number
  tileKey:     string
  source:      'tile' | 'global' | 'edit'
}

// RBush node for flat segment (routing wire) spatial index
export interface FlatSegRef {
  minX: number; minY: number; maxX: number; maxY: number
  tileKey:   string
  layerIdx:  number
  wireWidth: number
  direction: number
  segKey:    string   // unique key: `${layerIdx}:${x}:${y}:${w}:${h}`
  rx: number; ry: number; rw: number; rh: number  // original rect coords
}

// Viewport state for animation
export interface ViewportState {
  centerX: number
  centerY: number
  scale:   number
}

// Edit operation (command pattern)
export interface EditOperation {
  type:   'add' | 'delete' | 'move'
  apply:  () => void
  revert: () => void
}

// PreparedLayer: pre-computed from LayerDef for rendering
export interface PreparedLayer {
  id:    number
  color: number
  alpha: number
  name:  string
}
