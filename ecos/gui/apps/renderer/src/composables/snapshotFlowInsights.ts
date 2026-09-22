import type {
  WorkspaceArtifactDescriptor,
  WorkspaceCongestionStatistic,
  WorkspaceDrcInsights,
  WorkspaceFlowInsightsSummary,
  WorkspaceOverviewCore,
  WorkspaceStaInsights,
  WorkspaceTimingSummaryDetail,
} from '@ecos-studio/shared'
import {
  buildDrcRelatedMetrics,
  buildStepResourcesModel,
  canonicalStepKey,
  type CongestionMapTileModel,
  type DbTrendMetricRow,
  type DbTrendModel,
  type DrcLayerTypeMatrix,
  type DrcRelatedMetrics,
  type FlowInsightStep,
  type InstanceCompositionModel,
  type StaCriticalPathsModel,
  type StaCornerRowModel,
  type StaOverviewModel,
  selectStaCriticalPaths,
  type StepResourcesModel,
} from '@/components/flow-insights/flowInsightsData'

export interface FlowInsightsData {
  signature: string
  stepResources: StepResourcesModel | null
  dbTrends: DbTrendModel | null
  instanceComposition: {
    num: InstanceCompositionModel
    area: InstanceCompositionModel
  } | null
  congestionTiles: CongestionMapTileModel[]
  congestionTileUrls: Map<string, string>
  drc: DrcLayerTypeMatrix | null
  drcRelated: DrcRelatedMetrics
  sta: StaOverviewModel | null
  staCriticalPaths: StaCriticalPathsModel | null
  timingArtifacts: WorkspaceArtifactDescriptor[]
}

function trendRows(
  steps: FlowInsightStep[],
  insights: WorkspaceFlowInsightsSummary,
): DbTrendMetricRow[] {
  return insights.trends.map((trend) => {
    const pointByStep = new Map(trend.points.map((point) => [point.stepId, point]))
    const points = steps.map((step) => pointByStep.get(step.name))
    return {
      id: trend.id,
      label: trend.name,
      unit: trend.unit,
      group: trend.id.includes('utilization') ? 'Utilization' : 'Area / Scale',
      polarity: trend.polarity,
      values: points.map((point) => point?.value ?? null),
      deltas: points.map((point) => point?.delta ?? null),
      deltaStates: points.map((point) =>
        !point || point.value === null
          ? 'missing'
          : point.verdict === 'not-comparable' || point.verdict === 'unchanged'
            ? 'neutral'
            : point.verdict,
      ),
    }
  })
}

function composition(
  steps: FlowInsightStep[],
  insights: WorkspaceFlowInsightsSummary,
  field: 'num' | 'area',
): InstanceCompositionModel {
  const definitions = [
    {
      id: 'logic',
      label: 'Logic',
      metricId: field === 'num' ? 'stdCellCount' : 'stdCellArea',
    },
    {
      id: 'clock',
      label: 'Clock',
      metricId: field === 'num' ? 'clockCount' : 'clockArea',
    },
    {
      id: 'macros',
      label: 'Macros',
      metricId: field === 'num' ? 'macroCount' : 'macroArea',
    },
    {
      id: 'iopads',
      label: 'I/O pads',
      metricId: field === 'num' ? 'ioPadCount' : 'ioPadArea',
    },
    {
      id: 'filler',
      label: 'Filler',
      metricId: field === 'num' ? 'fillerCount' : 'fillerArea',
    },
  ]
  return {
    field,
    classes: definitions.map((definition) => ({
      id: definition.id,
      label: definition.label,
      values: steps.map((step) => {
        const point = insights.composition.find(
          (candidate) => candidate.stepId === step.name,
        )
        return point?.[definition.metricId as keyof typeof point] as number | null
      }),
    })),
  }
}

export function drcSummaryFromSnapshot(
  drc: WorkspaceDrcInsights,
): DrcLayerTypeMatrix | null {
  if (drc.totalCount === null && !drc.hotspots.length) return null
  const layers = [...new Set(drc.hotspots.map((hotspot) => hotspot.layer))]
  const rules = [...new Set(drc.hotspots.map((hotspot) => hotspot.rule))]
  const value = (rule: string, layer: string): number =>
    drc.hotspots.find((hotspot) => hotspot.rule === rule && hotspot.layer === layer)
      ?.value ?? 0
  return {
    headers: ['Type', ...layers, 'total'],
    layerColumns: layers,
    totalColumn: 'total',
    types: rules.map((rule) => {
      const values = layers.map((layer) => value(rule, layer))
      const max = Math.max(...values, 0)
      return {
        name: rule,
        values,
        total: values.reduce((sum, amount) => sum + amount, 0),
        maxLayer: max > 0 ? (layers[values.indexOf(max)] ?? null) : null,
      }
    }),
    totalByLayer: layers.map((layer) =>
      rules.reduce((sum, rule) => sum + value(rule, layer), 0),
    ),
    totalCount: drc.totalCount,
    reportedCount: drc.reportedCount,
    truncated: drc.truncated,
  }
}

export function staOverviewFromSnapshot(
  sta: WorkspaceStaInsights | null,
): StaOverviewModel | null {
  if (!sta) return null
  const rows: StaCornerRowModel[] = sta.corners.map((corner) => {
    const setup = {
      wns: corner.setupWns,
      tns: corner.setupTns,
      nvp: corner.setupViolationCount,
      frequencyMhz: corner.frequencyMhz,
    }
    const hold = {
      wns: corner.holdWns,
      tns: corner.holdTns,
      nvp: corner.holdViolationCount,
    }
    const firstPath = sta.criticalPaths.find((path) => path.corner === corner.corner)
    return {
      corner: corner.corner,
      setup,
      hold,
      summary: { setup, hold },
      groups: {},
      firstPath: firstPath
        ? {
            corner: firstPath.corner,
            pathId: firstPath.issueId,
            analysisType: firstPath.analysisType,
            slackNs: firstPath.slackNs,
            startPoint: firstPath.startPoint,
            endPoint: firstPath.endPoint,
            stageCount: firstPath.stages.length,
            pathGroup: firstPath.pathGroup,
          }
        : null,
      missing: corner.availability === 'missing',
    }
  })
  return {
    corners: rows,
    pathGroups: [],
    selectedPathGroup: 'summary',
    worstSetup: sta.worstSetup,
    worstHold: sta.worstHold,
    frequencyMhz: sta.frequencyMhz,
    setupViolationCount: sta.setupViolationCount,
    holdViolationCount: sta.holdViolationCount,
    allCornersMet: sta.allCornersMet,
  }
}

export function mergeStaTimingSummaries(
  overview: StaOverviewModel | null,
  summaries: readonly WorkspaceTimingSummaryDetail[],
): StaOverviewModel | null {
  if (!summaries.length && !overview) return null
  if (!summaries.length) return overview

  const existing = new Map(
    (overview?.corners ?? []).map((corner) => [corner.corner, corner]),
  )
  const corners: StaCornerRowModel[] = summaries.map((summary) => {
    const previous = existing.get(summary.corner)
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
      corner: summary.corner,
      availability: 'available',
      missing: false,
      setup,
      hold,
      summary: { setup, hold },
      groups: previous?.groups ?? {},
      firstPath: previous?.firstPath ?? null,
    }
  })
  const summaryCorners = new Set(summaries.map((summary) => summary.corner))
  for (const corner of overview?.corners ?? []) {
    if (corner.missing && !summaryCorners.has(corner.corner)) corners.push(corner)
  }

  const setupEntries = corners.flatMap((corner) =>
    corner.setup?.wns === null || corner.setup?.wns === undefined
      ? []
      : [{ corner: corner.corner, wns: corner.setup.wns }],
  )
  const holdEntries = corners.flatMap((corner) =>
    corner.hold?.wns === null || corner.hold?.wns === undefined
      ? []
      : [{ corner: corner.corner, wns: corner.hold.wns }],
  )
  const worstSetup = setupEntries.sort((left, right) => left.wns - right.wns)[0] ?? null
  const worstHold = holdEntries.sort((left, right) => left.wns - right.wns)[0] ?? null
  const frequencies = corners.flatMap((corner) =>
    corner.setup?.frequencyMhz === null || corner.setup?.frequencyMhz === undefined
      ? []
      : [corner.setup.frequencyMhz],
  )
  const setupCounts = corners.map((corner) => corner.setup?.nvp)
  const holdCounts = corners.map((corner) => corner.hold?.nvp)
  const setupViolationCount = setupCounts.every(
    (value) => value !== null && value !== undefined,
  )
    ? setupCounts.reduce((total, value) => total + (value ?? 0), 0)
    : (overview?.setupViolationCount ?? null)
  const holdViolationCount = holdCounts.every(
    (value) => value !== null && value !== undefined,
  )
    ? holdCounts.reduce((total, value) => total + (value ?? 0), 0)
    : (overview?.holdViolationCount ?? null)

  return {
    corners,
    pathGroups: overview?.pathGroups ?? [],
    selectedPathGroup: overview?.selectedPathGroup ?? 'summary',
    worstSetup,
    worstHold,
    frequencyMhz: frequencies.length
      ? Math.min(...frequencies)
      : (overview?.frequencyMhz ?? null),
    setupViolationCount,
    holdViolationCount,
    allCornersMet:
      worstSetup && worstHold
        ? worstSetup.wns >= 0 && worstHold.wns >= 0
        : (overview?.allCornersMet ?? null),
  }
}

export function staCriticalPathsFromSnapshot(
  sta: WorkspaceStaInsights | null,
): StaCriticalPathsModel | null {
  if (!sta?.criticalPaths.length) return null
  const paths = sta.criticalPaths.map((path) => ({
    id: path.issueId,
    corner: path.corner,
    analysisType: path.analysisType,
    slackNs: path.slackNs,
    stageCount: path.stages.length,
    stages: path.stages,
  }))
  return selectStaCriticalPaths([{ corner: '', paths }], null)
}

export function congestionTilesFromArtifacts(
  artifacts: WorkspaceArtifactDescriptor[],
  steps: FlowInsightStep[],
  statistics: WorkspaceCongestionStatistic[] = [],
): CongestionMapTileModel[] {
  return artifacts.flatMap((artifact) => {
    if (artifact.kind !== 'congestion_image' || artifact.availability !== 'available') {
      return []
    }
    const step = steps.find(
      (candidate) =>
        candidate.name.trim().toLowerCase() === artifact.stepId?.trim().toLowerCase(),
    )
    if (!step) return []
    const name = artifact.name.toLowerCase()
    const mapKind = name.includes('lut_rudy')
      ? 'lut_rudy'
      : name.includes('rudy')
        ? 'rudy'
        : name.includes('density')
          ? 'density'
          : 'egr'
    const direction = name.includes('horizontal')
      ? 'horizontal'
      : name.includes('vertical')
        ? 'vertical'
        : name.includes('union')
          ? 'union'
          : ''
    return [
      {
        id: artifact.artifactId,
        step,
        mapKind,
        direction,
        label: artifact.name.replace(/\.png$/i, ''),
        pngPath: artifact.artifactId,
        csvPath: '',
        layoutCsvPath: '',
        ...(artifact.sourceRevision === undefined
          ? {}
          : { sourceRevision: artifact.sourceRevision }),
        stats:
          statistics.find(
            (statistic) =>
              statistic.stepId.toLowerCase() === step.name.toLowerCase() &&
              statistic.mapKind === mapKind &&
              statistic.direction === direction,
          ) ?? null,
      } satisfies CongestionMapTileModel,
    ]
  })
}

export function buildSnapshotFlowInsights(
  overview: WorkspaceOverviewCore | null | undefined,
): FlowInsightsData | null {
  const revision = overview?.revision
  const flow = overview?.flow
  const insights = overview?.flowInsights
  if (
    !revision ||
    (revision.status !== 'ready' && revision.status !== 'partial') ||
    !flow ||
    (flow.status !== 'ready' && flow.status !== 'partial') ||
    !insights ||
    (insights.status !== 'ready' && insights.status !== 'partial')
  ) {
    return null
  }
  const steps: FlowInsightStep[] = flow.data.steps.map((step) => ({
    directory: '',
    key: canonicalStepKey(step.name),
    name: step.name,
    peakMemoryMb: step.peakMemoryMb ?? null,
    runtimeSeconds: step.runtimeSeconds ?? null,
    state: step.state,
    successful: step.state === 'succeeded' || step.state === 'skipped',
    tool: step.toolId ?? '',
  }))
  const rows = trendRows(steps, insights.data)
  const artifacts = overview.artifacts
  const maps =
    artifacts?.status === 'ready' || artifacts?.status === 'partial'
      ? congestionTilesFromArtifacts(
          artifacts.data.items,
          steps,
          insights.data.congestion,
        )
      : []
  return {
    signature: `${revision.data.workspaceId}:${revision.data.workspaceRevision}`,
    stepResources: buildStepResourcesModel(steps),
    dbTrends: rows.length ? { rows, steps } : null,
    instanceComposition: rows.length
      ? {
          num: composition(steps, insights.data, 'num'),
          area: composition(steps, insights.data, 'area'),
        }
      : null,
    congestionTiles: maps,
    congestionTileUrls: new Map(),
    drc: drcSummaryFromSnapshot(insights.data.drc),
    drcRelated: buildDrcRelatedMetrics({
      drcCount: insights.data.drc.totalCount,
      drcStepName: flow.data.steps.find((step) => canonicalStepKey(step.name) === 'DRC')
        ?.name,
      routeStepName: flow.data.steps.find(
        (step) => canonicalStepKey(step.name) === 'Route',
      )?.name,
    }),
    sta: staOverviewFromSnapshot(insights.data.sta),
    staCriticalPaths: staCriticalPathsFromSnapshot(insights.data.sta),
    timingArtifacts:
      artifacts?.status === 'ready' || artifacts?.status === 'partial'
        ? artifacts.data.items.filter(
            (artifact) =>
              artifact.stepId?.trim().toLowerCase() === 'sta' &&
              artifact.availability === 'available' &&
              (artifact.kind === 'timing_summary' || artifact.kind === 'timing_paths'),
          )
        : [],
  }
}
