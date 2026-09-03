import type { WorkspaceOverviewCore, WorkspaceSummary } from '@ecos-studio/shared'

export function recentProjectFreshness(
  workspaceRecognized: boolean,
  committedRevision: number | undefined,
): WorkspaceSummary['committedFreshness'] {
  if (committedRevision === undefined) return undefined
  return workspaceRecognized ? 'last-verified' : 'stale'
}

function totalRuntime(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return hours
    ? `${hours}h ${minutes}m`
    : minutes
      ? `${minutes}m ${remainder}s`
      : `${remainder}s`
}

export function recentProjectSnapshot(
  overview: WorkspaceOverviewCore,
  verifiedAt = new Date().toISOString(),
): Partial<WorkspaceSummary> {
  const snapshot: Partial<WorkspaceSummary> = {}
  const flow = overview.flow
  if (flow.status === 'ready' || flow.status === 'partial') {
    const steps = flow.data.steps
    const completedSteps = steps.filter(
      (step) => step.state === 'succeeded' || step.state === 'skipped',
    ).length
    const failed = steps.find((step) => step.state === 'failed')
    const running = steps.find((step) => step.state === 'running')
    const pending = steps.find((step) => step.state === 'not-started')
    snapshot.status = running
      ? 'running'
      : completedSteps === steps.length && steps.length > 0
        ? 'success'
        : failed
          ? 'failed'
          : completedSteps > 0
            ? 'in_progress'
            : 'not_started'
    snapshot.totalSteps = steps.length
    snapshot.completedSteps = completedSteps
    snapshot.currentStep = running?.name ?? failed?.name ?? pending?.name
    if (steps.some((step) => step.runtimeSeconds !== undefined)) {
      snapshot.totalRuntime = totalRuntime(
        steps.reduce((total, step) => total + (step.runtimeSeconds ?? 0), 0),
      )
    }
  }
  const configuration = overview.configuration
  if (configuration.status === 'ready' || configuration.status === 'partial') {
    snapshot.pdk = configuration.data.pdk || undefined
    snapshot.topModule = configuration.data.topModule || undefined
    snapshot.frequencyTarget = configuration.data.frequencyMaxMhz ?? undefined
  }
  const metrics = overview.keyMetrics
  if (metrics.status === 'ready' || metrics.status === 'partial') {
    snapshot.coreUtilization =
      metrics.data.items.find((metric) => metric.id === 'core-utilization')?.value ??
      undefined
  }
  const revision = overview.revision
  if (revision?.status === 'ready' || revision?.status === 'partial') {
    snapshot.committedWorkspaceId = revision.data.workspaceId
    snapshot.committedRevision = revision.data.workspaceRevision
    snapshot.committedVerifiedAt = verifiedAt
    snapshot.committedFreshness = 'last-verified'
  }
  return snapshot
}
