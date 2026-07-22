import type {
  ProjectComparisonMetricDiff,
  ProjectComparisonParameterDiff,
  ProjectComparisonSummary,
  ProjectManifest,
  ProjectMetricDefinition,
  ProjectMetricId,
  ProjectWorkspaceManifest,
  ProjectWorkspaceStatus,
} from './projectManagement'

export function buildProjectComparisonSummary(
  manifest: ProjectManifest,
  metricDefinitions: ProjectMetricDefinition[],
): ProjectComparisonSummary {
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
    metricDiffs: buildMetricDiffs(baselineWorkspace, bestWorkspace, metricDefinitions),
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
  metricDefinitions: ProjectMetricDefinition[],
): ProjectComparisonMetricDiff[] {
  if (
    !baselineWorkspace ||
    !targetWorkspace ||
    baselineWorkspace.workspace_id === targetWorkspace.workspace_id
  )
    return []

  return metricDefinitions.flatMap((definition) => {
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
  return value === undefined || value === null ? undefined : String(value)
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

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
