import {
  normalizeProjectManifestStage,
  projectManifestFrontendFlowSteps,
  type ProjectManifest,
  type ProjectManifestFrontendFlowStep,
  type ProjectManifestWorkspace,
} from '@ecos-studio/shared'
import type { Project } from '@/types'
import { buildFrontendProjectAnalysis } from '@/views/project-management/frontendProjectAnalysis'
import {
  buildProjectManagementProject as buildBackendProjectManagementProject,
  workspaceStatusFromFlow,
  type ProjectStepStatus,
  type ProjectWorkspaceAnalysisInputsById,
  type ProjectWorkspaceFlowStateMap,
  type ProjectWorkspaceFlowStatesById,
  type ProjectWorkspaceStatus,
} from '../backendProjectManagement'
import type {
  ProjectFlowStatusHint,
  ProjectManagementProject,
  ProjectStage,
  ProjectStepCell,
  ProjectWorkspace,
} from './model'

export const FRONTEND_FLOW_STEPS = projectManifestFrontendFlowSteps

export function buildFrontendProjectManagementProject(
  project: Project | null | undefined,
  manifest: ProjectManifest,
  workspaceFlowStates: ProjectWorkspaceFlowStatesById = {},
  workspaceAnalysisInputs: ProjectWorkspaceAnalysisInputsById = {},
): ProjectManagementProject {
  const base = buildBackendProjectManagementProject(project, null)
  const lineage = sortWorkspacesByLineage(manifest.workspaces)
  const workspaces = lineage.map(({ workspace, depth }) =>
    buildFrontendWorkspace(
      workspace,
      workspaceFlowStates[workspace.workspace_id] ?? {},
      depth,
    ),
  )
  const frontendAnalysis = buildFrontendProjectAnalysis(
    workspaces.map((workspace) => ({
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspacePath: workspace.workspacePath,
      status: workspace.status,
      startStage: workspace.startStep as ProjectManifestFrontendFlowStep,
      endStage: workspace.endStep as ProjectManifestFrontendFlowStep,
      steps: workspace.steps.map((step) => ({
        stage: step.step as ProjectManifestFrontendFlowStep,
        status: step.status,
      })),
      detailTexts:
        workspaceAnalysisInputs[workspace.id]?.frontendDetailTexts ?? undefined,
      qorMetricTexts:
        workspaceAnalysisInputs[workspace.id]?.frontendQorMetricTexts ?? undefined,
      qorSummaryTexts:
        workspaceAnalysisInputs[workspace.id]?.frontendQorSummaryTexts ?? undefined,
      qorHotspotTexts:
        workspaceAnalysisInputs[workspace.id]?.frontendQorHotspotTexts ?? undefined,
    })),
  )
  const bestWorkspaceId =
    workspaces.find((workspace) => workspace.status === 'success')?.id ??
    workspaces[0]?.id ??
    ''

  return {
    ...base,
    id: manifest.root_path,
    projectType: 'frontend',
    name: manifest.name,
    designName: manifest.design_name,
    path: manifest.root_path,
    pdk: manifest.base_design.pdk,
    topModule: manifest.base_design.top_module,
    objective: manifest.objectives.primary
      ? `${manifest.objectives.primary} objective`
      : 'verification objective',
    flowSteps: FRONTEND_FLOW_STEPS,
    bestWorkspaceId,
    workspaces,
    metricsRows: [],
    workspaceSummaries: [],
    stepCompareSummaries: [],
    branchLinks: [],
    comparisonSummary: {
      ...base.comparisonSummary,
      bestWorkspaceId,
    },
    frontendAnalysis,
  }
}

function buildFrontendWorkspace(
  workspace: ProjectManifestWorkspace,
  flowStates: ProjectWorkspaceFlowStateMap,
  depth: number,
): ProjectWorkspace {
  const startStep = normalizeFrontendStage(workspace.start_step)
  const endStep = normalizeFrontendStage(workspace.end_step)
  const branchStep = workspace.branch_from
    ? normalizeFrontendStage(workspace.branch_from.source_step)
    : null
  const status = workspaceStatusFromFlow(workspace.status, flowStates)
  const steps = FRONTEND_FLOW_STEPS.map((step) =>
    buildFrontendStep(
      workspace,
      status,
      step,
      startStep,
      endStep,
      branchStep,
      flowStates,
    ),
  )

  return {
    id: workspace.workspace_id,
    name: workspaceName(workspace),
    workspacePath: workspace.workspace_path,
    artifactDesignName: '',
    status,
    description: workspace.branch_from
      ? `from ${workspace.branch_from.source_workspace_id}/${branchStep}`
      : 'initial workspace',
    sourceWorkspaceId: workspace.source_workspace_id,
    branchStep,
    startStep,
    endStep,
    depth,
    flowStatusHint: buildFlowStatusHint(steps, startStep, endStep, flowStates),
    steps,
  }
}

function buildFrontendStep(
  workspace: ProjectManifestWorkspace,
  workspaceStatus: ProjectWorkspaceStatus,
  step: ProjectManifestFrontendFlowStep,
  startStep: ProjectManifestFrontendFlowStep,
  endStep: ProjectManifestFrontendFlowStep,
  branchStep: ProjectManifestFrontendFlowStep | null,
  flowStates: ProjectWorkspaceFlowStateMap,
): ProjectStepCell {
  const stepIndex = FRONTEND_FLOW_STEPS.indexOf(step)
  const startIndex = FRONTEND_FLOW_STEPS.indexOf(startStep)
  const endIndex = FRONTEND_FLOW_STEPS.indexOf(endStep)
  const flowStatus = flowStates[step]
  let status: ProjectStepStatus

  if (workspace.status !== 'archived' && flowStatus) status = flowStatus
  else if (workspace.status === 'archived') status = 'skipped'
  else if (stepIndex < startIndex) {
    status =
      workspace.branch_from &&
      branchStep &&
      stepIndex <= FRONTEND_FLOW_STEPS.indexOf(branchStep)
        ? 'reused'
        : 'skipped'
  } else if (stepIndex > endIndex || Object.keys(flowStates).length > 0) {
    status = 'skipped'
  } else if (workspaceStatus === 'running') status = 'running'
  else if (workspaceStatus === 'failed' && stepIndex === endIndex) status = 'failed'
  else if (workspaceStatus === 'not_started') status = 'unstart'
  else status = 'success'

  return {
    step,
    status,
    label: status === 'reused' ? 'success' : status,
    canCreateWorkspace: false,
  }
}

function buildFlowStatusHint(
  steps: ProjectStepCell[],
  startStep: ProjectManifestFrontendFlowStep,
  endStep: ProjectManifestFrontendFlowStep,
  flowStates: ProjectWorkspaceFlowStateMap,
): ProjectFlowStatusHint {
  const startIndex = FRONTEND_FLOW_STEPS.indexOf(startStep)
  const endIndex = FRONTEND_FLOW_STEPS.indexOf(endStep)
  const recordedFlow = Object.keys(flowStates).length > 0
  const configured = steps.filter((cell) => {
    const index = FRONTEND_FLOW_STEPS.indexOf(
      cell.step as ProjectManifestFrontendFlowStep,
    )
    if (index < startIndex || index > endIndex) return false
    return !recordedFlow || flowStates[cell.step] !== undefined
  })
  const incomplete = configured.find(
    (cell) => cell.status !== 'success' && cell.status !== 'reused',
  )
  if (!incomplete) return { state: 'success', label: 'Success' }
  return {
    state: flowHintState(incomplete.status),
    step: incomplete.step,
    label: `${frontendStageLabel(incomplete.step)} ${incomplete.status}`,
  }
}

function flowHintState(status: ProjectStepStatus): ProjectFlowStatusHint['state'] {
  if (status === 'failed') return 'failed'
  if (status === 'running') return 'running'
  if (status === 'success' || status === 'reused') return 'success'
  if (status === 'skipped') return 'skipped'
  return 'unstart'
}

function frontendStageLabel(stage: ProjectStage): string {
  const labels: Record<ProjectManifestFrontendFlowStep, string> = {
    prepare: 'Prepare',
    review: 'RTL Review',
    elab: 'Elab',
    lint: 'Lint',
    sim: 'Sim',
  }
  return labels[stage as ProjectManifestFrontendFlowStep]
}

function normalizeFrontendStage(value: string): ProjectManifestFrontendFlowStep {
  return normalizeProjectManifestStage(
    'frontend',
    value,
  ) as ProjectManifestFrontendFlowStep
}

function workspaceName(workspace: ProjectManifestWorkspace): string {
  return (
    workspace.workspace_path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ||
    workspace.name ||
    workspace.workspace_id
  )
}

function sortWorkspacesByLineage(
  workspaces: ProjectManifestWorkspace[],
): Array<{ workspace: ProjectManifestWorkspace; depth: number }> {
  const byId = new Map(workspaces.map((workspace) => [workspace.workspace_id, workspace]))
  const childrenBySource = new Map<string, ProjectManifestWorkspace[]>()
  const roots: ProjectManifestWorkspace[] = []

  for (const workspace of workspaces) {
    const sourceId =
      workspace.branch_from?.source_workspace_id ?? workspace.source_workspace_id
    if (sourceId && byId.has(sourceId)) {
      const children = childrenBySource.get(sourceId) ?? []
      children.push(workspace)
      childrenBySource.set(sourceId, children)
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
  for (const workspace of [...workspaces].sort(sortByCreatedAt)) visit(workspace, 0)
  return sorted
}
