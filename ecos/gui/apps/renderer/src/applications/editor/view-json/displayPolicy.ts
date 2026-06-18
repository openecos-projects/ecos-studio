import {
  VIEW_JSON_DETAIL_LOD_MIN_SCALE,
  VIEW_JSON_OVERVIEW_LOD_MAX_SCALE,
} from './renderSpatialIndex'
import type { ViewJsonObjectKind } from './types'

export type ViewJsonDisplayPreset =
  | 'engineering'
  | 'floorplan'
  | 'placement'
  | 'routing'
  | 'power'
  | 'debug'

export type ViewJsonDisplayLOD = 'overview' | 'balanced' | 'detail'
export type ViewJsonObjectDisplayMode = 'detail' | 'overview' | 'outline' | 'deferred' | 'hidden'

export const VIEW_JSON_DEFAULT_DISPLAY_PRESET: ViewJsonDisplayPreset = 'engineering'

const PRESET_KIND_OVERRIDES: Partial<Record<ViewJsonDisplayPreset, Set<ViewJsonObjectKind>>> = {
  floorplan: new Set(['die', 'core', 'rows', 'instances', 'io_pins', 'blockages', 'regions']),
  placement: new Set(['die', 'core', 'rows', 'instances', 'io_pins', 'blockages', 'regions', 'cell_obs']),
  routing: new Set(['die', 'core', 'io_pins', 'regular_wires', 'special_wires', 'vias']),
  power: new Set(['die', 'core', 'io_pins', 'special_wires', 'vias']),
}

const OVERVIEW_KINDS = new Set<ViewJsonObjectKind>([
  'instances',
  'io_pins',
  'regular_wires',
  'special_wires',
  'vias',
  'blockages',
  'fills',
  'regions',
])

const ALWAYS_DETAIL_KINDS = new Set<ViewJsonObjectKind>(['die', 'core', 'rows'])
const DEBUG_ONLY_DETAIL_KINDS = new Set<ViewJsonObjectKind>([
  'tracks',
  'gcell_grids',
])
const DEBUG_OVERVIEW_LAZY_INTERNAL_KINDS = new Set<ViewJsonObjectKind>([
  'cell_pins',
  'cell_obs',
])
const ROUTING_OVERVIEW_FALLBACK_KINDS = new Set<ViewJsonObjectKind>([
  'regular_wires',
  'special_wires',
  'vias',
])

export function viewJsonDisplayPresetIncludesKind(
  preset: ViewJsonDisplayPreset,
  objectKind: ViewJsonObjectKind,
): boolean {
  if (preset === 'engineering' || preset === 'debug') return true
  return PRESET_KIND_OVERRIDES[preset]?.has(objectKind) ?? true
}

export function getViewJsonDisplayLOD(scale: number): ViewJsonDisplayLOD {
  if (Number.isFinite(scale) && scale <= VIEW_JSON_OVERVIEW_LOD_MAX_SCALE) return 'overview'
  if (Number.isFinite(scale) && scale >= VIEW_JSON_DETAIL_LOD_MIN_SCALE) return 'detail'
  return 'balanced'
}

export function getViewJsonObjectDisplayMode(
  objectKind: ViewJsonObjectKind,
  scale: number,
  preset: ViewJsonDisplayPreset = VIEW_JSON_DEFAULT_DISPLAY_PRESET,
): ViewJsonObjectDisplayMode {
  if (!viewJsonDisplayPresetIncludesKind(preset, objectKind)) return 'hidden'

  const lod = getViewJsonDisplayLOD(scale)
  if (DEBUG_ONLY_DETAIL_KINDS.has(objectKind)) {
    if (preset !== 'debug') return 'deferred'
    return lod === 'detail' ? 'detail' : 'outline'
  }
  if (DEBUG_OVERVIEW_LAZY_INTERNAL_KINDS.has(objectKind)) {
    if (lod === 'detail') return 'detail'
    return preset === 'debug' ? 'overview' : 'deferred'
  }
  if (lod === 'detail') return 'detail'
  if (objectKind === 'rows') return 'outline'
  if (ALWAYS_DETAIL_KINDS.has(objectKind)) return 'detail'
  if (OVERVIEW_KINDS.has(objectKind)) return 'overview'
  return 'detail'
}

export function isViewJsonRoutingOverviewFallbackKind(objectKind: ViewJsonObjectKind): boolean {
  return ROUTING_OVERVIEW_FALLBACK_KINDS.has(objectKind)
}

export function getViewJsonEffectiveObjectDisplayMode(
  objectKind: ViewJsonObjectKind,
  scale: number,
  preset: ViewJsonDisplayPreset = VIEW_JSON_DEFAULT_DISPLAY_PRESET,
  routingDetailDeferred = false,
): ViewJsonObjectDisplayMode {
  const mode = getViewJsonObjectDisplayMode(objectKind, scale, preset)
  if (
    routingDetailDeferred
    && preset !== 'debug'
    && mode === 'detail'
    && isViewJsonRoutingOverviewFallbackKind(objectKind)
  ) {
    return 'overview'
  }
  return mode
}

export function isViewJsonObjectKindQueryableAtScale(
  objectKind: ViewJsonObjectKind,
  scale: number,
  preset: ViewJsonDisplayPreset = VIEW_JSON_DEFAULT_DISPLAY_PRESET,
): boolean {
  const mode = getViewJsonObjectDisplayMode(objectKind, scale, preset)
  return mode === 'detail' || mode === 'outline' || mode === 'overview'
}

export function getViewJsonDisplayModeLabel(mode: ViewJsonObjectDisplayMode): string {
  switch (mode) {
    case 'overview':
      return 'OVR'
    case 'outline':
      return 'OUT'
    case 'detail':
      return 'DTL'
    case 'deferred':
      return 'LOD'
    case 'hidden':
      return 'OFF'
  }
}

export function isViewJsonDisplayModeVisible(mode: ViewJsonObjectDisplayMode): boolean {
  return mode === 'detail' || mode === 'overview' || mode === 'outline'
}
