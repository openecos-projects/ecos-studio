import type { DesktopAgentWorkspaceRerunParameterPatch } from '@ecos-studio/shared'

type ParameterValue = DesktopAgentWorkspaceRerunParameterPatch['value']
type ValueKind =
  | 'boolean'
  | 'integer'
  | 'number'
  | 'positive'
  | 'string'
  | 'int-list'
  | 'str-list'

type Knob = {
  kind: ValueKind
  parameter: string
  range?: readonly [number, number]
  transform?: (value: ParameterValue) => ParameterValue
}

const workspace = (
  id: string,
  kind: ValueKind,
  range?: readonly [number, number],
): Knob => ({
  kind,
  parameter: id,
  range,
})
const numericString = (
  id: string,
  kind: 'integer' | 'number',
  range?: readonly [number, number],
): Knob => ({
  ...workspace(id, kind, range),
  transform: (value) => String(value),
})

const knobs: Record<string, Knob> = {
  'design.frequency_max': workspace('design.frequency_mhz', 'positive'),
  'floorplan.utilitization': workspace('floorplan.core_util', 'number', [0.01, 1]),
  'floorplan.aspect_ratio': workspace('floorplan.aspect_ratio', 'positive'),
  'floorplan.die_width': workspace(
    'floorplan.die_builder.die_size.width_micron',
    'positive',
  ),
  'floorplan.die_height': workspace(
    'floorplan.die_builder.die_size.height_micron',
    'positive',
  ),
  'floorplan.global_right_padding': workspace('place.global_right_padding', 'integer', [
    0,
    Infinity,
  ]),
  'place.target_density': workspace('place.target_density', 'number', [0.1, 0.95]),
  'place.target_overflow': workspace('place.target_overflow', 'number', [0, 1]),
  'place.cell_padding_x': workspace('place.cell_padding_x', 'integer', [0, Infinity]),
  'place.routability_opt': {
    ...workspace('place.routability_opt', 'boolean'),
    transform: (value) => (value ? 1 : 0),
  },
  'cts.max_fanout': workspace('cts.max_fanout', 'integer'),
  'route.bottom_layer': workspace('route.bottom_layer', 'string'),
  'route.top_layer': workspace('route.top_layer', 'string'),
  'place.density_weight': workspace('place.density_weight', 'number'),
  'place.gp_noise_ratio': workspace('place.gp_noise_ratio', 'number', [0, 1]),
  'place.num_threads': workspace('place.num_threads', 'integer'),
  'cts.skew_bound': numericString('cts.skew_bound', 'number', [0, 1]),
  'cts.max_buf_tran': numericString('cts.max_buf_tran', 'number'),
  'cts.root_input_slew': numericString('cts.root_input_slew', 'number'),
  'cts.max_sink_tran': numericString('cts.max_sink_tran', 'number'),
  'cts.max_cap': numericString('cts.max_cap', 'number'),
  'cts.wirelength_iterations': numericString('cts.wirelength_iterations', 'integer'),
  'cts.slew_steps': numericString('cts.slew_steps', 'integer'),
  'cts.cap_steps': numericString('cts.cap_steps', 'integer'),
  'cts.routing_layer': workspace('cts.routing_layer', 'int-list'),
  'cts.buffer_type': workspace('cts.buffer_type', 'str-list'),
  'route.thread_number': numericString('route.RT.-thread_number', 'integer'),
  'route.enable_timing': {
    ...workspace('route.RT.-enable_timing', 'boolean'),
    transform: (value) => (value ? '1' : '0'),
  },
}

function validString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= 256 &&
    ![...value].some((character) => character.charCodeAt(0) < 32) &&
    !/[`]|\.\.|[;&|]|\$\(/.test(value)
  )
}

function validValue(value: ParameterValue, knob: Knob): boolean {
  if (knob.kind === 'boolean') return typeof value === 'boolean'
  if (knob.kind === 'string') return validString(value)
  if (knob.kind === 'int-list' || knob.kind === 'str-list') {
    if (!Array.isArray(value) || value.length === 0 || value.length > 64) return false
    if (new Set<unknown>(value).size !== value.length) return false
    return knob.kind === 'int-list'
      ? value.every((item) => Number.isInteger(item) && Number(item) >= 1)
      : value.every(validString)
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  if (
    knob.kind === 'integer' &&
    (!Number.isInteger(value) || value < (knob.range?.[0] ?? 1))
  )
    return false
  if (knob.kind === 'positive' && value <= 0) return false
  if (knob.kind === 'number' && !knob.range && value < 0) return false
  return !knob.range || (value >= knob.range[0] && value <= knob.range[1])
}

export function readAgentWorkspaceParameterValues(
  workspaceSpec: Record<string, unknown>,
  _stepConfigurations: Record<string, Record<string, unknown>>,
): Record<string, ParameterValue> {
  const parameters =
    workspaceSpec.parameters &&
    typeof workspaceSpec.parameters === 'object' &&
    !Array.isArray(workspaceSpec.parameters)
      ? (workspaceSpec.parameters as Record<string, unknown>)
      : {}
  const result: Record<string, ParameterValue> = {}
  for (const [knobId, knob] of Object.entries(knobs)) {
    const value = parameters[knob.parameter]
    let normalized = value
    if (
      knob.kind === 'boolean' &&
      (value === 0 || value === 1 || value === '0' || value === '1')
    ) {
      normalized = value === 1 || value === '1'
    } else if (
      (knob.kind === 'integer' || knob.kind === 'number' || knob.kind === 'positive') &&
      typeof value === 'string' &&
      Number.isFinite(Number(value))
    ) {
      normalized = Number(value)
    }
    if (
      typeof normalized === 'boolean' ||
      typeof normalized === 'string' ||
      (typeof normalized === 'number' && Number.isFinite(normalized)) ||
      (Array.isArray(normalized) &&
        normalized.length > 0 &&
        normalized.every(
          (item) =>
            typeof item === 'string' ||
            (typeof item === 'number' && Number.isFinite(item)),
        ))
    ) {
      result[knobId] = normalized
    }
  }
  return result
}

export function deriveAgentWorkspaceParameterUpdates(
  patch: DesktopAgentWorkspaceRerunParameterPatch[],
): {
  workspace_parameters: Record<string, unknown>
  step_configurations: []
} | null {
  const workspaceParameters: Record<string, unknown> = {}
  for (const item of patch) {
    const knob = knobs[item.knob_id]
    if (!knob || !validValue(item.value, knob)) return null
    const value = knob.transform?.(item.value) ?? item.value
    workspaceParameters[knob.parameter] = Array.isArray(value) ? [...value] : value
  }
  return {
    workspace_parameters: workspaceParameters,
    step_configurations: [],
  }
}
