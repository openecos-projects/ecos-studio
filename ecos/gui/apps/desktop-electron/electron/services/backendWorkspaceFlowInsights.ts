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
  const analysis = snapshot.sections.qor
  const empty = { hotspots: [], reportedCount: 0, truncated: false }
  if (analysis.status !== 'ready' && analysis.status !== 'partial') return empty
  const step = analysis.data.analysis.steps.find(
    (candidate) => canonicalStepId(candidate.stepId).toLowerCase() === 'drc',
  )
  const details = record(step?.metrics.data)?.details
  const detail = Array.isArray(details)
    ? details.map(record).find((value) => value?.id === 'drc_rule_layer_summary')
    : null
  const summary = record(detail?.summary)
  const detailedValues = summary?.top_violations
  const fallbackValues = record(step?.hotspots.data)?.hotspots
  const values = Array.isArray(detailedValues)
    ? detailedValues
    : Array.isArray(fallbackValues)
      ? fallbackValues
      : []
  const hotspots = values.flatMap((value) => {
    const hotspot = record(value)
    if (!hotspot || (hotspot.kind !== undefined && hotspot.kind !== 'drc_rule_layer')) {
      return []
    }
    const metricId = stringValue(hotspot, 'metric_id')
    const parts = metricId.split(':')
    const rule = stringValue(hotspot, 'rule') || parts[1] || ''
    const layer = stringValue(hotspot, 'layer') || parts[2] || ''
    const amount = finiteNumber(hotspot.value)
    if (!metricId || !rule || !layer || amount === null || amount < 0) return []
    return [
      {
        metricId,
        rule,
        layer,
        displayName: stringValue(hotspot, 'display_name') || `${rule} · ${layer}`,
        value: amount,
        unit: stringValue(hotspot, 'unit') || 'count',
      },
    ]
  })
  return {
    hotspots,
    reportedCount: finiteNumber(summary?.reported_count) ?? hotspots.length,
    truncated:
      typeof summary?.truncated === 'boolean' ? summary.truncated : hotspots.length > 0,
  }
}

function timingIssues(
  snapshot: Extract<ProjectEngineeringSnapshotReadResult, { ok: true }>,
): WorkspaceStaTimingIssue[] {
  const analysis = snapshot.sections.qor
  if (analysis.status !== 'ready' && analysis.status !== 'partial') return []
  const step = analysis.data.analysis.steps.find(
    (candidate) => canonicalStepId(candidate.stepId).toLowerCase() === 'sta',
  )
  const values = record(step?.timingIssues?.data)?.issues
  if (!Array.isArray(values)) return []
  return values.flatMap((value) => {
    const issue = record(value)
    const issueId = stringValue(issue, 'issue_id')
    const corner = stringValue(issue, 'corner')
    const analysisType = stringValue(issue, 'analysis_type')
    const slackNs = finiteNumber(issue?.slack_ns)
    if (
      !issueId ||
      !corner ||
      (analysisType !== 'setup' && analysisType !== 'hold') ||
      slackNs === null
    ) {
      return []
    }
    const stages = Array.isArray(issue?.dominant_stages) ? issue.dominant_stages : []
    return [
      {
        issueId,
        corner,
        analysisType,
        slackNs,
        startPoint: stringValue(issue, 'start_point'),
        endPoint: stringValue(issue, 'end_point'),
        pathGroup: stringValue(issue, 'path_group'),
        stages: stages.flatMap((value) => {
          const stage = record(value)
          return stage
            ? [
                {
                  pin: stringValue(stage, 'pin'),
                  cell: stringValue(stage, 'cell'),
                  arrivalNs: finiteNumber(stage.arrival_ns),
                  delayNs: finiteNumber(stage.incremental_delay_ns),
                },
              ]
            : []
        }),
      },
    ]
  })
}

function missingTimingCorners(
  snapshot: Extract<ProjectEngineeringSnapshotReadResult, { ok: true }>,
): string[] {
  const analysis = snapshot.sections.qor
  if (analysis.status !== 'ready' && analysis.status !== 'partial') return []
  const step = analysis.data.analysis.steps.find(
    (candidate) => canonicalStepId(candidate.stepId).toLowerCase() === 'sta',
  )
  const missing = record(step?.timingIssues?.data)?.missing_corners
  return Array.isArray(missing)
    ? missing.filter((corner): corner is string => typeof corner === 'string' && !!corner)
    : []
}

function congestionStatistics(
  snapshot: Extract<ProjectEngineeringSnapshotReadResult, { ok: true }>,
): WorkspaceCongestionStatistic[] {
  const analysis = snapshot.sections.qor
  if (analysis.status !== 'ready' && analysis.status !== 'partial') return []
  return analysis.data.analysis.steps.flatMap((step) => {
    const details = record(step.metrics.data)?.details
    if (!Array.isArray(details)) return []
    return details.flatMap((value) => {
      const detail = record(value)
      if (detail?.id !== 'place_map_metrics') return []
      const maps = record(detail.summary)?.maps
      if (!Array.isArray(maps)) return []
      return maps.flatMap((value) => {
        const map = record(value)
        const metric = stringValue(map, 'metric').toLowerCase()
        const direction = stringValue(map, 'direction').toLowerCase()
        const max = finiteNumber(map?.max)
        const total = finiteNumber(map?.total)
        const hotspotCount = finiteNumber(map?.nonzero_count)
        if (
          max === null ||
          total === null ||
          hotspotCount === null ||
          !['', 'horizontal', 'vertical', 'union'].includes(direction)
        ) {
          return []
        }
        const mapKind = metric.includes('lut')
          ? 'lut_rudy'
          : metric.includes('rudy')
            ? 'rudy'
            : metric.includes('density')
              ? 'density'
              : 'egr'
        return [
          {
            stepId: step.stepId,
            mapKind,
            direction: direction as WorkspaceCongestionStatistic['direction'],
            max,
            total,
            hotspotCount,
          },
        ]
      })
    })
  })
}

function staInsights(
  qor: WorkspaceQorSummary,
  issues: WorkspaceStaTimingIssue[],
  missingCorners: string[],
): WorkspaceStaInsights | null {
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
  const issues = timingIssues(snapshot)
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
      sta: staInsights(qor.data, issues, missingTimingCorners(snapshot)),
    },
    issues: [],
  }
}
