import type {
  ViewJsonLayer,
  ViewJsonObjectKind,
  ViewJsonVisibilityState,
} from './types'

export const VIEW_JSON_OBJECT_KINDS: ViewJsonObjectKind[] = [
  'die',
  'core',
  'rows',
  'tracks',
  'gcell_grids',
  'instances',
  'io_pins',
  'regular_wires',
  'special_wires',
  'vias',
  'blockages',
  'fills',
  'regions',
  'cell_pins',
  'cell_obs',
]

export const VIEW_JSON_OBJECT_KIND_LABELS: Record<ViewJsonObjectKind, string> = {
  die: 'Die',
  core: 'Core',
  rows: 'Rows',
  tracks: 'Tracks',
  gcell_grids: 'GCell grids',
  instances: 'Instances',
  io_pins: 'IO pins',
  regular_wires: 'Regular wires',
  special_wires: 'Special wires',
  vias: 'Vias',
  blockages: 'Blockages',
  fills: 'Fills',
  regions: 'Regions',
  cell_pins: 'Cell pins',
  cell_obs: 'Cell obstructions',
}

export function createViewJsonVisibilityState(
  layers: Pick<ViewJsonLayer, 'id'>[],
): ViewJsonVisibilityState {
  return {
    objectKinds: Object.fromEntries(
      VIEW_JSON_OBJECT_KINDS.map(kind => [kind, true]),
    ) as Record<ViewJsonObjectKind, boolean>,
    layers: new Map(layers.map(layer => [layer.id, true])),
  }
}

export function isViewJsonRenderableVisible(
  state: ViewJsonVisibilityState,
  objectKind: ViewJsonObjectKind,
  layerId?: number,
): boolean {
  if (!state.objectKinds[objectKind]) return false
  if (layerId == null) return true
  return state.layers.get(layerId) ?? true
}

export function toggleViewJsonObjectKind(
  state: ViewJsonVisibilityState,
  objectKind: ViewJsonObjectKind,
): ViewJsonVisibilityState {
  return {
    objectKinds: {
      ...state.objectKinds,
      [objectKind]: !state.objectKinds[objectKind],
    },
    layers: new Map(state.layers),
  }
}

export function showAllViewJsonObjectKinds(state: ViewJsonVisibilityState): ViewJsonVisibilityState {
  return {
    objectKinds: Object.fromEntries(
      VIEW_JSON_OBJECT_KINDS.map(kind => [kind, true]),
    ) as Record<ViewJsonObjectKind, boolean>,
    layers: new Map(state.layers),
  }
}

export function hideAllViewJsonObjectKinds(state: ViewJsonVisibilityState): ViewJsonVisibilityState {
  return {
    objectKinds: Object.fromEntries(
      VIEW_JSON_OBJECT_KINDS.map(kind => [kind, false]),
    ) as Record<ViewJsonObjectKind, boolean>,
    layers: new Map(state.layers),
  }
}

export function toggleViewJsonLayer(
  state: ViewJsonVisibilityState,
  layerId: number,
): ViewJsonVisibilityState {
  const layers = new Map(state.layers)
  layers.set(layerId, !(layers.get(layerId) ?? true))
  return {
    objectKinds: { ...state.objectKinds },
    layers,
  }
}

export function showAllViewJsonLayers(state: ViewJsonVisibilityState): ViewJsonVisibilityState {
  return {
    objectKinds: { ...state.objectKinds },
    layers: new Map([...state.layers.keys()].map(layerId => [layerId, true])),
  }
}

export function hideAllViewJsonLayers(state: ViewJsonVisibilityState): ViewJsonVisibilityState {
  return {
    objectKinds: { ...state.objectKinds },
    layers: new Map([...state.layers.keys()].map(layerId => [layerId, false])),
  }
}
