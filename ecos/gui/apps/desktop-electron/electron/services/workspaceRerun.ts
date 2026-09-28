import { createHash, randomUUID } from 'node:crypto'
import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

import type { DesktopAgentWorkspaceRerunContract } from '@ecos-studio/shared'
import { isPathWithinRoot, isRelativePathOutsideRoot } from './pathScope'
import {
  executeWorkspaceRerunDomain,
  hasValidWorkspaceRerunDomainUpdates,
  isWorkspaceRerunParameterValue,
  type WorkspaceRerunRuntime,
} from './workspaceRerunDomain'

/**
 * Well-known legacy rtl2gds step order and the tool each inserted step uses.
 * This is ONLY a compatibility shim for legacy flow.json files written before
 * a step was inserted into the rtl2gds flow: a full-flow rerun of such a
 * workspace regains the missing known steps. Rerun validation, wiping, and
 * ordering are always derived from the workspace's own flow.json so dynamic
 * flows (e.g. iPW power flows) and unknown/new step IDs keep working.
 */
const LEGACY_STEP_SEQUENCE = [
  'Synthesis',
  'Floorplan',
  'place',
  'CTS',
  'legalization',
  'Timing optimization',
  'route',
  'drc',
  'lvs',
  'filler',
  'postRouteLec',
  'RCX',
  'sta',
  'powerAnalysis',
  'Harden',
] as const
const LEGACY_STEP_INDEX: ReadonlyMap<string, number> = new Map(
  LEGACY_STEP_SEQUENCE.map((name, index) => [name, index]),
)
const GENERIC_STEP_TOOL = 'ecc'
const LEGACY_STEP_TOOLS: Record<string, string> = {
  Synthesis: 'yosys',
  Floorplan: 'ecc',
  place: 'dreamplace',
  CTS: 'ecc',
  legalization: 'dreamplace',
  'Timing optimization': 'sizer',
  route: 'ecc',
  drc: 'ecc',
  lvs: 'ecc',
  filler: 'ecc',
  postRouteLec: 'yosys_lec',
  RCX: 'ecc',
  sta: 'ecc',
  powerAnalysis: 'ecc',
  Harden: 'ecc',
}
const LEGACY_HOME_FILES = [
  'home.json',
  'home.json.lock',
  'engineering-snapshot.json',
] as const

/** Tool for steps flow.json does not name explicitly: known map, else generic. */
function defaultStepTool(stepName: string): string {
  return LEGACY_STEP_TOOLS[stepName] ?? GENERIC_STEP_TOOL
}
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

function isObsoleteFlowStep(stepName: string): boolean {
  return stepName.toLowerCase().replace(/[\s_-]/g, '') === 'fixfanout'
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
    await prepareWorkspaceRerunFlow(
      stagedWorkspace,
      contract.target_step,
      contract.end_step,
      contract.execution_scope,
    )
    await prepareWorkspaceRerunMetadata({
      sourceWorkspace: verified.sourceWorkspace,
      sourceWorkspaceRaw: contract.source_workspace,
      stagedWorkspace,
      targetStep: contract.target_step,
      targetWorkspace: verified.targetWorkspace,
    })
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
  const parsedFlow = parseWorkspaceFlow(flowText)
  const flowStepNames = parsedFlow.steps.map((step) => step.name)
  if (!flowStepNames.includes(contract.target_step)) {
    throw new Error('Workspace rerun contract is invalid.')
  }
  if (contract.execution_scope === 'full_flow') {
    const terminus = rerunFlowTerminus(flowStepNames)
    if (contract.end_step !== terminus) {
      throw new Error(
        `Workspace rerun full-flow end step must be the flow terminus (${terminus}).`,
      )
    }
  } else if (contract.end_step !== contract.target_step) {
    throw new Error('Workspace rerun contract is invalid.')
  }
  const targetTool = completedStepTool(parsedFlow.steps, contract.target_step)
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

/**
 * Whether every step of the parsed flow is a well-known legacy rtl2gds step.
 * Only such flows are eligible for the legacy missing-step extension.
 */
function isLegacyStepSet(stepNames: string[]): boolean {
  return stepNames.length > 0 && stepNames.every((name) => LEGACY_STEP_INDEX.has(name))
}

/**
 * Effective step order used to place the wipe boundary and the full-flow
 * terminus: legacy flows gain known steps inserted since their flow.json was
 * written; every other flow keeps its own flow.json order verbatim.
 */
function rerunFlowLayout(stepNames: string[]): string[] {
  return isLegacyStepSet(stepNames) ? [...LEGACY_STEP_SEQUENCE] : [...stepNames]
}

/** Last step of the effective flow order; full-flow reruns must end there. */
function rerunFlowTerminus(stepNames: string[]): string | undefined {
  const layout = rerunFlowLayout(stepNames)
  return layout[layout.length - 1]
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
  return isPathWithinRoot(path, workspace)
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

function completedStepTool(
  steps: WorkspaceFlowStep[],
  targetStep: string,
): string | null {
  const step = steps.find((item) => item.name === targetStep && item.state === 'Success')
  return step && /^[A-Za-z0-9_-]+$/.test(step.tool) ? step.tool : null
}

async function prepareWorkspaceRerunFlow(
  workspace: string,
  targetStep: string,
  endStep: string,
  executionScope: 'single_step' | 'full_flow',
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
  const flowStepNames = flow.steps.map((step) => step.name)
  const targetIndex = flowStepNames.indexOf(targetStep)
  if (targetIndex < 0) {
    throw new Error('Workspace rerun flow range is invalid.')
  }

  let orderedSteps = flow.steps
  if (executionScope === 'full_flow' && isLegacyStepSet(flowStepNames)) {
    // Fill missing known steps throughout the rerun range: flows created
    // before a step was inserted (e.g. Timing Opt, postRouteLec) still gain
    // it on a full-flow rerun instead of silently skipping the gate. The
    // known list is only consulted here because every step of this flow is
    // known; dynamic flows keep their own order and step set.
    const firstIndex = LEGACY_STEP_INDEX.get(targetStep)!
    const lastIndex = LEGACY_STEP_INDEX.get(endStep) ?? LEGACY_STEP_SEQUENCE.length - 1
    const present = new Map(flow.steps.map((step) => [step.name, step]))
    const retained: WorkspaceFlowStep[] = flow.steps
      .filter((step) => (LEGACY_STEP_INDEX.get(step.name) ?? -1) < firstIndex)
      .sort(
        (left, right) =>
          (LEGACY_STEP_INDEX.get(left.name) ?? -1) -
          (LEGACY_STEP_INDEX.get(right.name) ?? -1),
      )
    orderedSteps = []
    for (let index = firstIndex; index <= lastIndex; index += 1) {
      const name = LEGACY_STEP_SEQUENCE[index]!
      orderedSteps.push(
        present.get(name) ?? {
          name,
          tool: defaultStepTool(name),
          state: 'Unstart',
          runtime: '',
        },
      )
    }
    orderedSteps = [...retained, ...orderedSteps]
  }

  // Always wipe from the start stage through the end of the prepared flow so
  // single-step reruns do not leave stale dependent outputs from later stages.
  const wipeStart = orderedSteps.findIndex((step) => step.name === targetStep)
  if (wipeStart < 0) {
    throw new Error('Workspace rerun flow range is invalid.')
  }
  for (const step of orderedSteps.slice(wipeStart)) {
    await emptyWorkspaceStepDirectory(workspace, step)
    step.state = 'Unstart'
    step.runtime = ''
  }
  flow.data.steps = orderedSteps
  await writeFile(flowPath, `${JSON.stringify(flow.data, null, 2)}\n`, 'utf8')
}

async function prepareWorkspaceRerunMetadata(options: {
  sourceWorkspace: string
  sourceWorkspaceRaw: string
  stagedWorkspace: string
  targetStep: string
  targetWorkspace: string
}): Promise<void> {
  const home = await resolvePathWithinWorkspace(
    options.stagedWorkspace,
    join(options.stagedWorkspace, 'home'),
    'rerun home',
  )
  await removeLegacyWorkspaceHomeFiles(home)
  await rewriteWorkspaceHomeFilePaths(home, options)

  const flowPath = await resolvePathWithinWorkspace(
    options.stagedWorkspace,
    join(options.stagedWorkspace, 'home', 'flow.json'),
    'rerun flow',
  )
  const flow = parseWorkspaceFlow(await readFile(flowPath, 'utf8'))
  const flowStepNames = flow.steps.map((step) => step.name)
  const targetIndex = flowStepNames.indexOf(options.targetStep)
  if (targetIndex < 0) {
    throw new Error('Workspace rerun metadata prune target is invalid.')
  }

  await pruneWorkspaceRerunChecklistJson(
    join(home, 'checklist.json'),
    flowStepNames,
    targetIndex,
  )
}

async function removeLegacyWorkspaceHomeFiles(homeDirectory: string): Promise<void> {
  const removals: string[] = []
  for (const filename of LEGACY_HOME_FILES) {
    const path = join(homeDirectory, filename)
    try {
      const stats = await lstat(path)
      if (!stats.isFile() && !stats.isSymbolicLink()) {
        throw new Error(`Workspace rerun legacy home file is invalid: ${filename}`)
      }
      removals.push(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  for (const path of removals) {
    await unlink(path)
  }
}

function trimPathSeparators(value: string): string {
  return value.replace(/[\\/]+$/g, '')
}

function normalizePathSeparators(value: string): string {
  return value.replace(/\\/g, '/')
}

function isJsonWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r'
}

function nextNonWhitespaceChar(raw: string, index: number): string | undefined {
  while (index < raw.length && isJsonWhitespace(raw[index]!)) {
    index += 1
  }
  return raw[index]
}

/**
 * Rewrite decoded JSON string values with rewriteSourceRootedPath, then
 * re-escape only those tokens. Object keys are left untouched even when they
 * look like workspace paths (`{"/src/ws/cache":"metadata"}`). Raw-text
 * replacement misses JSON-escaped Windows paths (`C:\\runs\\gcd`) and can
 * insert unescaped native separators into otherwise slash-based JSON.
 */
export function rewriteJsonSourcePathStrings(
  raw: string,
  prefixes: string[],
  targetWorkspace: string,
): string {
  let index = 0
  let output = ''
  while (index < raw.length) {
    const char = raw[index]
    if (char !== '"') {
      output += char
      index += 1
      continue
    }
    const start = index
    index += 1
    let decoded = ''
    let escaped = false
    while (index < raw.length) {
      const current = raw[index]
      if (escaped) {
        if (current === 'u' && /^[0-9a-fA-F]{4}/.test(raw.slice(index + 1, index + 5))) {
          decoded += String.fromCharCode(
            Number.parseInt(raw.slice(index + 1, index + 5), 16),
          )
          index += 5
        } else {
          decoded += unescapeJsonChar(current)
          index += 1
        }
        escaped = false
        continue
      }
      if (current === '\\') {
        escaped = true
        index += 1
        continue
      }
      if (current === '"') {
        index += 1
        break
      }
      decoded += current
      index += 1
    }
    // In JSON, a string is an object key iff the next non-whitespace token is
    // `:`. Keys are identity, not workspace-rooted values.
    if (nextNonWhitespaceChar(raw, index) === ':') {
      output += raw.slice(start, index)
      continue
    }
    const rewritten = rewriteSourceRootedPath(decoded, prefixes, targetWorkspace)
    output += rewritten === decoded ? raw.slice(start, index) : JSON.stringify(rewritten)
  }
  return output
}

/**
 * Rewrite a parsed string scalar that is the source workspace root or a
 * path under it. Comparison is separator-normalized so Windows leaves
 * (`C:\runs\gcd\origin\gcd.v`) match a `/`-terminated prefix; the
 * replacement keeps the original value's separator style.
 */

export function rewriteSourceRootedPath(
  value: string,
  prefixes: string[],
  targetWorkspace: string,
): string {
  const valueNormalized = normalizePathSeparators(value)
  const targetTrimmed = trimPathSeparators(targetWorkspace)
  const targetNormalized = normalizePathSeparators(targetTrimmed)
  const separator = value.includes('\\') || targetWorkspace.includes('\\') ? '\\' : '/'
  for (const prefix of prefixes) {
    const trimmed = trimPathSeparators(prefix)
    if (!trimmed) continue
    const trimmedNormalized = normalizePathSeparators(trimmed)
    if (!trimmedNormalized || trimmedNormalized === targetNormalized) continue
    if (valueNormalized === trimmedNormalized) return targetWorkspace
    if (valueNormalized.startsWith(`${trimmedNormalized}/`)) {
      const rest = valueNormalized.slice(trimmedNormalized.length + 1)
      const renderedRest = separator === '\\' ? rest.replace(/\//g, '\\') : rest
      return `${targetTrimmed}${separator}${renderedRest}`
    }
  }
  return value
}

export async function rewriteWorkspaceHomeFilePaths(
  homeDirectory: string,
  options: {
    sourceWorkspace: string
    sourceWorkspaceRaw: string
    targetWorkspace: string
  },
): Promise<void> {
  const prefixes = uniquePathPrefixes([
    options.sourceWorkspace,
    options.sourceWorkspaceRaw,
  ])
  if (prefixes.length === 0) return

  let authorizedParent: string
  try {
    const homeStats = await lstat(homeDirectory)
    if (homeStats.isSymbolicLink() || !homeStats.isDirectory()) {
      throw new Error(
        `Refusing to rewrite ${homeDirectory}: the home directory is a symlink or not a regular directory`,
      )
    }
    authorizedParent = await realpath(homeDirectory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }

  let entries: string[]
  try {
    entries = await readdir(homeDirectory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    if (entry === 'flow_agent_workspace_rerun_contract.v1.json') continue
    const filePath = join(homeDirectory, entry)
    const canonicalPath = join(authorizedParent, entry)
    // Skip anything that is not a regular file: a symlinked config (the
    // clone preserves it) would otherwise redirect the rewrite outside the
    // workspace, and the read must not follow it either. Parent revalidation
    // uses the already-authorized home directory so a swapped ancestor
    // cannot retarget the rewrite.
    const entryStats = await lstat(filePath)
    if (!entryStats.isFile() || entryStats.isSymbolicLink()) continue
    const original = await readFile(canonicalPath, 'utf8')
    const rewritten = rewriteJsonSourcePathStrings(
      original,
      prefixes,
      options.targetWorkspace,
    )
    if (rewritten !== original) {
      await writeFile(filePath, rewritten, 'utf8')
    }
  }
}

function unescapeJsonChar(char: string): string {
  switch (char) {
    case '"':
    case '\\':
    case '/':
      return char
    case 'b':
      return '\b'
    case 'f':
      return '\f'
    case 'n':
      return '\n'
    case 'r':
      return '\r'
    case 't':
      return '\t'
    default:
      return char
  }
}

function uniquePathPrefixes(values: string[]): string[] {
  const prefixes = new Set<string>()
  for (const value of values) {
    const trimmed = trimPathSeparators(value.trim())
    if (!trimmed) continue
    prefixes.add(trimmed)
    prefixes.add(trimmed.replace(/\\/g, '/'))
    prefixes.add(trimmed.replace(/\//g, '\\'))
  }
  return [...prefixes].sort((left, right) => right.length - left.length)
}

async function pruneWorkspaceRerunChecklistJson(
  checklistPath: string,
  flowStepNames: string[],
  targetIndex: number,
): Promise<void> {
  let raw: string
  try {
    raw = await readFile(checklistPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }

  let data: Record<string, unknown>
  try {
    data = JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new Error('Workspace rerun checklist.json is invalid.')
  }

  const items = Array.isArray(data.checklist) ? data.checklist : []
  const kept = items.filter((item) => {
    if (!item || typeof item !== 'object') return true
    const step = (item as { step?: unknown }).step
    if (typeof step !== 'string') return true
    // Entries for obsolete steps or steps outside this workspace flow are
    // dangling; steps at or after the rerun target are being reset.
    if (isObsoleteFlowStep(step)) return false
    const stepIndex = flowStepNames.indexOf(step)
    return stepIndex >= 0 && stepIndex < targetIndex
  })

  let passed = 0
  let blocked = 0
  let attention = 0
  let unavailable = 0
  for (const item of kept) {
    if (!item || typeof item !== 'object') {
      unavailable += 1
      continue
    }
    const record = item as { state?: unknown; blocked?: unknown }
    if (
      record.blocked === true ||
      record.state === 'failed' ||
      record.state === 'blocked'
    ) {
      blocked += 1
    } else if (record.state === 'pass' || record.state === 'passed') {
      passed += 1
    } else if (record.state === 'attention') {
      attention += 1
    } else {
      unavailable += 1
    }
  }

  data.checklist = kept
  data.summary = { passed, blocked, attention, unavailable }
  data.status = blocked > 0 ? 'blocked' : attention > 0 ? 'attention' : 'ready'
  await writeFile(checklistPath, `${JSON.stringify(data, null, 4)}\n`, 'utf8')
}

async function emptyWorkspaceStepDirectory(
  workspace: string,
  step: WorkspaceFlowStep,
): Promise<void> {
  const stageDirectory = join(workspace, rerunStageDirectoryName(step.name, step.tool))
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

function isSafeFlowStepName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9 _-]{0,127}$/.test(name)
}

function parseWorkspaceFlow(flowText: string): {
  data: { steps: WorkspaceFlowStep[] }
  steps: WorkspaceFlowStep[]
} {
  try {
    const data = JSON.parse(flowText) as { steps?: unknown }
    if (!Array.isArray(data.steps)) throw new Error('steps are missing')
    const steps = data.steps
      .filter(
        (value) =>
          typeof value !== 'object' ||
          value === null ||
          !isObsoleteFlowStep(String((value as { name?: unknown }).name ?? '')),
      )
      .map((value) => {
        if (typeof value !== 'object' || value === null) {
          throw new Error('step is invalid')
        }
        const record = value as {
          name?: unknown
          tool?: unknown
          state?: unknown
          runtime?: unknown
        }
        if (typeof record.name !== 'string' || !isSafeFlowStepName(record.name)) {
          throw new Error('step is invalid')
        }
        if (typeof record.state !== 'string') {
          throw new Error('step is invalid')
        }
        const step: WorkspaceFlowStep = {
          name: record.name,
          tool:
            typeof record.tool === 'string' && /^[A-Za-z0-9_-]+$/.test(record.tool)
              ? record.tool
              : defaultStepTool(record.name),
          state: record.state,
        }
        if (typeof record.runtime === 'string') step.runtime = record.runtime
        return step
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
