// ============================================================
// Raw JSON types (matching backend response format exactly)
// ============================================================

/** Raw Header JSON as returned by the backend */
export interface RawHeaderJSON {
  header: string
  lastModify: string
  libname: string
  units: string
  version: string
  'design name': string
  diearea: { path: number[][] }
  layerInfo: RawLayerDef[]
}

export interface RawLayerDef {
  id: number
  layername: string
}

/** Raw Data JSON as returned by the backend */
export interface RawDataJSON {
  data: RawGroup[]
}

export interface RawGroup {
  type: 'group'
  'struct name': string
  children: RawBox[]
}

export interface RawBox {
  type: 'box'
  id: string
  layer: number
  path: number[][]
}

// ============================================================
// Parsed frontend data model
// ============================================================

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface LayerDef {
  id: number
  layername: string
}

export enum GroupType {
  Cell = 'Cell',
  PowerNet = 'PowerNet',
  SignalNet = 'SignalNet',
}

export interface LayoutBox {
  type: 'box'
  id: string
  layer: number
  path: number[][]
  rect: Rect
  /** Index of the parent group in the groups array */
  groupIndex: number
}

export interface LayoutGroup {
  type: 'group'
  structName: string
  groupType: GroupType
  children: LayoutBox[]
  /** Bounding box covering all children */
  bbox: Rect
}

export interface LayoutHeader {
  designName: string
  version: string
  lastModify: string
  /** DBU per micron (e.g. 1000 means 1μm = 1000 DBU) */
  dbuPerMicron: number
  dieArea: Rect
  layerInfo: Map<number, LayerDef>
  /** Ordered array of layer defs for iteration */
  layerList: LayerDef[]
}

// ============================================================
// Utility functions
// ============================================================

/**
 * Extract a Rect from a 5-point closed path [[x1,y1],[x2,y2],[x3,y3],[x4,y4],[x1,y1]].
 * Handles any rotation of the 4 corner points.
 */
export function pathToRect(path: number[][]): Rect {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  // Use first 4 points (5th is duplicate of 1st)
  const count = Math.min(path.length, 4)
  for (let i = 0; i < count; i++) {
    const px = path[i][0]
    const py = path[i][1]
    if (px < minX) minX = px
    if (py < minY) minY = py
    if (px > maxX) maxX = px
    if (py > maxY) maxY = py
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

/** Convert DBU value to microns */
export function dbuToMicron(dbu: number, dbuPerMicron: number): number {
  return dbu / dbuPerMicron
}

/** Convert microns to DBU */
export function micronToDbu(micron: number, dbuPerMicron: number): number {
  return micron * dbuPerMicron
}

/** Format a DBU value as a micron string (e.g. "84.710 μm") */
export function formatMicron(dbu: number, dbuPerMicron: number, decimals = 3): string {
  return `${dbuToMicron(dbu, dbuPerMicron).toFixed(decimals)} μm`
}

/**
 * Classify a group by its struct name.
 */
export function classifyGroup(structName: string): GroupType {
  if (structName.startsWith('Instance')) return GroupType.Cell

  const upper = structName.toUpperCase()
  if (upper === 'VDD' || upper === 'VSS' || upper === 'VDDIO' || upper === 'VSSIO') {
    return GroupType.PowerNet
  }

  return GroupType.SignalNet
}

/**
 * Parse the "units" field from the header (e.g. "0.001 1e-09").
 * Returns dbuPerMicron.
 */
export function parseUnits(units: string): number {
  const parts = units.trim().split(/\s+/)
  const micronsPerDbu = parseFloat(parts[0])
  if (!isFinite(micronsPerDbu) || micronsPerDbu <= 0) {
    return 1000 // safe fallback
  }
  return Math.round(1 / micronsPerDbu)
}
