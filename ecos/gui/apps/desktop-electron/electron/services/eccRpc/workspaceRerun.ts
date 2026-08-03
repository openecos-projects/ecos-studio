import { createHash, randomUUID } from 'node:crypto'
import {
  cp,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

import type { DesktopAgentWorkspaceRerunContract } from '@ecos-studio/shared'

interface WorkspaceRerunRuntime {
  runCandidateRerun(request: {
    candidateId: string
    endStep: string
    executionScope: 'single_step' | 'full_flow'
    patch: Array<{ knob_id: string; value: unknown }>
    targetStep: string
    workspaceHandle: string
  }): Promise<unknown>
}

const FLOW_STEP_SEQUENCE = [
  'Synthesis',
  'Floorplan',
  'fixFanout',
  'place',
  'CTS',
  'legalization',
  'route',
  'drc',
  'filler',
  'RCX',
  'sta',
  'Harden',
] as const
const FLOW_STEPS: Set<string> = new Set(FLOW_STEP_SEQUENCE)
const STAGE_OUTPUT_SUFFIXES = ['.def.gz', '.v.gz', '.gds']
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
const OWNER_MARKER = '.flow_agent_workspace_rerun_owner'

export async function prepareWorkspaceRerun(
  contract: DesktopAgentWorkspaceRerunContract,
): Promise<{ directory: string }> {
  const verified = await verifyWorkspaceRerunContract(contract)
  const owner = randomUUID()
  const stagingRoot = await createStagingRoot(verified.targetWorkspace)
  const stagedWorkspace = join(stagingRoot, basename(verified.targetWorkspace))
  let targetCreated = false
  try {
    await cp(verified.sourceWorkspace, stagedWorkspace, {
      errorOnExist: true,
      force: false,
      recursive: true,
    })
    await invalidateWorkspaceRerunSuffix(stagedWorkspace, contract.target_step)
    const stagedHome = await resolvePathWithinWorkspace(
      stagedWorkspace,
      join(stagedWorkspace, 'home'),
      'rerun home',
    )
    await assertMissing(join(stagedWorkspace, OWNER_MARKER))
    await writeFile(
      join(stagedHome, 'flow_agent_workspace_rerun_contract.v1.json'),
      `${JSON.stringify(contract, null, 2)}\n`,
      'utf8',
    )
    await writeFile(join(stagedWorkspace, OWNER_MARKER), owner, 'utf8')
    await rename(stagedWorkspace, verified.targetWorkspace)
    targetCreated = true
    return { directory: verified.targetWorkspace }
  } catch (error) {
    if (targetCreated) await removeOwnedWorkspace(verified.targetWorkspace, owner)
    throw error
  } finally {
    await rm(stagingRoot, { force: true, recursive: true })
  }
}

export async function executeWorkspaceRerun(
  contract: DesktopAgentWorkspaceRerunContract,
  runtime: WorkspaceRerunRuntime,
  workspaceHandle: string,
): Promise<void> {
  await runtime.runCandidateRerun({
    candidateId: contract.rerun_id,
    endStep: contract.end_step,
    executionScope: contract.execution_scope,
    patch: contract.parameter_patch,
    targetStep: contract.target_step,
    workspaceHandle,
  })
}

async function verifyWorkspaceRerunContract(
  contract: DesktopAgentWorkspaceRerunContract,
): Promise<{ sourceWorkspace: string; targetWorkspace: string }> {
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
    `${basename(sourceWorkspace)}_rerun_${contract.target_step.toLowerCase()}`,
  )
  const targetSuffix = targetWorkspace.slice(expectedTarget.length)
  if (
    !targetWorkspace.startsWith(expectedTarget) ||
    (targetSuffix && !/^_\d{4}$/.test(targetSuffix)) ||
    contract.rerun_id !== basename(targetWorkspace) ||
    relative(dirname(sourceWorkspace), targetWorkspace).startsWith('..')
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
    sourceFlowEndStep(flowText) !== contract.end_step
  ) {
    throw new Error(
      'Workspace rerun full-flow end step does not match the source workspace flow.',
    )
  }
  const targetTool = completedStepTool(flowText, contract.target_step)
  if (!targetTool) {
    throw new Error('Workspace rerun target step is not completed in the source flow.')
  }
  if (
    !STAGE_OUTPUT_SUFFIXES.some(
      (suffix) =>
        contract.source_stage_artifact ===
        `${contract.target_step}_${targetTool}/output/${contract.design_id}_${contract.target_step}${suffix}`,
    )
  ) {
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

async function createStagingRoot(targetWorkspace: string): Promise<string> {
  const parent = dirname(targetWorkspace)
  const stagingRoot = join(parent, `.${basename(targetWorkspace)}.${randomUUID()}`)
  await mkdir(parent, { recursive: true })
  await mkdir(stagingRoot)
  return stagingRoot
}

async function removeOwnedWorkspace(
  targetWorkspace: string,
  owner: string,
): Promise<void> {
  try {
    const targetStats = await lstat(targetWorkspace)
    if (targetStats.isSymbolicLink() || !targetStats.isDirectory()) return
    const resolvedTarget = await realpath(targetWorkspace)
    if (resolvedTarget !== resolve(targetWorkspace)) return
    const marker = join(resolvedTarget, OWNER_MARKER)
    const markerStats = await lstat(marker)
    if (markerStats.isSymbolicLink() || !markerStats.isFile()) return
    if ((await readFile(marker, 'utf8')) !== owner) return
    await rm(resolvedTarget, { force: true, recursive: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
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
  const relativePath = relative(workspace, path)
  return (
    relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  )
}

async function assertMissing(path: string): Promise<void> {
  try {
    await lstat(path)
    throw new Error('Workspace rerun marker already exists.')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
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
    return isValidParameterValue(item.value)
  })
}

function isValidParameterValue(
  value: DesktopAgentWorkspaceRerunContract['parameter_patch'][number]['value'],
): boolean {
  if (typeof value === 'boolean') return true
  if (typeof value === 'string') return isSafeParameterString(value)
  if (typeof value === 'number') return Number.isFinite(value)
  if (!Array.isArray(value) || value.length > 64) return false
  return value.every(
    (item) =>
      (typeof item === 'number' && Number.isFinite(item)) ||
      (typeof item === 'string' && isSafeParameterString(item)),
  )
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

function sourceFlowEndStep(flowText: string): string | null {
  try {
    const flow = JSON.parse(flowText) as { steps?: unknown }
    if (!Array.isArray(flow.steps)) return null
    for (let index = flow.steps.length - 1; index >= 0; index -= 1) {
      const name = (flow.steps[index] as { name?: unknown })?.name
      if (typeof name === 'string' && FLOW_STEPS.has(name)) return name
    }
  } catch {
    return null
  }
  return null
}

async function invalidateWorkspaceRerunSuffix(
  workspace: string,
  targetStep: string,
): Promise<void> {
  const home = await resolvePathWithinWorkspace(
    workspace,
    join(workspace, 'home'),
    'rerun home',
  )
  const flowPath = await resolvePathWithinWorkspace(
    workspace,
    join(home, 'flow.json'),
    'rerun flow',
  )
  const flow = parseWorkspaceFlow(await readFile(flowPath, 'utf8'))
  const targetIndex = FLOW_STEP_SEQUENCE.indexOf(
    targetStep as (typeof FLOW_STEP_SEQUENCE)[number],
  )
  for (const step of flow.steps) {
    const stepIndex = FLOW_STEP_SEQUENCE.indexOf(
      step.name as (typeof FLOW_STEP_SEQUENCE)[number],
    )
    if (stepIndex < targetIndex) continue
    await emptyWorkspaceStepDirectory(workspace, step)
    step.state = 'Unstart'
    step.runtime = ''
  }
  await writeFile(flowPath, `${JSON.stringify(flow.data, null, 2)}\n`, 'utf8')
}

async function emptyWorkspaceStepDirectory(
  workspace: string,
  step: WorkspaceFlowStep,
): Promise<void> {
  const stageDirectory = join(workspace, `${step.name}_${step.tool}`)
  try {
    const stats = await lstat(stageDirectory)
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`Workspace rerun stage directory is invalid: ${step.name}`)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await mkdir(stageDirectory, { recursive: true })
  }
  const resolvedStage = await realpath(stageDirectory)
  if (!isWithinWorkspace(workspace, resolvedStage)) {
    throw new Error(
      `Workspace rerun stage directory is outside the workspace root: ${step.name}`,
    )
  }
  await rm(resolvedStage, { force: true, recursive: true })
  await mkdir(stageDirectory)
}

interface WorkspaceFlowStep {
  name: string
  tool: string
  state: string
  runtime?: string
}

function parseWorkspaceFlow(flowText: string): {
  data: { steps: WorkspaceFlowStep[] }
  steps: WorkspaceFlowStep[]
} {
  try {
    const data = JSON.parse(flowText) as { steps?: unknown }
    if (!Array.isArray(data.steps)) throw new Error('steps are missing')
    const steps = data.steps.map((value) => {
      if (
        typeof value !== 'object' ||
        value === null ||
        !FLOW_STEPS.has((value as { name?: unknown }).name as string) ||
        typeof (value as { tool?: unknown }).tool !== 'string' ||
        !/^[A-Za-z0-9_-]+$/.test((value as { tool: string }).tool) ||
        typeof (value as { state?: unknown }).state !== 'string'
      ) {
        throw new Error('step is invalid')
      }
      return value as WorkspaceFlowStep
    })
    if (new Set(steps.map((step) => step.name)).size !== steps.length) {
      throw new Error('step names are duplicated')
    }
    data.steps = steps
    return { data: data as { steps: WorkspaceFlowStep[] }, steps }
  } catch (error) {
    throw new Error(`Workspace rerun flow is invalid: ${(error as Error).message}`)
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
