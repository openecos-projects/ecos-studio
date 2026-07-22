import {
  archiveWorkspaceInManifest as archiveSharedWorkspaceInManifest,
  createProjectManifestDraft as createSharedProjectManifestDraft,
  deleteWorkspaceFromManifest as deleteSharedWorkspaceFromManifest,
  parseProjectManifest as parseSharedProjectManifest,
  registerWorkspaceInManifest as registerSharedWorkspaceInManifest,
  serializeProjectManifest as serializeSharedProjectManifest,
} from '@ecos-studio/shared'
import { FLOW_STEPS } from './projectFlow'
import {
  buildProjectManagementProject,
  createWorkspaceBranchDraft,
  nextWorkspaceId,
  parseWorkspaceFlowStateMap,
} from './projectManagementAnalysis'

export {
  FLOW_STEPS,
  buildProjectManagementProject,
  createWorkspaceBranchDraft,
  nextWorkspaceId,
  parseWorkspaceFlowStateMap,
}

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

export interface ProjectMetricDefinition {
  id: ProjectMetricId
  label: string
  hint: string
  kind: MetricsRowKind
  manifestKey: keyof ProjectMetricSummary
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
  return createSharedProjectManifestDraft(input)
}

export function serializeProjectManifest(manifest: ProjectManifest): string {
  return serializeSharedProjectManifest(manifest)
}

export function parseProjectManifest(content: string): ProjectManifest {
  return parseSharedProjectManifest(content)
}

export function registerWorkspaceInManifest(
  manifest: ProjectManifest,
  input: ProjectWorkspaceRegistrationInput,
): ProjectManifest {
  return registerSharedWorkspaceInManifest(manifest, input)
}

export function archiveWorkspaceInManifest(
  manifest: ProjectManifest,
  workspaceId: string,
  now = new Date().toISOString(),
): ProjectManifest {
  return archiveSharedWorkspaceInManifest(manifest, workspaceId, now)
}

export function deleteWorkspaceFromManifest(
  manifest: ProjectManifest,
  workspaceId: string,
  now = new Date().toISOString(),
): ProjectManifest {
  return deleteSharedWorkspaceFromManifest(manifest, workspaceId, now)
}
