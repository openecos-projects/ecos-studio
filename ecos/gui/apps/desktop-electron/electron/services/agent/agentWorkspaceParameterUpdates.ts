import type {
  DesktopAgentStepConfigurationUpdate,
  DesktopAgentWorkspaceRerunParameterPatch,
} from '@ecos-studio/shared'

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
  range?: readonly [number, number]
  target: readonly ['workspace', string] | readonly ['step', string, ...string[]]
  transform?: (value: ParameterValue) => ParameterValue
}

const workspace = (
  id: string,
  kind: ValueKind,
  range?: readonly [number, number],
): Knob => ({
  kind,
  range,
  target: ['workspace', id],
})
const step = (
  stepId: string,
  path: string[],
  kind: ValueKind,
  range?: readonly [number, number],
): Knob => ({ kind, range, target: ['step', stepId, ...path] })

const knobs: Record<string, Knob> = {
  'design.frequency_max': workspace('frequency_max', 'positive'),
  'floorplan.utilitization': workspace('core_utilization', 'number', [0.01, 1]),
  'floorplan.aspect_ratio': workspace('aspect_ratio', 'positive'),
  'floorplan.die_width': workspace('die_width', 'positive'),
  'floorplan.die_height': workspace('die_height', 'positive'),
  'floorplan.global_right_padding': workspace('global_right_padding', 'integer', [
    0,
    Infinity,
  ]),
  'place.target_density': workspace('target_density', 'number', [0.1, 0.95]),
  'place.target_overflow': workspace('target_overflow', 'number', [0, 1]),
  'place.cell_padding_x': workspace('cell_padding_x', 'integer', [0, Infinity]),
  'place.routability_opt': {
    ...workspace('routability_opt_flag', 'boolean'),
    transform: (value) => (value ? 1 : 0),
  },
  'cts.max_fanout': workspace('max_fanout', 'integer'),
  'route.bottom_layer': workspace('bottom_layer', 'string'),
  'route.top_layer': workspace('top_layer', 'string'),
  'place.density_weight': step('place', ['density_weight'], 'number'),
  'place.gp_noise_ratio': step('place', ['gp_noise_ratio'], 'number', [0, 1]),
  'place.num_threads': step('place', ['num_threads'], 'integer'),
  'cts.skew_bound': step('CTS', ['skew_bound'], 'number', [0, 1]),
  'cts.max_buf_tran': step('CTS', ['max_buf_tran'], 'number'),
  'cts.root_input_slew': step('CTS', ['root_input_slew'], 'number'),
  'cts.max_sink_tran': step('CTS', ['max_sink_tran'], 'number'),
  'cts.max_cap': step('CTS', ['max_cap'], 'number'),
  'cts.wirelength_unit_um': step('CTS', ['wirelength_unit_um'], 'number'),
  'cts.wirelength_iterations': step('CTS', ['wirelength_iterations'], 'integer'),
  'cts.slew_steps': step('CTS', ['slew_steps'], 'integer'),
  'cts.cap_steps': step('CTS', ['cap_steps'], 'integer'),
  'cts.wire_width': step('CTS', ['wire_width'], 'number'),
  'cts.routing_layer': step('CTS', ['routing_layer'], 'int-list'),
  'cts.buffer_type': step('CTS', ['buffer_type'], 'str-list'),
  'cts.char_buf_redundancy_pct': step('CTS', ['char_buf_redundancy_pct'], 'number'),
  'cts.force_branch_buffer': step('CTS', ['force_branch_buffer'], 'boolean'),
  'cts.htree_depth_explore_window': step(
    'CTS',
    ['htree_depth_explore_window'],
    'integer',
  ),
  'cts.htree_topology_tolerance': step('CTS', ['htree_topology_tolerance'], 'number'),
  'cts.enable_analytical_htree': step('CTS', ['enable_analytical_htree'], 'boolean'),
  'cts.enable_sink_clustering': step('CTS', ['enable_sink_clustering'], 'boolean'),
  'legalization.cell_padding_x': step('legalization', ['cell_padding_x'], 'integer', [
    0,
    Infinity,
  ]),
  'legalization.bndry_padding_x': step('legalization', ['bndry_padding_x'], 'integer'),
  'legalization.bndry_padding_y': step('legalization', ['bndry_padding_y'], 'integer'),
  'legalization.detailed_place_flag': step(
    'legalization',
    ['detailed_place_flag'],
    'boolean',
  ),
  'legalization.num_threads': step('legalization', ['num_threads'], 'integer'),
  'legalization.deterministic': step('legalization', ['deterministic_flag'], 'boolean'),
  'route.thread_number': step('route', ['RT', '-thread_number'], 'integer'),
  'route.enable_timing': step('route', ['RT', '-enable_timing'], 'boolean'),
}

export const agentWorkspaceStepIds = [
  ...new Set(
    Object.values(knobs).flatMap((knob) =>
      knob.target[0] === 'step' ? [knob.target[1]] : [],
    ),
  ),
]

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

function setOption(
  target: Record<string, unknown>,
  path: string[],
  value: ParameterValue,
): void {
  let node = target
  for (const segment of path.slice(0, -1)) {
    const current = node[segment]
    const child =
      current && typeof current === 'object' && !Array.isArray(current)
        ? (current as Record<string, unknown>)
        : {}
    node[segment] = child
    node = child
  }
  node[path.at(-1)!] = Array.isArray(value) ? [...value] : value
}

function getValue(source: Record<string, unknown>, path: readonly string[]): unknown {
  let value: unknown = source
  for (const segment of path) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    value = (value as Record<string, unknown>)[segment]
  }
  return value
}

export function readAgentWorkspaceParameterValues(
  workspaceSpec: Record<string, unknown>,
  stepConfigurations: Record<string, Record<string, unknown>>,
): Record<string, ParameterValue> {
  const parameters =
    workspaceSpec.parameters &&
    typeof workspaceSpec.parameters === 'object' &&
    !Array.isArray(workspaceSpec.parameters)
      ? (workspaceSpec.parameters as Record<string, unknown>)
      : {}
  const result: Record<string, ParameterValue> = {}
  for (const [knobId, knob] of Object.entries(knobs)) {
    const value =
      knob.target[0] === 'workspace'
        ? parameters[knob.target[1]]
        : getValue(stepConfigurations[knob.target[1]] ?? {}, knob.target.slice(2))
    const normalized =
      knobId === 'place.routability_opt' && (value === 0 || value === 1)
        ? value === 1
        : value
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
  step_configurations: DesktopAgentStepConfigurationUpdate[]
} | null {
  const workspaceParameters: Record<string, unknown> = {}
  const stepOptions = new Map<string, Record<string, unknown>>()
  for (const item of patch) {
    const knob = knobs[item.knob_id]
    if (!knob || !validValue(item.value, knob)) return null
    const value = knob.transform?.(item.value) ?? item.value
    if (knob.target[0] === 'workspace') {
      workspaceParameters[knob.target[1]] = Array.isArray(value) ? [...value] : value
      continue
    }
    const [, stepId, ...path] = knob.target
    const options = stepOptions.get(stepId) ?? {}
    setOption(options, path, value)
    stepOptions.set(stepId, options)
  }
  return {
    workspace_parameters: workspaceParameters,
    step_configurations: [...stepOptions].map(([step_id, options]) => ({
      step_id,
      options,
    })),
  }
}
