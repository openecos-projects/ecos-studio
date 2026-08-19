/**
 * Flow Insights 数据层（纯函数）。
 *
 * 数据来源（全部由 workspace resource index 可寻址）：
 * - step 资源：WorkspaceStepResource（runtime/state/peak memory 从 flow.json 步骤信息读取）
 * - qor_metrics.json：step.resources.analysis.metrics
 * - step.db.json：step.resources.feature.db
 * - drc_statis.csv：step.resources.analysis.statis_csv
 * - 拥塞/密度图：step.directory/feature/<map_dir>/<step>_<kind>.{png,csv} + layout.csv
 * - STA corner：step.resources.report.sta（嵌套 corner 目录中的 qor_summary.json）
 */

export type FlowInsightTone = 'good' | 'warn' | 'bad' | 'neutral'
export type MetricDeltaState =
  | 'improvement'
  | 'regression'
  | 'neutral'
  | 'structural'
  | 'missing'
export type MetricPolarity =
  | 'higher_is_better'
  | 'lower_is_better'
  | 'target_range'
  | 'trend_only'

const SUCCESSFUL_STEP_STATES = new Set(['success', 'reused', 'skipped', 'completed'])

export function flowInsightStepTone(state: string): FlowInsightTone {
  const normalized = state.trim().toLowerCase()
  if (SUCCESSFUL_STEP_STATES.has(normalized)) return 'good'
  if (normalized === 'failed' || normalized === 'error') return 'bad'
  if (normalized === 'running' || normalized === 'ongoing') return 'warn'
  return 'neutral'
}

export function flowInsightStepStateIcon(tone: FlowInsightTone): string {
  if (tone === 'good') return '✓'
  if (tone === 'bad') return '✕'
  if (tone === 'warn') return '●'
  return '○'
}

export function describeMetricDelta(
  value: number | null,
  previous: number | null,
  polarity: MetricPolarity,
  deltaState?: MetricDeltaState,
): {
  delta: number | null
  arrow: '↑' | '↓' | '→'
  tone: MetricDeltaState
  label: string
} {
  if (value === null || previous === null) {
    return { delta: null, arrow: '→', tone: 'missing', label: '—' }
  }
  const delta = value - previous
  const arrow: '↑' | '↓' | '→' = delta > 0 ? '↑' : delta < 0 ? '↓' : '→'
  const tone =
    deltaState ??
    (delta === 0
      ? 'neutral'
      : polarity === 'lower_is_better'
        ? delta < 0
          ? 'improvement'
          : 'regression'
        : polarity === 'higher_is_better'
          ? delta > 0
            ? 'improvement'
            : 'regression'
          : 'neutral')
  const sign = delta > 0 ? '+' : ''
  const formatted = Number.isInteger(delta)
    ? String(delta)
    : delta.toFixed(Math.abs(delta) >= 10 ? 1 : 3)
  return {
    delta,
    arrow,
    tone,
    label: delta === 0 ? 'Δ ·' : `Δ ${sign}${formatted} ${arrow}`,
  }
}

export interface FlowInsightStep {
  /** 原始 step 名（flow.json name，如 "Synthesis"/"fixFanout"） */
  name: string
  /** 规范化短名（"Synth"/"Fanout"…，用于与 FlowStep 对齐） */
  key: string
  tool: string
  state: string
  runtimeSeconds: number | null
  peakMemoryMb: number | null
  successful: boolean
  directory: string
}

export interface StepResourceRow {
  id: string
  label: string
  values: Array<number | null>
  unit: string
}

export interface StepResourcesModel {
  steps: FlowInsightStep[]
  rows: Array<{
    id: 'runtime' | 'memory'
    label: string
    unit: string
    values: Array<number | null>
  }>
  totalRuntimeSeconds: number
  peakMemoryMb: number | null
  runtimeBottleneckIndex: number
  memoryBottleneckIndex: number
}

const FLOW_STEP_CANONICAL_KEYS: Array<[RegExp, string]> = [
  [/^synth/i, 'Synth'],
  [/^floorplan/i, 'Floor'],
  [/^fixfanout/i, 'Fanout'],
  [/^fanout/i, 'Fanout'],
  [/^place/i, 'Place'],
  [/^cts/i, 'CTS'],
  [/^legal/i, 'Legal'],
  [/^route/i, 'Route'],
  [/^drc/i, 'DRC'],
  [/^filler/i, 'Filler'],
  [/^rcx/i, 'RCX'],
  [/^sta$/i, 'STA'],
  [/^sta_/i, 'STA'],
  [/^harden/i, 'Harden'],
]

export function canonicalStepKey(stepName: string): string {
  const trimmed = stepName.trim()
  for (const [pattern, key] of FLOW_STEP_CANONICAL_KEYS) {
    if (pattern.test(trimmed)) return key
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

export function isSuccessfulStepState(state: string): boolean {
  return SUCCESSFUL_STEP_STATES.has(state.trim().toLowerCase())
}

/** "0:1:6" → 66；解析失败返回 null。 */
export function parseRuntimeSeconds(runtime: string): number | null {
  if (!runtime) return null
  const parts = runtime.split(':').map((part) => Number(part))
  if (parts.some((part) => !Number.isFinite(part))) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts.length === 1 ? parts[0] : null
}

export function parsePeakMemoryMb(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** flow.json 顶层 `peak memory (mb)` 或 step.info 兜底。 */
export function peakMemoryFromFlowStep(step: {
  info?: Record<string, unknown>
  peakMemoryMb?: unknown
  ['peak memory (mb)']?: unknown
}): number | null {
  return (
    parsePeakMemoryMb(step.peakMemoryMb) ??
    parsePeakMemoryMb(step['peak memory (mb)']) ??
    parsePeakMemoryMb(step.info?.['peak memory (mb)'])
  )
}

function finiteMetricNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function buildFlowInsightSteps(
  steps: Array<{
    name: string
    tool: string
    state: string
    runtime: string
    peakMemoryMb?: number | null
    directory: string
    info?: Record<string, unknown>
    ['peak memory (mb)']?: unknown
  }>,
): FlowInsightStep[] {
  return steps.map((step) => ({
    name: step.name,
    key: canonicalStepKey(step.name),
    tool: step.tool,
    state: step.state,
    runtimeSeconds: parseRuntimeSeconds(step.runtime),
    peakMemoryMb: step.peakMemoryMb ?? peakMemoryFromFlowStep(step),
    successful: isSuccessfulStepState(step.state),
    directory: step.directory,
  }))
}

export function buildStepResourcesModel(steps: FlowInsightStep[]): StepResourcesModel {
  const runtimeValues = steps.map((step) => step.runtimeSeconds)
  const memoryValues = steps.map((step) => step.peakMemoryMb)
  const totalRuntimeSeconds = runtimeValues.reduce<number>(
    (sum, value) => (value === null ? sum : sum + value),
    0,
  )
  const peakMemoryMb = memoryValues.reduce<number | null>(
    (best, value) => (value !== null && (best === null || value > best) ? value : best),
    null,
  )
  const bottleneckIndexOf = (values: Array<number | null>): number => {
    let bestIndex = -1
    let bestValue = -Infinity
    values.forEach((value, index) => {
      if (value !== null && value > bestValue) {
        bestValue = value
        bestIndex = index
      }
    })
    return bestIndex
  }
  return {
    steps,
    rows: [
      {
        id: 'runtime',
        label: 'Runtime',
        unit: 's',
        values: runtimeValues,
      },
      {
        id: 'memory',
        label: 'Peak memory',
        unit: 'MB',
        values: memoryValues,
      },
    ],
    totalRuntimeSeconds,
    peakMemoryMb,
    runtimeBottleneckIndex: bottleneckIndexOf(runtimeValues),
    memoryBottleneckIndex: bottleneckIndexOf(memoryValues),
  }
}

export interface RuntimeWaterfallModel {
  categories: string[]
  offsets: number[]
  durations: Array<number | null>
  runningIndex: number
  completedRuntimeSeconds: number
}

export function buildRuntimeWaterfallModel(
  steps: FlowInsightStep[],
): RuntimeWaterfallModel {
  let cursor = 0
  let runningIndex = -1
  const offsets: number[] = []
  const durations: Array<number | null> = []
  steps.forEach((step, index) => {
    const state = step.state.trim().toLowerCase()
    if (state === 'running' || state === 'ongoing') runningIndex = index
    offsets.push(cursor)
    if (step.runtimeSeconds === null) {
      durations.push(null)
      return
    }
    durations.push(step.runtimeSeconds)
    cursor += step.runtimeSeconds
  })
  return {
    categories: steps.map((step) => step.key),
    offsets,
    durations,
    runningIndex,
    completedRuntimeSeconds: cursor,
  }
}

/* ------------------------------------------------------------------ *
 * 模块②：step.db.json 指标 × step 二维矩阵 + delta
 * ------------------------------------------------------------------ */

export interface DbTrendMetricRow {
  id: string
  label: string
  unit: string
  group: string
  polarity: MetricPolarity
  values: Array<number | null>
  deltas: Array<number | null>
  deltaStates: MetricDeltaState[]
}

export interface DbTrendModel {
  steps: FlowInsightStep[]
  rows: DbTrendMetricRow[]
}

interface DbMetricDefinition {
  id: string
  label: string
  unit: string
  group: string
  polarity: DbTrendMetricRow['polarity']
  /** 从 db.json 原始对象中取值 */
  select: (db: Record<string, unknown>) => number | null
  /** synthesis 场景下的替数值（Synthesis_stat.json → cell_count 等） */
  synthesisValue?: (stat: Record<string, unknown>) => number | null
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function numberOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const nested = record(value)
  if (nested) return numberOf(nested.value)
  return null
}

function selectPath(source: Record<string, unknown>, path: string[]): number | null {
  let current: unknown = source
  for (const key of path) {
    const nested = record(current)
    if (!nested) return null
    current = nested[key]
  }
  return numberOf(current)
}

const DB_METRIC_DEFINITIONS: DbMetricDefinition[] = [
  {
    id: 'instance_count',
    label: 'Instance Count',
    unit: 'count',
    group: 'Area / Scale',
    polarity: 'trend_only',
    select: (db) => selectPath(db, ['Design Statis', 'num_instances']),
    synthesisValue: (stat) => selectPath(stat, ['design', 'num_cells']),
  },
  {
    id: 'net_count',
    label: 'Net Count',
    unit: 'count',
    group: 'Area / Scale',
    polarity: 'trend_only',
    select: (db) => selectPath(db, ['Design Statis', 'num_nets']),
    synthesisValue: (stat) => selectPath(stat, ['design', 'num_wires']),
  },
  {
    id: 'io_pin_count',
    label: 'IO Pin Count',
    unit: 'count',
    group: 'Area / Scale',
    polarity: 'trend_only',
    select: (db) => selectPath(db, ['Design Statis', 'num_iopins']),
    synthesisValue: (stat) => selectPath(stat, ['design', 'num_ports']),
  },
  {
    id: 'logic_area',
    label: 'Logic Cell Area',
    unit: 'um2',
    group: 'Area / Scale',
    polarity: 'lower_is_better',
    select: (db) => selectPath(db, ['Instances', 'logic', 'area']),
    synthesisValue: (stat) => selectPath(stat, ['design', 'area']),
  },
  {
    id: 'total_cell_area',
    label: 'Total Cell Area',
    unit: 'um2',
    group: 'Area / Scale',
    polarity: 'lower_is_better',
    select: (db) => selectPath(db, ['Instances', 'total', 'area']),
  },
  {
    id: 'die_area',
    label: 'Die Area',
    unit: 'um2',
    group: 'Area / Scale',
    polarity: 'trend_only',
    select: (db) => selectPath(db, ['Design Layout', 'die_area']),
  },
  {
    id: 'core_area',
    label: 'Core Area',
    unit: 'um2',
    group: 'Area / Scale',
    polarity: 'trend_only',
    select: (db) => selectPath(db, ['Design Layout', 'core_area']),
  },
  {
    id: 'die_utilization',
    label: 'Die Utilization',
    unit: 'ratio',
    group: 'Utilization',
    polarity: 'target_range',
    select: (db) => selectPath(db, ['Design Layout', 'die_usage']),
  },
  {
    id: 'core_utilization',
    label: 'Core Utilization',
    unit: 'ratio',
    group: 'Utilization',
    polarity: 'target_range',
    select: (db) => selectPath(db, ['Design Layout', 'core_usage']),
  },
  {
    id: 'pin_num',
    label: 'Pin Count',
    unit: 'count',
    group: 'Area / Scale',
    polarity: 'trend_only',
    select: (db) => selectPath(db, ['Instances', 'total', 'pin_num']),
  },
  {
    id: 'wire_len',
    label: 'Wirelength',
    unit: 'um',
    group: 'Routability',
    polarity: 'lower_is_better',
    select: (db) => selectPath(db, ['Nets', 'wire_len']),
  },
  {
    id: 'via_num',
    label: 'Via Count',
    unit: 'count',
    group: 'Routability',
    polarity: 'lower_is_better',
    select: (db) => selectPath(db, ['Nets', 'num_via']),
  },
  {
    id: 'clock_instance_num',
    label: 'Clock Instances',
    unit: 'count',
    group: 'Clock',
    polarity: 'trend_only',
    select: (db) => selectPath(db, ['Instances', 'clock', 'num']),
  },
  {
    id: 'macro_num',
    label: 'Macro Count',
    unit: 'count',
    group: 'Area / Scale',
    polarity: 'trend_only',
    select: (db) => selectPath(db, ['Instances', 'macros', 'num']),
  },
]

/** 增长超过该比例且发生在 filler/rcx/harden 的 step 视为结构性变化（filler 插入等）。 */
const STRUCTURAL_JUMP_RATIO = 0.5
const STRUCTURAL_STEP_KEYS = new Set(['Filler', 'RCX', 'Harden'])

function deltaStateFor(
  polarity: DbTrendMetricRow['polarity'],
  delta: number,
  ratio: number,
  currentKey: string,
): MetricDeltaState {
  if (!Number.isFinite(delta) || delta === 0) return 'neutral'
  if (
    ratio > STRUCTURAL_JUMP_RATIO &&
    delta > 0 &&
    STRUCTURAL_STEP_KEYS.has(currentKey)
  ) {
    return 'structural'
  }
  if (polarity === 'trend_only' || polarity === 'target_range') return 'neutral'
  const improving = polarity === 'lower_is_better' ? delta < 0 : delta > 0
  return improving ? 'improvement' : 'regression'
}

export function buildDbTrendModel(
  steps: FlowInsightStep[],
  dbJsonByStep: Map<string, Record<string, unknown> | null>,
  synthesisStatJson: Record<string, unknown> | null,
): DbTrendModel {
  const rows = DB_METRIC_DEFINITIONS.map((definition) => {
    const values = steps.map((step) => {
      if (step.key === 'Synth') {
        return definition.synthesisValue && synthesisStatJson
          ? definition.synthesisValue(synthesisStatJson)
          : null
      }
      const db = dbJsonByStep.get(step.name)
      return db ? definition.select(db) : null
    })

    const deltas: Array<number | null> = []
    const deltaStates: MetricDeltaState[] = []
    let previousIndex = -1
    values.forEach((value, index) => {
      if (value === null || previousIndex < 0) {
        deltas.push(null)
        deltaStates.push(value === null && previousIndex >= 0 ? 'missing' : 'neutral')
        if (value !== null) previousIndex = index
        return
      }
      const previous = values[previousIndex]
      if (previous === null) {
        deltas.push(null)
        deltaStates.push('missing')
        return
      }
      const delta = value - previous
      const ratio =
        previous !== 0 ? Math.abs(delta / previous) : delta === 0 ? 0 : Infinity
      deltas.push(delta)
      deltaStates.push(deltaStateFor(definition.polarity, delta, ratio, steps[index].key))
      previousIndex = index
    })

    return {
      id: definition.id,
      label: definition.label,
      unit: definition.unit,
      group: definition.group,
      polarity: definition.polarity,
      values,
      deltas,
      deltaStates,
    }
  })

  return { steps, rows }
}

export interface InstanceCompositionSeries {
  id: string
  label: string
  values: Array<number | null>
}

export interface InstanceCompositionModel {
  field: 'num' | 'area'
  classes: InstanceCompositionSeries[]
}

const COMPOSITION_CLASSES: Array<{
  id: string
  label: string
  path: string[]
}> = [
  { id: 'logic', label: 'Logic', path: ['Instances', 'logic'] },
  { id: 'clock', label: 'Clock', path: ['Instances', 'clock'] },
  { id: 'macros', label: 'Macros', path: ['Instances', 'macros'] },
  { id: 'iopads', label: 'I/O pads', path: ['Instances', 'iopads'] },
]

/** 按 step 堆叠 instance class；filler 用 total - 已知 class 的差值。 */
export function buildInstanceCompositionModel(
  steps: FlowInsightStep[],
  dbJsonByStep: Map<string, Record<string, unknown> | null>,
  field: 'num' | 'area' = 'num',
): InstanceCompositionModel {
  const classes = COMPOSITION_CLASSES.map((item) => ({
    id: item.id,
    label: item.label,
    values: steps.map((step) => {
      const db = dbJsonByStep.get(step.name)
      return db ? selectPath(db, [...item.path, field]) : null
    }),
  }))
  const fillerValues = steps.map((step, index) => {
    const db = dbJsonByStep.get(step.name)
    if (!db) return null
    const total = selectPath(db, ['Instances', 'total', field])
    if (total === null) return null
    const accounted = classes.reduce((sum, series) => {
      const value = series.values[index]
      return value === null ? sum : sum + value
    }, 0)
    const remainder = total - accounted
    return remainder > 0 ? remainder : 0
  })
  return {
    field,
    classes: [...classes, { id: 'filler', label: 'Filler', values: fillerValues }],
  }
}

/** 矩阵单元格背景热力值：行内 min-max 归一化（null → null）。 */
export function metricHeatLevel(
  values: Array<number | null>,
  value: number | null,
): number | null {
  const finite = values.filter((item): item is number => item !== null)
  if (value === null || finite.length < 2) return null
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  if (max === min) return 0
  return (value - min) / (max - min)
}

/* ------------------------------------------------------------------ *
 * 模块③：拥塞 / 密度图枚举
 * ------------------------------------------------------------------ */

export type CongestionMapKind = 'egr' | 'rudy' | 'lut_rudy' | 'density'

export interface CongestionMapTileModel {
  id: string
  step: FlowInsightStep
  mapKind: CongestionMapKind
  /** horizontal / vertical / union；density 图为 '' */
  direction: 'horizontal' | 'vertical' | 'union' | ''
  label: string
  pngPath: string
  csvPath: string
  /** 网格 → die 坐标映射文件（与 png/csv 同目录） */
  layoutCsvPath: string
  stats: CongestionMapStats | null
}

export interface CongestionMapStats {
  max: number
  total: number
  hotspotCount: number
}

interface CongestionMapSpec {
  mapKind: CongestionMapKind
  directory: string
  filePrefixPattern: string
  directions: Array<CongestionMapTileModel['direction']>
  labelPrefix: string
}

const CONGESTION_MAP_SPECS: CongestionMapSpec[] = [
  {
    mapKind: 'egr',
    directory: 'egr_congestion_map',
    filePrefixPattern: '{step}_egr_{direction}_overflow',
    directions: ['horizontal', 'vertical', 'union'],
    labelPrefix: 'EGR',
  },
  {
    mapKind: 'rudy',
    directory: 'RUDY_map',
    filePrefixPattern: '{step}_rudy_{direction}',
    directions: ['horizontal', 'vertical', 'union'],
    labelPrefix: 'RUDY',
  },
  {
    mapKind: 'lut_rudy',
    directory: 'RUDY_map',
    filePrefixPattern: '{step}_lut_rudy_{direction}',
    directions: ['horizontal', 'vertical', 'union'],
    labelPrefix: 'LUT-RUDY',
  },
  {
    mapKind: 'density',
    directory: 'density_map',
    filePrefixPattern: '{step}_allcell_density',
    directions: [''],
    labelPrefix: 'All-Cell Density',
  },
]

export interface CongestionMapAvailability {
  stepName: string
  step: FlowInsightStep
  files: Array<{ pngPath: string; csvPath: string; layoutCsvPath: string }>
}

/**
 * 构建拥塞图 tile 列表。png/csv 内容存在性由调用方（异步读取）补充，
 * 此函数只负责路径推导与规格匹配。
 */
export function buildCongestionTiles(
  steps: FlowInsightStep[],
  existingFiles: Set<string>,
): CongestionMapTileModel[] {
  const tiles: CongestionMapTileModel[] = []
  for (const step of steps) {
    for (const spec of CONGESTION_MAP_SPECS) {
      for (const direction of spec.directions) {
        const fileStem = spec.filePrefixPattern
          .replace('{step}', step.name)
          .replace('{direction}', direction)
        const directory = `${step.directory}/feature/${spec.directory}`
        const pngPath = `${directory}/${fileStem}.png`
        const csvPath = `${directory}/${fileStem}.csv`
        const layoutCsvPath = `${directory}/layout.csv`
        if (!existingFiles.has(pngPath)) continue
        const directionLabel = direction
          ? ` ${direction[0].toUpperCase()}${direction.slice(1)}`
          : ''
        tiles.push({
          id: `${step.name}-${spec.mapKind}-${direction || 'plain'}`,
          step,
          mapKind: spec.mapKind,
          direction,
          label: `${spec.labelPrefix}${directionLabel}`,
          pngPath,
          csvPath,
          layoutCsvPath,
          stats: null,
        })
      }
    }
  }
  return tiles
}

/** 解析网格 CSV（逗号分隔的数值矩阵）→ max/total/热点格数。 */
export function parseCongestionCsv(content: string): CongestionMapStats | null {
  if (!content.trim()) return null
  let max = 0
  let total = 0
  let hotspotCount = 0
  let cellCount = 0
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue
    for (const cell of line.split(',')) {
      const value = Number(cell)
      if (!Number.isFinite(value)) continue
      cellCount += 1
      if (value > max) max = value
      if (value > 0) {
        total += value
        hotspotCount += 1
      }
    }
  }
  return cellCount > 0 ? { max, total, hotspotCount } : null
}

export interface CongestionComparisonPoint {
  stepKey: string
  stepName: string
  total: number | null
  max: number | null
}

/** 每个 step 取 EGR union（否则任意 EGR）的 max/total，供 step 间对比折线。 */
export function buildCongestionComparisonModel(
  tiles: CongestionMapTileModel[],
): CongestionComparisonPoint[] {
  const byStep = new Map<string, CongestionComparisonPoint>()
  for (const tile of tiles) {
    if (tile.mapKind !== 'egr' || !tile.stats) continue
    const existing = byStep.get(tile.step.name)
    const point: CongestionComparisonPoint = {
      stepKey: tile.step.key,
      stepName: tile.step.name,
      total: tile.stats.total,
      max: tile.stats.max,
    }
    if (!existing || tile.direction === 'union') byStep.set(tile.step.name, point)
  }
  return [...byStep.values()]
}

/* ------------------------------------------------------------------ *
 * 模块④：DRC 统计（Type × Layer 矩阵）
 * ------------------------------------------------------------------ */

export interface DrcLayerTypeMatrix {
  headers: string[]
  layerColumns: string[]
  totalColumn: string
  types: Array<{
    name: string
    values: number[]
    total: number
    maxLayer: string | null
  }>
  totalByLayer: number[]
  totalCount: number
}

export interface DrcRelatedMetrics {
  drcCount: number | null
  routeDrViolations: number | null
  routeLaOverflow: number | null
  drcStepName: string | null
  routeStepName: string | null
}

export function buildDrcRelatedMetrics(
  source: {
    drcCount?: number | null
    routeDrViolations?: number | null
    routeLaOverflow?: number | null
    drcStepName?: string | null
    routeStepName?: string | null
  } = {},
): DrcRelatedMetrics {
  return {
    drcCount: source.drcCount ?? null,
    routeDrViolations: source.routeDrViolations ?? null,
    routeLaOverflow: source.routeLaOverflow ?? null,
    drcStepName: source.drcStepName ?? null,
    routeStepName: source.routeStepName ?? null,
  }
}

export function parseDrcStatisCsv(content: string | null): DrcLayerTypeMatrix | null {
  if (!content) return null
  const rows = content
    .split(/\r?\n/)
    .map((line) => line.split(',').map((cell) => cell.trim()))
    .filter((cells) => cells.some(Boolean))
  if (rows.length < 2) return null

  const headers = rows[0]
  const totalColumnIndex = Math.max(
    1,
    headers.findIndex((header) => header.toLowerCase() === 'total'),
  )
  const layerColumns = headers.slice(1, totalColumnIndex)

  const toCount = (cell: string): number => {
    const value = Number(cell)
    return Number.isFinite(value) && value > 0 ? value : 0
  }

  const totalRow = rows.find((cells) => (cells[0] ?? '').toLowerCase() === 'total')
  const typeRows = rows
    .slice(1)
    .filter((cells) => (cells[0] ?? '').toLowerCase() !== 'total')

  const types = typeRows.map((cells) => {
    const values = layerColumns.map((_, index) => toCount(cells[index + 1] ?? ''))
    const maxIndex = values.reduce(
      (best, value, index) => (value > values[best] ? index : best),
      0,
    )
    return {
      name: cells[0] || 'Unknown',
      values,
      total: toCount(cells[totalColumnIndex] ?? ''),
      maxLayer: values[maxIndex] > 0 ? layerColumns[maxIndex] : null,
    }
  })

  const totalByLayer = layerColumns.map((_, index) => {
    if (totalRow) return toCount(totalRow[index + 1] ?? '')
    return types.reduce((sum, type) => sum + type.values[index], 0)
  })

  const totalCount =
    totalRow !== undefined
      ? toCount(totalRow[totalColumnIndex] ?? '')
      : types.reduce((sum, type) => sum + type.total, 0)

  return {
    headers,
    layerColumns,
    totalColumn: headers[totalColumnIndex] ?? 'total',
    types,
    totalByLayer,
    totalCount,
  }
}

/* ------------------------------------------------------------------ *
 * 模块⑤：STA corner 一览
 * ------------------------------------------------------------------ */

export interface StaCornerCheck {
  wns: number | null
  tns: number | null
  nvp: number | null
  frequencyMhz: number | null
}

export interface StaCornerChecks {
  setup: StaCornerCheck | null
  hold: Omit<StaCornerCheck, 'frequencyMhz'> | null
}

export interface StaPathPreview {
  corner: string
  pathId: string
  analysisType: 'setup' | 'hold' | 'unknown'
  slackNs: number | null
  startPoint: string
  endPoint: string
  stageCount: number
  pathGroup: string
}

export interface StaCornerRowModel extends StaCornerChecks {
  /** "MAX_125/Cworst" 形式 */
  corner: string
  missing: boolean
  summary: StaCornerChecks
  groups: Record<string, StaCornerChecks>
  firstPath: StaPathPreview | null
}

export interface StaOverviewModel {
  corners: StaCornerRowModel[]
  pathGroups: string[]
  selectedPathGroup: string
  worstSetup: { corner: string; wns: number } | null
  worstHold: { corner: string; wns: number } | null
  frequencyMhz: number | null
  setupViolationCount: number
  holdViolationCount: number
  allCornersMet: boolean | null
}

const CORNER_PROCESS_ORDER = ['MAX', 'ML', 'TYP', 'MIN', 'WCL', 'WCH']

function cornerSortKey(corner: string): [number, string] {
  const process = corner.split('/')[0] ?? ''
  const order = CORNER_PROCESS_ORDER.findIndex((prefix) => process.startsWith(prefix))
  return [order === -1 ? CORNER_PROCESS_ORDER.length : order, corner]
}

function checkFromRecord(
  source: Record<string, unknown> | null,
  includeFrequency: boolean,
): StaCornerCheck | null {
  if (!source) return null
  return {
    wns: finiteMetricNumber(source.wns),
    tns: finiteMetricNumber(source.tns),
    nvp: finiteMetricNumber(source.nvp),
    frequencyMhz: includeFrequency ? finiteMetricNumber(source.frequency_mhz) : null,
  }
}

export interface StaCornerSummaryRef {
  /** "MAX_125/Cworst" 形式的 corner 名 */
  corner: string
  /** 相对 step 目录的 qor_summary.json 路径（如 feature/MAX_125/Cworst/qor_summary.json） */
  summaryPath: string
  /** 相对 step 目录的 timing_paths.json 路径 */
  pathsPath: string
}

/**
 * 从 sta.step.json 的 signoff_metrics.corners 提取 corner 列表与 summary 文件路径。
 * 每项形如 { corner: "MAX_125/Cworst", summary_file: "feature/MAX_125/Cworst/qor_summary.json" }。
 */
export function parseStaCornerSummaries(
  staStepJson: Record<string, unknown>,
): StaCornerSummaryRef[] {
  const sta = record(staStepJson.sta)
  const signoff = record(sta?.signoff_metrics)
  const corners = Array.isArray(signoff?.corners) ? signoff.corners : []
  return corners.flatMap((candidate) => {
    const corner = record(candidate)
    const cornerName = typeof corner?.sta_corner === 'string' ? corner.sta_corner : ''
    const summaryFile =
      typeof corner?.summary_file === 'string' ? corner.summary_file : ''
    const pathsFile =
      typeof corner?.timing_paths_file === 'string' ? corner.timing_paths_file : ''
    if (!cornerName) return []
    const summaryPath = summaryFile || `feature/${cornerName}/qor_summary.json`
    return [
      {
        corner: cornerName,
        summaryPath,
        pathsPath:
          pathsFile || summaryPath.replace(/qor_summary\.json$/i, 'timing_paths.json'),
      },
    ]
  })
}

function parseStaPathGroupMap(
  summary: Record<string, unknown> | null,
): Record<string, StaCornerChecks> {
  if (!summary) return {}
  const groups = Array.isArray(summary.path_groups) ? summary.path_groups : []
  const result: Record<string, StaCornerChecks> = {}
  for (const candidate of groups) {
    const group = record(candidate)
    const name = typeof group?.name === 'string' ? group.name.trim() : ''
    if (!group || !name) continue
    result[name] = {
      setup: checkFromRecord(record(group.setup), true),
      hold: checkFromRecord(record(group.hold), false),
    }
  }
  return result
}

function summarizeStaOverview(
  corners: StaCornerRowModel[],
  pathGroups: string[],
  selectedPathGroup: string,
): StaOverviewModel {
  const setupEntries = corners.flatMap((row) =>
    row.setup?.wns !== null && row.setup?.wns !== undefined
      ? [{ corner: row.corner, wns: row.setup.wns as number }]
      : [],
  )
  const holdEntries = corners.flatMap((row) =>
    row.hold?.wns !== null && row.hold?.wns !== undefined
      ? [{ corner: row.corner, wns: row.hold.wns as number }]
      : [],
  )
  const worstSetup = setupEntries.sort((left, right) => left.wns - right.wns)[0] ?? null
  const worstHold = holdEntries.sort((left, right) => left.wns - right.wns)[0] ?? null
  const frequencyMhz =
    corners.flatMap((row) =>
      row.setup?.frequencyMhz != null ? [row.setup.frequencyMhz] : [],
    )[0] ?? null
  const setupViolationCount = corners.reduce((sum, row) => sum + (row.setup?.nvp ?? 0), 0)
  const holdViolationCount = corners.reduce((sum, row) => sum + (row.hold?.nvp ?? 0), 0)
  const allCornersMet =
    worstSetup !== null && worstHold !== null
      ? worstSetup.wns >= 0 && worstHold.wns >= 0
      : null

  return {
    corners,
    pathGroups,
    selectedPathGroup,
    worstSetup,
    worstHold,
    frequencyMhz,
    setupViolationCount,
    holdViolationCount,
    allCornersMet,
  }
}

export function buildStaOverviewModel(
  cornerSummaries: Array<{ corner: string; summary: Record<string, unknown> | null }>,
): StaOverviewModel {
  const pathGroupNames = new Set<string>()
  const corners: StaCornerRowModel[] = cornerSummaries
    .map(({ corner, summary }) => {
      if (!summary) {
        const empty = { setup: null, hold: null }
        return {
          corner,
          ...empty,
          summary: empty,
          missing: true,
          groups: {},
          firstPath: null,
        }
      }
      const summaryRecord = record(summary.summary) ?? summary
      const checks: StaCornerChecks = {
        setup: checkFromRecord(record(summaryRecord.setup), true),
        hold: checkFromRecord(record(summaryRecord.hold), false),
      }
      const groups = parseStaPathGroupMap(summary)
      Object.keys(groups).forEach((name) => pathGroupNames.add(name))
      return {
        corner,
        ...checks,
        summary: checks,
        missing: false,
        groups,
        firstPath: null,
      }
    })
    .sort((left, right) => {
      const [leftOrder, leftCorner] = cornerSortKey(left.corner)
      const [rightOrder, rightCorner] = cornerSortKey(right.corner)
      return leftOrder - rightOrder || leftCorner.localeCompare(rightCorner)
    })

  return summarizeStaOverview(corners, [...pathGroupNames].sort(), 'summary')
}

export function selectStaPathGroup(
  model: StaOverviewModel,
  groupName: string,
): StaOverviewModel {
  const selected = groupName.trim() || 'summary'
  if (selected === model.selectedPathGroup) return model
  const corners = model.corners.map((row) => {
    if (selected === 'summary') {
      return {
        ...row,
        setup: row.summary.setup,
        hold: row.summary.hold,
        missing:
          row.summary.setup === null &&
          row.summary.hold === null &&
          !Object.keys(row.groups).length,
      }
    }
    const group = row.groups[selected]
    if (!group) {
      return {
        ...row,
        setup: null,
        hold: null,
        missing: true,
      }
    }
    return {
      ...row,
      setup: group.setup,
      hold: group.hold,
      missing: false,
    }
  })
  return summarizeStaOverview(corners, model.pathGroups, selected)
}

export function attachStaFirstPaths(
  model: StaOverviewModel,
  previews: Array<StaPathPreview | null>,
): StaOverviewModel {
  const byCorner = new Map(
    previews.flatMap((preview) => (preview ? [[preview.corner, preview] as const] : [])),
  )
  return {
    ...model,
    corners: model.corners.map((row) => ({
      ...row,
      firstPath: byCorner.get(row.corner) ?? row.firstPath,
    })),
  }
}

export function parseFirstStaPathPreview(
  source: Record<string, unknown> | null,
  corner: string,
): StaPathPreview | null {
  if (!source) return null
  const rawPaths = Array.isArray(source.paths) ? source.paths : []
  for (const candidate of rawPaths) {
    const path = record(candidate)
    if (!path) continue
    const stages = Array.isArray(path.stages) ? path.stages : []
    const pathId = typeof path.path_id === 'string' ? path.path_id : 'path-1'
    return {
      corner,
      pathId,
      analysisType: analysisTypeOf(path.analysis_type),
      slackNs: finiteMetricNumber(path.slack_ns ?? path.slack),
      startPoint: typeof path.start_point === 'string' ? path.start_point : '',
      endPoint: typeof path.end_point === 'string' ? path.end_point : '',
      stageCount: stages.length,
      pathGroup: typeof path.path_group === 'string' ? path.path_group : '',
    }
  }
  return null
}

export function formatStaPathPreview(preview: StaPathPreview | null): string {
  if (!preview) return ''
  const slack =
    preview.slackNs === null
      ? 'slack —'
      : `slack ${preview.slackNs > 0 ? '+' : ''}${preview.slackNs.toFixed(3)} ns`
  const endpoints =
    preview.startPoint || preview.endPoint
      ? `${preview.startPoint || '—'} → ${preview.endPoint || '—'}`
      : ''
  return [
    `${preview.analysisType} ${preview.pathId}`,
    slack,
    endpoints,
    preview.stageCount ? `${preview.stageCount} stages` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

export function staCornerSummaryPath(stepDirectory: string, corner: string): string {
  const [group, sub] = corner.split('/')
  if (!sub) return `${stepDirectory}/feature/${group}/qor_summary.json`
  return `${stepDirectory}/feature/${group}/${sub}/qor_summary.json`
}

export interface StaPathStage {
  pin: string
  cell: string
  arrivalNs: number | null
  delayNs: number | null
}

export interface StaCriticalPath {
  id: string
  corner: string
  analysisType: 'setup' | 'hold' | 'unknown'
  slackNs: number | null
  stageCount: number
  stages: StaPathStage[]
}

export interface StaCriticalPathsModel {
  setup: StaCriticalPath[]
  hold: StaCriticalPath[]
}

function analysisTypeOf(value: unknown): StaCriticalPath['analysisType'] {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (normalized === 'setup') return 'setup'
  if (normalized === 'hold') return 'hold'
  return 'unknown'
}

export function parseStaTimingPaths(
  source: Record<string, unknown> | null,
  corner: string,
): StaCriticalPath[] {
  if (!source) return []
  const rawPaths = Array.isArray(source.paths) ? source.paths : []
  return rawPaths.flatMap((candidate, index) => {
    const path = record(candidate)
    if (!path) return []
    const rawStages = Array.isArray(path.stages) ? path.stages : []
    const stages: StaPathStage[] = []
    rawStages.forEach((item) => {
      const stage = record(item)
      if (!stage) return
      const arrivalNs = finiteMetricNumber(stage.arrival_ns ?? stage.arrival)
      const previous = stages[stages.length - 1]
      const inferredDelay =
        arrivalNs !== null &&
        previous?.arrivalNs !== null &&
        previous?.arrivalNs !== undefined
          ? arrivalNs - previous.arrivalNs
          : arrivalNs
      stages.push({
        pin: typeof stage.pin === 'string' ? stage.pin : '',
        cell: typeof stage.cell === 'string' ? stage.cell : '',
        arrivalNs,
        delayNs: finiteMetricNumber(stage.delay_ns ?? stage.delay) ?? inferredDelay,
      })
    })
    const pathId = typeof path.path_id === 'string' ? path.path_id : `path-${index + 1}`
    return [
      {
        id: `${corner}:${pathId}`,
        corner,
        analysisType: analysisTypeOf(path.analysis_type),
        slackNs: finiteMetricNumber(path.slack_ns ?? path.slack),
        stageCount: stages.length,
        stages,
      },
    ]
  })
}

export function buildStaCriticalPathsModel(
  pathGroups: Array<{ corner: string; source: Record<string, unknown> | null }>,
  limit = 5,
): StaCriticalPathsModel {
  return selectStaCriticalPaths(
    pathGroups.map(({ corner, source }) => ({
      corner,
      paths: parseStaTimingPaths(source, corner),
    })),
    null,
    limit,
  )
}

/** Worst setup/hold paths across all corners, or scoped to one corner when given. */
export function selectStaCriticalPaths(
  pathsByCorner: ReadonlyArray<{
    corner: string
    paths: readonly StaCriticalPath[]
  }>,
  corner: string | null,
  limit = 5,
): StaCriticalPathsModel {
  const paths = pathsByCorner
    .filter((group) => corner === null || group.corner === corner)
    .flatMap((group) => group.paths)
  const bySlack = (left: StaCriticalPath, right: StaCriticalPath): number => {
    const leftSlack = left.slackNs ?? Number.POSITIVE_INFINITY
    const rightSlack = right.slackNs ?? Number.POSITIVE_INFINITY
    return leftSlack - rightSlack
  }
  return {
    setup: paths
      .filter((path) => path.analysisType === 'setup')
      .sort(bySlack)
      .slice(0, limit),
    hold: paths
      .filter((path) => path.analysisType === 'hold')
      .sort(bySlack)
      .slice(0, limit),
  }
}

export interface StaConvergencePoint {
  workspaceName: string
  setupWns: number | null
  holdWns: number | null
  frequencyMhz: number | null
}

export interface StaConvergenceModel {
  points: StaConvergencePoint[]
}

export function buildStaConvergenceModel(
  points: StaConvergencePoint[],
): StaConvergenceModel | null {
  const kept = points.filter(
    (point) =>
      point.setupWns !== null || point.holdWns !== null || point.frequencyMhz !== null,
  )
  return kept.length >= 2 ? { points: kept } : null
}

export function staConvergenceFromComparison(
  comparison: {
    workspaceName: string
    baselineWorkspaceName: string | null
    isBaselineWorkspace: boolean
    metrics: Array<{
      metricName: string
      currentValue: number
      baselineValue: number
    }>
  } | null,
): StaConvergenceModel | null {
  if (!comparison?.baselineWorkspaceName || comparison.isBaselineWorkspace) return null
  const pick = (
    metricName: string,
  ): { current: number | null; baseline: number | null } => {
    const metric = comparison.metrics.find((item) => item.metricName === metricName)
    return {
      current:
        metric && Number.isFinite(metric.currentValue) ? metric.currentValue : null,
      baseline:
        metric && Number.isFinite(metric.baselineValue) ? metric.baselineValue : null,
    }
  }
  const setup = pick('sta_setup_wns')
  const hold = pick('sta_hold_wns')
  const frequency = pick('sta_frequency_mhz')
  return buildStaConvergenceModel([
    {
      workspaceName: comparison.baselineWorkspaceName,
      setupWns: setup.baseline,
      holdWns: hold.baseline,
      frequencyMhz: frequency.baseline,
    },
    {
      workspaceName: comparison.workspaceName,
      setupWns: setup.current,
      holdWns: hold.current,
      frequencyMhz: frequency.current,
    },
  ])
}
