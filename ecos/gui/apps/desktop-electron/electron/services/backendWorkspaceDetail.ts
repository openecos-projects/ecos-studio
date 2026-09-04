import type {
  EccEngineeringAnalysisArtifactRef,
  EccEngineeringMetric,
  ReadSection,
  WorkspaceArtifactDescriptor,
  WorkspaceChecklistSummary,
  WorkspaceDatabaseFacts,
  WorkspaceFlowSummary,
  WorkspaceFlowInsightsSummary,
  WorkspaceLvsInsights,
  WorkspaceRcxInsights,
  WorkspaceStepDetail,
} from '@ecos-studio/shared'
import type { ProjectEngineeringSnapshotReadResult } from './projectManagementReadService'
import { checklistSection, flowSection } from './backendWorkspaceOverviewProjection'

type ValidSnapshot = NonNullable<ProjectEngineeringSnapshotReadResult['staleSnapshot']>

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function sameStep(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

function stringValue(value: Record<string, unknown>, key: string): string {
  return typeof value[key] === 'string' ? value[key] : ''
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function analysisDetail(
  data: Record<string, unknown> | null,
  id: string,
): Record<string, unknown> | null {
  const details = Array.isArray(data?.details) ? data.details : []
  for (const value of details) {
    const detail = record(value)
    if (detail?.id === id) return record(detail.summary)
  }
  return null
}

function databaseFacts(
  data: Record<string, unknown> | null,
): WorkspaceDatabaseFacts | null {
  const summary = analysisDetail(data, 'database_facts')
  if (!summary) return null
  const layout = record(summary.layout) ?? {}
  const statistics = record(summary.statistics) ?? {}
  const total = record(summary.instance_total) ?? {}
  const rows = (value: unknown, limit: number): Record<string, unknown>[] =>
    Array.isArray(value)
      ? value.slice(0, limit).flatMap((candidate) => {
          const row = record(candidate)
          return row ? [row] : []
        })
      : []
  return {
    layout: {
      dieArea: finiteNumber(layout.die_area),
      dieUsage: finiteNumber(layout.die_usage),
      dieWidth: finiteNumber(layout.die_width),
      dieHeight: finiteNumber(layout.die_height),
      coreArea: finiteNumber(layout.core_area),
      coreUsage: finiteNumber(layout.core_usage),
      coreWidth: finiteNumber(layout.core_width),
      coreHeight: finiteNumber(layout.core_height),
      dbu: finiteNumber(layout.dbu),
    },
    statistics: {
      ioPins: finiteNumber(statistics.io_pins),
      instances: finiteNumber(statistics.instances),
      nets: finiteNumber(statistics.nets),
      pdn: finiteNumber(statistics.pdn),
    },
    instanceClasses: rows(summary.instance_classes, 32).flatMap((row) => {
      const kind = stringValue(row, 'kind')
      return kind
        ? [
            {
              kind,
              count: finiteNumber(row.count),
              area: finiteNumber(row.area),
              pinCount: finiteNumber(row.pin_count),
            },
          ]
        : []
    }),
    instanceTotal: {
      count: finiteNumber(total.count),
      area: finiteNumber(total.area),
      pinCount: finiteNumber(total.pin_count),
    },
    pinDistribution: rows(summary.pin_distribution, 64).flatMap((row) => {
      const pinCount = finiteNumber(row.pin_count)
      return pinCount !== null && Number.isInteger(pinCount) && pinCount >= 0
        ? [
            {
              pinCount,
              instanceCount: finiteNumber(row.instance_count),
              netCount: finiteNumber(row.net_count),
            },
          ]
        : []
    }),
    cutLayers: rows(summary.cut_layers, 64).flatMap((row) => {
      const layer = stringValue(row, 'layer')
      return layer ? [{ layer, viaCount: finiteNumber(row.via_count) }] : []
    }),
    routingLayers: rows(summary.routing_layers, 64).flatMap((row) => {
      const layer = stringValue(row, 'layer')
      return layer ? [{ layer, wireLength: finiteNumber(row.wire_length) }] : []
    }),
    wireLength: finiteNumber(summary.wire_length),
    viaCount: finiteNumber(summary.via_count),
  }
}

function lvsInsights(data: Record<string, unknown> | null): WorkspaceLvsInsights | null {
  const summary = analysisDetail(data, 'lvs_connectivity_summary')
  if (!summary) return null
  const rows = (key: string): Record<string, unknown>[] =>
    Array.isArray(summary[key])
      ? summary[key].flatMap((value) => {
          const row = record(value)
          return row ? [row] : []
        })
      : []
  return {
    entities: rows('entities').flatMap((row, index) => {
      const entity = stringValue(row, 'entity')
      return entity
        ? [
            {
              id: `lvs-entity-${index}`,
              entity,
              netlist: finiteNumber(row.netlist),
              def: finiteNumber(row.def),
              difference: finiteNumber(row.difference),
            },
          ]
        : []
    }),
    connections: rows('connectivity').flatMap((row, index) => {
      const connectivity = stringValue(row, 'connectivity')
      return connectivity
        ? [
            {
              id: `lvs-connectivity-${index}`,
              connectivity,
              open: finiteNumber(row.open),
              short: finiteNumber(row.short),
              connected: finiteNumber(row.connected),
              total: finiteNumber(row.total),
            },
          ]
        : []
    }),
    violations: rows('violations').flatMap((row, index) => {
      const type = stringValue(row, 'type')
      return type
        ? [
            {
              id: `lvs-violation-${index}`,
              type,
              net: stringValue(row, 'net'),
              instance: stringValue(row, 'instance'),
              terminals: stringValue(row, 'terminals'),
              components: stringValue(row, 'components'),
            },
          ]
        : []
    }),
  }
}

function displayNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)))
}

function rcxInsights(data: Record<string, unknown> | null): WorkspaceRcxInsights | null {
  const summary = analysisDetail(data, 'rcx_electrical_corner_metrics')
  if (!summary) return null
  const metrics = (source: Record<string, unknown>, prefix: string) =>
    Object.entries(source).flatMap(([key, value]) => {
      const number = finiteNumber(value)
      return number === null
        ? []
        : [
            {
              id: `${prefix}-${key}`,
              label: key.replace(/_/g, ' '),
              value: displayNumber(number),
            },
          ]
    })
  const rows = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value)
      ? value.flatMap((candidate) => {
          const row = record(candidate)
          return row ? [row] : []
        })
      : []
  const coverage = record(summary.coverage)
  return {
    electricalMetrics: metrics(summary, 'rcx-electrical'),
    electricalCorners: rows(summary.electrical_corners).map((corner) => ({
      corner: stringValue(corner, 'corner'),
      netCount: finiteNumber(corner.net_count),
      groundCapacitanceFf: finiteNumber(corner.ground_capacitance_ff),
      couplingCapacitanceFf: finiteNumber(corner.coupling_capacitance_ff),
      totalCapacitanceFf: finiteNumber(corner.total_capacitance_ff),
      totalResistanceOhm: finiteNumber(corner.total_resistance_ohm),
    })),
    signoffMetrics: coverage ? metrics(coverage, 'rcx-coverage') : [],
    signoffCorners: rows(summary.rc_corners).map((corner) => ({
      corner: stringValue(corner, 'label') || stringValue(corner, 'rc_corner'),
      availability: stringValue(corner, 'availability'),
      totalCapacitanceFf: finiteNumber(corner.total_capacitance_ff),
      couplingCapacitanceFf: finiteNumber(corner.coupling_capacitance_ff),
      totalResistanceOhm: finiteNumber(corner.total_resistance_ohm),
    })),
  }
}

export function artifactDescriptor(
  artifact: EccEngineeringAnalysisArtifactRef,
): WorkspaceArtifactDescriptor {
  return {
    artifactId: artifact.artifactId,
    availability: artifact.availability,
    kind: artifact.kind,
    name: artifact.name,
    ...(artifact.sizeBytes === undefined ? {} : { sizeBytes: artifact.sizeBytes }),
    ...(artifact.stepId ? { stepId: artifact.stepId } : {}),
  }
}

function analysisMetrics(data: Record<string, unknown> | null): EccEngineeringMetric[] {
  return Array.isArray(data?.metrics) ? (data.metrics as EccEngineeringMetric[]) : []
}

function analysisHotspots(
  data: Record<string, unknown> | null,
): Array<Record<string, unknown>> {
  return Array.isArray(data?.hotspots)
    ? data.hotspots.flatMap((value) => {
        const hotspot = record(value)
        return hotspot ? [hotspot] : []
      })
    : []
}

export function workspaceStepDetail(
  snapshot: ValidSnapshot,
  stepId: string,
  flow: ReadSection<WorkspaceFlowSummary>,
  checklist: ReadSection<WorkspaceChecklistSummary>,
  insights: WorkspaceFlowInsightsSummary | null,
  staleSnapshot?: ValidSnapshot,
): ReadSection<WorkspaceStepDetail> {
  const analysis = snapshot.sections.qor
  if (flow.status !== 'ready' && flow.status !== 'partial') {
    return {
      status: 'unavailable',
      issues: [{ code: 'WORKSPACE_STEP_DETAIL_UNAVAILABLE' }],
    }
  }
  const analysisStep =
    analysis.status === 'ready'
      ? analysis.data.analysis.steps.find((step) => sameStep(step.stepId, stepId))
      : undefined
  const flowStep = flow.data.steps.find((step) => sameStep(step.stepId, stepId))
  if (!flowStep) {
    return { status: 'unavailable', issues: [{ code: 'WORKSPACE_STEP_NOT_FOUND' }] }
  }
  const artifacts = snapshot.sections.artifacts
  const invalidated = snapshot.snapshot.stalePredecessor?.invalidatedStepIds ?? []
  let staleEvidence: WorkspaceStepDetail['staleEvidence']
  if (staleSnapshot && invalidated.some((candidate) => sameStep(candidate, stepId))) {
    const staleFlow = flowSection(staleSnapshot)
    const staleDetail = workspaceStepDetail(
      staleSnapshot,
      stepId,
      staleFlow,
      checklistSection(staleSnapshot, staleFlow),
      null,
    )
    if (staleDetail.status === 'ready' || staleDetail.status === 'partial') {
      staleEvidence = {
        ...staleDetail.data,
        workspaceRevision: staleSnapshot.snapshot.workspaceRevision,
      }
    }
  }
  if (!analysisStep && !staleEvidence) {
    return {
      status: 'unavailable',
      issues: [{ code: 'WORKSPACE_STEP_DETAIL_UNAVAILABLE' }],
    }
  }
  return {
    status: 'ready',
    data: {
      analysis: {
        metrics: analysisMetrics(analysisStep?.metrics.data ?? null),
        summary: analysisStep?.summary.data ?? null,
        hotspots: analysisHotspots(analysisStep?.hotspots.data ?? null),
        lec: analysisStep?.lecResult?.data ?? null,
        drc:
          analysisStep?.stepId.trim().toLowerCase() === 'drc' && insights
            ? insights.drc
            : { totalCount: null, hotspots: [], reportedCount: 0, truncated: false },
        sta:
          analysisStep?.stepId.trim().toLowerCase() === 'sta'
            ? (insights?.sta ?? null)
            : null,
        congestion: (insights?.congestion ?? []).filter((statistic) =>
          sameStep(statistic.stepId, analysisStep?.stepId ?? stepId),
        ),
        database: databaseFacts(analysisStep?.metrics.data ?? null),
        lvs: lvsInsights(analysisStep?.metrics.data ?? null),
        rcx: rcxInsights(analysisStep?.metrics.data ?? null),
      },
      artifacts:
        artifacts.status === 'ready'
          ? artifacts.data
              .filter((artifact) => sameStep(artifact.stepId ?? '', stepId))
              .map(artifactDescriptor)
          : [],
      checklist:
        checklist.status === 'ready' || checklist.status === 'partial'
          ? {
              findings: checklist.data.findings.filter((finding) =>
                sameStep(finding.step, stepId),
              ),
            }
          : { findings: [] },
      step: flowStep,
      subflow: analysisStep?.subflow ?? { status: 'missing', steps: [] },
      ...(staleEvidence ? { staleEvidence } : {}),
    },
    issues: [],
  }
}
