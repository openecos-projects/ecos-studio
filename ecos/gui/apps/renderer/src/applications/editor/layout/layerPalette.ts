import type { ViewJsonObjectKind } from '../view-json/types'

export const EDA_LAYER_COLORS: Record<string, number> = {
  OVERLAP: 0x6b7280,
  ACT: 0xb8794d,
  NP: 0x79a85c,
  PP: 0x55a886,
  NW1: 0x5aa6ad,
  POLY: 0xc96f54,
  CT: 0x8b949e,
  MET1: 0x4f73c8,
  VIA1: 0x7b8290,
  MET2: 0xc76464,
  VIA2: 0x858b96,
  MET3: 0x4d9b79,
  VIA3: 0x91959c,
  MET4: 0xc59a45,
  VIA4: 0x9d9a94,
  MET5: 0xa866a8,
  T4V2: 0x767c84,
  T4M2: 0x8a7562,
  RV: 0x6f757d,
  RDL: 0x4f9b87,
}

export const EDA_FALLBACK_LAYER_COLORS = [
  0x4f73c8,
  0xc76464,
  0x4d9b79,
  0xc59a45,
  0x5aa6ad,
  0xa866a8,
  0x8a7562,
]

export const EDA_OBJECT_COLORS = {
  die: 0x526173,
  core: 0x2f7f75,
  rows: 0x8794a3,
  instances: 0x667085,
  ioPins: 0x00a88f,
  specialWires: 0xb9872c,
  vias: 0x7a7288,
  blockages: 0xb45b5b,
  regions: 0x4d8aaa,
  fills: 0x94a3b8,
  cellPins: 0x2f9e8b,
  cellObs: 0x8d7d67,
  macro: 0x2f7f75,
}

export function getEdaObjectKindColor(objectKind: ViewJsonObjectKind): number {
  switch (objectKind) {
    case 'die':
      return EDA_OBJECT_COLORS.die
    case 'core':
      return EDA_OBJECT_COLORS.core
    case 'rows':
      return EDA_OBJECT_COLORS.rows
    case 'instances':
      return EDA_OBJECT_COLORS.instances
    case 'io_pins':
      return EDA_OBJECT_COLORS.ioPins
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
    case 'regular_wires':
    case 'tracks':
    case 'gcell_grids':
    default:
      return EDA_OBJECT_COLORS.fills
  }
}

export function getEdaLayerColor(layerName: string | undefined, fallbackIndex = 0): number {
  const normalized = layerName?.trim().toUpperCase()
  if (normalized && EDA_LAYER_COLORS[normalized] !== undefined) {
    return EDA_LAYER_COLORS[normalized]
  }
  return EDA_FALLBACK_LAYER_COLORS[Math.max(fallbackIndex, 0) % EDA_FALLBACK_LAYER_COLORS.length]
}

export function numberColorToCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

export function getEdaLayerColorCss(layerName: string | undefined, fallbackIndex = 0): string {
  return numberColorToCss(getEdaLayerColor(layerName, fallbackIndex))
}

export function getEdaObjectKindColorCss(objectKind: ViewJsonObjectKind): string {
  return numberColorToCss(getEdaObjectKindColor(objectKind))
}
