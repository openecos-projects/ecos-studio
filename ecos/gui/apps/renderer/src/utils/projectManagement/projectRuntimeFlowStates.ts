import {
  parseProjectManifestFlowStep,
  type BackendProjectActiveOperation,
  type BackendProjectComparison,
  type ProjectManifestFlowStep,
  type ProjectStepStatus,
} from '@ecos-studio/shared'
import type {
  ProjectWorkspaceFlowStateMap,
  ProjectWorkspaceFlowStatesById,
} from '../backendProjectManagement'

export function projectComparisonWorkspaceFlowStates(
  comparison: BackendProjectComparison | null,
  fallback: ProjectWorkspaceFlowStatesById,
): ProjectWorkspaceFlowStatesById {
  const snapshots = comparison?.workspaceSnapshots
  return snapshots?.status === 'ready' || snapshots?.status === 'partial'
    ? snapshots.data.flowStates
    : fallback
}

export function projectWorkspaceFlowStatesWithRuntime(
  committed: ProjectWorkspaceFlowStatesById,
  operations: readonly BackendProjectActiveOperation[],
): ProjectWorkspaceFlowStatesById {
  let projected = committed
  for (const operation of operations) {
    if (!operation.flow) continue
    const runtimeStates = runtimeProjectFlowStates(operation.flow.steps)
    if (Object.keys(runtimeStates).length === 0) continue
    if (projected === committed) projected = { ...committed }
    projected[operation.projectWorkspaceId] = {
      ...committed[operation.projectWorkspaceId],
      ...runtimeStates,
    }
  }
  return projected
}

function runtimeProjectFlowStates(
  steps: readonly { name: string; state: string }[],
): ProjectWorkspaceFlowStateMap {
  const grouped = new Map<ProjectManifestFlowStep, ProjectStepStatus[]>()
  for (const step of steps) {
    const projectStep = parseProjectManifestFlowStep(step.name)
    if (!projectStep) continue
    const states = grouped.get(projectStep) ?? []
    states.push(runtimeProjectStepStatus(step.state))
    grouped.set(projectStep, states)
  }
  return Object.fromEntries(
    [...grouped].map(([step, states]) => [step, aggregateRuntimeStepStatuses(states)]),
  )
}

function runtimeProjectStepStatus(state: string): ProjectStepStatus {
  switch (state.trim().toLowerCase()) {
    case 'success':
    case 'succeeded':
    case 'complete':
    case 'completed':
      return 'success'
    case 'warning':
      return 'warning'
    case 'reused':
      return 'reused'
    case 'skipped':
      return 'skipped'
    case 'ongoing':
    case 'running':
      return 'running'
    case 'incomplete':
    case 'invalid':
    case 'failed':
    case 'failure':
    case 'error':
    case 'cancelled':
    case 'canceled':
    case 'interrupted':
      return 'failed'
    default:
      return 'unstart'
  }
}

function aggregateRuntimeStepStatuses(
  states: readonly ProjectStepStatus[],
): ProjectStepStatus {
  if (states.includes('failed')) return 'failed'
  if (states.includes('running')) return 'running'
  if (states.includes('unstart')) return 'unstart'
  if (states.includes('warning')) return 'warning'
  if (states.includes('success')) return 'success'
  if (states.includes('reused')) return 'reused'
  return 'skipped'
}
