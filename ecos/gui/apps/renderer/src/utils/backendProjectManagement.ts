import type {
  ProjectManifest,
  ProjectManifestBaseDesign,
  ProjectManifestType,
  ProjectManifestWorkspace,
  ResourceInfo,
} from '@ecos-studio/shared'
import type { Project } from '@/types'
import {
  buildProjectQorTrendSummary,
  type ProjectQorMetricRecord,
  type ProjectQorTimingSummary,
  type ProjectQorTrendSummary,
  type ProjectQorTrendWorkspaceSummary,
} from './projectQorTrend'
import {
  buildProjectAnalysisSnapshot,
  type ProjectAnalysisSnapshot,
} from './projectAnalysisSnapshot'

export const FLOW_STEPS = [
  'Synth',
  'Floor',
  'Fanout',
  'Place',
  'CTS',
  'Legal',
  'Route',
  'DRC',
  'LVS',
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
  | 'hold_wns'
  | 'hold_tns'
  | 'drc'
  | 'lvs'
  | 'area'
  | 'runtime'
  | 'memory'
  | 'die_area'
  | 'core_util'
  | 'frequency'
export type ProjectWorkspaceFlowStateMap = Partial<Record<FlowStep, ProjectStepStatus>>
export type ProjectWorkspaceFlowStatesById = Record<string, ProjectWorkspaceFlowStateMap>
export interface ProjectWorkspaceAnalysisInput {
  stepMetricTexts?: Partial<Record<FlowStep, string | null>>
  stepSummaryTexts?: Partial<Record<FlowStep, string | null>>
  stepHotspotTexts?: Partial<Record<FlowStep, string | null>>
  staTimingIssuesText?: string | null
  flowText?: string | null
}

export type ProjectWorkspaceAnalysisInputsById = Record<
  string,
  ProjectWorkspaceAnalysisInput
>

export interface ProjectManifestMpcCandidate {
  resource_id: string
  display_name: string
  installed_version: string
  path: string
  spec_path: string
}

export type ProjectQorBaselineSource = 'selected' | 'default'

export interface ProjectQorBaselineResolution {
  workspaceId: string
  source: ProjectQorBaselineSource
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
  workspaceName: string
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
  lvsCount?: ProjectSummaryMetric
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
  totalRuntimeSec: number | null
  peakMemoryMb: number | null
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
  analysis: ProjectAnalysisSnapshot
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
  /**
   * Workspaces that finished every step they configure. Counted per workspace rather
   * than per step cell so it reads against the same denominator as the signoff checks
   * beside it, and so an incomplete project points at workspaces a reader can open.
   */
  flowCompleteWorkspaceCount: number
  configuredStepCount: number
  successStepCount: number
  failedStepCount: number
  runningStepCount: number
  flowSuccessRatio: number
  drcCleanCount: number
  timingCleanCount: number
  timingAtRiskCount: number
  timingIncompleteCount: number
  timingUnavailableCount: number
  signoffReadyCount: number
  runStateSlices: ProjectRunStateSlice[]
  flowMetricSummary: ProjectFlowMetricSummary
}

export interface ProjectManagementProject {
  id: string
  projectType: ProjectManifestType
  name: string
  designName: string
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
  qorTrendSummary: ProjectQorTrendSummary
  branchLinks: ProjectBranchLink[]
  comparisonSummary: ProjectComparisonSummary
}

export interface ProjectSelectionState {
  selectedWorkspaceId: string
  selectedStep: FlowStep
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

/**
 * Build the project-wide QoR trend from the manifest and the workspace artifacts. This
 * is shared by Project Management and Home so both surfaces use exactly the same
 * baseline, scoring, lineage ordering, and comparable-metric rules.
 */
export function buildProjectQorTrendForManifest(
  manifest: ProjectManifest,
  workspaceFlowStates: ProjectWorkspaceFlowStatesById = {},
  workspaceAnalysisInputs: ProjectWorkspaceAnalysisInputsById = {},
  options: { baselineWorkspaceId?: string | null } = {},
): ProjectQorTrendSummary {
  const sortedWorkspaces = sortWorkspacesByLineage(manifest.workspaces).map(
    (item) => item.workspace,
  )
  return buildProjectQorTrendSummary(
    sortedWorkspaces.map((workspace) => ({
      workspaceId: workspace.workspace_id,
      workspaceName: workspaceDisplayName(workspace),
      workspacePath: workspace.workspace_path,
      createdAt: workspace.created_at,
      status: workspaceStatusFromFlow(
        workspace.status,
        workspaceFlowStates[workspace.workspace_id] ?? {},
      ),
      branchFrom: workspace.branch_from,
      stepMetricTexts:
        workspaceAnalysisInputs[workspace.workspace_id]?.stepMetricTexts ?? {},
      stepSummaryTexts:
        workspaceAnalysisInputs[workspace.workspace_id]?.stepSummaryTexts ?? {},
      stepHotspotTexts:
        workspaceAnalysisInputs[workspace.workspace_id]?.stepHotspotTexts ?? {},
      staTimingIssuesText:
        workspaceAnalysisInputs[workspace.workspace_id]?.staTimingIssuesText ?? null,
      stepStatuses: workspaceFlowStates[workspace.workspace_id] ?? {},
    })),
    {
      baselineWorkspaceId:
        options.baselineWorkspaceId ?? manifest.qor_baseline?.workspace_id ?? null,
    },
  )
}

/** Resolve the baseline Home stores in project.json when older projects omit one. */
export function resolveProjectQorBaselineWorkspace(
  manifest: ProjectManifest,
  currentWorkspaceId: string,
): ProjectQorBaselineResolution | null {
  const selectedId = manifest.qor_baseline?.workspace_id
  if (
    selectedId &&
    manifest.workspaces.some(
      (workspace) =>
        workspace.workspace_id === selectedId && workspace.status !== 'archived',
    )
  ) {
    return { workspaceId: selectedId, source: 'selected' }
  }

  const defaultWorkspace = manifest.workspaces.find(
    (workspace) =>
      workspace.workspace_id !== currentWorkspaceId && workspace.status !== 'archived',
  )
  if (defaultWorkspace) {
    return { workspaceId: defaultWorkspace.workspace_id, source: 'default' }
  }

  const currentWorkspace = manifest.workspaces.find(
    (workspace) =>
      workspace.workspace_id === currentWorkspaceId && workspace.status !== 'archived',
  )
  return currentWorkspace
    ? { workspaceId: currentWorkspace.workspace_id, source: 'default' }
    : null
}

export function buildProjectManagementProject(
  project?: Project | null,
  manifest?: ProjectManifest | null,
  workspaceFlowStates: ProjectWorkspaceFlowStatesById = {},
  workspaceAnalysisInputs: ProjectWorkspaceAnalysisInputsById = {},
): ProjectManagementProject {
  const path = manifest?.root_path ?? project?.path ?? ''
  const name = manifest?.name ?? project?.name ?? 'No Project Selected'
  const designName = manifest?.design_name ?? ''
  const topModule = manifest?.base_design.top_module ?? project?.topModule
  const pdk = manifest?.base_design.pdk ?? project?.pdk
  const manifestWorkspaces = manifest?.workspaces ?? []
  const lineageItems = sortWorkspacesByLineage(manifestWorkspaces)
  const sortedWorkspaces = lineageItems.map((item) => item.workspace)
  const workspaces = lineageItems.map(({ workspace, depth }) => {
    const flowStates = workspaceFlowStates[workspace.workspace_id] ?? {}
    return buildProjectWorkspace(
      {
        ...workspace,
        status: workspaceStatusFromFlow(workspace.status, flowStates),
      },
      flowStates,
      depth,
      workspaceArtifactDesignName(
        workspace,
        manifest?.base_design,
        designName || projectArtifactDesignName(project?.name ?? name, topModule),
      ),
    )
  })
  const qorTrendSummary = manifest
    ? buildProjectQorTrendForManifest(
        manifest,
        workspaceFlowStates,
        workspaceAnalysisInputs,
      )
    : buildProjectQorTrendSummary([])
  const snapshots = buildProjectAnalysisSnapshots(
    sortedWorkspaces,
    workspaceAnalysisInputs,
    workspaceFlowStates,
  )
  const workspaceSummaries = buildV3WorkspaceSummaries(
    sortedWorkspaces,
    workspaces,
    snapshots,
    qorTrendSummary,
  )
  const comparisonSummary = buildV3ComparisonSummary(
    manifest,
    sortedWorkspaces,
    qorTrendSummary,
  )

  return {
    id: path,
    projectType: manifest?.project_type ?? project?.projectType ?? 'backend',
    name,
    designName,
    path,
    pdk,
    topModule,
    objective: buildObjective(project, manifest),
    bestWorkspaceId: comparisonSummary.bestWorkspaceId,
    workspaces,
    metricsRows: buildV3MetricRows(workspaceSummaries),
    workspaceSummaries,
    stepCompareSummaries: manifest
      ? buildStepCompareSummaries(sortedWorkspaces, workspaces, workspaceSummaries)
      : [],
    dashboardSummary: buildProjectDashboardSummary(
      workspaces,
      workspaceSummaries,
      qorTrendSummary.timingClosure,
      qorTrendSummary,
    ),
    qorTrendSummary,
    branchLinks: manifest ? buildBranchLinks(sortedWorkspaces) : [],
    comparisonSummary,
  }
}

function buildProjectAnalysisSnapshots(
  manifestWorkspaces: ProjectManifestWorkspace[],
  inputs: ProjectWorkspaceAnalysisInputsById,
  flowStates: ProjectWorkspaceFlowStatesById,
): Map<string, ProjectAnalysisSnapshot> {
  return new Map(
    manifestWorkspaces.map((workspace) => {
      const input = inputs[workspace.workspace_id]
      return [
        workspace.workspace_id,
        buildProjectAnalysisSnapshot(
          {
            workspaceId: workspace.workspace_id,
            workspaceName: workspaceDisplayName(workspace),
            workspacePath: workspace.workspace_path,
            createdAt: workspace.created_at,
            status: workspace.status,
            branchFrom: workspace.branch_from,
            stepMetricTexts: input?.stepMetricTexts ?? {},
            stepSummaryTexts: input?.stepSummaryTexts ?? {},
            stepHotspotTexts: input?.stepHotspotTexts ?? {},
            staTimingIssuesText: input?.staTimingIssuesText ?? null,
            stepStatuses: flowStates[workspace.workspace_id] ?? {},
          },
          FLOW_STEPS,
        ),
      ]
    }),
  )
}

function buildV3WorkspaceSummaries(
  manifestWorkspaces: ProjectManifestWorkspace[],
  workspaces: ProjectWorkspace[],
  snapshots: Map<string, ProjectAnalysisSnapshot>,
  qorTrendSummary: ProjectQorTrendSummary,
): ProjectWorkspaceSummary[] {
  return manifestWorkspaces.map((workspace) => {
    const projectWorkspace = workspaces.find((item) => item.id === workspace.workspace_id)
    const snapshot =
      snapshots.get(workspace.workspace_id) ??
      emptyProjectAnalysisSnapshot(workspace.workspace_id, workspace.workspace_path)
    const qorWorkspace = qorTrendSummary.workspaces.find(
      (item) => item.workspaceId === workspace.workspace_id,
    )
    const finalMetrics = v3FinalMetrics(qorWorkspace)
    const flowMetrics = v3FlowMetrics(snapshot, projectWorkspace)

    return {
      workspaceId: workspace.workspace_id,
      workspaceName: workspaceDisplayName(workspace),
      workspacePath: workspace.workspace_path,
      finalMetrics,
      flowMetrics,
      steps: FLOW_STEPS.map((step) => {
        const status =
          projectWorkspace?.steps.find((cell) => cell.step === step)?.status ?? 'skipped'
        const analysis = snapshot.steps[step]
        return {
          step,
          title: step,
          status,
          metrics: (analysis?.metrics ?? [])
            .filter(
              (metric) =>
                metric.stepRole === 'primary' || metric.stepRole === 'secondary',
            )
            .map(v3SummaryMetric)
            .sort((left, right) => left.label.localeCompare(right.label)),
          detailHint: detailHintForStep(step),
        }
      }),
      deltaSummaries: [],
      analysis: snapshot,
    }
  })
}

function emptyProjectAnalysisSnapshot(
  workspaceId: string,
  workspacePath: string,
): ProjectAnalysisSnapshot {
  return {
    workspaceId,
    workspacePath,
    steps: {},
    signoffReadiness: {
      status: 'unavailable',
      scoreEligible: false,
      reasonCodes: [],
      groups: [],
    },
    timingConstraints: {
      status: 'unavailable',
      fingerprint: null,
      sourceFile: null,
      step: null,
    },
  }
}

function v3FinalMetrics(
  workspace: ProjectQorTrendWorkspaceSummary | undefined,
): ProjectWorkspaceFinalMetrics {
  const records = workspace?.records ?? []
  return {
    drcCount: v3MetricByName(records, 'drc_count'),
    lvsCount: v3MetricByName(records, 'lvs_count'),
    setupWns: v3MetricByName(records, 'sta_setup_wns'),
    setupTns: v3MetricByName(records, 'sta_setup_tns'),
    holdWns: v3MetricByName(records, 'sta_hold_wns'),
    holdTns: v3MetricByName(records, 'sta_hold_tns'),
    area:
      v3MetricByName(records, 'core_area') ??
      v3MetricByName(records, 'synthesis_cell_area'),
    dieArea: v3MetricByName(records, 'die_area'),
    coreUtil: v3MetricByName(records, 'core_utilization'),
    frequency: v3MetricByName(records, 'sta_frequency_mhz'),
  }
}

function v3MetricByName(
  records: ProjectQorMetricRecord[],
  metricName: string,
): ProjectSummaryMetric | undefined {
  const record = records.find((item) => item.metricName === metricName)
  return record ? v3SummaryMetric(record) : undefined
}

function v3SummaryMetric(record: ProjectQorMetricRecord): ProjectSummaryMetric {
  const hint = [record.cornerContext?.label, record.analysisGroup]
    .filter((value): value is string => Boolean(value))
    .join(' | ')
  return {
    id: record.metricName,
    label: record.displayName,
    value: record.value,
    display: record.value === null ? 'N/A' : formatMetricValue(record.value),
    state: v3MetricState(record),
    hint: hint || undefined,
  }
}

function v3MetricState(record: ProjectQorMetricRecord): ProjectMetricPoint['state'] {
  if (record.value === null) return 'pending'
  if (
    record.metricName.includes('drc') ||
    record.metricName.includes('lvs') ||
    record.metricName.includes('violation') ||
    record.metricName.includes('missing_corner') ||
    record.metricName.includes('parse_failure')
  ) {
    return record.value === 0 ? 'good' : record.value <= 3 ? 'warn' : 'bad'
  }
  if (record.metricName.includes('wns') || record.metricName.includes('tns')) {
    return record.value >= 0 ? 'good' : 'bad'
  }
  return 'good'
}

function v3FlowMetrics(
  snapshot: ProjectAnalysisSnapshot,
  workspace: ProjectWorkspace | undefined,
): ProjectWorkspaceFlowMetrics {
  const successfulSteps = new Set(
    workspace?.steps
      .filter((step) => step.status === 'success' || step.status === 'reused')
      .map((step) => step.step) ?? [],
  )
  const metrics = Object.values(snapshot.steps).flatMap((step) =>
    step && successfulSteps.has(step.step) ? step.metrics : [],
  )
  const runtimes = metrics
    .filter((metric) => metric.metricName === 'runtime_seconds')
    .flatMap((metric) => (metric.value === null ? [] : [metric.value]))
  const memories = metrics
    .filter((metric) => metric.metricName === 'peak_memory_mb')
    .flatMap((metric) => (metric.value === null ? [] : [metric.value]))
  return {
    totalRuntimeSec:
      runtimes.length > 0
        ? Number(runtimes.reduce((sum, value) => sum + value, 0).toFixed(3))
        : null,
    peakMemoryMb: memories.length > 0 ? Math.max(...memories) : null,
    checklistPassed: 0,
    checklistFailed: 0,
    checklistWarning: 0,
    checklistTotal: 0,
  }
}

function buildV3MetricRows(summaries: ProjectWorkspaceSummary[]): ProjectMetricRow[] {
  if (summaries.length === 0) return []
  const definitions: Array<{
    id: ProjectMetricId
    label: string
    hint: string
    metric: keyof ProjectWorkspaceFinalMetrics | 'runtime' | 'memory'
  }> = [
    {
      id: 'die_area',
      label: 'Die Area',
      hint: 'V3 final physical metric',
      metric: 'dieArea',
    },
    {
      id: 'core_util',
      label: 'Core Util',
      hint: 'V3 final physical metric',
      metric: 'coreUtil',
    },
    {
      id: 'frequency',
      label: 'Frequency [MHz]',
      hint: 'V3 STA controlling corner',
      metric: 'frequency',
    },
    {
      id: 'wns',
      label: 'Setup WNS',
      hint: 'V3 STA controlling corner',
      metric: 'setupWns',
    },
    {
      id: 'tns',
      label: 'Setup TNS',
      hint: 'V3 STA controlling corner',
      metric: 'setupTns',
    },
    {
      id: 'hold_wns',
      label: 'Hold WNS',
      hint: 'V3 STA controlling corner',
      metric: 'holdWns',
    },
    {
      id: 'hold_tns',
      label: 'Hold TNS',
      hint: 'V3 STA controlling corner',
      metric: 'holdTns',
    },
    { id: 'drc', label: 'DRC', hint: 'V3 DRC metric', metric: 'drcCount' },
    { id: 'lvs', label: 'LVS', hint: 'V3 LVS metric', metric: 'lvsCount' },
    { id: 'area', label: 'Area', hint: 'V3 final physical metric', metric: 'area' },
    {
      id: 'runtime',
      label: 'Runtime',
      hint: 'V3 successful-step total',
      metric: 'runtime',
    },
    { id: 'memory', label: 'Memory', hint: 'V3 successful-step peak', metric: 'memory' },
  ]
  return definitions.map((definition) => ({
    id: definition.id,
    label: definition.label,
    hint: definition.hint,
    kind: 'bar',
    points: summaries.map((summary) => {
      const metric =
        definition.metric === 'runtime'
          ? metricFromNumber(
              'runtime',
              'Runtime',
              summary.flowMetrics.totalRuntimeSec,
              'good',
            )
          : definition.metric === 'memory'
            ? metricFromNumber(
                'memory',
                'Memory',
                summary.flowMetrics.peakMemoryMb,
                'good',
              )
            : summary.finalMetrics[definition.metric]
      return {
        workspaceId: summary.workspaceId,
        workspaceName: summary.workspaceName,
        label: metric?.display ?? 'N/A',
        value: metric?.value ?? null,
        state: metric?.state ?? 'pending',
      }
    }),
  }))
}

function buildV3ComparisonSummary(
  manifest: ProjectManifest | null | undefined,
  workspaces: ProjectManifestWorkspace[],
  qorTrendSummary: ProjectQorTrendSummary,
): ProjectComparisonSummary {
  const bestRatedWorkspace = qorTrendSummary.workspaces
    .filter((workspace) => workspace.overallScore !== null)
    .sort((left, right) => (right.overallScore ?? -1) - (left.overallScore ?? -1))[0]
  const explicitBest = manifest?.best_workspace?.workspace_id
  const bestWorkspaceId =
    bestRatedWorkspace?.workspaceId ?? explicitBest ?? workspaces[0]?.workspace_id ?? ''
  return {
    bestWorkspaceId,
    bestReason: bestRatedWorkspace
      ? `Highest eligible QoR score: ${bestRatedWorkspace.overallScore}`
      : 'No workspace has eligible V3 signoff readiness.',
    riskLabels: Array.from(
      new Set(
        qorTrendSummary.risks.flatMap((risk) => (risk.message ? [risk.message] : [])),
      ),
    ).slice(0, 8),
    parameterDiffs: buildParameterDiffs(workspaces),
    metricDiffs: [],
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

export function projectMpcOptionFromResource(
  resource: ResourceInfo,
): ProjectManifestMpcCandidate | null {
  if (
    resource.type !== 'mpc' ||
    (resource.status !== 'installed' && resource.status !== 'update_available') ||
    resource.health.status !== 'ok' ||
    resource.health.managed !== true ||
    !resource.id.startsWith('mpc:') ||
    !resource.path ||
    !resource.installed_version
  ) {
    return null
  }

  const path = normalizePath(resource.path.trim())
  const displayName = resource.display_name.trim() || resource.name
  const installedVersion = resource.installed_version.trim()
  if (!path || !displayName || !installedVersion) return null

  return {
    resource_id: resource.id,
    display_name: displayName,
    installed_version: installedVersion,
    path,
    spec_path: joinPath(path, 'spec', 'spec.json.in'),
  }
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
    const flowStep = knownFlowStep(name)
    if (!flowStep || !status) return stateMap

    stateMap[flowStep] = status
    return stateMap
  }, {})
}

export function nextWorkspaceId(
  project: ProjectManagementProject,
  occupiedWorkspaceIds: string[] = [],
): string {
  const numbers = project.workspaces
    .map((workspace) => Number(workspace.id.replace(/^ws_/, '')))
    .concat(
      occupiedWorkspaceIds.map((workspaceId) => Number(workspaceId.replace(/^ws_/, ''))),
    )
    .filter(Number.isFinite)
  const next = Math.max(0, ...numbers) + 1
  return `ws_${String(next).padStart(4, '0')}`
}

export function createWorkspaceBranchDraft(
  project: ProjectManagementProject,
  sourceWorkspaceId: string,
  step: FlowStep,
  targetWorkspaceId = nextWorkspaceId(project),
): WorkspaceBranchDraft {
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
  workspace: ProjectManifestWorkspace,
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
    name: workspaceDisplayName(workspace),
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

export function workspaceStatusFromFlow(
  manifestStatus: ProjectWorkspaceStatus,
  flowStates: ProjectWorkspaceFlowStateMap,
): ProjectWorkspaceStatus {
  if (manifestStatus === 'archived') return 'archived'
  const states = Object.values(flowStates)
  if (states.length === 0) return manifestStatus
  if (states.includes('failed')) return 'failed'
  if (states.includes('running')) return 'running'
  if (states.includes('unstart')) return 'in_progress'
  if (states.some((state) => state === 'success' || state === 'reused')) return 'success'
  return manifestStatus
}

function workspaceDisplayName(workspace: ProjectManifestWorkspace): string {
  return (
    basenamePath(workspace.workspace_path) || workspace.name || workspace.workspace_id
  )
}

function sortWorkspacesByLineage(workspaces: ProjectManifestWorkspace[]): Array<{
  workspace: ProjectManifestWorkspace
  depth: number
}> {
  const byId = new Map(workspaces.map((workspace) => [workspace.workspace_id, workspace]))
  const childrenBySource = new Map<string, ProjectManifestWorkspace[]>()
  const roots: ProjectManifestWorkspace[] = []

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
    left: ProjectManifestWorkspace,
    right: ProjectManifestWorkspace,
  ) =>
    new Date(left.created_at).getTime() - new Date(right.created_at).getTime() ||
    left.workspace_id.localeCompare(right.workspace_id)

  roots.sort(sortByCreatedAt)
  for (const children of childrenBySource.values()) children.sort(sortByCreatedAt)

  const visited = new Set<string>()
  const sorted: Array<{ workspace: ProjectManifestWorkspace; depth: number }> = []
  const visit = (workspace: ProjectManifestWorkspace, depth: number) => {
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
  const firstIncomplete = configuredSteps.find(
    (cell) => !isCompletedStepStatus(cell.status),
  )
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
  workspace: ProjectManifestWorkspace,
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
    canCreateWorkspace: isCompletedStepStatus(status),
  }
}

function projectStepStatusFromFlowState(state: unknown): ProjectStepStatus | null {
  const normalized = optionalString(state).toLowerCase()
  if (!normalized) return null

  if (['success', 'succeeded', 'complete', 'completed', 'done'].includes(normalized))
    return 'success'
  if (['reused', 'reuse'].includes(normalized)) return 'reused'
  if (['skipped', 'skip'].includes(normalized)) return 'skipped'
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

function buildBranchLinks(workspaces: ProjectManifestWorkspace[]): ProjectBranchLink[] {
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

function buildStepCompareSummaries(
  manifestWorkspaces: ProjectManifestWorkspace[],
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
          workspaceName: workspaceDisplayName(workspace),
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
        workspaceName: workspaceDisplayName(workspace),
        label: 'N/A',
        value: null,
        state: 'pending' as const,
      })),
    }
    const configuredCount = workspaces.filter(
      (workspace) =>
        workspace.steps.find((cell) => cell.step === step)?.status !== 'skipped',
    ).length
    const successCount = workspaces.filter((workspace) =>
      isCompletedStepStatus(
        workspace.steps.find((cell) => cell.step === step)?.status ?? 'skipped',
      ),
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
  timingClosure: ProjectQorTimingSummary,
  qorTrendSummary: ProjectQorTrendSummary,
): ProjectDashboardSummary {
  const isStepComplete = (cell: ProjectStepCell): boolean =>
    cell.status === 'success' || cell.status === 'reused'
  const configuredCells = workspaces.flatMap((workspace) =>
    workspace.steps.filter((cell) => cell.status !== 'skipped'),
  )
  const successStepCount = configuredCells.filter(isStepComplete).length
  // A workspace configuring no step at all has nothing to finish, so it does not count.
  const flowCompleteWorkspaceCount = workspaces.filter((workspace) => {
    const configured = workspace.steps.filter((cell) => cell.status !== 'skipped')
    return configured.length > 0 && configured.every(isStepComplete)
  }).length
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
  const signoffReadyCount = qorTrendSummary.workspaces.filter(
    (workspace) => workspace.signoffReadiness.status === 'pass',
  ).length
  const runStateSlices = buildRunStateSlices(workspaces)
  const flowMetricSummary = buildFlowMetricSummary(workspaceSummaries)

  return {
    workspaceCount: workspaces.length,
    flowCompleteWorkspaceCount,
    configuredStepCount,
    successStepCount,
    failedStepCount,
    runningStepCount,
    flowSuccessRatio,
    drcCleanCount,
    timingCleanCount: timingClosure.cleanWorkspaceCount,
    timingAtRiskCount: timingClosure.atRiskWorkspaceCount,
    timingIncompleteCount: timingClosure.incompleteWorkspaceCount,
    timingUnavailableCount: timingClosure.unavailableWorkspaceCount,
    signoffReadyCount,
    runStateSlices,
    flowMetricSummary,
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
  const runtimes = workspaceSummaries.flatMap((summary) =>
    summary.flowMetrics.totalRuntimeSec === null
      ? []
      : [summary.flowMetrics.totalRuntimeSec],
  )
  const memories = workspaceSummaries.flatMap((summary) =>
    summary.flowMetrics.peakMemoryMb === null ? [] : [summary.flowMetrics.peakMemoryMb],
  )
  const checklist = workspaceSummaries.reduce(
    (totals, summary) => ({
      passed: totals.passed + summary.flowMetrics.checklistPassed,
      failed: totals.failed + summary.flowMetrics.checklistFailed,
      warning: totals.warning + summary.flowMetrics.checklistWarning,
      total: totals.total + summary.flowMetrics.checklistTotal,
    }),
    { passed: 0, failed: 0, warning: 0, total: 0 },
  )

  return {
    totalRuntimeSec:
      runtimes.length > 0
        ? Number(runtimes.reduce((sum, value) => sum + value, 0).toFixed(3))
        : null,
    peakMemoryMb: memories.length > 0 ? Math.max(...memories) : null,
    checklistPassed: checklist.passed,
    checklistFailed: checklist.failed,
    checklistWarning: checklist.warning,
    checklistTotal: checklist.total,
    runtimePoints: workspaceSummaries.map((summary) => ({
      workspaceId: summary.workspaceId,
      workspaceName: summary.workspaceName,
      label:
        summary.flowMetrics.totalRuntimeSec === null
          ? 'N/A'
          : formatRuntimeLabel(summary.flowMetrics.totalRuntimeSec),
      value: summary.flowMetrics.totalRuntimeSec,
      state: summary.flowMetrics.totalRuntimeSec === null ? 'pending' : 'good',
    })),
    memoryPoints: workspaceSummaries.map((summary) => ({
      workspaceId: summary.workspaceId,
      workspaceName: summary.workspaceName,
      label:
        summary.flowMetrics.peakMemoryMb === null
          ? 'N/A'
          : `${formatMetricValue(summary.flowMetrics.peakMemoryMb)} MB`,
      value: summary.flowMetrics.peakMemoryMb,
      state: summary.flowMetrics.peakMemoryMb === null ? 'pending' : 'good',
    })),
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

interface StepCompareDefinition {
  id: string
  label: string
  hint: string
}

const STEP_ANALYSIS_METRIC_IDS: Record<FlowStep, readonly string[]> = {
  Synth: [
    'synthesis_cell_area',
    'synthesis_cell_count',
    'synthesis_port_count',
    'synthesis_wire_count',
  ],
  Floor: ['die_area', 'core_area', 'core_utilization', 'instance_count', 'net_count'],
  Fanout: ['fanout_max', 'instance_count', 'net_count'],
  Place: [
    'place_congestion_egr_overflow_max',
    'place_congestion_egr_overflow_total',
    'place_flute_wirelength',
    'place_grwl',
    'place_hpwl',
    'place_lutrudy_utilization_max',
    'place_rudy_utilization_max',
  ],
  CTS: [
    'clock_path_max_buffer',
    'clock_path_min_buffer',
    'clock_wirelength',
    'cts_buffer_area',
    'cts_buffer_count',
    'cts_clock_tree_max_level',
    'cts_clock_wirelength_max',
    'cts_worst_optimized_skew_ns',
    'cts_worst_max_insertion_latency_ns',
    'cts_skew_target_unmet_count',
    'instance_count',
    'io_pin_count',
    'net_count',
  ],
  Legal: [],
  Route: [
    'route_dr_total_patch_count',
    'route_dr_total_via_count',
    'route_dr_total_violation_count',
    'route_dr_total_wirelength',
    'route_la_total_demand',
    'route_la_total_overflow',
    'route_via_count',
    'route_wirelength',
  ],
  DRC: ['drc_count'],
  Filler: [],
  RCX: [
    'rcx_missing_corner_count',
    'rcx_spef_parse_failure_count',
    'rcx_worst_total_capacitance_ff',
    'rcx_worst_total_resistance_ohm',
  ],
  STA: [
    'sta_setup_wns',
    'sta_setup_tns',
    'sta_hold_wns',
    'sta_hold_tns',
    'sta_frequency_mhz',
  ],
  Harden: ['harden_artifact_missing_count'],
}

function stepMetricDefinitions(
  step: FlowStep,
  workspaceSummaries: ProjectWorkspaceSummary[],
): StepCompareDefinition[] {
  const definitionsById = new Map<string, StepCompareDefinition>()
  for (const summary of workspaceSummaries) {
    const stepSummary = summary.steps.find((item) => item.step === step)
    for (const metric of stepSummary?.metrics ?? []) {
      if (definitionsById.has(metric.id)) continue
      definitionsById.set(metric.id, {
        id: metric.id,
        label: metric.label,
        hint: metric.hint ?? metric.label,
      })
    }
  }
  return STEP_ANALYSIS_METRIC_IDS[step].flatMap(
    (metricId) => definitionsById.get(metricId) ?? [],
  )
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

function buildParameterDiffs(
  workspaces: ProjectManifestWorkspace[],
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
  workspace: ProjectManifestWorkspace,
  baseDesign: ProjectManifestBaseDesign | undefined,
  fallback: string,
): string {
  return (
    normalizeArtifactDesignName(
      parameterPatchValues((workspace.parameter_patch ?? {}).design).to,
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

function normalizeFlowStep(step: FlowStep | string): FlowStep {
  return knownFlowStep(step) ?? 'Synth'
}

function knownFlowStep(step: FlowStep | string): FlowStep | null {
  if ((FLOW_STEPS as readonly string[]).includes(step)) return step as FlowStep
  return FLOW_STEP_ALIASES[String(step).toLowerCase()] ?? null
}

function isCompletedStepStatus(status: ProjectStepStatus): boolean {
  return status === 'success' || status === 'reused'
}

function nextFlowStep(step: FlowStep): FlowStep {
  const index = FLOW_STEPS.indexOf(step)
  return FLOW_STEPS[Math.min(index + 1, FLOW_STEPS.length - 1)]
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
