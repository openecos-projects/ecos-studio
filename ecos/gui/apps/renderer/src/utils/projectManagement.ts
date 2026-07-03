import type { Project } from '@/types'

export const FLOW_STEPS = [
  'Synth',
  'Floor',
  'Fanout',
  'Place',
  'CTS',
  'Legal',
  'Route',
  'DRC',
  'Filler',
  'RCX',
  'STA',
  'Harden',
] as const

export type FlowStep = typeof FLOW_STEPS[number]
export type ProjectStepStatus = 'success' | 'reused' | 'skipped' | 'unstart' | 'running' | 'failed'
export type ProjectWorkspaceStatus = 'success' | 'failed' | 'running' | 'in_progress' | 'not_started' | 'archived'
export type MetricsRowKind = 'line' | 'bar'
export type ProjectMetricId = 'wns' | 'tns' | 'drc' | 'area' | 'runtime'
export type ProjectWorkspaceFlowStateMap = Partial<Record<FlowStep, ProjectStepStatus>>
export type ProjectWorkspaceFlowStatesById = Record<string, ProjectWorkspaceFlowStateMap>

export interface ProjectManifestBaseDesign {
  pdk?: string
  pdk_root?: string
  top_module?: string
  clock?: string
  rtl_list?: string[]
  origin_verilog?: string
  origin_def?: string
  parameters?: Record<string, unknown>
}

export interface ProjectMetricSummary {
  wns?: number
  tns?: number
  drc_count?: number
  area?: number
  runtime_sec?: number
  [key: string]: unknown
}

export interface ProjectWorkspaceManifest {
  workspace_id: string
  name: string
  workspace_path: string
  source_workspace_id: string | null
  branch_from: {
    source_workspace_id: string
    source_step: FlowStep | string
    source_output_type?: string
    source_output_path?: string
  } | null
  start_step: FlowStep | string
  end_step: FlowStep | string
  status: ProjectWorkspaceStatus
  created_at: string
  updated_at: string
  parameter_patch: Record<string, unknown>
  metrics_summary: ProjectMetricSummary
  step_metrics: Record<string, Record<string, unknown>>
}

export interface ProjectManifest {
  schema_version: 1
  project_id: string
  name: string
  description: string
  root_path: string
  created_at: string
  updated_at: string
  base_design: ProjectManifestBaseDesign
  objectives: {
    primary: string
    directions: Record<string, 'maximize' | 'minimize'>
  }
  workspaces: ProjectWorkspaceManifest[]
  best_workspace: {
    workspace_id: string
    reason: string
  } | null
}

export interface ProjectStepCell {
  step: FlowStep
  status: ProjectStepStatus
  label: string
  canCreateWorkspace: boolean
}

export interface ProjectWorkspace {
  id: string
  name: string
  workspacePath: string
  status: ProjectWorkspaceStatus
  description: string
  sourceWorkspaceId: string | null
  branchStep: FlowStep | null
  startStep: FlowStep
  endStep: FlowStep
  steps: ProjectStepCell[]
}

export interface ProjectMetricPoint {
  workspaceId: string
  label: string
  value: number | null
  state: 'good' | 'warn' | 'bad' | 'pending'
}

export interface ProjectMetricRow {
  id: ProjectMetricId
  label: string
  hint: string
  kind: MetricsRowKind
  points: ProjectMetricPoint[]
}

export interface ProjectBranchLink {
  fromWorkspaceId: string
  fromStep: FlowStep
  toWorkspaceId: string
  toStep: FlowStep
}

export interface ProjectComparisonParameterDiff {
  workspaceId: string
  name: string
  from: string | undefined
  to: string | undefined
}

export interface ProjectComparisonMetricDiff {
  metric: string
  fromWorkspaceId: string
  toWorkspaceId: string
  delta: number
  state: 'good' | 'warn' | 'bad' | 'pending'
}

export interface ProjectComparisonSummary {
  bestWorkspaceId: string
  bestReason: string
  riskLabels: string[]
  parameterDiffs: ProjectComparisonParameterDiff[]
  metricDiffs: ProjectComparisonMetricDiff[]
}

export interface ProjectManagementProject {
  id: string
  name: string
  path: string
  pdk?: string
  topModule?: string
  objective: string
  bestWorkspaceId: string
  workspaces: ProjectWorkspace[]
  metricsRows: ProjectMetricRow[]
  branchLinks: ProjectBranchLink[]
  comparisonSummary: ProjectComparisonSummary
}

export interface ProjectSelectionState {
  selectedWorkspaceId: string
  selectedStep: FlowStep
}

export interface ProjectManifestDraftInput {
  rootPath: string
  name: string
  now?: string
}

export interface ProjectWorkspaceRegistrationInput {
  projectRoot: string
  projectName?: string
  workspacePath: string
  sourceWorkspaceId?: string
  sourceStep?: FlowStep | string
  sourceOutputPath?: string
  sourceOutputType?: string
  startStep?: FlowStep | string
  endStep?: FlowStep | string
  now?: string
  config?: {
    pdk?: string
    pdk_root?: string
    rtl_list?: string[]
    origin_verilog?: string
    origin_def?: string
    parameters?: Record<string, unknown>
  }
}

export interface WorkspaceBranchDraft {
  sourceWorkspaceId: string
  sourceWorkspacePath: string
  step: FlowStep
  targetWorkspaceId: string
  targetWorkspacePath: string
  targetStartStep: FlowStep
  targetEndStep: FlowStep
  sourceOutputType: 'verilog' | 'def'
  sourceOutputPath: string
  originVerilog?: string
  originDef?: string
}

const FLOW_STEP_ALIASES: Record<string, FlowStep> = {
  synthesis: 'Synth',
  synth: 'Synth',
  floorplan: 'Floor',
  floor: 'Floor',
  fixfanout: 'Fanout',
  fanout: 'Fanout',
  place: 'Place',
  placement: 'Place',
  cts: 'CTS',
  legalization: 'Legal',
  legal: 'Legal',
  route: 'Route',
  routing: 'Route',
  drc: 'DRC',
  filler: 'Filler',
  rcx: 'RCX',
  sta: 'STA',
  gds: 'Harden',
  signoff: 'Harden',
  harden: 'Harden',
}

const RUNTIME_STEP_ARTIFACTS: Record<FlowStep, {
  directory: string
  outputName: string
}> = {
  Synth: { directory: 'Synthesis_yosys', outputName: 'Synthesis' },
  Floor: { directory: 'Floorplan_ecc', outputName: 'Floorplan' },
  Fanout: { directory: 'fixFanout_ecc', outputName: 'fixFanout' },
  Place: { directory: 'place_dreamplace', outputName: 'place' },
  CTS: { directory: 'CTS_ecc', outputName: 'CTS' },
  Legal: { directory: 'legalization_dreamplace', outputName: 'legalization' },
  Route: { directory: 'route_ecc', outputName: 'route' },
  DRC: { directory: 'drc_ecc', outputName: 'drc' },
  Filler: { directory: 'filler_ecc', outputName: 'filler' },
  RCX: { directory: 'RCX_ecc', outputName: 'RCX' },
  STA: { directory: 'sta_ecc', outputName: 'sta' },
  Harden: { directory: 'Harden_ecc', outputName: 'Harden' },
}

const METRIC_DEFINITIONS: Array<{
  id: ProjectMetricId
  label: string
  hint: string
  kind: MetricsRowKind
  manifestKey: keyof ProjectMetricSummary
}> = [
  { id: 'wns', label: 'WNS', hint: 'timing slack', kind: 'line', manifestKey: 'wns' },
  { id: 'tns', label: 'TNS', hint: 'total negative slack', kind: 'line', manifestKey: 'tns' },
  { id: 'drc', label: 'DRC', hint: 'violation count', kind: 'bar', manifestKey: 'drc_count' },
  { id: 'area', label: 'Area', hint: 'cell area', kind: 'bar', manifestKey: 'area' },
  { id: 'runtime', label: 'Runtime', hint: 'total runtime', kind: 'bar', manifestKey: 'runtime_sec' },
]

export function buildProjectManagementProject(
  project?: Project | null,
  manifest?: ProjectManifest | null,
  workspaceFlowStates: ProjectWorkspaceFlowStatesById = {},
): ProjectManagementProject {
  const path = manifest?.root_path ?? project?.path ?? ''
  const name = manifest?.name ?? project?.name ?? 'No Project Selected'
  const topModule = manifest?.base_design.top_module ?? project?.topModule
  const pdk = manifest?.base_design.pdk ?? project?.pdk
  const workspaces = manifest?.workspaces.map(workspace =>
    buildProjectWorkspace(workspace, workspaceFlowStates[workspace.workspace_id] ?? {}),
  ) ?? []
  const comparisonSummary = manifest ? buildComparisonSummary(manifest) : emptyComparisonSummary()

  return {
    id: manifest?.project_id ?? project?.id ?? '',
    name,
    path,
    pdk,
    topModule,
    objective: buildObjective(project, manifest),
    bestWorkspaceId: comparisonSummary.bestWorkspaceId,
    workspaces,
    metricsRows: manifest ? buildMetricRows(manifest.workspaces) : [],
    branchLinks: manifest ? buildBranchLinks(manifest.workspaces) : [],
    comparisonSummary,
  }
}

export function createSelectionState(project: ProjectManagementProject): ProjectSelectionState {
  return {
    selectedWorkspaceId: project.bestWorkspaceId || project.workspaces[0]?.id || '',
    selectedStep: 'DRC',
  }
}

export function createProjectManifestDraft(input: ProjectManifestDraftInput): ProjectManifest {
  const now = input.now ?? new Date().toISOString()
  return {
    schema_version: 1,
    project_id: `proj_${slugify(input.name || basenamePath(input.rootPath) || 'project')}`,
    name: input.name || basenamePath(input.rootPath) || 'project',
    description: '',
    root_path: normalizePath(input.rootPath),
    created_at: now,
    updated_at: now,
    base_design: {
      parameters: {},
      rtl_list: [],
    },
    objectives: {
      primary: 'timing',
      directions: {
        wns: 'maximize',
        tns: 'maximize',
        area: 'minimize',
        drc_count: 'minimize',
        power: 'minimize',
      },
    },
    workspaces: [],
    best_workspace: null,
  }
}

export function serializeProjectManifest(manifest: ProjectManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

export function parseProjectManifest(content: string): ProjectManifest {
  const parsed = JSON.parse(content) as ProjectManifest
  if (parsed.schema_version !== 1 || !Array.isArray(parsed.workspaces)) {
    throw new Error('Invalid project manifest.')
  }
  return parsed
}

export function parseWorkspaceFlowStateMap(content: string): ProjectWorkspaceFlowStateMap {
  const parsed = JSON.parse(content) as { steps?: Array<{ name?: unknown; state?: unknown }> }
  if (!Array.isArray(parsed.steps)) return {}

  return parsed.steps.reduce<ProjectWorkspaceFlowStateMap>((stateMap, step) => {
    const name = optionalString(step.name)
    const status = projectStepStatusFromFlowState(step.state)
    if (!name || !status) return stateMap

    stateMap[normalizeFlowStep(name)] = status
    return stateMap
  }, {})
}

export function nextWorkspaceId(project: ProjectManagementProject): string {
  const numbers = project.workspaces
    .map(workspace => Number(workspace.id.replace(/^ws_/, '')))
    .filter(Number.isFinite)
  const next = Math.max(0, ...numbers) + 1
  return `ws_${String(next).padStart(4, '0')}`
}

export function createWorkspaceBranchDraft(
  project: ProjectManagementProject,
  sourceWorkspaceId: string,
  step: FlowStep,
): WorkspaceBranchDraft {
  const targetWorkspaceId = nextWorkspaceId(project)
  const sourceWorkspace = project.workspaces.find(workspace => workspace.id === sourceWorkspaceId)
  const sourceOutputType = step === 'Synth' ? 'verilog' : 'def'
  const sourceWorkspacePath = sourceWorkspace?.workspacePath ?? joinPath(project.path, sourceWorkspaceId)
  const designName = projectArtifactDesignName(project)
  const sourceOutputPath = sourceStepOutputPath(sourceWorkspacePath, step, designName)
  const artifactOrigin = sourceOutputType === 'verilog'
    ? { originVerilog: sourceOutputPath }
    : {
        originDef: sourceOutputPath,
        originVerilog: sourceStepOutputVerilogPath(sourceWorkspacePath, step, designName),
      }

  return {
    sourceWorkspaceId,
    sourceWorkspacePath,
    step,
    targetWorkspaceId,
    targetWorkspacePath: joinPath(project.path, targetWorkspaceId),
    targetStartStep: nextFlowStep(step),
    targetEndStep: 'Harden',
    sourceOutputType,
    sourceOutputPath,
    ...artifactOrigin,
  }
}

export function registerWorkspaceInManifest(
  manifest: ProjectManifest,
  input: ProjectWorkspaceRegistrationInput,
): ProjectManifest {
  const now = input.now ?? new Date().toISOString()
  const workspacePath = normalizePath(input.workspacePath)
  const workspaceId = basenamePath(workspacePath) || nextManifestWorkspaceId(manifest)
  const existingWorkspace = manifest.workspaces.find(workspace =>
    workspace.workspace_id === workspaceId || normalizePath(workspace.workspace_path) === workspacePath,
  )
  const sourceStep = input.sourceStep ? normalizeFlowStep(input.sourceStep) : null
  const sourceWorkspaceId = input.sourceWorkspaceId || existingWorkspace?.source_workspace_id || null
  const branchFrom = sourceWorkspaceId && sourceStep
    ? {
        source_workspace_id: sourceWorkspaceId,
        source_step: sourceStep,
        source_output_type: input.sourceOutputType || existingWorkspace?.branch_from?.source_output_type || defaultSourceOutputType(sourceStep),
        source_output_path: input.sourceOutputPath || existingWorkspace?.branch_from?.source_output_path,
      }
    : existingWorkspace?.branch_from ?? null
  const startStep = input.startStep
    ? normalizeFlowStep(input.startStep)
    : sourceStep
      ? nextFlowStep(sourceStep)
      : normalizeFlowStep(existingWorkspace?.start_step ?? 'Synth')
  const endStep = input.endStep
    ? normalizeFlowStep(input.endStep)
    : normalizeFlowStep(existingWorkspace?.end_step ?? 'Harden')
  const workspaceName = optionalString(input.config?.parameters?.design)
    || existingWorkspace?.name
    || workspaceId
  const parameterPatch = input.config?.parameters
    ? {
        ...(existingWorkspace?.parameter_patch ?? {}),
        ...buildParameterPatch(manifest.base_design.parameters ?? {}, input.config.parameters),
      }
    : existingWorkspace?.parameter_patch ?? {}

  const workspace: ProjectWorkspaceManifest = {
    workspace_id: workspaceId,
    name: workspaceName,
    workspace_path: workspacePath,
    source_workspace_id: sourceWorkspaceId,
    branch_from: branchFrom,
    start_step: startStep,
    end_step: endStep,
    status: existingWorkspace?.status ?? 'not_started',
    created_at: existingWorkspace?.created_at ?? now,
    updated_at: now,
    parameter_patch: parameterPatch,
    metrics_summary: existingWorkspace?.metrics_summary ?? {},
    step_metrics: existingWorkspace?.step_metrics ?? {},
  }

  const workspaces = existingWorkspace
    ? manifest.workspaces.map(item =>
        item.workspace_id === existingWorkspace.workspace_id ? workspace : item,
      )
    : [...manifest.workspaces, workspace]

  return {
    ...manifest,
    name: input.projectName || manifest.name,
    root_path: normalizePath(input.projectRoot || manifest.root_path),
    updated_at: now,
    base_design: mergeBaseDesignConfig(manifest.base_design, input.config),
    workspaces,
  }
}

export function archiveWorkspaceInManifest(
  manifest: ProjectManifest,
  workspaceId: string,
  now = new Date().toISOString(),
): ProjectManifest {
  return {
    ...manifest,
    updated_at: now,
    best_workspace: manifest.best_workspace?.workspace_id === workspaceId ? null : manifest.best_workspace,
    workspaces: manifest.workspaces.map(workspace =>
      workspace.workspace_id === workspaceId
        ? {
            ...workspace,
            status: 'archived',
            updated_at: now,
          }
        : workspace,
    ),
  }
}

export function deleteWorkspaceFromManifest(
  manifest: ProjectManifest,
  workspaceId: string,
  now = new Date().toISOString(),
): ProjectManifest {
  return {
    ...manifest,
    updated_at: now,
    best_workspace: manifest.best_workspace?.workspace_id === workspaceId ? null : manifest.best_workspace,
    workspaces: manifest.workspaces
      .filter(workspace => workspace.workspace_id !== workspaceId)
      .map(workspace => {
        const clearsSource = workspace.source_workspace_id === workspaceId || workspace.branch_from?.source_workspace_id === workspaceId
        if (!clearsSource) return workspace

        return {
          ...workspace,
          source_workspace_id: workspace.source_workspace_id === workspaceId ? null : workspace.source_workspace_id,
          branch_from: workspace.branch_from?.source_workspace_id === workspaceId ? null : workspace.branch_from,
          updated_at: now,
        }
      }),
  }
}

function buildObjective(project?: Project | null, manifest?: ProjectManifest | null): string {
  if (manifest?.objectives.primary) return `${manifest.objectives.primary} objective`
  return project?.frequencyTarget ? `timing · ${project.frequencyTarget}MHz` : 'No project data'
}

function buildProjectWorkspace(
  workspace: ProjectWorkspaceManifest,
  flowStateMap: ProjectWorkspaceFlowStateMap,
): ProjectWorkspace {
  const startStep = normalizeFlowStep(workspace.start_step)
  const endStep = normalizeFlowStep(workspace.end_step)
  const branchStep = workspace.branch_from ? normalizeFlowStep(workspace.branch_from.source_step) : null

  return {
    id: workspace.workspace_id,
    name: workspace.name,
    workspacePath: workspace.workspace_path,
    status: workspace.status,
    description: workspace.branch_from
      ? `from ${workspace.branch_from.source_workspace_id}/${branchStep}`
      : 'initial workspace',
    sourceWorkspaceId: workspace.source_workspace_id,
    branchStep,
    startStep,
    endStep,
    steps: FLOW_STEPS.map(step => buildStepCell(workspace, step, startStep, endStep, branchStep, flowStateMap)),
  }
}

function buildStepCell(
  workspace: ProjectWorkspaceManifest,
  step: FlowStep,
  startStep: FlowStep,
  endStep: FlowStep,
  branchStep: FlowStep | null,
  flowStateMap: ProjectWorkspaceFlowStateMap,
): ProjectStepCell {
  const stepIndex = FLOW_STEPS.indexOf(step)
  const startIndex = FLOW_STEPS.indexOf(startStep)
  const endIndex = FLOW_STEPS.indexOf(endStep)
  const isBeforeStart = stepIndex < startIndex
  const isAfterEnd = stepIndex > endIndex
  let status: ProjectStepStatus

  const flowStatus = flowStateMap[step]
  if (workspace.status !== 'archived' && flowStatus) {
    status = flowStatus
  } else if (workspace.status === 'archived') {
    status = 'skipped'
  } else if (isBeforeStart) {
    status = workspace.branch_from && branchStep && stepIndex <= FLOW_STEPS.indexOf(branchStep)
      ? 'reused'
      : 'skipped'
  } else if (isAfterEnd) {
    status = 'skipped'
  } else if (workspace.status === 'running') {
    status = 'running'
  } else if (workspace.status === 'failed' && stepIndex === endIndex) {
    status = 'failed'
  } else if (workspace.status === 'not_started') {
    status = 'unstart'
  } else {
    status = 'success'
  }

  return {
    step,
    status,
    label: labelForStepStatus(status),
    canCreateWorkspace: status === 'success',
  }
}

function projectStepStatusFromFlowState(state: unknown): ProjectStepStatus | null {
  const normalized = optionalString(state).toLowerCase()
  if (!normalized) return null

  if (['success', 'succeeded', 'complete', 'completed', 'done'].includes(normalized)) return 'success'
  if (['ongoing', 'running', 'run'].includes(normalized)) return 'running'
  if (['failed', 'failure', 'error', 'invalid', 'incomplete'].includes(normalized)) return 'failed'
  if (['unstart', 'unstarted', 'not_started', 'not started', 'pending', 'created'].includes(normalized)) return 'unstart'
  return null
}

function buildMetricRows(workspaces: ProjectWorkspaceManifest[]): ProjectMetricRow[] {
  if (workspaces.length === 0) return []

  return METRIC_DEFINITIONS.map(definition => ({
    id: definition.id,
    label: definition.label,
    hint: definition.hint,
    kind: definition.kind,
    points: workspaces.map(workspace => {
      const value = asNumber(workspace.metrics_summary[definition.manifestKey])
      return {
        workspaceId: workspace.workspace_id,
        label: value === null ? '-' : String(value),
        value,
        state: metricState(definition.id, value),
      }
    }),
  }))
}

function buildBranchLinks(workspaces: ProjectWorkspaceManifest[]): ProjectBranchLink[] {
  return workspaces.flatMap(workspace => {
    if (!workspace.branch_from) return []
    return [{
      fromWorkspaceId: workspace.branch_from.source_workspace_id,
      fromStep: normalizeFlowStep(workspace.branch_from.source_step),
      toWorkspaceId: workspace.workspace_id,
      toStep: normalizeFlowStep(workspace.start_step),
    }]
  })
}

function emptyComparisonSummary(): ProjectComparisonSummary {
  return {
    bestWorkspaceId: '',
    bestReason: '',
    riskLabels: [],
    parameterDiffs: [],
    metricDiffs: [],
  }
}

function buildComparisonSummary(manifest: ProjectManifest): ProjectComparisonSummary {
  const activeWorkspaces = manifest.workspaces.filter(workspace => workspace.status !== 'archived')
  const explicitBest = manifest.best_workspace
    ? activeWorkspaces.find(workspace => workspace.workspace_id === manifest.best_workspace?.workspace_id)
    : null
  const bestWorkspace = explicitBest ?? chooseBestWorkspace(activeWorkspaces)
  const baselineWorkspace = activeWorkspaces[0] ?? null

  return {
    bestWorkspaceId: bestWorkspace?.workspace_id ?? '',
    bestReason: explicitBest
      ? manifest.best_workspace?.reason ?? ''
      : bestWorkspace
        ? `Selected by ${manifest.objectives.primary || 'project'} objective`
        : '',
    riskLabels: buildRiskLabels(activeWorkspaces),
    parameterDiffs: buildParameterDiffs(activeWorkspaces),
    metricDiffs: buildMetricDiffs(baselineWorkspace, bestWorkspace),
  }
}

function chooseBestWorkspace(workspaces: ProjectWorkspaceManifest[]): ProjectWorkspaceManifest | null {
  if (workspaces.length === 0) return null
  return [...workspaces].sort((left, right) => workspaceScore(right) - workspaceScore(left))[0]
}

function workspaceScore(workspace: ProjectWorkspaceManifest): number {
  const statusScore = {
    success: 500,
    in_progress: 250,
    running: 150,
    not_started: 50,
    failed: -100,
    archived: -1000,
  } satisfies Record<ProjectWorkspaceStatus, number>
  const wns = asNumber(workspace.metrics_summary.wns) ?? -100
  const tns = asNumber(workspace.metrics_summary.tns) ?? -100
  const drc = asNumber(workspace.metrics_summary.drc_count) ?? 999
  const area = asNumber(workspace.metrics_summary.area) ?? 0
  return statusScore[workspace.status] + (wns * 100) + (tns * 4) - (drc * 5) - (area * 0.0001)
}

function buildRiskLabels(workspaces: ProjectWorkspaceManifest[]): string[] {
  const risks: string[] = []
  if (workspaces.some(workspace => (asNumber(workspace.metrics_summary.drc_count) ?? 0) > 0)) {
    risks.push('DRC violations present')
  }
  if (workspaces.some(workspace => (asNumber(workspace.metrics_summary.wns) ?? 0) < 0)) {
    risks.push('Negative WNS')
  }
  if (workspaces.some(workspace => workspace.status === 'failed')) {
    risks.push('Failed workspace present')
  }
  if (workspaces.some(workspace => workspace.status === 'running' || workspace.status === 'in_progress')) {
    risks.push('Workspace still running')
  }
  return risks
}

function buildParameterDiffs(workspaces: ProjectWorkspaceManifest[]): ProjectComparisonParameterDiff[] {
  return workspaces.flatMap(workspace =>
    Object.entries(workspace.parameter_patch ?? {}).map(([name, patch]) => {
      const values = parameterPatchValues(patch)
      return {
        workspaceId: workspace.workspace_id,
        name,
        from: diffValueLabel(values.from),
        to: diffValueLabel(values.to),
      }
    }),
  )
}

function buildMetricDiffs(
  baselineWorkspace: ProjectWorkspaceManifest | null,
  targetWorkspace: ProjectWorkspaceManifest | null,
): ProjectComparisonMetricDiff[] {
  if (!baselineWorkspace || !targetWorkspace || baselineWorkspace.workspace_id === targetWorkspace.workspace_id) return []

  return METRIC_DEFINITIONS.flatMap(definition => {
    const from = asNumber(baselineWorkspace.metrics_summary[definition.manifestKey])
    const to = asNumber(targetWorkspace.metrics_summary[definition.manifestKey])
    if (from === null || to === null) return []
    const delta = Number((to - from).toFixed(4))
    return [{
      metric: definition.label,
      fromWorkspaceId: baselineWorkspace.workspace_id,
      toWorkspaceId: targetWorkspace.workspace_id,
      delta,
      state: metricDeltaState(definition.id, delta),
    }]
  })
}

function parameterPatchValues(patch: unknown): { from: unknown; to: unknown } {
  if (patch && typeof patch === 'object' && ('from' in patch || 'to' in patch)) {
    const record = patch as { from?: unknown; to?: unknown }
    return { from: record.from, to: record.to }
  }
  return { from: undefined, to: patch }
}

function diffValueLabel(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  return String(value)
}

function metricDeltaState(metricId: ProjectMetricId, delta: number): ProjectComparisonMetricDiff['state'] {
  if (delta === 0) return 'warn'
  if (metricId === 'wns' || metricId === 'tns') return delta > 0 ? 'good' : 'bad'
  return delta < 0 ? 'good' : 'bad'
}

function sourceStepOutputPath(workspacePath: string, step: FlowStep, designName: string): string {
  return sourceStepArtifactPath(workspacePath, step, defaultSourceOutputType(step), designName)
}

function sourceStepOutputVerilogPath(workspacePath: string, step: FlowStep, designName: string): string {
  return sourceStepArtifactPath(workspacePath, step, 'verilog', designName)
}

function sourceStepArtifactPath(
  workspacePath: string,
  step: FlowStep,
  artifactType: 'verilog' | 'def',
  designName: string,
): string {
  const artifact = RUNTIME_STEP_ARTIFACTS[step]
  if (!artifact || !designName) {
    const fileName = artifactType === 'verilog' ? 'design.v' : 'design.def'
    return joinPath(workspacePath, step, 'output', fileName)
  }

  const suffix = artifactType === 'verilog'
    ? step === 'Synth' ? '_fixed.v.gz' : '.v.gz'
    : '.def.gz'
  return joinPath(
    workspacePath,
    artifact.directory,
    'output',
    `${designName}_${artifact.outputName}${suffix}`,
  )
}

function projectArtifactDesignName(project: ProjectManagementProject): string {
  return normalizeArtifactDesignName(project.topModule) || normalizeArtifactDesignName(project.name)
}

function normalizeArtifactDesignName(value: string | undefined): string {
  return (value ?? '').trim().replace(/[\\/]/g, '_').replace(/\s+/g, '_')
}

function defaultSourceOutputType(step: FlowStep): 'verilog' | 'def' {
  return step === 'Synth' ? 'verilog' : 'def'
}

function buildParameterPatch(
  baseParameters: Record<string, unknown>,
  nextParameters: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  return Object.fromEntries(Object.entries(nextParameters)
    .filter(([key, value]) => baseParameters[key] !== value)
    .map(([key, value]) => [key, {
      from: Object.prototype.hasOwnProperty.call(baseParameters, key) ? baseParameters[key] : undefined,
      to: value,
    }]))
}

function normalizeFlowStep(step: FlowStep | string): FlowStep {
  if ((FLOW_STEPS as readonly string[]).includes(step)) return step as FlowStep
  return FLOW_STEP_ALIASES[String(step).toLowerCase()] ?? 'Synth'
}

function nextFlowStep(step: FlowStep): FlowStep {
  const index = FLOW_STEPS.indexOf(step)
  return FLOW_STEPS[Math.min(index + 1, FLOW_STEPS.length - 1)]
}

function nextManifestWorkspaceId(manifest: ProjectManifest): string {
  const numbers = manifest.workspaces
    .map(workspace => Number(workspace.workspace_id.replace(/^ws_/, '')))
    .filter(Number.isFinite)
  const next = Math.max(0, ...numbers) + 1
  return `ws_${String(next).padStart(4, '0')}`
}

function mergeBaseDesignConfig(
  baseDesign: ProjectManifestBaseDesign,
  config: ProjectWorkspaceRegistrationInput['config'],
): ProjectManifestBaseDesign {
  if (!config) return baseDesign

  const parameters = config.parameters ?? {}
  const next: ProjectManifestBaseDesign = {
    ...baseDesign,
    parameters: {
      ...(baseDesign.parameters ?? {}),
      ...parameters,
    },
  }
  const pdk = optionalString(config.pdk)
  const pdkRoot = optionalString(config.pdk_root)
  const topModule = optionalString(parameters.top_module)
  const clock = optionalString(parameters.clock)
  const originVerilog = optionalString(config.origin_verilog)
  const originDef = optionalString(config.origin_def)

  if (pdk) next.pdk = pdk
  if (pdkRoot) next.pdk_root = pdkRoot
  if (topModule) next.top_module = topModule
  if (clock) next.clock = clock
  if (originVerilog) next.origin_verilog = originVerilog
  if (originDef) next.origin_def = originDef
  if (config.rtl_list && config.rtl_list.length > 0) next.rtl_list = [...config.rtl_list]

  return next
}

function optionalString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function labelForStepStatus(status: ProjectStepStatus): string {
  const map: Record<ProjectStepStatus, string> = {
    success: 'S',
    reused: 'R',
    skipped: '-',
    unstart: 'U',
    running: '...',
    failed: '!',
  }
  return map[status]
}

function metricState(metricId: ProjectMetricId, value: number | null): ProjectMetricPoint['state'] {
  if (value === null) return 'pending'
  if (metricId === 'drc') {
    if (value === 0) return 'good'
    if (value <= 3) return 'warn'
    return 'bad'
  }
  if (value >= 0) return 'good'
  if (value >= -0.1) return 'warn'
  return 'bad'
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function slugify(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return slug || 'project'
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/g, '')
}

function joinPath(...parts: string[]): string {
  const joined = parts
    .filter(Boolean)
    .map((part, index) => index === 0 ? part.replace(/\/+$/g, '') : part.replace(/^\/+|\/+$/g, ''))
    .join('/')
  return normalizePath(joined)
}

function basenamePath(path: string): string {
  return normalizePath(path).split('/').filter(Boolean).pop() ?? ''
}
