import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

import {
  ECC_CATALOG_END_STEP as CATALOG_END_STEP,
  ECC_FLOW_STEPS as FLOW_STEP_SEQUENCE,
  ECC_FLOW_STEP_SET as FLOW_STEPS,
  type DesktopAgentWorkspaceRerunContract,
} from '@ecos-studio/shared'
import { isPathWithinRoot, isRelativePathOutsideRoot } from '../pathScope'
import {
  executeWorkspaceRerunDomain,
  hasValidWorkspaceRerunDomainUpdates,
  isWorkspaceRerunParameterValue,
  type WorkspaceRerunRuntime,
} from './workspaceRerunDomain'

const STAGE_OUTPUT_SUFFIXES = ['.def.gz', '.v.gz', '.gds']

/** Sizer publishes underscored lowercase directory and file stems. */
function sizerStepStem(stepName: string): string {
  return stepName.trim().split(/\s+/).join('_').toLowerCase()
}

/** Mirrors the workspace resource index's step directory naming. */
function rerunStageDirectoryName(stepName: string, tool: string): string {
  return tool.toLowerCase() === 'sizer'
    ? `${sizerStepStem(stepName)}_sizer`
    : `${stepName}_${tool}`
}

/** Step slug for rerun target directories and ids; spaces are not path-safe. */
function rerunStepSlug(stepName: string): string {
  return stepName.trim().split(/\s+/).join('_').toLowerCase()
}
const AUTHORIZED_KNOBS = {
  place: new Set([
    'place.target_density',
    'place.target_overflow',
    'place.cell_padding_x',
    'place.routability_opt',
    'place.density_weight',
    'place.gp_noise_ratio',
    'place.num_threads',
  ]),
  CTS: new Set([
    'cts.skew_bound',
    'cts.max_buf_tran',
    'cts.root_input_slew',
    'cts.max_sink_tran',
    'cts.max_cap',
    'cts.wirelength_unit_um',
    'cts.wirelength_iterations',
    'cts.slew_steps',
    'cts.cap_steps',
    'cts.wire_width',
    'cts.max_fanout',
    'cts.routing_layer',
    'cts.buffer_type',
    'cts.char_buf_redundancy_pct',
    'cts.force_branch_buffer',
    'cts.htree_depth_explore_window',
    'cts.htree_topology_tolerance',
    'cts.enable_analytical_htree',
    'cts.enable_sink_clustering',
  ]),
  legalization: new Set([
    'legalization.cell_padding_x',
    'legalization.bndry_padding_x',
    'legalization.bndry_padding_y',
    'legalization.detailed_place_flag',
    'legalization.num_threads',
    'legalization.deterministic',
  ]),
  route: new Set([
    'route.bottom_layer',
    'route.top_layer',
    'route.thread_number',
    'route.enable_timing',
  ]),
}

const RANGED_KNOBS = new Map<string, readonly [number, number]>([
  ['place.target_density', [0.1, 0.95]],
  ['place.target_overflow', [0, 1]],
  ['place.gp_noise_ratio', [0, 1]],
  ['cts.skew_bound', [0, 1]],
])
const INTEGER_KNOBS = new Set([
  'place.num_threads',
  'cts.wirelength_iterations',
  'cts.slew_steps',
  'cts.cap_steps',
  'cts.max_fanout',
  'cts.htree_depth_explore_window',
  'legalization.bndry_padding_x',
  'legalization.bndry_padding_y',
  'legalization.num_threads',
  'route.thread_number',
])
const ZERO_BASED_INTEGER_KNOBS = new Set([
  'place.cell_padding_x',
  'legalization.cell_padding_x',
])
const BOOLEAN_KNOBS = new Set([
  'place.routability_opt',
  'cts.force_branch_buffer',
  'cts.enable_analytical_htree',
  'cts.enable_sink_clustering',
  'legalization.detailed_place_flag',
  'legalization.deterministic',
  'route.enable_timing',
])

export async function executeWorkspaceRerun(
  contract: DesktopAgentWorkspaceRerunContract,
  runtime: WorkspaceRerunRuntime,
  workspaceHandle: string,
  initialWorkspaceRevision: number | undefined,
): Promise<void> {
  await executeWorkspaceRerunDomain(
    contract,
    runtime,
    workspaceHandle,
    initialWorkspaceRevision,
    FLOW_STEPS,
  )
}

export async function verifyWorkspaceRerunContract(
  contract: DesktopAgentWorkspaceRerunContract,
): Promise<{
  sourceWorkspace: string
  targetWorkspace: string
}> {
  if (
    contract.schema_version !== 'flow-agent.workspace_rerun_contract.v1' ||
    contract.requires_gui_review !== true ||
    !FLOW_STEPS.has(contract.target_step) ||
    !FLOW_STEPS.has(contract.end_step) ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(contract.design_id) ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(contract.rerun_id) ||
    !/^[a-f0-9]{64}$/.test(contract.source_flow_json_sha256) ||
    !/^[a-f0-9]{64}$/.test(contract.source_stage_artifact_sha256) ||
    !isWorkspaceArtifactReference(contract.source_stage_artifact) ||
    !isAbsolute(contract.source_workspace) ||
    !isAbsolute(contract.target_workspace) ||
    !hasValidParameterPatch(contract.parameter_patch) ||
    !hasValidWorkspaceRerunDomainUpdates(contract, FLOW_STEPS) ||
    !hasAuthorizedParameterPatch(contract.target_step, contract.parameter_patch) ||
    (contract.execution_scope !== 'single_step' &&
      contract.execution_scope !== 'full_flow') ||
    !isValidRerunRange(contract.target_step, contract.end_step, contract.execution_scope)
  ) {
    throw new Error('Workspace rerun contract is invalid.')
  }
  const sourceWorkspace = await realpath(contract.source_workspace)
  const targetWorkspace = resolve(contract.target_workspace)
  const expectedTarget = join(
    dirname(sourceWorkspace),
    `${basename(sourceWorkspace)}_rerun_${rerunStepSlug(contract.target_step)}`,
  )
  const targetSuffix = targetWorkspace.slice(expectedTarget.length)
  if (
    !targetWorkspace.startsWith(expectedTarget) ||
    (targetSuffix && !/^_\d{4}$/.test(targetSuffix)) ||
    contract.rerun_id !== basename(targetWorkspace) ||
    isRelativePathOutsideRoot(relative(dirname(sourceWorkspace), targetWorkspace))
  ) {
    throw new Error('Workspace rerun target is outside the source workspace parent.')
  }
  try {
    await lstat(targetWorkspace)
    throw new Error('Workspace rerun target already exists.')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const sourceHome = await resolvePathWithinWorkspace(
    sourceWorkspace,
    join(sourceWorkspace, 'home'),
    'source home',
  )
  const flowPath = await resolvePathWithinWorkspace(
    sourceWorkspace,
    join(sourceHome, 'flow.json'),
    'source flow evidence',
  )
  const flowText = await readFile(flowPath, 'utf8')
  if (sha256(flowText) !== contract.source_flow_json_sha256) {
    throw new Error('Workspace rerun source flow evidence is stale.')
  }
  if (
    contract.execution_scope === 'full_flow' &&
    contract.end_step !== CATALOG_END_STEP
  ) {
    throw new Error(
      `Workspace rerun full-flow end step must be the catalog terminus (${CATALOG_END_STEP}).`,
    )
  }
  const targetTool = completedStepTool(flowText, contract.target_step)
  if (!targetTool) {
    throw new Error('Workspace rerun target step is not completed in the source flow.')
  }
  const stageFileStem =
    targetTool === 'sizer' ? sizerStepStem(contract.target_step) : contract.target_step
  const stageOutputPrefix = `${rerunStageDirectoryName(contract.target_step, targetTool)}/output/${contract.design_id}_${stageFileStem}`
  const isStageArtifact = STAGE_OUTPUT_SUFFIXES.some(
    (suffix) => contract.source_stage_artifact === `${stageOutputPrefix}${suffix}`,
  )
  // LEC stages publish an equivalence result JSON instead of layout outputs.
  const isLecResultArtifact =
    targetTool === 'yosys_lec' &&
    contract.source_stage_artifact === `${stageOutputPrefix}_result.json`
  if (!isStageArtifact && !isLecResultArtifact) {
    throw new Error('Workspace rerun source artifact does not match the completed stage.')
  }
  const artifact = await resolvePathWithinWorkspace(
    sourceWorkspace,
    join(sourceWorkspace, contract.source_stage_artifact),
    'source artifact evidence',
  )
  if (!(await lstat(artifact)).isFile()) {
    throw new Error('Workspace rerun source artifact is invalid.')
  }
  if (sha256(await readFile(artifact)) !== contract.source_stage_artifact_sha256) {
    throw new Error('Workspace rerun source artifact evidence is stale.')
  }
  return { sourceWorkspace, targetWorkspace }
}

function isValidRerunRange(
  targetStep: string,
  endStep: string,
  executionScope: 'single_step' | 'full_flow',
): boolean {
  const targetIndex = FLOW_STEP_SEQUENCE.indexOf(
    targetStep as (typeof FLOW_STEP_SEQUENCE)[number],
  )
  const endIndex = FLOW_STEP_SEQUENCE.indexOf(
    endStep as (typeof FLOW_STEP_SEQUENCE)[number],
  )
  return (
    targetIndex >= 0 &&
    endIndex >= targetIndex &&
    (executionScope === 'full_flow' || targetStep === endStep)
  )
}

function isWorkspaceArtifactReference(value: string): boolean {
  const segments = value.split('/')
  return (
    Boolean(value) &&
    segments.every((segment) => segment && segment !== '.' && segment !== '..')
  )
}

async function resolvePathWithinWorkspace(
  workspace: string,
  path: string,
  label: string,
): Promise<string> {
  const resolvedPath = await realpath(path)
  if (!isWithinWorkspace(workspace, resolvedPath)) {
    throw new Error(`Workspace rerun ${label} is outside the workspace root.`)
  }
  return resolvedPath
}

function isWithinWorkspace(workspace: string, path: string): boolean {
  return isPathWithinRoot(path, workspace)
}

function hasValidParameterPatch(
  patch: DesktopAgentWorkspaceRerunContract['parameter_patch'],
): boolean {
  if (!Array.isArray(patch) || patch.length > 16) return false
  const knobs = new Set<string>()
  return patch.every((item) => {
    if (
      !/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(item.knob_id) ||
      knobs.has(item.knob_id)
    ) {
      return false
    }
    knobs.add(item.knob_id)
    return isWorkspaceRerunParameterValue(item.value)
  })
}

function hasAuthorizedParameterPatch(
  targetStep: string,
  patch: DesktopAgentWorkspaceRerunContract['parameter_patch'],
): boolean {
  if (patch.length === 0) return true
  const allowed = AUTHORIZED_KNOBS[targetStep as keyof typeof AUTHORIZED_KNOBS]
  return (
    Boolean(allowed) &&
    patch.every((item) => allowed.has(item.knob_id) && isAuthorizedValue(item))
  )
}

function isAuthorizedValue(
  item: DesktopAgentWorkspaceRerunContract['parameter_patch'][number],
): boolean {
  const { knob_id: knobId, value } = item
  const range = RANGED_KNOBS.get(knobId)
  if (range) return typeof value === 'number' && value >= range[0] && value <= range[1]
  if (ZERO_BASED_INTEGER_KNOBS.has(knobId)) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0
  }
  if (INTEGER_KNOBS.has(knobId)) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1
  }
  if (BOOLEAN_KNOBS.has(knobId)) return typeof value === 'boolean'
  if (knobId === 'cts.routing_layer') {
    return (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every(
        (layer) => typeof layer === 'number' && Number.isInteger(layer) && layer >= 1,
      ) &&
      new Set<unknown>(value).size === value.length
    )
  }
  if (knobId === 'cts.buffer_type') {
    return (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every(
        (buffer) => typeof buffer === 'string' && isSafeParameterString(buffer),
      ) &&
      new Set<unknown>(value).size === value.length
    )
  }
  if (knobId === 'route.bottom_layer' || knobId === 'route.top_layer') {
    return typeof value === 'string' && value.trim().length > 0
  }
  return typeof value === 'number' && value >= 0
}

function isSafeParameterString(value: string): boolean {
  return (
    value.length <= 256 &&
    !value.includes('`') &&
    !value.includes('..') &&
    !value.split('').some((character) => character.charCodeAt(0) < 32) &&
    !/[;&|]|\$\(/.test(value)
  )
}

function completedStepTool(flowText: string, targetStep: string): string | null {
  try {
    const flow = JSON.parse(flowText) as { steps?: unknown }
    if (!Array.isArray(flow.steps)) return null
    const step = flow.steps.find(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        (item as { name?: unknown; state?: unknown }).name === targetStep &&
        (item as { state?: unknown }).state === 'Success',
    )
    const tool =
      typeof step === 'object' && step !== null && (step as { tool?: unknown }).tool
    return typeof tool === 'string' && /^[A-Za-z0-9_-]+$/.test(tool) ? tool : null
  } catch {
    return null
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
