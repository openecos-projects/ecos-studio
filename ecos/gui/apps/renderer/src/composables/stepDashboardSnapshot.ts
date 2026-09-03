import type {
  WorkspaceDrcInsights,
  WorkspaceStaInsights,
  WorkspaceStepDetail,
  WorkspaceTimingPathsDetail,
  WorkspaceTimingSummaryDetail,
} from '@ecos-studio/shared'
import {
  canonicalStepKey,
  type CongestionMapTileModel,
  type StaOverviewModel,
} from '@/components/flow-insights/flowInsightsData'
import {
  checklistSummary,
  qorSummary,
  runSummary,
  type StepDashboardBar,
  type StepDashboardChecklist,
  type StepDashboardDistribution,
  type StepDashboardDrcInsights,
  type StepDashboardFloorplanInsights,
  type StepDashboardHardenInsights,
  type StepDashboardLvsInsights,
  type StepDashboardMetric,
  type StepDashboardQor,
  type StepDashboardRcxInsights,
  type StepDashboardStaInsights,
  type StepDashboardSynthesisInsights,
  type StepDashboardTimingAnalysis,
  type StepDesignStatis,
} from '@/components/step-dashboard/stepDashboardData'
import {
  congestionTilesFromArtifacts,
  drcSummaryFromSnapshot,
  staCriticalPathsFromSnapshot,
  staOverviewFromSnapshot,
} from './snapshotFlowInsights'
import { designStatistics, physicalInsights } from './stepDashboardPhysicalSnapshot'

export interface StepDashboardReport {
  artifactId: string
  directory: string
  id: string
  label: string
  relativePath: string
  sizeBytes: number | null
  modifiedAt: number | null
}

export interface StepDashboardData {
  step: string
  tool: string
  run: ReturnType<typeof runSummary>
  keyMetrics: StepDashboardMetric[]
  stepChartTitle: string
  stepChartUnit: string
  stepBars: StepDashboardBar[]
  checklist: StepDashboardChecklist
  qor: StepDashboardQor
  dataHighlights: StepDashboardMetric[]
  dataCharts: StepDashboardDistribution[]
  drcInsights: StepDashboardDrcInsights | null
  floorplanInsights: StepDashboardFloorplanInsights | null
  hardenInsights: StepDashboardHardenInsights | null
  lvsInsights: StepDashboardLvsInsights | null
  rcxInsights: StepDashboardRcxInsights | null
  staInsights: StepDashboardStaInsights | null
  stepInsights: StepDashboardFloorplanInsights | null
  synthesisInsights: StepDashboardSynthesisInsights | null
  timingAnalysis: StepDashboardTimingAnalysis | null
  layoutUrl: string | null
  layoutAvailability: 'available' | 'missing' | 'stale' | null
  mapUrl: string | null
  congestionTiles: CongestionMapTileModel[]
  congestionTileUrls: Map<string, string>
  designStatis: StepDesignStatis | null
  hasGeometry: boolean
  reports: StepDashboardReport[]
}

function dashboardMetric(
  metric: WorkspaceStepDetail['analysis']['metrics'][number],
): StepDashboardMetric {
  return {
    id: metric.id,
    label: metric.display_name,
    value: metric.value,
    unit: metric.unit ?? '',
  }
}

function displayMetric(value: number, unit?: string | null): string {
  const formatted = Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(3)))
  return unit ? `${formatted} ${unit}` : formatted
}

function metricValues(detail: WorkspaceStepDetail) {
  return detail.analysis.metrics.map((metric) => ({
    id: metric.id,
    label: metric.display_name,
    value: displayMetric(metric.value, metric.unit),
  }))
}

function metricDistributions(detail: WorkspaceStepDetail): StepDashboardDistribution[] {
  const database = detail.analysis.database
  if (database) {
    const definitions: Array<{
      field: 'count' | 'area' | 'pinCount'
      title: string
      unit: string
    }> = [
      { field: 'count', title: 'Instance count by class', unit: 'count' },
      { field: 'area', title: 'Cell area by class', unit: 'um2' },
      { field: 'pinCount', title: 'Pin count by class', unit: 'count' },
    ]
    const distributions = definitions.flatMap(({ field, title, unit }) => {
      const bars = database.instanceClasses.flatMap((item) =>
        item[field] === null
          ? []
          : [{ id: `${field}-${item.kind}`, label: item.kind, value: item[field] }],
      )
      return bars.length ? [{ title, unit, bars }] : []
    })
    if (distributions.length) return distributions
  }
  const groups = new Map<string, StepDashboardBar[]>()
  for (const metric of detail.analysis.metrics) {
    const bars = groups.get(metric.category) ?? []
    bars.push({ id: metric.id, label: metric.display_name, value: metric.value })
    groups.set(metric.category, bars)
  }
  return [...groups].map(([category, bars]) => ({
    title: category.replace(/_/g, ' '),
    unit: '',
    bars,
  }))
}

function drcDashboardInsights(
  drc: WorkspaceDrcInsights,
): StepDashboardDrcInsights | null {
  const matrix = drcSummaryFromSnapshot(drc)
  if (!matrix) return null
  const rows = matrix.types.map((type, index) => ({
    id: `drc-${index}-${type.name}`,
    values: [type.name, ...type.values.map(String), String(type.total)],
  }))
  const layerSlices = matrix.layerColumns.map((layer, index) => ({
    id: `drc-layer-${layer}`,
    label: layer,
    value: matrix.totalByLayer[index] ?? 0,
    tone: 'neutral' as const,
  }))
  const typeSlices = matrix.types.map((type) => ({
    id: `drc-type-${type.name}`,
    label: type.name,
    value: type.total,
    tone: 'neutral' as const,
  }))
  return {
    table: { headers: matrix.headers, rows },
    snapshots: [
      {
        id: 'drc-layer-total',
        label: 'Layer Totals',
        total: layerSlices.reduce((sum, slice) => sum + slice.value, 0),
        unit: 'count',
        kind: 'distribution',
        slices: layerSlices,
      },
      {
        id: 'drc-type-total',
        label: 'Type Totals',
        total: typeSlices.reduce((sum, slice) => sum + slice.value, 0),
        unit: 'count',
        kind: 'distribution',
        slices: typeSlices,
      },
    ],
  }
}

function staDashboardInsights(sta: WorkspaceStaInsights | null): {
  insights: StepDashboardStaInsights | null
  timing: StepDashboardTimingAnalysis | null
} {
  const overview = staOverviewFromSnapshot(sta)
  if (!sta || !overview) return { insights: null, timing: null }
  const critical = staCriticalPathsFromSnapshot(sta)
  return {
    insights: {
      corners: sta.corners.map((corner) => ({
        id: corner.corner,
        staCorner: corner.corner,
        metrics: [
          ['setup-wns', 'Setup WNS', corner.setupWns, 'ns'],
          ['setup-tns', 'Setup TNS', corner.setupTns, 'ns'],
          ['hold-wns', 'Hold WNS', corner.holdWns, 'ns'],
          ['hold-tns', 'Hold TNS', corner.holdTns, 'ns'],
        ].flatMap(([id, label, value, unit]) =>
          typeof value === 'number'
            ? [
                {
                  id: `${corner.corner}-${id}`,
                  label: String(label),
                  value: displayMetric(value, String(unit)),
                },
              ]
            : [],
        ),
        role: corner.role || '--',
        process: corner.process || '--',
        voltageV: corner.voltageV,
        temperatureC: corner.temperatureC,
        rcCorner: corner.rcCorner || '--',
        availability: corner.availability,
      })),
    },
    timing: {
      overview,
      pathsByCorner: sta.corners.map((corner) => ({
        corner: corner.corner,
        paths: [...(critical?.setup ?? []), ...(critical?.hold ?? [])].filter(
          (path) => path.corner === corner.corner,
        ),
      })),
      runInfo: [],
    },
  }
}

export function snapshotStepDashboardData(
  detail: WorkspaceStepDetail,
): StepDashboardData {
  const keyMetrics = detail.analysis.metrics.map(dashboardMetric)
  const insightStep = {
    directory: '',
    key: canonicalStepKey(detail.step.name),
    name: detail.step.name,
    peakMemoryMb: detail.step.peakMemoryMb ?? null,
    runtimeSeconds: detail.step.runtimeSeconds ?? null,
    state: detail.step.state,
    successful: detail.step.state === 'succeeded' || detail.step.state === 'skipped',
    tool: detail.step.toolId ?? '',
  }
  const normalizedStep = detail.step.name.trim().toLowerCase()
  const distributions = metricDistributions(detail)
  const sta = staDashboardInsights(detail.analysis.sta ?? null)
  const physical = physicalInsights(detail)
  const values = metricValues(detail)
  const hardenArtifacts = detail.artifacts.filter(
    (artifact) => artifact.kind === 'harden_output',
  )
  return {
    step: detail.step.name,
    tool: detail.step.toolId ?? '',
    run: runSummary({
      run: {
        state: detail.step.state,
        runtime_seconds: detail.step.runtimeSeconds,
        peak_memory_mb: detail.step.peakMemoryMb,
      },
    }),
    keyMetrics,
    stepChartTitle: distributions[0]?.title ?? '',
    stepChartUnit: distributions[0]?.unit ?? '',
    stepBars: distributions[0]?.bars ?? [],
    checklist: checklistSummary({ checklist: detail.checklist.findings }),
    qor: qorSummary(
      detail.analysis.summary,
      { metrics: detail.analysis.metrics },
      { hotspots: detail.analysis.hotspots },
    ),
    dataHighlights: keyMetrics,
    dataCharts: distributions,
    drcInsights: drcDashboardInsights(
      detail.analysis.drc ?? {
        totalCount: null,
        hotspots: [],
        reportedCount: 0,
        truncated: false,
      },
    ),
    floorplanInsights: normalizedStep === 'floorplan' ? physical : null,
    hardenInsights:
      normalizedStep === 'harden' && hardenArtifacts.length
        ? {
            artifacts: hardenArtifacts.flatMap((artifact) => {
              const parts = artifact.name.toLowerCase().split('.')
              const type = parts[parts.length - 1]
              return type === 'lef' || type === 'lib' || type === 'gds'
                ? [
                    {
                      type,
                      path: artifact.name,
                      exists: artifact.availability === 'available',
                    },
                  ]
                : []
            }),
          }
        : null,
    lvsInsights: detail.analysis.lvs ?? null,
    rcxInsights:
      normalizedStep === 'rcx'
        ? (detail.analysis.rcx ?? {
            electricalMetrics: values,
            electricalCorners: [],
            signoffMetrics: values.filter((metric) => metric.id.includes('corner')),
            signoffCorners: [],
          })
        : null,
    staInsights: sta.insights,
    stepInsights: [
      'fixfanout',
      'place',
      'cts',
      'legalization',
      'route',
      'filler',
    ].includes(normalizedStep)
      ? physical
      : null,
    synthesisInsights: normalizedStep === 'synthesis' ? { metrics: values } : null,
    timingAnalysis: sta.timing,
    layoutUrl: null,
    layoutAvailability:
      detail.artifacts.find((artifact) => artifact.kind === 'layout_image')
        ?.availability ?? null,
    mapUrl: null,
    congestionTiles: congestionTilesFromArtifacts(
      detail.artifacts,
      [insightStep],
      detail.analysis.congestion ?? [],
    ),
    congestionTileUrls: new Map(),
    designStatis: designStatistics(detail),
    hasGeometry: detail.artifacts.some(
      (artifact) =>
        artifact.kind === 'layout_geometry' && artifact.availability === 'available',
    ),
    reports: detail.artifacts
      .filter(
        (artifact) =>
          artifact.kind === 'report_text' && artifact.availability === 'available',
      )
      .map((artifact) => {
        const parts = artifact.name.split('/').filter(Boolean)
        return {
          artifactId: artifact.artifactId,
          directory: parts.slice(0, -1).join(' / '),
          id: artifact.artifactId,
          label: parts[parts.length - 1] ?? artifact.name,
          relativePath: artifact.name,
          sizeBytes: artifact.sizeBytes ?? null,
          modifiedAt: null,
        }
      }),
  }
}

function overviewFromTimingSummary(
  summary: WorkspaceTimingSummaryDetail,
): StaOverviewModel {
  const setup = {
    wns: summary.setup.wns,
    tns: summary.setup.tns,
    nvp: summary.setup.violationCount,
    frequencyMhz: summary.setup.frequencyMhz,
  }
  const hold = {
    wns: summary.hold.wns,
    tns: summary.hold.tns,
    nvp: summary.hold.violationCount,
  }
  return {
    corners: [
      {
        corner: summary.corner,
        missing: false,
        summary: { setup, hold },
        setup,
        hold,
        groups: {},
        firstPath: null,
      },
    ],
    pathGroups: [],
    selectedPathGroup: 'summary',
    worstSetup:
      summary.setup.wns === null
        ? null
        : { corner: summary.corner, wns: summary.setup.wns },
    worstHold:
      summary.hold.wns === null
        ? null
        : { corner: summary.corner, wns: summary.hold.wns },
    frequencyMhz: summary.setup.frequencyMhz,
    setupViolationCount: summary.setup.violationCount,
    holdViolationCount: summary.hold.violationCount,
    allCornersMet: summary.meetsTiming,
  }
}

export function applyTimingArtifacts(
  data: StepDashboardData,
  summaries: WorkspaceTimingSummaryDetail[],
  pathDetails: WorkspaceTimingPathsDetail[],
): void {
  const overview =
    data.timingAnalysis?.overview ??
    (summaries.length === 1 ? overviewFromTimingSummary(summaries[0]) : null)
  if (!overview && !pathDetails.length) return
  const pathsByCorner = pathDetails.map((detail) => ({
    corner: detail.corner,
    paths: detail.paths.map((path) => ({
      id: `${detail.corner}:${path.pathId}`,
      corner: detail.corner,
      analysisType: path.analysisType,
      slackNs: path.slackNs,
      stageCount: path.stages.length,
      stages: path.stages,
    })),
  }))
  data.timingAnalysis = {
    overview: overview ?? {
      corners: [],
      pathGroups: [],
      selectedPathGroup: 'summary',
      worstSetup: null,
      worstHold: null,
      frequencyMhz: null,
      setupViolationCount: null,
      holdViolationCount: null,
      allCornersMet: null,
    },
    pathsByCorner,
    runInfo: pathDetails.map((detail) => ({
      id: `path-limit-${detail.corner}`,
      label: `${detail.corner} path limit`,
      value: String(detail.pathLimit),
    })),
  }
}
