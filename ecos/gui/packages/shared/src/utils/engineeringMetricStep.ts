import {
  flowStepRegistry,
  parseProjectManifestFlowStep,
  type ProjectManifestFlowStep,
} from './flowStepRegistry.ts'

/**
 * Producer `scope` values assigned by ECC `_metric_scope_and_roles`
 * (chipcompiler/tools/ecc/metrics.py), mirrored in the flow step registry:
 * the six pinned signoff/final scopes plus each step's lowercased name.
 */
const METRIC_SCOPE_STEPS: Record<string, ProjectManifestFlowStep> = Object.fromEntries(
  flowStepRegistry.flatMap((step) =>
    step.metricScopes.map((scope) => [scope, step.id] as const),
  ),
)

/** Canonical metric ids are namespaced by their emitting step. */
const METRIC_ID_PREFIX_STEPS: Record<string, ProjectManifestFlowStep> =
  Object.fromEntries(
    flowStepRegistry.flatMap((step) =>
      step.metricIdPrefixes.map((prefix) => [prefix, step.id] as const),
    ),
  )

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Step attribution for one flat Snapshot v6 metric record.
 *
 * ECC validates metric records per step and flattens them into the single
 * Snapshot `metrics` projection without a dedicated step field
 * (chipcompiler/engine/analysis.py `collect_workspace_projections`). The
 * owning step is still recoverable from fields the producer assigns per step,
 * checked here in order of authority:
 *
 * 1. `scope` — `_metric_scope_and_roles` pins six signoff/final scopes (the
 *    map above) and otherwise uses the step name lowercased.
 * 2. `scope` with an `_execution` suffix — runtime records
 *    (`runtime_seconds`, `peak_memory_mb`) carry `{step}_execution`.
 * 3. generic `scope` parse — the producer-assigned scope is authoritative for
 *    records without a step-prefixed id (`die_area`, `instance_count`, ...),
 *    and db metrics such as `clock_count` are re-emitted at every step under
 *    that step's scope, so the scope outranks the id prefix.
 * 4. `id` prefix — canonical signoff ids are step-namespaced (`sta_*`,
 *    `route_*`, ...), which covers records with a non-step scope such as
 *    `workspace`.
 * 5. `analysis_group` with a `_metrics` suffix — the default group is
 *    `{step}_metrics`; named groups never reach this rule because their ids
 *    are step-prefixed.
 *
 * A record that matches none of these stays unattributed (`null`) rather than
 * guessing: it remains visible in flat metric lists but is excluded from
 * per-step comparison.
 */
export function engineeringSnapshotMetricStep(
  metric: Record<string, unknown>,
): ProjectManifestFlowStep | null {
  const scope = text(metric.scope)
  if (scope) {
    const mapped = METRIC_SCOPE_STEPS[scope]
    if (mapped) return mapped
    if (scope.endsWith('_execution')) {
      const step = parseProjectManifestFlowStep(scope.slice(0, -'_execution'.length))
      if (step) return step
    }
    const step = parseProjectManifestFlowStep(scope)
    if (step) return step
  }
  const prefixed = METRIC_ID_PREFIX_STEPS[text(metric.id).split('_', 1)[0] ?? '']
  if (prefixed) return prefixed
  const group = text(metric.analysis_group)
  if (group.endsWith('_metrics')) {
    return parseProjectManifestFlowStep(group.slice(0, -'_metrics'.length))
  }
  return null
}
