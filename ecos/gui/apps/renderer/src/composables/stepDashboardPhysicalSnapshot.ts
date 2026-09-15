import type { WorkspaceDatabaseFacts, WorkspaceStepDetail } from '@ecos-studio/shared'
import type {
  StepDashboardFloorplanInsights,
  StepDashboardFloorplanSnapshot,
  StepDashboardSynthesisValue,
  StepDesignStatis,
} from '@/components/step-dashboard/stepDashboardData'

function displayMetric(value: number, unit?: string | null): string {
  const formatted = Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(3)))
  return unit ? `${formatted} ${unit}` : formatted
}

function metricValues(detail: WorkspaceStepDetail): StepDashboardSynthesisValue[] {
  return detail.analysis.metrics.map((metric) => ({
    id: metric.id,
    label: metric.display_name,
    value: displayMetric(metric.value, metric.unit),
  }))
}

function sliceColor(index: number, count: number): string {
  const hue = Math.round((index / Math.max(1, count)) * 300 + 25) % 360
  return `hsl(${hue} 62% 54%)`
}

function composition(
  database: WorkspaceDatabaseFacts,
  id: string,
  label: string,
  total: number | null,
  field: 'count' | 'area' | 'pinCount',
  unit: 'count' | 'um2',
): StepDashboardFloorplanSnapshot | null {
  if (total === null) return null
  const slices = database.instanceClasses.flatMap((item) => {
    const value = item[field]
    return value === null
      ? []
      : [{ id: `${id}-${item.kind}`, label: item.kind, value, tone: 'neutral' as const }]
  })
  return slices.length ? { id, label, total, unit, kind: 'composition', slices } : null
}

function pinDistribution(
  database: WorkspaceDatabaseFacts,
  field: 'instanceCount' | 'netCount',
  label: string,
): StepDashboardFloorplanSnapshot | null {
  const bins = new Map<number, number>()
  let over32 = 0
  for (const row of database.pinDistribution) {
    const value = row[field]
    if (value === null) continue
    if (row.pinCount <= 32) bins.set(row.pinCount, (bins.get(row.pinCount) ?? 0) + value)
    else over32 += value
  }
  if (!bins.size && over32 === 0) return null
  const slices = Array.from({ length: 33 }, (_, pinCount) => ({
    id: `${field}-${pinCount}`,
    label: String(pinCount),
    value: bins.get(pinCount) ?? 0,
    tone: 'neutral' as const,
    color: sliceColor(pinCount, 34),
  }))
  slices.push({
    id: `${field}-over-32`,
    label: '>32',
    value: over32,
    tone: 'neutral',
    color: sliceColor(33, 34),
  })
  return {
    id: `pin-distribution-${field}`,
    label,
    total: slices.reduce((sum, slice) => sum + slice.value, 0),
    unit: 'count',
    kind: 'distribution',
    slices,
  }
}

function layerDistribution(
  rows: Array<{ layer: string; value: number | null }>,
  id: string,
  label: string,
  unit: 'count' | '',
): StepDashboardFloorplanSnapshot | null {
  const available = rows.filter(
    (row): row is { layer: string; value: number } => row.value !== null,
  )
  if (!available.length) return null
  const slices = available.map((row, index) => ({
    id: `${id}-${row.layer}`,
    label: row.layer,
    value: row.value,
    tone: 'neutral' as const,
    color: sliceColor(index, available.length),
  }))
  return {
    id,
    label,
    total: slices.reduce((sum, slice) => sum + slice.value, 0),
    unit,
    kind: 'distribution',
    slices,
  }
}

function databaseSnapshots(
  database: WorkspaceDatabaseFacts,
): StepDashboardFloorplanSnapshot[] {
  return [
    composition(
      database,
      'instance-area',
      'Instance Area',
      database.instanceTotal.area,
      'area',
      'um2',
    ),
    composition(
      database,
      'instance-count',
      'Instance Count',
      database.instanceTotal.count,
      'count',
      'count',
    ),
    composition(
      database,
      'instance-pins',
      'Instance Pins',
      database.instanceTotal.pinCount,
      'pinCount',
      'count',
    ),
    pinDistribution(database, 'instanceCount', 'Inst Pin Bins'),
    pinDistribution(database, 'netCount', 'Net Pin Bins'),
    layerDistribution(
      database.cutLayers.map((row) => ({ layer: row.layer, value: row.viaCount })),
      'layer-via-count',
      'Cut Layer Vias',
      'count',
    ),
    layerDistribution(
      database.routingLayers.map((row) => ({
        layer: row.layer,
        value: row.wireLength,
      })),
      'layer-wire-length',
      'Routing Wire Length',
      '',
    ),
  ].filter((snapshot): snapshot is StepDashboardFloorplanSnapshot => snapshot !== null)
}

export function physicalInsights(
  detail: WorkspaceStepDetail,
): StepDashboardFloorplanInsights | null {
  const metrics = metricValues(detail)
  const database = detail.analysis.database
  if (!metrics.length && !database) return null
  return { metrics, snapshots: database ? databaseSnapshots(database) : [] }
}

export function designStatistics(detail: WorkspaceStepDetail): StepDesignStatis | null {
  const database = detail.analysis.database
  if (database) {
    const rows = [
      ['die-area', 'Die Area', database.layout.dieArea, 'um2'],
      ['die-usage', 'Die Usage', database.layout.dieUsage, 'ratio'],
      ['core-area', 'Core Area', database.layout.coreArea, 'um2'],
      ['core-usage', 'Core Usage', database.layout.coreUsage, 'ratio'],
      ['io-pins', 'IO Pins', database.statistics.ioPins, 'count'],
      ['instances', 'Instances', database.statistics.instances, 'count'],
      ['nets', 'Nets', database.statistics.nets, 'count'],
    ].flatMap(([id, label, value, unit]) =>
      typeof value === 'number'
        ? [
            {
              id: String(id),
              label: String(label),
              value: displayMetric(value, String(unit)),
            },
          ]
        : [],
    )
    return rows.length
      ? {
          rowCount: rows.length,
          groups: [{ id: 'design-statis', label: 'Design Statis', rows }],
        }
      : null
  }
  const rows = detail.analysis.metrics
    .filter((metric) =>
      [
        'die_area',
        'core_area',
        'core_utilization',
        'instance_count',
        'net_count',
        'io_pin_count',
      ].includes(metric.id),
    )
    .map((metric) => ({
      id: `design-statis-${metric.id}`,
      label: metric.display_name,
      value: displayMetric(metric.value, metric.unit),
    }))
  return rows.length
    ? {
        rowCount: rows.length,
        groups: [{ id: 'design-statis', label: 'Design Statis', rows }],
      }
    : null
}
