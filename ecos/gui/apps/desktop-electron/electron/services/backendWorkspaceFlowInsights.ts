import type {
  ReadSection,
  WorkspaceCongestionStatistic,
  WorkspaceDrcHotspot,
  WorkspaceFlowInsightsSummary,
  WorkspaceFlowSummary,
  WorkspaceQorSummary,
  WorkspaceStaInsights,
  WorkspaceStaTimingIssue,
} from '@ecos-studio/shared'
import type { ProjectEngineeringSnapshotReadResult } from './projectManagementReadService'

const TREND_METRIC_IDS = new Set([
  'instance_count',
  'instance_area',
  'net_count',
  'io_pin_count',
  'die_area',
  'core_area',
  'core_utilization',
  'macro_count',
  'macro_area',
  'std_cell_count',
  'std_cell_area',
  'clock_count',
  'clock_area',
  'io_pad_count',
  'io_pad_area',
  'route_wirelength',
  'route_via_count',
])

const STEP_ALIASES: Record<string, string> = {
  synthesis: 'Synth',
  synth: 'Synth',
  floorplan: 'Floor',
  floor: 'Floor',
  prefloorplan: 'Floor',
  macroplacement: 'Floor',
  postfloorplan: 'Floor',
  lec: 'LEC',
  legalization: 'Legal',
  legal: 'Legal',
  'timing optimization': 'Timing Opt',
  timingoptimization: 'Timing Opt',
  postroutelec: 'Post-route LEC',
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringValue(value: Record<string, unknown> | null, key: string): string {
  const candidate = value?.[key]
  return typeof candidate === 'string' ? candidate : ''
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function canonicalStepId(value: string): string {
  const trimmed = value.trim()
  return STEP_ALIASES[trimmed.toLowerCase()] ?? trimmed
}

function metricValue(
  qor: WorkspaceQorSummary,
  stepId: string,
  metricId: string,
  corner?: string,
): number | null {
  return (
    qor.metrics.find(
      (metric) =>
        metric.id === metricId &&
        metric.stepId.toLowerCase() === canonicalStepId(stepId).toLowerCase() &&
        (corner === undefined || metric.corner === corner),
    )?.value ?? null
  )
}

function trendVerdict(
  delta: number | null,
  polarity: WorkspaceQorSummary['metrics'][number]['polarity'],
): 'improvement' | 'regression' | 'unchanged' | 'not-comparable' {
  if (delta === null || polarity === 'trend_only' || polarity === 'target_range') {
    return 'not-comparable'
  }
  if (delta === 0) return 'unchanged'
  return (polarity === 'lower_is_better' ? delta < 0 : delta > 0)
    ? 'improvement'
    : 'regression'
}

function remainder(total: number | null, values: Array<number | null>): number | null {
  if (total === null || values.some((value) => value === null)) return null
  return Math.max(0, total - values.reduce<number>((sum, value) => sum + (value ?? 0), 0))
}

function drcBreakdown(
  snapshot: Extract<ProjectEngineeringSnapshotReadResult, { ok: true }>,
): { hotspots: WorkspaceDrcHotspot[]; reportedCount: number; truncated: boolean } {
  // The hotspot preview is the bounded top-N projection across all steps; DRC
  // rule/layer entries carry scalar fields only. When the global preview is
  // truncated, the DRC subset shown here may be incomplete — the count of the
  // full per-rule breakdown stays behind the qor_hotspots artifact.
  const empty = { hotspots: [], reportedCount: 0, truncated: false }
  const preview = snapshot.sections.hotspotPreview
  if (preview.status !== 'ready' && preview.status !== 'partial') return empty
  const hotspots = preview.data.hotspots.flatMap((value) => {
    if (value.kind !== 'drc_rule_layer') return []
    const metricId = stringValue(value, 'metric_id')
    const parts = metricId.split(':')
    const rule = parts[1] ?? ''
    const layer = parts[2] ?? ''
    const amount = finiteNumber(value.value)
    if (!metricId || !rule || !layer || amount === null || amount < 0) return []
    return [
      {
        metricId,
        rule,
        layer,
        displayName: stringValue(value, 'display_name') || `${rule} · ${layer}`,
        value: amount,
        unit: stringValue(value, 'unit') || 'count',
      },
    ]
  })
  return {
    hotspots,
    reportedCount: hotspots.length,
    truncated: preview.data.hotspotsTruncated,
  }
}

function timingIssues(
  snapshot: Extract<ProjectEngineeringSnapshotReadResult, { ok: true }>,
): { issues: WorkspaceStaTimingIssue[]; issueCount: number; truncated: boolean } | null {
  // The timing preview is the bounded top-N projection: scalar fields only,
  // no stage lists (those load on demand from the timing artifact).
  const preview = snapshot.sections.timingPreview
  if (preview.status !== 'ready' && preview.status !== 'partial') return null
  const issues: WorkspaceStaTimingIssue[] = preview.data.issues.flatMap((issue) => {
    const issueId = stringValue(issue, 'issue_id')
    const corner = stringValue(issue, 'corner')
    const analysisType = stringValue(issue, 'analysis_type')
    const slackNs = finiteNumber(issue.slack_ns)
    if (
      !issueId ||
      !corner ||
      (analysisType !== 'setup' && analysisType !== 'hold') ||
      slackNs === null
    ) {
      return []
    }
    return [
      {
        issueId,
        corner,
        analysisType,
        slackNs,
        startPoint: stringValue(issue, 'start_point'),
        endPoint: stringValue(issue, 'end_point'),
        pathGroup: stringValue(issue, 'path_group'),
        stages: [],
      },
    ]
  })
  return {
    issues,
    issueCount: preview.data.issueCount,
    truncated: preview.data.issuesTruncated,
  }
}

function missingTimingCorners(
  _snapshot: Extract<ProjectEngineeringSnapshotReadResult, { ok: true }>,
): string[] {
  // The bounded preview does not project missing-corner bookkeeping.
  return []
}

function congestionStatistics(
  _snapshot: Extract<ProjectEngineeringSnapshotReadResult, { ok: true }>,
): WorkspaceCongestionStatistic[] {
  // Congestion map statistics are not part of the bounded v6 projections.
  return []
}

function staInsights(
  qor: WorkspaceQorSummary,
  timing: {
    issues: WorkspaceStaTimingIssue[]
    issueCount: number
    truncated: boolean
  } | null,
  missingCorners: string[],
): WorkspaceStaInsights | null {
  const issues = timing?.issues ?? []
  const staMetrics = qor.metrics.filter(
    (metric) => metric.stepId === 'STA' && Boolean(metric.corner),
  )
  const missing = new Set(missingCorners)
  const corners = [
    ...new Set([
      ...staMetrics.flatMap((metric) => metric.corner ?? []),
      ...missingCorners,
    ]),
  ]
  if (!corners.length && !issues.length) return null
  const summaries = corners.map((corner) => {
    const context = record(
      staMetrics.find((metric) => metric.corner === corner)?.cornerContext,
    )
    return {
      corner,
      role: stringValue(context, 'configured_role'),
      process: stringValue(context, 'process_corner'),
      voltageV: finiteNumber(context?.voltage_v),
      temperatureC: finiteNumber(context?.temperature_c),
      rcCorner: stringValue(context, 'rc_corner'),
      availability: missing.has(corner) ? 'missing' : 'available',
      setupWns: metricValue(qor, 'STA', 'sta_setup_wns', corner),
      setupTns: metricValue(qor, 'STA', 'sta_setup_tns', corner),
      setupViolationCount: metricValue(qor, 'STA', 'sta_setup_violation_count', corner),
      frequencyMhz: metricValue(qor, 'STA', 'sta_frequency_mhz', corner),
      holdWns: metricValue(qor, 'STA', 'sta_hold_wns', corner),
      holdTns: metricValue(qor, 'STA', 'sta_hold_tns', corner),
      holdViolationCount: metricValue(qor, 'STA', 'sta_hold_violation_count', corner),
    }
  })
  const setup = summaries.flatMap((summary) =>
    summary.setupWns === null ? [] : [{ corner: summary.corner, wns: summary.setupWns }],
  )
  const hold = summaries.flatMap((summary) =>
    summary.holdWns === null ? [] : [{ corner: summary.corner, wns: summary.holdWns }],
  )
  const worstSetup = setup.sort((left, right) => left.wns - right.wns)[0] ?? null
  const worstHold = hold.sort((left, right) => left.wns - right.wns)[0] ?? null
  const incomplete =
    missing.size > 0 || (metricValue(qor, 'STA', 'sta_missing_corner_count') ?? 0) > 0
  return {
    corners: summaries,
    criticalPaths: issues,
    criticalPathIssueCount: timing?.issueCount ?? null,
    criticalPathsTruncated: timing?.truncated ?? false,
    worstSetup,
    worstHold,
    frequencyMhz:
      summaries.find((summary) => summary.frequencyMhz !== null)?.frequencyMhz ?? null,
    setupViolationCount:
      !incomplete && summaries.every((summary) => summary.setupViolationCount !== null)
        ? summaries.reduce(
            (total, summary) => total + (summary.setupViolationCount ?? 0),
            0,
          )
        : null,
    holdViolationCount:
      !incomplete && summaries.every((summary) => summary.holdViolationCount !== null)
        ? summaries.reduce(
            (total, summary) => total + (summary.holdViolationCount ?? 0),
            0,
          )
        : null,
    allCornersMet:
      !incomplete && worstSetup && worstHold
        ? worstSetup.wns >= 0 && worstHold.wns >= 0
        : null,
  }
}

export function flowInsightsSection(
  snapshot: ProjectEngineeringSnapshotReadResult | null,
  flow: ReadSection<WorkspaceFlowSummary>,
  qor: ReadSection<WorkspaceQorSummary>,
): ReadSection<WorkspaceFlowInsightsSummary> {
  if (
    !snapshot?.ok ||
    (flow.status !== 'ready' && flow.status !== 'partial') ||
    (qor.status !== 'ready' && qor.status !== 'partial')
  ) {
    return {
      status: 'unavailable',
      issues: [{ code: 'WORKSPACE_FLOW_INSIGHTS_UNAVAILABLE' }],
    }
  }
  const definitions = new Map<string, WorkspaceQorSummary['metrics'][number]>()
  for (const metric of qor.data.metrics) {
    if (TREND_METRIC_IDS.has(metric.id) && !definitions.has(metric.id)) {
      definitions.set(metric.id, metric)
    }
  }
  const trends = [...definitions.values()].map((definition) => {
    let previous: number | null = null
    return {
      id: definition.id,
      name: definition.name,
      unit: definition.unit ?? '',
      polarity: definition.polarity,
      points: flow.data.steps.map((step) => {
        const value = metricValue(qor.data, step.name, definition.id)
        const delta = value === null || previous === null ? null : value - previous
        if (value !== null) previous = value
        return {
          stepId: step.stepId,
          value,
          delta,
          verdict: trendVerdict(delta, definition.polarity),
        }
      }),
    }
  })
  const timing = timingIssues(snapshot)
  const drc = drcBreakdown(snapshot)
  return {
    status: 'ready',
    data: {
      trends,
      composition: flow.data.steps.map((step) => {
        const totalCount = metricValue(qor.data, step.name, 'instance_count')
        const totalArea = metricValue(qor.data, step.name, 'instance_area')
        const stdCellCount = metricValue(qor.data, step.name, 'std_cell_count')
        const stdCellArea = metricValue(qor.data, step.name, 'std_cell_area')
        const clockCount = metricValue(qor.data, step.name, 'clock_count')
        const clockArea = metricValue(qor.data, step.name, 'clock_area')
        const macroCount = metricValue(qor.data, step.name, 'macro_count')
        const macroArea = metricValue(qor.data, step.name, 'macro_area')
        const ioPadCount = metricValue(qor.data, step.name, 'io_pad_count')
        const ioPadArea = metricValue(qor.data, step.name, 'io_pad_area')
        return {
          stepId: step.stepId,
          stdCellCount,
          stdCellArea,
          clockCount,
          clockArea,
          macroCount,
          macroArea,
          ioPadCount,
          ioPadArea,
          fillerCount: remainder(totalCount, [
            stdCellCount,
            clockCount,
            macroCount,
            ioPadCount,
          ]),
          fillerArea: remainder(totalArea, [
            stdCellArea,
            clockArea,
            macroArea,
            ioPadArea,
          ]),
        }
      }),
      congestion: congestionStatistics(snapshot),
      drc: {
        totalCount: metricValue(qor.data, 'DRC', 'drc_count'),
        ...drc,
      },
      sta: staInsights(qor.data, timing, missingTimingCorners(snapshot)),
    },
    issues: [],
  }
}
