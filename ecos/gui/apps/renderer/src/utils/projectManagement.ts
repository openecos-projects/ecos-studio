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

export type FlowStep = (typeof FLOW_STEPS)[number]
export type ProjectStepStatus =
  | 'success'
  | 'reused'
  | 'skipped'
  | 'unstart'
  | 'running'
  | 'failed'
export type ProjectWorkspaceStatus =
  | 'success'
  | 'failed'
  | 'running'
  | 'in_progress'
  | 'not_started'
  | 'archived'
export type MetricsRowKind = 'line' | 'bar'
export type ProjectMetricId =
  | 'wns'
  | 'tns'
  | 'drc'
  | 'area'
  | 'runtime'
  | 'memory'
  | 'die_area'
  | 'core_util'
  | 'frequency'
export type ProjectWorkspaceFlowStateMap = Partial<Record<FlowStep, ProjectStepStatus>>
export type ProjectWorkspaceFlowStatesById = Record<string, ProjectWorkspaceFlowStateMap>
export type ProjectFeatureFileKey =
  | 'synthesisStat'
  | 'floorplanDb'
  | 'fanoutDb'
  | 'fanoutStep'
  | 'placeDb'
  | 'placeMap'
  | 'ctsDb'
  | 'ctsStep'
  | 'ctsMap'
  | 'legalDb'
  | 'routeDb'
  | 'routeStep'
  | 'drcDb'
  | 'drcStep'
  | 'fillerDb'
  | 'fillerStep'
  | 'rcxDb'
  | 'staDb'

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

export interface ProjectStaReportInput {
  corner: string
  content: string | null
}

export interface ProjectWorkspaceAnalysisInput {
  files?: Partial<Record<ProjectFeatureFileKey, string | null>>
  stepMetricTexts?: Partial<Record<FlowStep, string | null>>
  staReports?: ProjectStaReportInput[]
  flowText?: string | null
  checklistText?: string | null
  parametersText?: string | null
}

export type ProjectWorkspaceAnalysisInputsById = Record<
  string,
  ProjectWorkspaceAnalysisInput
>

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
  artifactDesignName: string
  status: ProjectWorkspaceStatus
  description: string
  sourceWorkspaceId: string | null
  branchStep: FlowStep | null
  startStep: FlowStep
  endStep: FlowStep
  depth: number
  flowStatusHint: ProjectFlowStatusHint
  steps: ProjectStepCell[]
}

export interface ProjectFlowStatusHint {
  state: 'success' | 'failed' | 'running' | 'unstart' | 'skipped'
  step?: FlowStep
  label: string
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

export interface ProjectSummaryMetric {
  id: string
  label: string
  value: number | null
  display: string
  state: ProjectMetricPoint['state']
  hint?: string
}

export interface ProjectWorkspaceFinalMetrics {
  drcCount?: ProjectSummaryMetric
  setupWns?: ProjectSummaryMetric
  setupTns?: ProjectSummaryMetric
  holdWns?: ProjectSummaryMetric
  holdTns?: ProjectSummaryMetric
  area?: ProjectSummaryMetric
  dieArea?: ProjectSummaryMetric
  coreUtil?: ProjectSummaryMetric
  frequency?: ProjectSummaryMetric
}

export interface ProjectWorkspaceFlowMetrics {
  totalRuntimeSec: number
  peakMemoryMb: number
  checklistPassed: number
  checklistFailed: number
  checklistWarning: number
  checklistTotal: number
}

export interface ProjectStepSummary {
  step: FlowStep
  title: string
  metrics: ProjectSummaryMetric[]
  status: ProjectStepStatus
  detailHint: string
}

export interface ProjectWorkspaceSummary {
  workspaceId: string
  workspaceName: string
  workspacePath: string
  finalMetrics: ProjectWorkspaceFinalMetrics
  flowMetrics: ProjectWorkspaceFlowMetrics
  steps: ProjectStepSummary[]
  deltaSummaries: ProjectComparisonMetricDiff[]
}

export interface ProjectStepCompareMetric {
  id: string
  label: string
  hint: string
  points: ProjectMetricPoint[]
}

export interface ProjectStepCompareSummary {
  step: FlowStep
  title: string
  metricLabel: string
  metricHint: string
  configuredCount: number
  successCount: number
  missingCount: number
  points: ProjectMetricPoint[]
  metrics: ProjectStepCompareMetric[]
}

export interface ProjectRunStateSlice {
  state: ProjectFlowStatusHint['state']
  label: string
  count: number
  percent: number
}

export interface ProjectFlowMetricSummary extends ProjectWorkspaceFlowMetrics {
  runtimePoints: ProjectMetricPoint[]
  memoryPoints: ProjectMetricPoint[]
}

export interface ProjectDashboardSummary {
  workspaceCount: number
  configuredStepCount: number
  successStepCount: number
  failedStepCount: number
  runningStepCount: number
  flowSuccessRatio: number
  drcCleanCount: number
  timingCleanCount: number
  signoffReadyCount: number
  runStateSlices: ProjectRunStateSlice[]
  flowMetricSummary: ProjectFlowMetricSummary
  topBlockingSteps: Array<{ step: FlowStep; count: number }>
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
  workspaceSummaries: ProjectWorkspaceSummary[]
  stepCompareSummaries: ProjectStepCompareSummary[]
  dashboardSummary: ProjectDashboardSummary
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
  originSdc?: string
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

const RUNTIME_STEP_ARTIFACTS: Record<
  FlowStep,
  {
    directory: string
    outputName: string
  }
> = {
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
  {
    id: 'tns',
    label: 'TNS',
    hint: 'total negative slack',
    kind: 'line',
    manifestKey: 'tns',
  },
  {
    id: 'drc',
    label: 'DRC',
    hint: 'violation count',
    kind: 'bar',
    manifestKey: 'drc_count',
  },
  { id: 'area', label: 'Area', hint: 'cell area', kind: 'bar', manifestKey: 'area' },
  {
    id: 'runtime',
    label: 'Runtime',
    hint: 'total runtime',
    kind: 'bar',
    manifestKey: 'runtime_sec',
  },
  {
    id: 'die_area',
    label: 'Die Area',
    hint: 'die area from parameters',
    kind: 'bar',
    manifestKey: 'die_area',
  },
  {
    id: 'core_util',
    label: 'Core Util',
    hint: 'core utilization from parameters',
    kind: 'bar',
    manifestKey: 'core_util',
  },
  {
    id: 'frequency',
    label: 'Frequency [MHz]',
    hint: 'worst frequency across STA corners',
    kind: 'bar',
    manifestKey: 'frequency_mhz',
  },
]

export function buildProjectManagementProject(
  project?: Project | null,
  manifest?: ProjectManifest | null,
  workspaceFlowStates: ProjectWorkspaceFlowStatesById = {},
  workspaceAnalysisInputs: ProjectWorkspaceAnalysisInputsById = {},
): ProjectManagementProject {
  const path = manifest?.root_path ?? project?.path ?? ''
  const name = manifest?.name ?? project?.name ?? 'No Project Selected'
  const topModule = manifest?.base_design.top_module ?? project?.topModule
  const pdk = manifest?.base_design.pdk ?? project?.pdk
  const effectiveWorkspaces = manifest
    ? buildEffectiveWorkspaceMetrics(manifest.workspaces, workspaceAnalysisInputs)
    : []
  const lineageItems = sortWorkspacesByLineage(effectiveWorkspaces)
  const sortedEffectiveWorkspaces = lineageItems.map((item) => item.workspace)
  const workspaces = lineageItems.map(({ workspace, depth }) =>
    buildProjectWorkspace(
      workspace,
      workspaceFlowStates[workspace.workspace_id] ?? {},
      depth,
      workspaceArtifactDesignName(
        workspace,
        manifest?.base_design,
        projectArtifactDesignName(project?.name ?? name, topModule),
      ),
    ),
  )
  const comparisonSummary = manifest
    ? buildComparisonSummary({ ...manifest, workspaces: sortedEffectiveWorkspaces })
    : emptyComparisonSummary()
  const workspaceSummaries = manifest
    ? buildWorkspaceSummaries(
        sortedEffectiveWorkspaces,
        workspaces,
        workspaceAnalysisInputs,
        comparisonSummary,
      )
    : []

  return {
    id: path,
    name,
    path,
    pdk,
    topModule,
    objective: buildObjective(project, manifest),
    bestWorkspaceId: comparisonSummary.bestWorkspaceId,
    workspaces,
    metricsRows: manifest ? buildMetricRows(sortedEffectiveWorkspaces) : [],
    workspaceSummaries,
    stepCompareSummaries: manifest
      ? buildStepCompareSummaries(
          sortedEffectiveWorkspaces,
          workspaces,
          workspaceSummaries,
        )
      : [],
    dashboardSummary: buildProjectDashboardSummary(workspaces, workspaceSummaries),
    branchLinks: manifest ? buildBranchLinks(sortedEffectiveWorkspaces) : [],
    comparisonSummary,
  }
}

export function createSelectionState(
  project: ProjectManagementProject,
): ProjectSelectionState {
  return {
    selectedWorkspaceId: project.bestWorkspaceId || project.workspaces[0]?.id || '',
    selectedStep: 'DRC',
  }
}

export type ProjectSelectionUpdateMode = 'reset' | 'reconcile-workspace' | 'keep'

export function resolveProjectSelectionUpdate(
  previousProjectKey: string | null,
  project: ProjectManagementProject,
  currentWorkspaceId: string,
): {
  nextProjectKey: string
  mode: ProjectSelectionUpdateMode
  selection?: ProjectSelectionState
  nextWorkspaceId?: string
} {
  const nextProjectKey = project.path || project.id
  if (nextProjectKey !== previousProjectKey) {
    return {
      nextProjectKey,
      mode: 'reset',
      selection: createSelectionState(project),
    }
  }

  const workspaceIds = project.workspaces.map((workspace) => workspace.id)
  if (currentWorkspaceId && workspaceIds.includes(currentWorkspaceId)) {
    return {
      nextProjectKey,
      mode: 'keep',
    }
  }

  return {
    nextProjectKey,
    mode: 'reconcile-workspace',
    nextWorkspaceId: project.bestWorkspaceId || project.workspaces[0]?.id || '',
  }
}

export function createProjectManifestDraft(
  input: ProjectManifestDraftInput,
): ProjectManifest {
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

export function parseWorkspaceFlowStateMap(
  content: string,
): ProjectWorkspaceFlowStateMap {
  const parsed = JSON.parse(content) as {
    steps?: Array<{ name?: unknown; state?: unknown }>
  }
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
    .map((workspace) => Number(workspace.id.replace(/^ws_/, '')))
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
  const sourceWorkspace = project.workspaces.find(
    (workspace) => workspace.id === sourceWorkspaceId,
  )
  const sourceOutputType = step === 'Synth' ? 'verilog' : 'def'
  const sourceWorkspacePath =
    sourceWorkspace?.workspacePath ?? joinPath(project.path, sourceWorkspaceId)
  const designName =
    sourceWorkspace?.artifactDesignName ||
    projectArtifactDesignName(project.name, project.topModule)
  const sourceOutputPath = sourceStepOutputPath(sourceWorkspacePath, step, designName)
  const originSdc = sourceWorkspaceSdcPath(sourceWorkspacePath, designName)
  const artifactOrigin =
    sourceOutputType === 'verilog'
      ? { originVerilog: sourceOutputPath }
      : {
          originDef: sourceOutputPath,
          originVerilog: sourceStepOutputVerilogPath(
            sourceWorkspacePath,
            step,
            designName,
          ),
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
    originSdc,
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
  const existingWorkspace = manifest.workspaces.find(
    (workspace) =>
      workspace.workspace_id === workspaceId ||
      normalizePath(workspace.workspace_path) === workspacePath,
  )
  const sourceStep = input.sourceStep ? normalizeFlowStep(input.sourceStep) : null
  const sourceWorkspaceId =
    input.sourceWorkspaceId || existingWorkspace?.source_workspace_id || null
  const branchFrom =
    sourceWorkspaceId && sourceStep
      ? {
          source_workspace_id: sourceWorkspaceId,
          source_step: sourceStep,
          source_output_type:
            input.sourceOutputType ||
            existingWorkspace?.branch_from?.source_output_type ||
            defaultSourceOutputType(sourceStep),
          source_output_path:
            input.sourceOutputPath || existingWorkspace?.branch_from?.source_output_path,
        }
      : (existingWorkspace?.branch_from ?? null)
  const startStep = input.startStep
    ? normalizeFlowStep(input.startStep)
    : sourceStep
      ? nextFlowStep(sourceStep)
      : normalizeFlowStep(existingWorkspace?.start_step ?? 'Synth')
  const endStep = input.endStep
    ? normalizeFlowStep(input.endStep)
    : normalizeFlowStep(existingWorkspace?.end_step ?? 'Harden')
  const workspaceName =
    optionalString(input.config?.parameters?.design) ||
    existingWorkspace?.name ||
    workspaceId
  const parameterPatch = input.config?.parameters
    ? {
        ...existingWorkspace?.parameter_patch,
        ...buildParameterPatch(
          manifest.base_design.parameters ?? {},
          input.config.parameters,
        ),
      }
    : (existingWorkspace?.parameter_patch ?? {})

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
    ? manifest.workspaces.map((item) =>
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
    best_workspace:
      manifest.best_workspace?.workspace_id === workspaceId
        ? null
        : manifest.best_workspace,
    workspaces: manifest.workspaces.map((workspace) =>
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
    best_workspace:
      manifest.best_workspace?.workspace_id === workspaceId
        ? null
        : manifest.best_workspace,
    workspaces: manifest.workspaces
      .filter((workspace) => workspace.workspace_id !== workspaceId)
      .map((workspace) => {
        const clearsSource =
          workspace.source_workspace_id === workspaceId ||
          workspace.branch_from?.source_workspace_id === workspaceId
        if (!clearsSource) return workspace

        return {
          ...workspace,
          source_workspace_id:
            workspace.source_workspace_id === workspaceId
              ? null
              : workspace.source_workspace_id,
          branch_from:
            workspace.branch_from?.source_workspace_id === workspaceId
              ? null
              : workspace.branch_from,
          updated_at: now,
        }
      }),
  }
}

function buildObjective(
  project?: Project | null,
  manifest?: ProjectManifest | null,
): string {
  if (manifest?.objectives.primary) return `${manifest.objectives.primary} objective`
  return project?.frequencyTarget
    ? `timing · ${project.frequencyTarget}MHz`
    : 'No project data'
}

function buildProjectWorkspace(
  workspace: ProjectWorkspaceManifest,
  flowStateMap: ProjectWorkspaceFlowStateMap,
  depth = 0,
  artifactDesignName = '',
): ProjectWorkspace {
  const startStep = normalizeFlowStep(workspace.start_step)
  const endStep = normalizeFlowStep(workspace.end_step)
  const branchStep = workspace.branch_from
    ? normalizeFlowStep(workspace.branch_from.source_step)
    : null

  const steps = FLOW_STEPS.map((step) =>
    buildStepCell(workspace, step, startStep, endStep, branchStep, flowStateMap),
  )

  return {
    id: workspace.workspace_id,
    name: workspace.name,
    workspacePath: workspace.workspace_path,
    artifactDesignName,
    status: workspace.status,
    description: workspace.branch_from
      ? `from ${workspace.branch_from.source_workspace_id}/${branchStep}`
      : 'initial workspace',
    sourceWorkspaceId: workspace.source_workspace_id,
    branchStep,
    startStep,
    endStep,
    depth,
    flowStatusHint: buildFlowStatusHint(steps, startStep, endStep),
    steps,
  }
}

function sortWorkspacesByLineage(workspaces: ProjectWorkspaceManifest[]): Array<{
  workspace: ProjectWorkspaceManifest
  depth: number
}> {
  const byId = new Map(workspaces.map((workspace) => [workspace.workspace_id, workspace]))
  const childrenBySource = new Map<string, ProjectWorkspaceManifest[]>()
  const roots: ProjectWorkspaceManifest[] = []

  for (const workspace of workspaces) {
    const sourceWorkspaceId =
      workspace.branch_from?.source_workspace_id ?? workspace.source_workspace_id
    if (sourceWorkspaceId && byId.has(sourceWorkspaceId)) {
      const children = childrenBySource.get(sourceWorkspaceId) ?? []
      children.push(workspace)
      childrenBySource.set(sourceWorkspaceId, children)
    } else {
      roots.push(workspace)
    }
  }

  const sortByCreatedAt = (
    left: ProjectWorkspaceManifest,
    right: ProjectWorkspaceManifest,
  ) =>
    new Date(left.created_at).getTime() - new Date(right.created_at).getTime() ||
    left.workspace_id.localeCompare(right.workspace_id)

  roots.sort(sortByCreatedAt)
  for (const children of childrenBySource.values()) children.sort(sortByCreatedAt)

  const visited = new Set<string>()
  const sorted: Array<{ workspace: ProjectWorkspaceManifest; depth: number }> = []
  const visit = (workspace: ProjectWorkspaceManifest, depth: number) => {
    if (visited.has(workspace.workspace_id)) return
    visited.add(workspace.workspace_id)
    sorted.push({ workspace, depth })
    for (const child of childrenBySource.get(workspace.workspace_id) ?? []) {
      visit(child, depth + 1)
    }
  }

  for (const root of roots) visit(root, 0)
  for (const workspace of [...workspaces].sort(sortByCreatedAt)) {
    visit(workspace, 0)
  }

  return sorted
}

function buildFlowStatusHint(
  steps: ProjectStepCell[],
  startStep: FlowStep,
  endStep: FlowStep,
): ProjectFlowStatusHint {
  const startIndex = FLOW_STEPS.indexOf(startStep)
  const endIndex = FLOW_STEPS.indexOf(endStep)
  const configuredSteps = steps.filter((cell) => {
    const stepIndex = FLOW_STEPS.indexOf(cell.step)
    return stepIndex >= startIndex && stepIndex <= endIndex
  })
  const firstIncomplete = configuredSteps.find((cell) => cell.status !== 'success')
  if (!firstIncomplete) {
    return {
      state: 'success',
      label: 'Success',
    }
  }

  return {
    state: flowHintState(firstIncomplete.status),
    step: firstIncomplete.step,
    label: `${firstIncomplete.step} ${flowHintStatusLabel(firstIncomplete.status)}`,
  }
}

function flowHintState(status: ProjectStepStatus): ProjectFlowStatusHint['state'] {
  if (status === 'failed') return 'failed'
  if (status === 'running') return 'running'
  if (status === 'success' || status === 'reused') return 'success'
  if (status === 'skipped') return 'skipped'
  return 'unstart'
}

function flowHintStatusLabel(status: ProjectStepStatus): string {
  if (status === 'reused') return 'success'
  if (status === 'unstart') return 'unstart'
  return status
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
    status =
      workspace.branch_from && branchStep && stepIndex <= FLOW_STEPS.indexOf(branchStep)
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

  if (['success', 'succeeded', 'complete', 'completed', 'done'].includes(normalized))
    return 'success'
  if (['ongoing', 'running', 'run'].includes(normalized)) return 'running'
  if (['failed', 'failure', 'error', 'invalid', 'incomplete'].includes(normalized))
    return 'failed'
  if (
    ['unstart', 'unstarted', 'not_started', 'not started', 'pending', 'created'].includes(
      normalized,
    )
  )
    return 'unstart'
  return null
}

function buildMetricRows(workspaces: ProjectWorkspaceManifest[]): ProjectMetricRow[] {
  if (workspaces.length === 0) return []

  return METRIC_DEFINITIONS.map((definition) => ({
    id: definition.id,
    label: definition.label,
    hint: definition.hint,
    kind: definition.kind,
    points: workspaces.map((workspace) => {
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
  return workspaces.flatMap((workspace) => {
    if (!workspace.branch_from) return []
    return [
      {
        fromWorkspaceId: workspace.branch_from.source_workspace_id,
        fromStep: normalizeFlowStep(workspace.branch_from.source_step),
        toWorkspaceId: workspace.workspace_id,
        toStep: normalizeFlowStep(workspace.start_step),
      },
    ]
  })
}

function buildEffectiveWorkspaceMetrics(
  workspaces: ProjectWorkspaceManifest[],
  workspaceAnalysisInputs: ProjectWorkspaceAnalysisInputsById,
): ProjectWorkspaceManifest[] {
  return workspaces.map((workspace) => {
    const extracted = extractMetricSummary(
      workspaceAnalysisInputs[workspace.workspace_id],
    )
    return {
      ...workspace,
      metrics_summary: {
        ...workspace.metrics_summary,
        ...extracted,
      },
    }
  })
}

function buildWorkspaceSummaries(
  manifestWorkspaces: ProjectWorkspaceManifest[],
  workspaces: ProjectWorkspace[],
  workspaceAnalysisInputs: ProjectWorkspaceAnalysisInputsById,
  comparisonSummary: ProjectComparisonSummary,
): ProjectWorkspaceSummary[] {
  return manifestWorkspaces.map((workspace) => {
    const projectWorkspace = workspaces.find((item) => item.id === workspace.workspace_id)
    const workspaceAnalysisInput = workspaceAnalysisInputs[workspace.workspace_id]
    const extracted = extractAnalysisSummary(workspaceAnalysisInput)
    const flowMetrics = extractFlowMetrics(workspaceAnalysisInput)
    const metrics = {
      ...extracted.metrics,
      area:
        extracted.metrics.area ??
        metricFromNumber(
          'area',
          'Area',
          asNumber(workspace.metrics_summary.area),
          metricState('area', asNumber(workspace.metrics_summary.area)),
        ),
      drcCount:
        extracted.metrics.drcCount ??
        metricFromNumber(
          'drc',
          'DRC',
          asNumber(workspace.metrics_summary.drc_count),
          metricState('drc', asNumber(workspace.metrics_summary.drc_count)),
        ),
      setupWns:
        extracted.metrics.setupWns ??
        metricFromNumber(
          'setup_wns',
          'Setup WNS',
          asNumber(workspace.metrics_summary.wns),
          metricState('wns', asNumber(workspace.metrics_summary.wns)),
        ),
      setupTns:
        extracted.metrics.setupTns ??
        metricFromNumber(
          'setup_tns',
          'Setup TNS',
          asNumber(workspace.metrics_summary.tns),
          metricState('tns', asNumber(workspace.metrics_summary.tns)),
        ),
      frequency:
        extracted.metrics.frequency ??
        metricFromNumber(
          'frequency',
          'Frequency [MHz]',
          asNumber(workspace.metrics_summary.frequency_mhz),
          metricState('frequency', asNumber(workspace.metrics_summary.frequency_mhz)),
        ),
    }

    return {
      workspaceId: workspace.workspace_id,
      workspaceName: workspace.name,
      workspacePath: workspace.workspace_path,
      finalMetrics: metrics,
      flowMetrics,
      steps: FLOW_STEPS.map((step) => {
        const status =
          projectWorkspace?.steps.find((cell) => cell.step === step)?.status ?? 'skipped'
        return buildStepSummary(step, status, extracted)
      }),
      deltaSummaries: comparisonSummary.metricDiffs.filter(
        (diff) =>
          diff.fromWorkspaceId === workspace.workspace_id ||
          diff.toWorkspaceId === workspace.workspace_id,
      ),
    }
  })
}

function buildStepSummary(
  step: FlowStep,
  status: ProjectStepStatus,
  extracted: ExtractedWorkspaceAnalysis,
): ProjectStepSummary {
  const metrics = extracted.stepMetrics[step] ?? []
  return {
    step,
    title: step,
    metrics,
    status,
    detailHint: detailHintForStep(step),
  }
}

function buildStepCompareSummaries(
  manifestWorkspaces: ProjectWorkspaceManifest[],
  workspaces: ProjectWorkspace[],
  workspaceSummaries: ProjectWorkspaceSummary[],
): ProjectStepCompareSummary[] {
  return FLOW_STEPS.map((step) => {
    const definitions = stepMetricDefinitions(step, workspaceSummaries)
    const metrics = definitions.map((definition) => ({
      id: definition.id,
      label: definition.label,
      hint: definition.hint,
      points: manifestWorkspaces.map((workspace) => {
        const summary = workspaceSummaries.find(
          (item) => item.workspaceId === workspace.workspace_id,
        )
        const metric = stepMetricFromSummary(summary, step, definition.id)
        const value = metric?.value ?? null
        return {
          workspaceId: workspace.workspace_id,
          label: metric?.display ?? 'N/A',
          value,
          state: metric?.state ?? 'pending',
        }
      }),
    }))
    const primaryMetric = metrics[0] ?? {
      id: 'none',
      label: 'metric',
      hint: 'No metric available',
      points: manifestWorkspaces.map((workspace) => ({
        workspaceId: workspace.workspace_id,
        label: 'N/A',
        value: null,
        state: 'pending' as const,
      })),
    }
    const configuredCount = workspaces.filter(
      (workspace) =>
        workspace.steps.find((cell) => cell.step === step)?.status !== 'skipped',
    ).length
    const successCount = workspaces.filter(
      (workspace) =>
        workspace.steps.find((cell) => cell.step === step)?.status === 'success',
    ).length
    const missingCount = primaryMetric.points.filter(
      (point) => point.value === null,
    ).length

    return {
      step,
      title: `${step} Compare`,
      metricLabel: primaryMetric.label,
      metricHint: primaryMetric.hint,
      configuredCount,
      successCount,
      missingCount,
      points: primaryMetric.points,
      metrics,
    }
  })
}

function buildProjectDashboardSummary(
  workspaces: ProjectWorkspace[],
  workspaceSummaries: ProjectWorkspaceSummary[],
): ProjectDashboardSummary {
  const configuredCells = workspaces.flatMap((workspace) =>
    workspace.steps.filter((cell) => cell.status !== 'skipped'),
  )
  const successStepCount = configuredCells.filter(
    (cell) => cell.status === 'success' || cell.status === 'reused',
  ).length
  const failedStepCount = configuredCells.filter(
    (cell) => cell.status === 'failed',
  ).length
  const runningStepCount = configuredCells.filter(
    (cell) => cell.status === 'running',
  ).length
  const configuredStepCount = configuredCells.length
  const flowSuccessRatio =
    configuredStepCount === 0
      ? 0
      : Math.round((successStepCount / configuredStepCount) * 100)
  const drcCleanCount = workspaceSummaries.filter(
    (summary) => summary.finalMetrics.drcCount?.value === 0,
  ).length
  const timingCleanCount = workspaceSummaries.filter((summary) => {
    const setupWns = summary.finalMetrics.setupWns?.value
    const setupTns = summary.finalMetrics.setupTns?.value
    return (
      setupWns !== undefined &&
      setupWns !== null &&
      setupWns >= 0 &&
      (setupTns === undefined || setupTns === null || setupTns >= 0)
    )
  }).length
  const signoffReadyCount = workspaceSummaries.filter((summary) => {
    const drc = summary.finalMetrics.drcCount?.value
    const setupWns = summary.finalMetrics.setupWns?.value
    const setupTns = summary.finalMetrics.setupTns?.value
    return (
      drc === 0 &&
      setupWns !== undefined &&
      setupWns !== null &&
      setupWns >= 0 &&
      (setupTns === undefined || setupTns === null || setupTns >= 0)
    )
  }).length
  const blockingCounts = new Map<FlowStep, number>()
  for (const workspace of workspaces) {
    const blockedStep = workspace.steps.find(
      (cell) =>
        cell.status === 'failed' ||
        cell.status === 'running' ||
        cell.status === 'unstart',
    )
    if (!blockedStep) continue
    blockingCounts.set(blockedStep.step, (blockingCounts.get(blockedStep.step) ?? 0) + 1)
  }
  const runStateSlices = buildRunStateSlices(workspaces)
  const flowMetricSummary = buildFlowMetricSummary(workspaceSummaries)

  return {
    workspaceCount: workspaces.length,
    configuredStepCount,
    successStepCount,
    failedStepCount,
    runningStepCount,
    flowSuccessRatio,
    drcCleanCount,
    timingCleanCount,
    signoffReadyCount,
    runStateSlices,
    flowMetricSummary,
    topBlockingSteps: [...blockingCounts.entries()]
      .sort(
        (left, right) =>
          right[1] - left[1] ||
          FLOW_STEPS.indexOf(left[0]) - FLOW_STEPS.indexOf(right[0]),
      )
      .slice(0, 3)
      .map(([step, count]) => ({ step, count })),
  }
}

function buildRunStateSlices(workspaces: ProjectWorkspace[]): ProjectRunStateSlice[] {
  const labels: Record<ProjectFlowStatusHint['state'], string> = {
    success: 'Success',
    failed: 'Failed',
    running: 'Running',
    unstart: 'Not Started',
    skipped: 'Skipped',
  }
  const total = workspaces.length
  const counts = workspaces.reduce((map, workspace) => {
    const state = workspace.flowStatusHint.state
    map.set(state, (map.get(state) ?? 0) + 1)
    return map
  }, new Map<ProjectFlowStatusHint['state'], number>())

  return (
    [
      'success',
      'failed',
      'running',
      'unstart',
      'skipped',
    ] satisfies ProjectFlowStatusHint['state'][]
  ).flatMap((state) => {
    const count = counts.get(state) ?? 0
    if (count === 0) return []
    return [
      {
        state,
        label: labels[state],
        count,
        percent: total === 0 ? 0 : Math.round((count / total) * 100),
      },
    ]
  })
}

function buildFlowMetricSummary(
  workspaceSummaries: ProjectWorkspaceSummary[],
): ProjectFlowMetricSummary {
  const empty = emptyFlowMetrics()
  const totals = workspaceSummaries.reduce(
    (summary, workspace) => ({
      totalRuntimeSec: summary.totalRuntimeSec + workspace.flowMetrics.totalRuntimeSec,
      peakMemoryMb: Math.max(summary.peakMemoryMb, workspace.flowMetrics.peakMemoryMb),
      checklistPassed: summary.checklistPassed + workspace.flowMetrics.checklistPassed,
      checklistFailed: summary.checklistFailed + workspace.flowMetrics.checklistFailed,
      checklistWarning: summary.checklistWarning + workspace.flowMetrics.checklistWarning,
      checklistTotal: summary.checklistTotal + workspace.flowMetrics.checklistTotal,
    }),
    empty,
  )

  return {
    ...totals,
    runtimePoints: workspaceSummaries.map((summary) => ({
      workspaceId: summary.workspaceId,
      label: formatRuntimeLabel(summary.flowMetrics.totalRuntimeSec),
      value: summary.flowMetrics.totalRuntimeSec,
      state: summary.flowMetrics.totalRuntimeSec > 0 ? 'good' : 'pending',
    })),
    memoryPoints: workspaceSummaries.map((summary) => ({
      workspaceId: summary.workspaceId,
      label: `${formatMetricValue(summary.flowMetrics.peakMemoryMb)} MB`,
      value: summary.flowMetrics.peakMemoryMb,
      state: summary.flowMetrics.peakMemoryMb > 0 ? 'good' : 'pending',
    })),
  }
}

interface ExtractedWorkspaceAnalysis {
  metrics: ProjectWorkspaceFinalMetrics
  stepMetrics: Partial<Record<FlowStep, ProjectSummaryMetric[]>>
}

function extractMetricSummary(
  input?: ProjectWorkspaceAnalysisInput,
): ProjectMetricSummary {
  const extracted = extractAnalysisSummary(input)
  return compactMetricSummary({
    area: extracted.metrics.area?.value ?? undefined,
    drc_count: extracted.metrics.drcCount?.value ?? undefined,
    wns: extracted.metrics.setupWns?.value ?? undefined,
    tns: extracted.metrics.setupTns?.value ?? undefined,
    die_area: extracted.metrics.dieArea?.value ?? undefined,
    core_util: extracted.metrics.coreUtil?.value ?? undefined,
    frequency_mhz: extracted.metrics.frequency?.value ?? undefined,
  })
}

function extractFlowMetrics(
  input?: ProjectWorkspaceAnalysisInput,
): ProjectWorkspaceFlowMetrics {
  const metrics = emptyFlowMetrics()
  const flow = parseJsonRecord(input?.flowText)
  const steps = arrayAt(flow, 'steps')
    .map(recordValue)
    .filter((step): step is Record<string, unknown> => Boolean(step))

  for (const step of steps) {
    metrics.totalRuntimeSec += runtimeSeconds(step.runtime)
    metrics.peakMemoryMb = Math.max(
      metrics.peakMemoryMb,
      flexibleNumber(step['peak memory (mb)']) ?? 0,
      flexibleNumber(step.peakMemoryMb) ?? 0,
      flexibleNumber(step.peak_memory_mb) ?? 0,
    )
  }

  const checklist = parseJsonRecord(input?.checklistText)
  const checklistRows = checklistItems(checklist)
  for (const item of checklistRows) {
    const bucket = checklistStateBucket(item)
    metrics.checklistTotal += 1
    if (bucket === 'passed') metrics.checklistPassed += 1
    if (bucket === 'failed') metrics.checklistFailed += 1
    if (bucket === 'warning') metrics.checklistWarning += 1
  }

  metrics.totalRuntimeSec = Number(metrics.totalRuntimeSec.toFixed(3))
  return metrics
}

function emptyFlowMetrics(): ProjectWorkspaceFlowMetrics {
  return {
    totalRuntimeSec: 0,
    peakMemoryMb: 0,
    checklistPassed: 0,
    checklistFailed: 0,
    checklistWarning: 0,
    checklistTotal: 0,
  }
}

function extractAnalysisSummary(
  input?: ProjectWorkspaceAnalysisInput,
): ExtractedWorkspaceAnalysis {
  const files = input?.files ?? {}
  const synthesis = parseJsonRecord(files.synthesisStat)
  const floorplanDb = parseJsonRecord(files.floorplanDb)
  const drcStep = parseJsonRecord(files.drcStep)
  const staDb = parseJsonRecord(files.staDb)
  const parameters = parseJsonRecord(input?.parametersText)
  const sta = extractStaSummary(input?.staReports ?? [])

  const synthesisDesign = recordAt(synthesis, 'design')
  const synthesisArea = numberAt(synthesisDesign, 'area')
  const floorplanLayout = extractDbLayout(floorplanDb)
  const floorplanInstances = extractDbInstances(floorplanDb)
  const drc = recordAt(drcStep, 'drc') ?? drcStep
  const staLayout = extractDbLayout(staDb)
  const parameterLayout = extractParameterLayout(parameters)
  const area = synthesisArea ?? floorplanInstances.area ?? null
  const dieArea =
    parameterLayout.dieArea ?? floorplanLayout.dieArea ?? staLayout.dieArea ?? null
  const coreUtil =
    parameterLayout.coreUtil ?? floorplanLayout.coreUsage ?? staLayout.coreUsage ?? null

  return {
    metrics: {
      drcCount: metricFromNumber(
        'drc',
        'DRC',
        numberAt(drc, 'number'),
        metricState('drc', numberAt(drc, 'number')),
      ),
      setupWns: metricFromNumber(
        'setup_wns',
        'Setup WNS',
        sta.setupWns,
        metricState('wns', sta.setupWns),
        sta.worstSetupCorner,
      ),
      setupTns: metricFromNumber(
        'setup_tns',
        'Setup TNS',
        sta.setupTns,
        metricState('tns', sta.setupTns),
        sta.worstSetupCorner,
      ),
      holdWns: metricFromNumber(
        'hold_wns',
        'Hold WNS',
        sta.holdWns,
        sta.holdWns === null ? 'pending' : sta.holdWns >= 0 ? 'good' : 'bad',
        sta.worstHoldCorner,
      ),
      holdTns: metricFromNumber(
        'hold_tns',
        'Hold TNS',
        sta.holdTns,
        sta.holdTns === null ? 'pending' : sta.holdTns >= 0 ? 'good' : 'bad',
        sta.worstHoldCorner,
      ),
      area: metricFromNumber('area', 'Area', area, metricState('area', area)),
      dieArea: metricFromNumber(
        'die_area',
        'Die Area',
        dieArea,
        dieArea === null ? 'pending' : 'good',
      ),
      coreUtil: metricFromNumber(
        'core_util',
        'Core Util',
        coreUtil,
        coreUtil === null ? 'pending' : 'good',
      ),
      frequency: metricFromNumber(
        'frequency',
        'Frequency [MHz]',
        sta.worstFrequency,
        metricState('frequency', sta.worstFrequency),
        sta.worstFrequencyCorner,
      ),
    },
    stepMetrics: extractStepMetrics(input?.stepMetricTexts ?? {}),
  }
}

function metricFromNumber(
  id: string,
  label: string,
  value: number | null,
  state: ProjectMetricPoint['state'],
  hint?: string,
  format: 'default' | 'percent' | 'compact' = 'default',
): ProjectSummaryMetric | undefined {
  if (value === null) return undefined
  return {
    id,
    label: `${label} ${formatMetricValue(value, format)}`,
    value,
    display: formatMetricValue(value, format),
    state,
    hint,
  }
}

function extractStepMetrics(
  stepMetricTexts: Partial<Record<FlowStep, string | null>>,
): Partial<Record<FlowStep, ProjectSummaryMetric[]>> {
  return Object.fromEntries(
    FLOW_STEPS.flatMap((step) => {
      const metrics = stepMetricsFromRecord(parseJsonRecord(stepMetricTexts[step]))
      return metrics.length > 0 ? [[step, metrics]] : []
    }),
  )
}

function stepMetricsFromRecord(
  record: Record<string, unknown> | null,
): ProjectSummaryMetric[] {
  if (!record) return []
  return Object.entries(record).flatMap(([key, rawValue]) => {
    if (key.trim().toLowerCase() === 'tool') return []
    const value = flexibleNumber(rawValue)
    if (value === null) return []
    const id = metricIdFromAnalysisKey(key)
    return [
      {
        id,
        label: metricLabelFromAnalysisKey(key),
        value,
        display: formatRawMetricValue(value),
        state: compareMetricState(id, value),
        hint: key,
      },
    ]
  })
}

function metricIdFromAnalysisKey(key: string): string {
  const normalized = key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return normalized || 'metric'
}

function metricLabelFromAnalysisKey(key: string): string {
  return key
    .trim()
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
}

function formatRawMetricValue(value: number): string {
  return String(Number(value.toFixed(6)))
}

function extractDbLayout(db: Record<string, unknown> | null): {
  dieUsage: number | null
  coreUsage: number | null
  dieArea: number | null
} {
  const layout = recordAt(db, 'Design Layout')
  return {
    dieUsage: numberAt(layout, 'die_usage'),
    coreUsage: numberAt(layout, 'core_usage'),
    dieArea: numberAt(layout, 'die_area'),
  }
}

function extractParameterLayout(parameters: Record<string, unknown> | null): {
  dieArea: number | null
  coreUtil: number | null
} {
  const die = recordAt(parameters, 'Die')
  const core = recordAt(parameters, 'Core')
  return {
    dieArea: numberAtAny(die, ['Area', 'area', 'die_area']),
    coreUtil: numberAtAny(core, [
      'Utilitization',
      'Utilization',
      'utilitization',
      'utilization',
      'core_usage',
    ]),
  }
}

function runtimeSeconds(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || !value.trim()) return 0

  const normalized = value.trim().toLowerCase()
  if (normalized.endsWith('s')) {
    const seconds = Number(normalized.slice(0, -1))
    return Number.isFinite(seconds) ? seconds : 0
  }

  const colonParts = normalized.split(':').map((part) => Number(part.trim()))
  if (colonParts.length > 1 && colonParts.every(Number.isFinite)) {
    if (colonParts.length === 3)
      return colonParts[0] * 3600 + colonParts[1] * 60 + colonParts[2]
    if (colonParts.length === 2) return colonParts[0] * 60 + colonParts[1]
  }

  const numeric = Number(normalized)
  return Number.isFinite(numeric) ? numeric : 0
}

function checklistItems(
  checklist: Record<string, unknown> | null,
): Record<string, unknown>[] {
  if (!checklist) return []
  const rows = Array.isArray(checklist.checklist)
    ? checklist.checklist
    : Array.isArray(checklist.items)
      ? checklist.items
      : []
  return rows
    .map(recordValue)
    .filter((item): item is Record<string, unknown> => Boolean(item))
}

function checklistStateBucket(
  item: Record<string, unknown>,
): 'passed' | 'failed' | 'warning' | null {
  const state = optionalString(
    item.status ?? item.state ?? item.result ?? item.level,
  ).toLowerCase()
  if (['passed', 'pass', 'ok', 'success', 'succeeded'].includes(state)) return 'passed'
  if (['failed', 'fail', 'error', 'fatal'].includes(state)) return 'failed'
  if (['warning', 'warn'].includes(state)) return 'warning'
  return null
}

function extractDbInstances(db: Record<string, unknown> | null): {
  area: number | null
  count: number | null
} {
  const total = recordAt(recordAt(db, 'Instances'), 'total')
  return {
    area: numberAt(total, 'area'),
    count: numberAt(total, 'num'),
  }
}

function extractStaSummary(reports: ProjectStaReportInput[]): {
  setupWns: number | null
  setupTns: number | null
  holdWns: number | null
  holdTns: number | null
  worstFrequency: number | null
  worstSetupCorner?: string
  worstHoldCorner?: string
  worstFrequencyCorner?: string
} {
  const initial = {
    setupWns: null as number | null,
    setupTns: null as number | null,
    holdWns: null as number | null,
    holdTns: null as number | null,
    worstFrequency: null as number | null,
    worstSetupCorner: undefined as string | undefined,
    worstHoldCorner: undefined as string | undefined,
    worstFrequencyCorner: undefined as string | undefined,
  }

  return reports.reduce((summary, report) => {
    const parsed = parseJsonRecord(report.content)
    const reportFrequency = extractReportFrequency(parsed)
    if (
      reportFrequency !== null &&
      (summary.worstFrequency === null || reportFrequency < summary.worstFrequency)
    ) {
      summary.worstFrequency = reportFrequency
      summary.worstFrequencyCorner = report.corner
    }
    const slackRows = arrayAt(parsed, 'slack')
    slackRows.forEach((rowValue) => {
      const row = recordValue(rowValue)
      const delayType = optionalString(row?.delay_type).toLowerCase()
      const wns = flexibleNumber(row?.WNS)
      const tns = flexibleNumber(row?.TNS)
      if (
        delayType === 'max' &&
        wns !== null &&
        (summary.setupWns === null || wns < summary.setupWns)
      ) {
        summary.setupWns = wns
        summary.setupTns = tns
        summary.worstSetupCorner = report.corner
      }
      if (
        delayType === 'min' &&
        wns !== null &&
        (summary.holdWns === null || wns < summary.holdWns)
      ) {
        summary.holdWns = wns
        summary.holdTns = tns
        summary.worstHoldCorner = report.corner
      }
    })
    return summary
  }, initial)
}

function extractReportFrequency(report: Record<string, unknown> | null): number | null {
  if (!report) return null
  const summaryValue = report.summary
  const summaryRecord = recordValue(summaryValue)
  if (summaryRecord) return numberAt(summaryRecord, 'freq')

  if (!Array.isArray(summaryValue)) return null
  const values = summaryValue
    .map((rowValue) => flexibleNumber(recordValue(rowValue)?.freq))
    .filter((value): value is number => value !== null)
  return values.length > 0 ? Math.min(...values) : null
}

interface StepCompareDefinition {
  id: string
  label: string
  hint: string
}

function stepMetricDefinitions(
  step: FlowStep,
  workspaceSummaries: ProjectWorkspaceSummary[],
): StepCompareDefinition[] {
  const definitions = new Map<string, StepCompareDefinition>()
  for (const summary of workspaceSummaries) {
    const stepSummary = summary.steps.find((item) => item.step === step)
    for (const metric of stepSummary?.metrics ?? []) {
      if (definitions.has(metric.id)) continue
      definitions.set(metric.id, {
        id: metric.id,
        label: metric.label,
        hint: metric.hint ?? metric.label,
      })
    }
  }
  return [...definitions.values()]
}

function stepMetricFromSummary(
  summary: ProjectWorkspaceSummary | undefined,
  step: FlowStep,
  metricId: string,
): ProjectSummaryMetric | undefined {
  return summary?.steps
    .find((item) => item.step === step)
    ?.metrics.find((metric) => metric.id === metricId)
}

function compareMetricState(
  metricId: string,
  value: number | null,
): ProjectMetricPoint['state'] {
  if (value === null) return 'pending'
  const normalized = metricId.toLowerCase()
  if (normalized.includes('drc') || normalized.includes('violation')) {
    if (value === 0) return 'good'
    if (value <= 3) return 'warn'
    return 'bad'
  }
  if (normalized.includes('wns') || normalized.includes('slack'))
    return value >= 0 ? 'good' : 'bad'
  return 'good'
}

function detailHintForStep(step: FlowStep): string {
  const hints: Record<FlowStep, string> = {
    Synth: 'Open workspace Synthesis for cell type and netlist details.',
    Floor: 'Open workspace Floorplan for geometry, pin and fanout details.',
    Fanout: 'Open workspace Fanout for high-fanout net details.',
    Place: 'Open workspace Place for density and congestion maps.',
    CTS: 'Open workspace CTS for clock tree and post-CTS congestion.',
    Legal: 'Open workspace Legalization for placement cleanup details.',
    Route: 'Open workspace Route for route iterations and layer pressure.',
    DRC: 'Open workspace DRC for rule/layer heatmaps and violation maps.',
    Filler: 'Open workspace Filler for final filler impact details.',
    RCX: 'Open workspace RCX for extraction readiness details.',
    STA: 'Open workspace STA for path detail and corner matrix.',
    Harden: 'Open workspace Harden for final artifact details.',
  }
  return hints[step]
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
  const activeWorkspaces = manifest.workspaces.filter(
    (workspace) => workspace.status !== 'archived',
  )
  const explicitBest = manifest.best_workspace
    ? activeWorkspaces.find(
        (workspace) => workspace.workspace_id === manifest.best_workspace?.workspace_id,
      )
    : null
  const bestWorkspace = explicitBest ?? chooseBestWorkspace(activeWorkspaces)
  const baselineWorkspace = activeWorkspaces[0] ?? null

  return {
    bestWorkspaceId: bestWorkspace?.workspace_id ?? '',
    bestReason: explicitBest
      ? (manifest.best_workspace?.reason ?? '')
      : bestWorkspace
        ? `Selected by ${manifest.objectives.primary || 'project'} objective`
        : '',
    riskLabels: buildRiskLabels(activeWorkspaces),
    parameterDiffs: buildParameterDiffs(activeWorkspaces),
    metricDiffs: buildMetricDiffs(baselineWorkspace, bestWorkspace),
  }
}

function chooseBestWorkspace(
  workspaces: ProjectWorkspaceManifest[],
): ProjectWorkspaceManifest | null {
  if (workspaces.length === 0) return null
  return [...workspaces].sort(
    (left, right) => workspaceScore(right) - workspaceScore(left),
  )[0]
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
  return statusScore[workspace.status] + wns * 100 + tns * 4 - drc * 5 - area * 0.0001
}

function buildRiskLabels(workspaces: ProjectWorkspaceManifest[]): string[] {
  const risks: string[] = []
  if (
    workspaces.some(
      (workspace) => (asNumber(workspace.metrics_summary.drc_count) ?? 0) > 0,
    )
  ) {
    risks.push('DRC violations present')
  }
  if (
    workspaces.some((workspace) => (asNumber(workspace.metrics_summary.wns) ?? 0) < 0)
  ) {
    risks.push('Negative WNS')
  }
  if (workspaces.some((workspace) => workspace.status === 'failed')) {
    risks.push('Failed workspace present')
  }
  if (
    workspaces.some(
      (workspace) => workspace.status === 'running' || workspace.status === 'in_progress',
    )
  ) {
    risks.push('Workspace still running')
  }
  return risks
}

function buildParameterDiffs(
  workspaces: ProjectWorkspaceManifest[],
): ProjectComparisonParameterDiff[] {
  return workspaces.flatMap((workspace) =>
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
  if (
    !baselineWorkspace ||
    !targetWorkspace ||
    baselineWorkspace.workspace_id === targetWorkspace.workspace_id
  )
    return []

  return METRIC_DEFINITIONS.flatMap((definition) => {
    const from = asNumber(baselineWorkspace.metrics_summary[definition.manifestKey])
    const to = asNumber(targetWorkspace.metrics_summary[definition.manifestKey])
    if (from === null || to === null) return []
    const delta = Number((to - from).toFixed(4))
    return [
      {
        metric: definition.label,
        fromWorkspaceId: baselineWorkspace.workspace_id,
        toWorkspaceId: targetWorkspace.workspace_id,
        delta,
        state: metricDeltaState(definition.id, delta),
      },
    ]
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

function metricDeltaState(
  metricId: ProjectMetricId,
  delta: number,
): ProjectComparisonMetricDiff['state'] {
  if (delta === 0) return 'warn'
  if (metricId === 'wns' || metricId === 'tns' || metricId === 'frequency')
    return delta > 0 ? 'good' : 'bad'
  return delta < 0 ? 'good' : 'bad'
}

function sourceStepOutputPath(
  workspacePath: string,
  step: FlowStep,
  designName: string,
): string {
  return sourceStepArtifactPath(
    workspacePath,
    step,
    defaultSourceOutputType(step),
    designName,
  )
}

function sourceStepOutputVerilogPath(
  workspacePath: string,
  step: FlowStep,
  designName: string,
): string {
  return sourceStepArtifactPath(workspacePath, step, 'verilog', designName)
}

function sourceWorkspaceSdcPath(workspacePath: string, designName: string): string {
  return joinPath(workspacePath, 'origin', `${designName || 'design'}.sdc`)
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

  const suffix =
    artifactType === 'verilog' ? (step === 'Synth' ? '_fixed.v.gz' : '.v.gz') : '.def.gz'
  return joinPath(
    workspacePath,
    artifact.directory,
    'output',
    `${designName}_${artifact.outputName}${suffix}`,
  )
}

function projectArtifactDesignName(name: string, topModule?: string): string {
  return normalizeArtifactDesignName(topModule) || normalizeArtifactDesignName(name)
}

function workspaceArtifactDesignName(
  workspace: ProjectWorkspaceManifest,
  baseDesign: ProjectManifestBaseDesign | undefined,
  fallback: string,
): string {
  return (
    normalizeArtifactDesignName(
      parameterPatchValues(workspace.parameter_patch.design).to,
    ) ||
    (workspace.branch_from || workspace.source_workspace_id
      ? normalizeArtifactDesignName(workspace.name)
      : '') ||
    normalizeArtifactDesignName(baseDesign?.parameters?.design) ||
    fallback ||
    normalizeArtifactDesignName(workspace.workspace_id)
  )
}

function normalizeArtifactDesignName(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().replace(/[\\/]/g, '_').replace(/\s+/g, '_')
    : ''
}

function defaultSourceOutputType(step: FlowStep): 'verilog' | 'def' {
  return step === 'Synth' ? 'verilog' : 'def'
}

function buildParameterPatch(
  baseParameters: Record<string, unknown>,
  nextParameters: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  return Object.fromEntries(
    Object.entries(nextParameters)
      .filter(([key, value]) => baseParameters[key] !== value)
      .map(([key, value]) => [
        key,
        {
          from: Object.prototype.hasOwnProperty.call(baseParameters, key)
            ? baseParameters[key]
            : undefined,
          to: value,
        },
      ]),
  )
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
    .map((workspace) => Number(workspace.workspace_id.replace(/^ws_/, '')))
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
      ...baseDesign.parameters,
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

function parseJsonRecord(
  content: string | null | undefined,
): Record<string, unknown> | null {
  if (!content) return null
  try {
    return recordValue(JSON.parse(content))
  } catch {
    return null
  }
}

function recordAt(
  record: Record<string, unknown> | null | undefined,
  key: string,
): Record<string, unknown> | null {
  if (!record) return null
  return recordValue(record[key])
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function arrayAt(
  record: Record<string, unknown> | null | undefined,
  key: string,
): unknown[] {
  if (!record) return []
  const value = record[key]
  return Array.isArray(value) ? value : []
}

function numberAt(
  record: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  if (!record) return null
  return flexibleNumber(record[key])
}

function numberAtAny(
  record: Record<string, unknown> | null | undefined,
  keys: string[],
): number | null {
  if (!record) return null
  for (const key of keys) {
    const value = flexibleNumber(record[key])
    if (value !== null) return value
  }
  return null
}

function flexibleNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function formatRuntimeLabel(seconds: number): string {
  if (seconds >= 3600) return `${Number((seconds / 3600).toFixed(2))} h`
  if (seconds >= 60) return `${Number((seconds / 60).toFixed(1))} min`
  return `${Number(seconds.toFixed(1))} s`
}

function formatMetricValue(
  value: number,
  format: 'default' | 'percent' | 'compact' = 'default',
): string {
  if (format === 'percent') return `${Number((value * 100).toFixed(1))}%`
  if (format === 'compact') {
    if (Math.abs(value) >= 1_000_000) return `${Number((value / 1_000_000).toFixed(2))}M`
    if (Math.abs(value) >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`
  }
  if (Math.abs(value) >= 100) return String(Number(value.toFixed(1)))
  if (Math.abs(value) >= 10) return String(Number(value.toFixed(2)))
  return String(Number(value.toFixed(3)))
}

function compactMetricSummary(summary: ProjectMetricSummary): ProjectMetricSummary {
  return Object.fromEntries(
    Object.entries(summary).filter(([, value]) => value !== undefined),
  ) as ProjectMetricSummary
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

function metricState(
  metricId: ProjectMetricId,
  value: number | null,
): ProjectMetricPoint['state'] {
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
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return slug || 'project'
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/g, '')
}

function joinPath(...parts: string[]): string {
  const joined = parts
    .filter(Boolean)
    .map((part, index) =>
      index === 0 ? part.replace(/\/+$/g, '') : part.replace(/^\/+|\/+$/g, ''),
    )
    .join('/')
  return normalizePath(joined)
}

function basenamePath(path: string): string {
  return normalizePath(path).split('/').filter(Boolean).pop() ?? ''
}
