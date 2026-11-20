import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { parseWorkspaceFlow } from './eccCli/persistedState'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

import type { DesktopAgentWorkspaceRerunContract } from '@ecos-studio/shared'
import { agentParameterIdentity } from '@ecos-studio/shared'
import { isPathWithinRoot, isRelativePathOutsideRoot } from './pathScope'
import {
  executeWorkspaceRerunDomain,
  hasValidWorkspaceRerunDomainUpdates,
  isWorkspaceRerunParameterValue,
  type WorkspaceRerunRuntime,
} from './workspaceRerunDomain'

const STAGE_OUTPUT_SUFFIXES = ['.def.gz', '.v.gz', '.gds']
const AUTHORIZED_KNOBS = {
  placement: new Set([
    'place.target_density',
    'place.target_overflow',
    'place.cell_padding_x',
    'place.routability_opt',
    'place.density_weight',
    'place.gp_noise_ratio',
    'place.num_threads',
  ]),
  cts: new Set([
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
  routing: new Set([
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
  'route.thread_number',
])
const ZERO_BASED_INTEGER_KNOBS = new Set(['place.cell_padding_x'])
const BOOLEAN_KNOBS = new Set([
  'place.routability_opt',
  'cts.force_branch_buffer',
  'cts.enable_analytical_htree',
  'cts.enable_sink_clustering',
  'route.enable_timing',
])
export async function prepareWorkspaceRerun(
  contract: DesktopAgentWorkspaceRerunContract,
  fork: () => Promise<{ directory: string }>,
): Promise<{ directory: string }> {
  await verifyWorkspaceRerunContract(contract)
  return await fork()
}

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
  )
}

async function verifyWorkspaceRerunContract(
  contract: DesktopAgentWorkspaceRerunContract,
): Promise<{
  sourceWorkspace: string
  targetWorkspace: string
}> {
  if (
    contract.schema_version !== 'flow-agent.workspace_rerun_contract.v1' ||
    contract.requires_gui_review !== true ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(contract.design_id) ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(contract.rerun_id) ||
    !/^[a-f0-9]{64}$/.test(contract.source_flow_json_sha256) ||
    !/^[a-f0-9]{64}$/.test(contract.source_stage_artifact_sha256) ||
    !isWorkspaceArtifactReference(contract.source_stage_artifact) ||
    !isAbsolute(contract.source_workspace) ||
    !isAbsolute(contract.target_workspace) ||
    !hasValidParameterPatch(contract.parameter_patch) ||
    !hasValidWorkspaceRerunDomainUpdates(contract) ||
    !hasAuthorizedParameterPatch(contract.target_step, contract.parameter_patch) ||
    (contract.execution_scope !== 'single_step' &&
      contract.execution_scope !== 'full_flow')
  ) {
    throw new Error('Workspace rerun contract is invalid.')
  }
  const sourceWorkspace = await realpath(contract.source_workspace)
  const targetWorkspace = resolve(contract.target_workspace)
  const expectedTarget = join(
    dirname(sourceWorkspace),
    `${basename(sourceWorkspace)}_rerun_${contract.target_step.replaceAll('@', '_')}`,
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
  const parsedFlow = parseWorkspaceFlow(JSON.parse(flowText))
  const flowStepNames = parsedFlow.steps.map((step) => step.name)
  if (!flowStepNames.includes(contract.target_step)) {
    throw new Error('Workspace rerun contract is invalid.')
  }
  if (contract.execution_scope === 'full_flow') {
    const terminus = flowStepNames.at(-1)
    if (contract.end_step !== terminus) {
      throw new Error(
        `Workspace rerun full-flow end step must be the flow terminus (${terminus}).`,
      )
    }
  } else if (contract.end_step !== contract.target_step) {
    throw new Error('Workspace rerun contract is invalid.')
  }
  const target = parsedFlow.steps.find(
    (step) => step.name === contract.target_step && step.state === 'Success',
  )
  if (!target) {
    throw new Error('Workspace rerun target step is not completed in the source flow.')
  }
  const stageOutputPrefix = `${target.directory}/output/${contract.design_id}_${target.name}`
  const isStageArtifact = STAGE_OUTPUT_SUFFIXES.some(
    (suffix) => contract.source_stage_artifact === `${stageOutputPrefix}${suffix}`,
  )
  // LEC stages publish an equivalence result JSON instead of layout outputs.
  const isLecResultArtifact =
    target.tool === 'kepler_formal' &&
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
    const identity = agentParameterIdentity(item)
    if (!/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(item.knob_id) || knobs.has(identity)) {
      return false
    }
    knobs.add(identity)
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
    patch.every(
      (item) =>
        (!item.step || item.step === targetStep) &&
        allowed.has(item.knob_id) &&
        isAuthorizedValue(item),
    )
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

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
