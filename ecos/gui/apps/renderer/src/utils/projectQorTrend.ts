import type {
  FlowStep,
  ProjectStepStatus,
  ProjectWorkspaceStatus,
} from './projectManagement'

export type QorDimension =
  | 'timing'
  | 'power_integrity'
  | 'routability_physical'
  | 'area_cost'
  | 'clock_robustness_dfm'

export type QorPolarity =
  | 'higher_is_better'
  | 'lower_is_better'
  | 'target_range'
  | 'trend_only'

export type QorStatus = 'Green' | 'Yellow' | 'Orange' | 'Red' | 'Blocked'

export interface ProjectQorWorkspaceInput {
  workspaceId: string
  workspaceName: string
  workspacePath: string
  createdAt: string
  status: ProjectWorkspaceStatus
  branchFrom: {
    source_workspace_id: string
    source_step: FlowStep | string
  } | null
  stepMetricTexts: Partial<Record<FlowStep, string | null>>
  stepSummaryTexts?: Partial<Record<FlowStep, string | null>>
  stepHotspotTexts?: Partial<Record<FlowStep, string | null>>
  stepStatuses: Partial<Record<FlowStep, ProjectStepStatus>>
}

export interface LegacyStepMetricInput {
  workspaceId: string
  workspacePath: string
  step: FlowStep
  sourceFile: string
  text: string | null | undefined
}

export interface ProjectQorMetricRecord {
  workspaceId: string
  workspacePath: string
  step: FlowStep
  metricName: string
  displayName: string
  value: number | null
  unit?: string
  dimension: QorDimension
  polarity: QorPolarity
  sourceFile: string
  confidence: 'high' | 'medium' | 'low'
}

export interface ProjectQorUnsupportedModule {
  id: string
  label: string
  reason: string
  status: '待后续开发'
}

export interface ProjectQorBlockingIssue {
  step: FlowStep
  metric: string
  displayName: string
  value: number | string | null
  reason: string
}

export interface ProjectQorHotspot {
  step: FlowStep
  kind: string
  severity: 'info' | 'warning' | 'critical'
  metric: string
  displayName: string
  value: number | string | null
  sourceFile: string
  description: string
}

export interface ProjectQorTrendWorkspaceSummary {
  workspaceId: string
  workspaceName: string
  workspacePath: string
  status: QorStatus
  overallScore: number | null
  hardGateCap: number
  dimensionScores: Partial<Record<QorDimension, number>>
  records: ProjectQorMetricRecord[]
  blockingIssues: ProjectQorBlockingIssue[]
  hotspots: ProjectQorHotspot[]
  missingAnalysisSteps: FlowStep[]
  missingMetrics: string[]
}

export interface ProjectQorTrendSummary {
  workspaces: ProjectQorTrendWorkspaceSummary[]
  trendPoints: ProjectQorTrendPoint[]
  baselineWorkspaceId: string | null
  baselineLabel: string
  regressions: ProjectQorRegression[]
  improvements: ProjectQorDelta[]
  risks: ProjectQorRisk[]
  unsupportedModules: ProjectQorUnsupportedModule[]
}

export interface ProjectQorTrendOptions {
  baselineWorkspaceId?: string | null
}

export interface ProjectQorTrendReportMetadata {
  projectId?: string
  projectName?: string
  projectPath?: string
  generatedAt?: string
}

export interface ProjectQorTrendPoint {
  workspaceId: string
  label: string
  score: number | null
  status: QorStatus
}

export interface ProjectQorDelta {
  workspaceId: string
  workspaceName: string
  baselineWorkspaceId: string
  baselineWorkspaceName: string
  metricName: string
  displayName: string
  currentValue: number
  baselineValue: number
  absoluteDelta: number
  relativeDeltaPct: number | null
  state: 'improvement' | 'regression' | 'neutral'
}

export interface ProjectQorRegression extends ProjectQorDelta {
  priority: 'P0' | 'P1' | 'P2' | 'P3'
  message: string
}

export interface ProjectQorRisk {
  workspaceId: string
  workspaceName: string
  step: FlowStep
  kind: 'blocking_issue' | 'hotspot'
  severity: 'critical' | 'warning' | 'info'
  metric: string
  displayName: string
  value: number | string | null
  message: string
}

interface LegacyMetricMapping {
  metricName: string
  displayName: string
  unit?: string
  dimension: QorDimension
  polarity: QorPolarity
}

type QorMetricConfidence = ProjectQorMetricRecord['confidence']

const QOR_FLOW_STEPS: FlowStep[] = [
  'Synth',
  'Floor',
  'Fanout',
  'Place',
  'CTS',
  'Legal',
  'Route',
  'DRC',
  'Filler',
  'RCX',
  'STA',
  'Harden',
]

const STEP_ANALYSIS_SOURCE_FILES: Record<FlowStep, string> = {
  Synth: 'Synthesis_yosys/analysis/Synthesis_metrics.json',
  Floor: 'Floorplan_ecc/analysis/Floorplan_metrics.json',
  Fanout: 'fixFanout_ecc/analysis/fixFanout_metrics.json',
  Place: 'place_dreamplace/analysis/place_metrics.json',
  CTS: 'CTS_ecc/analysis/CTS_metrics.json',
  Legal: 'legalization_dreamplace/analysis/legalization_metrics.json',
  Route: 'route_ecc/analysis/route_metrics.json',
  DRC: 'drc_ecc/analysis/drc_metrics.json',
  Filler: 'filler_ecc/analysis/filler_metrics.json',
  RCX: 'RCX_ecc/analysis/RCX_metrics.json',
  STA: 'sta_ecc/analysis/sta_metrics.json',
  Harden: 'Harden_ecc/analysis/Harden_metrics.json',
}

const QOR_DIMENSIONS: QorDimension[] = [
  'timing',
  'power_integrity',
  'routability_physical',
  'area_cost',
  'clock_robustness_dfm',
]

const QOR_POLARITIES: QorPolarity[] = [
  'higher_is_better',
  'lower_is_better',
  'target_range',
  'trend_only',
]

const QOR_CONFIDENCES: QorMetricConfidence[] = ['high', 'medium', 'low']

const LEGACY_METRIC_MAP: Record<string, LegacyMetricMapping> = {
  'cell area': {
    metricName: 'synthesis_cell_area',
    displayName: 'Synthesis Cell Area',
    unit: 'um^2',
    dimension: 'area_cost',
    polarity: 'lower_is_better',
  },
  'cell number': {
    metricName: 'synthesis_cell_count',
    displayName: 'Synthesis Cell Count',
    dimension: 'area_cost',
    polarity: 'trend_only',
  },
  'wire number': {
    metricName: 'synthesis_wire_count',
    displayName: 'Synthesis Wire Count',
    dimension: 'routability_physical',
    polarity: 'trend_only',
  },
  'port number': {
    metricName: 'synthesis_port_count',
    displayName: 'Synthesis Port Count',
    dimension: 'routability_physical',
    polarity: 'trend_only',
  },
  'die area um 2': {
    metricName: 'die_area',
    displayName: 'Die Area',
    unit: 'um^2',
    dimension: 'area_cost',
    polarity: 'lower_is_better',
  },
  'die width um': {
    metricName: 'die_width',
    displayName: 'Die Width',
    unit: 'um',
    dimension: 'area_cost',
    polarity: 'trend_only',
  },
  'die height um': {
    metricName: 'die_height',
    displayName: 'Die Height',
    unit: 'um',
    dimension: 'area_cost',
    polarity: 'trend_only',
  },
  'die util': {
    metricName: 'die_utilization',
    displayName: 'Die Utilization',
    dimension: 'area_cost',
    polarity: 'target_range',
  },
  die_utilization: {
    metricName: 'die_utilization',
    displayName: 'Die Utilization',
    dimension: 'area_cost',
    polarity: 'target_range',
  },
  'core area um 2': {
    metricName: 'core_area',
    displayName: 'Core Area',
    unit: 'um^2',
    dimension: 'area_cost',
    polarity: 'lower_is_better',
  },
  'core util': {
    metricName: 'core_utilization',
    displayName: 'Core Utilization',
    dimension: 'area_cost',
    polarity: 'target_range',
  },
  'total instances': {
    metricName: 'instance_count',
    displayName: 'Instance Count',
    dimension: 'area_cost',
    polarity: 'trend_only',
  },
  'total nets': {
    metricName: 'net_count',
    displayName: 'Net Count',
    dimension: 'routability_physical',
    polarity: 'trend_only',
  },
  'total io pins': {
    metricName: 'io_pin_count',
    displayName: 'IO Pin Count',
    dimension: 'routability_physical',
    polarity: 'trend_only',
  },
  io_pin_count: {
    metricName: 'io_pin_count',
    displayName: 'IO Pin Count',
    dimension: 'routability_physical',
    polarity: 'trend_only',
  },
  'max fanout': {
    metricName: 'fanout_max',
    displayName: 'Max Fanout',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  hpwl: {
    metricName: 'place_hpwl',
    displayName: 'Place HPWL',
    unit: 'um',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  'gp hpwl': {
    metricName: 'place_hpwl',
    displayName: 'Place HPWL',
    unit: 'um',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  'dp hpwl': {
    metricName: 'place_hpwl',
    displayName: 'Place HPWL',
    unit: 'um',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  grwl: {
    metricName: 'place_grwl',
    displayName: 'Place GRWL',
    unit: 'um',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  flute: {
    metricName: 'place_flute_wirelength',
    displayName: 'Place FLUTE Wirelength',
    unit: 'um',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  place_congestion_egr_overflow_total: {
    metricName: 'place_congestion_egr_overflow_total',
    displayName: 'Place EGR Overflow Total',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  'egr overflow total': {
    metricName: 'place_congestion_egr_overflow_total',
    displayName: 'Place EGR Overflow Total',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  place_congestion_egr_overflow_max: {
    metricName: 'place_congestion_egr_overflow_max',
    displayName: 'Place EGR Overflow Max',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  'egr overflow max': {
    metricName: 'place_congestion_egr_overflow_max',
    displayName: 'Place EGR Overflow Max',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  place_rudy_utilization_max: {
    metricName: 'place_rudy_utilization_max',
    displayName: 'Place RUDY Utilization Max',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  'rudy utilization max': {
    metricName: 'place_rudy_utilization_max',
    displayName: 'Place RUDY Utilization Max',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  place_lutrudy_utilization_max: {
    metricName: 'place_lutrudy_utilization_max',
    displayName: 'Place LUT-RUDY Utilization Max',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  'lutrudy utilization max': {
    metricName: 'place_lutrudy_utilization_max',
    displayName: 'Place LUT-RUDY Utilization Max',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  buffer_num: {
    metricName: 'cts_buffer_count',
    displayName: 'CTS Buffer Count',
    dimension: 'clock_robustness_dfm',
    polarity: 'lower_is_better',
  },
  buffer_area: {
    metricName: 'cts_buffer_area',
    displayName: 'CTS Buffer Area',
    unit: 'um^2',
    dimension: 'clock_robustness_dfm',
    polarity: 'lower_is_better',
  },
  clock_path_max_buffer: {
    metricName: 'clock_path_max_buffer',
    displayName: 'Clock Path Max Buffer',
    dimension: 'clock_robustness_dfm',
    polarity: 'lower_is_better',
  },
  clock_path_min_buffer: {
    metricName: 'clock_path_min_buffer',
    displayName: 'Clock Path Min Buffer',
    dimension: 'clock_robustness_dfm',
    polarity: 'trend_only',
  },
  total_clock_wirelength: {
    metricName: 'clock_wirelength',
    displayName: 'Clock Wirelength',
    unit: 'um',
    dimension: 'clock_robustness_dfm',
    polarity: 'lower_is_better',
  },
  max_clock_wirelength: {
    metricName: 'cts_clock_wirelength_max',
    displayName: 'CTS Max Clock Wirelength',
    unit: 'um',
    dimension: 'clock_robustness_dfm',
    polarity: 'lower_is_better',
  },
  max_level_of_clock_tree: {
    metricName: 'cts_clock_tree_max_level',
    displayName: 'CTS Clock Tree Max Level',
    dimension: 'clock_robustness_dfm',
    polarity: 'lower_is_better',
  },
  total_movement: {
    metricName: 'legal_total_movement',
    displayName: 'Legal Total Movement',
    unit: 'um',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  wire_len: {
    metricName: 'route_wirelength',
    displayName: 'Route Wirelength',
    unit: 'um',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  num_via: {
    metricName: 'route_via_count',
    displayName: 'Route Via Count',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  route_dr_total_violation_count: {
    metricName: 'route_dr_total_violation_count',
    displayName: 'Route DR Violations',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  total_violation_num: {
    metricName: 'route_dr_total_violation_count',
    displayName: 'Route DR Violations',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  route_dr_total_patch_count: {
    metricName: 'route_dr_total_patch_count',
    displayName: 'Route DR Patches',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  total_patch_num: {
    metricName: 'route_dr_total_patch_count',
    displayName: 'Route DR Patches',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  route_dr_total_wirelength: {
    metricName: 'route_dr_total_wirelength',
    displayName: 'Route DR Wirelength',
    unit: 'um',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  total_wire_length: {
    metricName: 'route_dr_total_wirelength',
    displayName: 'Route DR Wirelength',
    unit: 'um',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  route_dr_total_via_count: {
    metricName: 'route_dr_total_via_count',
    displayName: 'Route DR Via Count',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  total_via_num: {
    metricName: 'route_dr_total_via_count',
    displayName: 'Route DR Via Count',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  route_la_total_overflow: {
    metricName: 'route_la_total_overflow',
    displayName: 'Route LA Overflow',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  total_overflow: {
    metricName: 'route_la_total_overflow',
    displayName: 'Route LA Overflow',
    dimension: 'routability_physical',
    polarity: 'lower_is_better',
  },
  route_la_total_demand: {
    metricName: 'route_la_total_demand',
    displayName: 'Route LA Demand',
    dimension: 'routability_physical',
    polarity: 'trend_only',
  },
  total_demand: {
    metricName: 'route_la_total_demand',
    displayName: 'Route LA Demand',
    dimension: 'routability_physical',
    polarity: 'trend_only',
  },
  drc_num: {
    metricName: 'drc_count',
    displayName: 'DRC Count',
    dimension: 'clock_robustness_dfm',
    polarity: 'lower_is_better',
  },
  rcx_spef_file_count: {
    metricName: 'rcx_spef_file_count',
    displayName: 'RCX SPEF File Count',
    dimension: 'clock_robustness_dfm',
    polarity: 'trend_only',
  },
  spef_file_count: {
    metricName: 'rcx_spef_file_count',
    displayName: 'RCX SPEF File Count',
    dimension: 'clock_robustness_dfm',
    polarity: 'trend_only',
  },
  rcx_expected_corner_count: {
    metricName: 'rcx_expected_corner_count',
    displayName: 'RCX Expected Corner Count',
    dimension: 'clock_robustness_dfm',
    polarity: 'trend_only',
  },
  rcx_missing_corner_count: {
    metricName: 'rcx_missing_corner_count',
    displayName: 'RCX Missing Corner Count',
    dimension: 'clock_robustness_dfm',
    polarity: 'lower_is_better',
  },
  missing_spef_count: {
    metricName: 'rcx_missing_corner_count',
    displayName: 'RCX Missing Corner Count',
    dimension: 'clock_robustness_dfm',
    polarity: 'lower_is_better',
  },
  sta_setup_wns: {
    metricName: 'sta_setup_wns',
    displayName: 'STA Setup WNS',
    unit: 'ns',
    dimension: 'timing',
    polarity: 'higher_is_better',
  },
  max_wns: {
    metricName: 'sta_setup_wns',
    displayName: 'STA Setup WNS',
    unit: 'ns',
    dimension: 'timing',
    polarity: 'higher_is_better',
  },
  sta_setup_tns: {
    metricName: 'sta_setup_tns',
    displayName: 'STA Setup TNS',
    unit: 'ns',
    dimension: 'timing',
    polarity: 'higher_is_better',
  },
  max_tns: {
    metricName: 'sta_setup_tns',
    displayName: 'STA Setup TNS',
    unit: 'ns',
    dimension: 'timing',
    polarity: 'higher_is_better',
  },
  sta_hold_wns: {
    metricName: 'sta_hold_wns',
    displayName: 'STA Hold WNS',
    unit: 'ns',
    dimension: 'timing',
    polarity: 'higher_is_better',
  },
  min_wns: {
    metricName: 'sta_hold_wns',
    displayName: 'STA Hold WNS',
    unit: 'ns',
    dimension: 'timing',
    polarity: 'higher_is_better',
  },
  sta_hold_tns: {
    metricName: 'sta_hold_tns',
    displayName: 'STA Hold TNS',
    unit: 'ns',
    dimension: 'timing',
    polarity: 'higher_is_better',
  },
  min_tns: {
    metricName: 'sta_hold_tns',
    displayName: 'STA Hold TNS',
    unit: 'ns',
    dimension: 'timing',
    polarity: 'higher_is_better',
  },
  sta_frequency_mhz: {
    metricName: 'sta_frequency_mhz',
    displayName: 'STA Frequency',
    unit: 'MHz',
    dimension: 'timing',
    polarity: 'higher_is_better',
  },
  'frequency mhz': {
    metricName: 'sta_frequency_mhz',
    displayName: 'STA Frequency',
    unit: 'MHz',
    dimension: 'timing',
    polarity: 'higher_is_better',
  },
  sta_corner_count: {
    metricName: 'sta_corner_count',
    displayName: 'STA Corner Count',
    dimension: 'timing',
    polarity: 'trend_only',
  },
  sta_expected_corner_count: {
    metricName: 'sta_expected_corner_count',
    displayName: 'STA Expected Corner Count',
    dimension: 'timing',
    polarity: 'trend_only',
  },
  sta_missing_corner_count: {
    metricName: 'sta_missing_corner_count',
    displayName: 'STA Missing Corner Count',
    dimension: 'timing',
    polarity: 'lower_is_better',
  },
  setup_violation_count: {
    metricName: 'sta_setup_violation_count',
    displayName: 'STA Setup Violation Count',
    dimension: 'timing',
    polarity: 'lower_is_better',
  },
  hold_violation_count: {
    metricName: 'sta_hold_violation_count',
    displayName: 'STA Hold Violation Count',
    dimension: 'timing',
    polarity: 'lower_is_better',
  },
  harden_artifact_missing_count: {
    metricName: 'harden_artifact_missing_count',
    displayName: 'Harden Missing Artifact Count',
    dimension: 'clock_robustness_dfm',
    polarity: 'lower_is_better',
  },
}

const DIMENSION_WEIGHTS: Record<QorDimension, number> = {
  timing: 0.35,
  power_integrity: 0.25,
  routability_physical: 0.2,
  area_cost: 0.1,
  clock_robustness_dfm: 0.1,
}

const METRIC_FAIL_VALUES: Record<string, number> = {
  drc_count: 10,
  route_wirelength: 6000,
  route_via_count: 2000,
  cts_buffer_count: 20,
  cts_buffer_area: 40,
  clock_wirelength: 400000,
  cts_clock_wirelength_max: 100000,
  cts_clock_tree_max_level: 20,
  die_area: 3000,
  core_area: 2500,
  core_utilization: 0.85,
  synthesis_cell_area: 3000,
  fanout_max: 100,
  place_hpwl: 10000,
  place_grwl: 12000,
  place_flute_wirelength: 10000,
  place_congestion_egr_overflow_total: 100,
  place_congestion_egr_overflow_max: 20,
  place_rudy_utilization_max: 1,
  place_lutrudy_utilization_max: 1,
  legal_total_movement: 1000,
  route_dr_total_violation_count: 50,
  route_dr_total_patch_count: 100,
  route_dr_total_wirelength: 6000,
  route_dr_total_via_count: 2000,
  route_la_total_overflow: 100,
  rcx_missing_corner_count: 9,
  sta_setup_wns: -0.2,
  sta_setup_tns: -1,
  sta_hold_wns: -0.2,
  sta_hold_tns: -1,
  sta_frequency_mhz: 100,
  sta_setup_violation_count: 1,
  sta_hold_violation_count: 1,
  sta_missing_corner_count: 1,
  harden_artifact_missing_count: 6,
}

const UNSUPPORTED_MODULES: ProjectQorUnsupportedModule[] = [
  {
    id: 'sta_analysis',
    label: 'STA QoR analysis',
    reason:
      'sta_ecc/analysis/sta_metrics.json is not available in the current workspace data.',
    status: '待后续开发',
  },
  {
    id: 'power_ir_em_analysis',
    label: 'Power / IR / EM analysis',
    reason: 'Power, IR, and EM metrics are not generated into step analysis files yet.',
    status: '待后续开发',
  },
  {
    id: 'qor_metrics_standard_output',
    label: 'Standard qor_metrics.json',
    reason:
      'Current ECC workspaces provide legacy *_metrics.json files; standard QoR output is not generated yet.',
    status: '待后续开发',
  },
  {
    id: 'qor_summary_standard_output',
    label: 'Standard qor_summary.json',
    reason:
      'Step-level QoR summary, risk summary, missing metrics, and blocking issue output is not generated yet.',
    status: '待后续开发',
  },
  {
    id: 'qor_hotspots',
    label: 'Spatial hotspot QoR data',
    reason: 'qor_hotspots.json is not generated by analysis modules yet.',
    status: '待后续开发',
  },
  {
    id: 'project_qor_cache',
    label: 'Project-level QoR cache',
    reason:
      'First version computes from loaded workspace analysis snapshots without a persistent cache.',
    status: '待后续开发',
  },
]

export function normalizeLegacyStepMetrics(
  input: LegacyStepMetricInput,
): ProjectQorMetricRecord[] {
  const record = parseJsonObject(input.text)
  if (!record) return []

  const standardRecords = normalizeStandardQorMetrics(record, input)
  if (standardRecords.length > 0) return standardRecords

  return Object.entries(record).flatMap(([rawKey, rawValue]) => {
    if (rawKey.trim().toLowerCase() === 'tool') return []

    const value = flexibleNumber(rawValue)
    if (value === null) return []

    const mapping = legacyMetricMapping(rawKey)
    if (!mapping) return []

    return [
      {
        workspaceId: input.workspaceId,
        workspacePath: input.workspacePath,
        step: input.step,
        metricName: mapping.metricName,
        displayName: mapping.displayName,
        value,
        unit: mapping.unit,
        dimension: mapping.dimension,
        polarity: mapping.polarity,
        sourceFile: input.sourceFile,
        confidence: 'high',
      },
    ]
  })
}

function normalizeStandardQorMetrics(
  record: Record<string, unknown>,
  input: LegacyStepMetricInput,
): ProjectQorMetricRecord[] {
  if (!Array.isArray(record.metrics)) return []

  return record.metrics.flatMap((rawMetric) => {
    if (!rawMetric || typeof rawMetric !== 'object' || Array.isArray(rawMetric)) {
      return []
    }

    const metric = rawMetric as Record<string, unknown>
    const metricName = stringValue(metric.name)
    const value = flexibleNumber(metric.value)
    const dimension = qorDimensionValue(metric.dimension)
    const polarity = qorPolarityValue(metric.polarity)
    if (!metricName || value === null || !dimension || !polarity) return []

    const unit = stringValue(metric.unit)
    const sourceFile = stringValue(metric.source_file) ?? input.sourceFile

    return [
      {
        workspaceId: input.workspaceId,
        workspacePath: input.workspacePath,
        step: input.step,
        metricName,
        displayName:
          stringValue(metric.display_name) ?? displayNameFromMetricName(metricName),
        value,
        unit: unit || undefined,
        dimension,
        polarity,
        sourceFile,
        confidence: qorConfidenceValue(metric.confidence),
      },
    ]
  })
}

export function buildProjectQorTrendSummary(
  workspaces: ProjectQorWorkspaceInput[],
  options: ProjectQorTrendOptions = {},
): ProjectQorTrendSummary {
  const sortedInputs = [...workspaces].sort(compareWorkspaceInput)
  const workspaceSummaries = sortedInputs.map(buildWorkspaceSummary)
  const baselineWorkspace = resolveExplicitBaselineWorkspace(
    workspaceSummaries,
    options.baselineWorkspaceId,
  )
  const { regressions, improvements } = buildWorkspaceDeltas(
    workspaceSummaries,
    baselineWorkspace?.workspaceId ?? null,
  )
  const risks = buildProjectQorRisks(workspaceSummaries)

  return {
    workspaces: workspaceSummaries,
    trendPoints: workspaceSummaries.map((workspace) => ({
      workspaceId: workspace.workspaceId,
      label: workspace.workspaceName || workspace.workspaceId,
      score: workspace.overallScore,
      status: workspace.status,
    })),
    baselineWorkspaceId: baselineWorkspace?.workspaceId ?? null,
    baselineLabel: baselineWorkspace
      ? baselineWorkspace.workspaceName || baselineWorkspace.workspaceId
      : 'Sequential workspace baseline',
    regressions,
    improvements,
    risks,
    unsupportedModules: buildUnsupportedModules(sortedInputs, workspaceSummaries),
  }
}

export function buildProjectQorTrendReport(
  summary: ProjectQorTrendSummary,
  metadata: ProjectQorTrendReportMetadata = {},
) {
  return {
    schema_version: 1,
    generated_at: metadata.generatedAt ?? new Date().toISOString(),
    project: {
      id: metadata.projectId ?? '',
      name: metadata.projectName ?? '',
      path: metadata.projectPath ?? '',
    },
    baseline_workspace_id: summary.baselineWorkspaceId,
    baseline_label: summary.baselineLabel,
    trend_points: summary.trendPoints.map((point) => ({
      workspace_id: point.workspaceId,
      label: point.label,
      score: point.score,
      status: point.status,
    })),
    workspaces: summary.workspaces.map((workspace) => ({
      workspace_id: workspace.workspaceId,
      workspace_name: workspace.workspaceName,
      workspace_path: workspace.workspacePath,
      status: workspace.status,
      overall_score: workspace.overallScore,
      hard_gate_cap: workspace.hardGateCap,
      dimension_scores: workspace.dimensionScores,
      record_count: workspace.records.length,
      records: workspace.records.map((record) => ({
        step: record.step,
        metric_name: record.metricName,
        display_name: record.displayName,
        value: record.value,
        unit: record.unit ?? '',
        dimension: record.dimension,
        polarity: record.polarity,
        source_file: record.sourceFile,
        confidence: record.confidence,
      })),
      blocking_issues: workspace.blockingIssues.map((issue) => ({
        step: issue.step,
        metric: issue.metric,
        display_name: issue.displayName,
        value: issue.value,
        reason: issue.reason,
      })),
      hotspots: workspace.hotspots.map((hotspot) => ({
        step: hotspot.step,
        kind: hotspot.kind,
        severity: hotspot.severity,
        metric: hotspot.metric,
        display_name: hotspot.displayName,
        value: hotspot.value,
        source_file: hotspot.sourceFile,
        description: hotspot.description,
      })),
      missing_analysis_steps: workspace.missingAnalysisSteps,
      missing_metrics: workspace.missingMetrics,
    })),
    regressions: summary.regressions.map((regression) => ({
      workspace_id: regression.workspaceId,
      workspace_name: regression.workspaceName,
      baseline_workspace_id: regression.baselineWorkspaceId,
      baseline_workspace_name: regression.baselineWorkspaceName,
      metric_name: regression.metricName,
      display_name: regression.displayName,
      current_value: regression.currentValue,
      baseline_value: regression.baselineValue,
      absolute_delta: regression.absoluteDelta,
      relative_delta_pct: regression.relativeDeltaPct,
      state: regression.state,
      priority: regression.priority,
      message: regression.message,
    })),
    improvements: summary.improvements.map((improvement) => ({
      workspace_id: improvement.workspaceId,
      workspace_name: improvement.workspaceName,
      baseline_workspace_id: improvement.baselineWorkspaceId,
      baseline_workspace_name: improvement.baselineWorkspaceName,
      metric_name: improvement.metricName,
      display_name: improvement.displayName,
      current_value: improvement.currentValue,
      baseline_value: improvement.baselineValue,
      absolute_delta: improvement.absoluteDelta,
      relative_delta_pct: improvement.relativeDeltaPct,
      state: improvement.state,
    })),
    risks: summary.risks.map((risk) => ({
      workspace_id: risk.workspaceId,
      workspace_name: risk.workspaceName,
      step: risk.step,
      kind: risk.kind,
      severity: risk.severity,
      metric: risk.metric,
      display_name: risk.displayName,
      value: risk.value,
      message: risk.message,
    })),
    unsupported_modules: summary.unsupportedModules.map((module) => ({
      id: module.id,
      label: module.label,
      reason: module.reason,
      status: module.status,
    })),
  }
}

export function serializeProjectQorTrendReport(
  summary: ProjectQorTrendSummary,
  metadata: ProjectQorTrendReportMetadata = {},
): string {
  return `${JSON.stringify(buildProjectQorTrendReport(summary, metadata), null, 2)}\n`
}

function buildUnsupportedModules(
  inputs: ProjectQorWorkspaceInput[],
  workspaces: ProjectQorTrendWorkspaceSummary[],
): ProjectQorUnsupportedModule[] {
  const hasStandardQorMetrics = inputs.some((workspace) =>
    Object.values(workspace.stepMetricTexts).some(hasStandardQorMetricsText),
  )
  const hasStandardQorSummary = inputs.some((workspace) =>
    Object.values(workspace.stepSummaryTexts ?? {}).some(hasStandardQorSummaryText),
  )
  const hasStandardQorHotspots = inputs.some((workspace) =>
    Object.values(workspace.stepHotspotTexts ?? {}).some(hasStandardQorHotspotText),
  )
  const records = workspaces.flatMap((workspace) => workspace.records)
  const hasStaAnalysis = records.some((record) => record.step === 'STA')
  const hasPowerIntegrityAnalysis = records.some(
    (record) => record.dimension === 'power_integrity',
  )

  return UNSUPPORTED_MODULES.filter((module) => {
    if (module.id === 'qor_metrics_standard_output' && hasStandardQorMetrics) {
      return false
    }
    if (module.id === 'qor_summary_standard_output' && hasStandardQorSummary) {
      return false
    }
    if (module.id === 'qor_hotspots' && hasStandardQorHotspots) {
      return false
    }
    if (module.id === 'sta_analysis' && hasStaAnalysis) return false
    if (module.id === 'power_ir_em_analysis' && hasPowerIntegrityAnalysis) return false
    return true
  }).map((module) => ({ ...module }))
}

function resolveExplicitBaselineWorkspace(
  workspaces: ProjectQorTrendWorkspaceSummary[],
  baselineWorkspaceId: string | null | undefined,
): ProjectQorTrendWorkspaceSummary | null {
  if (!baselineWorkspaceId) return null
  return (
    workspaces.find((workspace) => workspace.workspaceId === baselineWorkspaceId) ?? null
  )
}

function buildWorkspaceSummary(
  workspace: ProjectQorWorkspaceInput,
): ProjectQorTrendWorkspaceSummary {
  const records = QOR_FLOW_STEPS.flatMap((step) =>
    normalizeLegacyStepMetrics({
      workspaceId: workspace.workspaceId,
      workspacePath: workspace.workspacePath,
      step,
      sourceFile: STEP_ANALYSIS_SOURCE_FILES[step],
      text: workspace.stepMetricTexts[step],
    }),
  )
  const missingAnalysisSteps = QOR_FLOW_STEPS.filter(
    (step) => !workspace.stepMetricTexts[step],
  )
  const blockingIssues = QOR_FLOW_STEPS.flatMap((step) =>
    normalizeQorSummaryBlockingIssues(step, workspace.stepSummaryTexts?.[step]),
  )
  const summaryMissingMetrics = QOR_FLOW_STEPS.flatMap((step) =>
    normalizeQorSummaryMissingMetrics(workspace.stepSummaryTexts?.[step]),
  )
  const hotspots = QOR_FLOW_STEPS.flatMap((step) =>
    normalizeQorHotspots(step, workspace.stepHotspotTexts?.[step]),
  )
  const hardGateCap = hasDrcViolation(records) || blockingIssues.length > 0 ? 60 : 100
  const dimensionScores = buildDimensionScores(records)
  const weightedScore = weightedOverallScore(dimensionScores)
  const overallScore =
    weightedScore === null ? null : roundScore(Math.min(weightedScore, hardGateCap))

  return {
    workspaceId: workspace.workspaceId,
    workspaceName: workspace.workspaceName,
    workspacePath: workspace.workspacePath,
    status: workspaceStatus(workspace.status, overallScore, hardGateCap),
    overallScore,
    hardGateCap,
    dimensionScores,
    records,
    blockingIssues,
    hotspots,
    missingAnalysisSteps,
    missingMetrics: uniqueStrings([
      ...buildMissingMetrics(records),
      ...summaryMissingMetrics,
    ]),
  }
}

function buildProjectQorRisks(
  workspaces: ProjectQorTrendWorkspaceSummary[],
): ProjectQorRisk[] {
  return workspaces
    .flatMap((workspace) => [
      ...workspace.blockingIssues.map((issue) => ({
        workspaceId: workspace.workspaceId,
        workspaceName: workspace.workspaceName,
        step: issue.step,
        kind: 'blocking_issue' as const,
        severity: 'critical' as const,
        metric: issue.metric,
        displayName: issue.displayName,
        value: issue.value,
        message: issue.reason,
      })),
      ...workspace.hotspots.map((hotspot) => ({
        workspaceId: workspace.workspaceId,
        workspaceName: workspace.workspaceName,
        step: hotspot.step,
        kind: 'hotspot' as const,
        severity: hotspot.severity,
        metric: hotspot.metric,
        displayName: hotspot.displayName,
        value: hotspot.value,
        message: hotspot.description,
      })),
    ])
    .sort(compareProjectQorRisk)
}

function buildDimensionScores(
  records: ProjectQorMetricRecord[],
): Partial<Record<QorDimension, number>> {
  const scoredByDimension = new Map<QorDimension, number[]>()

  for (const record of records) {
    const score = scoreRecord(record)
    if (score === null) continue

    const scores = scoredByDimension.get(record.dimension) ?? []
    scores.push(score)
    scoredByDimension.set(record.dimension, scores)
  }

  const entries = Array.from(scoredByDimension.entries()).map(([dimension, scores]) => [
    dimension,
    roundScore(average(scores)),
  ])
  return Object.fromEntries(entries)
}

function weightedOverallScore(
  dimensionScores: Partial<Record<QorDimension, number>>,
): number | null {
  let weightedTotal = 0
  let usedWeight = 0

  for (const [dimension, score] of Object.entries(dimensionScores) as Array<
    [QorDimension, number | undefined]
  >) {
    if (score === undefined) continue
    const weight = DIMENSION_WEIGHTS[dimension]
    if (weight <= 0) continue
    weightedTotal += score * weight
    usedWeight += weight
  }

  if (usedWeight === 0) return null
  return weightedTotal / usedWeight
}

function scoreRecord(record: ProjectQorMetricRecord): number | null {
  if (record.value === null || record.polarity === 'trend_only') return null

  if (
    record.metricName === 'sta_setup_wns' ||
    record.metricName === 'sta_setup_tns' ||
    record.metricName === 'sta_hold_wns' ||
    record.metricName === 'sta_hold_tns'
  ) {
    const failValue = METRIC_FAIL_VALUES[record.metricName]
    if (failValue === undefined || failValue >= 0) return null
    if (record.value >= 0) return 100
    return clampScore((100 * (record.value - failValue)) / -failValue)
  }

  if (record.polarity === 'target_range') {
    if (record.metricName === 'core_utilization') {
      return scoreTargetRange(
        record.value,
        0.45,
        0.7,
        METRIC_FAIL_VALUES.core_utilization,
      )
    }
    return null
  }

  const failValue = METRIC_FAIL_VALUES[record.metricName]
  if (!failValue || failValue <= 0) return null

  if (record.polarity === 'lower_is_better') {
    return clampScore((100 * (failValue - record.value)) / failValue)
  }

  if (record.polarity === 'higher_is_better') {
    return clampScore((100 * record.value) / failValue)
  }

  return null
}

function scoreTargetRange(
  value: number,
  minTarget: number,
  maxTarget: number,
  failValue: number,
): number {
  if (value >= minTarget && value <= maxTarget) return 100
  if (value < minTarget) return clampScore((100 * value) / minTarget)
  return clampScore((100 * (failValue - value)) / (failValue - maxTarget))
}

function buildWorkspaceDeltas(
  workspaces: ProjectQorTrendWorkspaceSummary[],
  baselineWorkspaceId: string | null,
): {
  regressions: ProjectQorRegression[]
  improvements: ProjectQorDelta[]
} {
  const baselineWorkspace = baselineWorkspaceId
    ? (workspaces.find((workspace) => workspace.workspaceId === baselineWorkspaceId) ??
      null)
    : null
  if (baselineWorkspace) {
    return buildExplicitBaselineDeltas(workspaces, baselineWorkspace)
  }

  const regressions: ProjectQorRegression[] = []
  const improvements: ProjectQorDelta[] = []
  const previousRecordsByMetric = new Map<string, ProjectQorMetricRecord>()
  const workspaceNamesById = new Map(
    workspaces.map((workspace) => [
      workspace.workspaceId,
      workspace.workspaceName || workspace.workspaceId,
    ]),
  )

  for (const workspace of workspaces) {
    const currentRecordsByMetric = new Map<string, ProjectQorMetricRecord>()
    for (const record of workspace.records) {
      if (record.value === null) continue
      currentRecordsByMetric.set(record.metricName, record)
    }

    for (const record of currentRecordsByMetric.values()) {
      const baseline = previousRecordsByMetric.get(record.metricName)
      if (baseline?.value !== null && baseline?.value !== undefined) {
        const delta = buildDelta(
          record,
          baseline,
          workspace.workspaceName || workspace.workspaceId,
          workspaceNamesById.get(baseline.workspaceId) ?? baseline.workspaceId,
        )
        if (delta.state === 'improvement') {
          improvements.push(delta)
        } else if (delta.state === 'regression') {
          regressions.push({
            ...delta,
            priority: regressionPriority(delta),
            message: regressionMessage(delta),
          })
        }
      }
    }

    for (const record of currentRecordsByMetric.values()) {
      previousRecordsByMetric.set(record.metricName, record)
    }
  }

  return {
    regressions: regressions.sort(compareRegressionPriority),
    improvements: improvements.sort(compareDeltaMagnitude),
  }
}

function buildExplicitBaselineDeltas(
  workspaces: ProjectQorTrendWorkspaceSummary[],
  baselineWorkspace: ProjectQorTrendWorkspaceSummary,
): {
  regressions: ProjectQorRegression[]
  improvements: ProjectQorDelta[]
} {
  const regressions: ProjectQorRegression[] = []
  const improvements: ProjectQorDelta[] = []
  const baselineRecordsByMetric = recordsByMetric(baselineWorkspace.records)

  for (const workspace of workspaces) {
    if (workspace.workspaceId === baselineWorkspace.workspaceId) continue

    for (const record of recordsByMetric(workspace.records).values()) {
      const baseline = baselineRecordsByMetric.get(record.metricName)
      if (baseline?.value === null || baseline?.value === undefined) continue

      const delta = buildDelta(
        record,
        baseline,
        workspace.workspaceName || workspace.workspaceId,
        baselineWorkspace.workspaceName || baselineWorkspace.workspaceId,
      )
      if (delta.state === 'improvement') {
        improvements.push(delta)
      } else if (delta.state === 'regression') {
        regressions.push({
          ...delta,
          priority: regressionPriority(delta),
          message: regressionMessage(delta),
        })
      }
    }
  }

  return {
    regressions: regressions.sort(compareRegressionPriority),
    improvements: improvements.sort(compareDeltaMagnitude),
  }
}

function recordsByMetric(
  records: ProjectQorMetricRecord[],
): Map<string, ProjectQorMetricRecord> {
  const recordsByMetric = new Map<string, ProjectQorMetricRecord>()
  for (const record of records) {
    if (record.value === null) continue
    recordsByMetric.set(record.metricName, record)
  }
  return recordsByMetric
}

function buildDelta(
  record: ProjectQorMetricRecord,
  baseline: ProjectQorMetricRecord,
  workspaceName: string,
  baselineWorkspaceName: string,
): ProjectQorDelta {
  const absoluteDelta = roundMetric((record.value ?? 0) - (baseline.value ?? 0))
  const baselineValue = baseline.value ?? 0
  const relativeDeltaPct =
    baselineValue === 0
      ? null
      : roundMetric((absoluteDelta / Math.abs(baselineValue)) * 100)

  return {
    workspaceId: record.workspaceId,
    workspaceName,
    baselineWorkspaceId: baseline.workspaceId,
    baselineWorkspaceName,
    metricName: record.metricName,
    displayName: record.displayName,
    currentValue: record.value ?? 0,
    baselineValue,
    absoluteDelta,
    relativeDeltaPct,
    state: deltaState(record, absoluteDelta),
  }
}

function deltaState(
  record: ProjectQorMetricRecord,
  absoluteDelta: number,
): ProjectQorDelta['state'] {
  if (record.polarity === 'trend_only' || absoluteDelta === 0) return 'neutral'
  if (record.polarity === 'lower_is_better') {
    return absoluteDelta < 0 ? 'improvement' : 'regression'
  }
  if (record.polarity === 'higher_is_better') {
    return absoluteDelta > 0 ? 'improvement' : 'regression'
  }
  return 'neutral'
}

function regressionPriority(delta: ProjectQorDelta): ProjectQorRegression['priority'] {
  if (
    delta.metricName === 'drc_count' &&
    delta.baselineValue === 0 &&
    delta.currentValue > 0
  ) {
    return 'P0'
  }

  if (
    (delta.metricName === 'route_wirelength' || delta.metricName === 'route_via_count') &&
    (delta.relativeDeltaPct ?? 0) > 10
  ) {
    return 'P2'
  }

  return 'P3'
}

function regressionMessage(delta: ProjectQorDelta): string {
  const unit = delta.relativeDeltaPct === null ? '' : ` (${delta.relativeDeltaPct}%)`
  return `${delta.displayName} regressed by ${delta.absoluteDelta}${unit}`
}

function buildMissingMetrics(records: ProjectQorMetricRecord[]): string[] {
  const available = new Set(records.map((record) => record.metricName))
  const expected = [
    'route_wirelength',
    'route_via_count',
    'drc_count',
    'cts_buffer_count',
    'cts_buffer_area',
    'die_area',
    'core_utilization',
  ]
  return expected.filter((metric) => !available.has(metric))
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values))
}

function hasDrcViolation(records: ProjectQorMetricRecord[]): boolean {
  return records.some(
    (record) => record.metricName === 'drc_count' && (record.value ?? 0) > 0,
  )
}

function workspaceStatus(
  workspaceStatus: ProjectWorkspaceStatus,
  score: number | null,
  hardGateCap: number,
): QorStatus {
  if (
    workspaceStatus === 'failed' ||
    workspaceStatus === 'running' ||
    workspaceStatus === 'in_progress' ||
    workspaceStatus === 'not_started'
  ) {
    return workspaceStatus === 'failed' ? 'Red' : 'Blocked'
  }
  if (hardGateCap < 100) return 'Orange'
  if (score === null) return 'Blocked'
  if (score >= 40) return 'Green'
  if (score >= 25) return 'Yellow'
  if (score >= 10) return 'Orange'
  return 'Red'
}

function parseJsonObject(
  text: string | null | undefined,
): Record<string, unknown> | null {
  if (!text) return null
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function hasStandardQorMetricsText(text: string | null | undefined): boolean {
  const record = parseJsonObject(text)
  return Array.isArray(record?.metrics)
}

function hasStandardQorSummaryText(text: string | null | undefined): boolean {
  const record = parseJsonObject(text)
  return (
    record?.schema_version === 1 &&
    (typeof record.metric_count === 'number' ||
      Array.isArray(record.blocking_issues) ||
      typeof record.status === 'string')
  )
}

function hasStandardQorHotspotText(text: string | null | undefined): boolean {
  const record = parseJsonObject(text)
  return record?.schema_version === 1 && Array.isArray(record.hotspots)
}

function normalizeQorSummaryBlockingIssues(
  step: FlowStep,
  text: string | null | undefined,
): ProjectQorBlockingIssue[] {
  const record = parseJsonObject(text)
  if (record?.schema_version !== 1 || !Array.isArray(record.blocking_issues)) {
    return []
  }

  return record.blocking_issues.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const issue = item as Record<string, unknown>
    const metric = stringValue(issue.metric)
    if (!metric) return []
    return [
      {
        step,
        metric,
        displayName: stringValue(issue.display_name) ?? metric,
        value: qorSummaryIssueValue(issue.value),
        reason: stringValue(issue.reason) ?? 'QoR blocking issue',
      },
    ]
  })
}

function normalizeQorSummaryMissingMetrics(
  text: string | null | undefined,
): string[] {
  const record = parseJsonObject(text)
  if (record?.schema_version !== 1 || !Array.isArray(record.missing_metrics)) {
    return []
  }

  return uniqueStrings(
    record.missing_metrics.flatMap((metric) => {
      const value = stringValue(metric)
      return value ? [value] : []
    }),
  )
}

function normalizeQorHotspots(
  step: FlowStep,
  text: string | null | undefined,
): ProjectQorHotspot[] {
  const record = parseJsonObject(text)
  if (record?.schema_version !== 1 || !Array.isArray(record.hotspots)) {
    return []
  }

  return record.hotspots.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const hotspot = item as Record<string, unknown>
    const metric = stringValue(hotspot.metric)
    if (!metric) return []
    return [
      {
        step,
        kind: stringValue(hotspot.kind) ?? 'hotspot',
        severity: hotspotSeverity(hotspot.severity),
        metric,
        displayName: stringValue(hotspot.display_name) ?? metric,
        value: qorSummaryIssueValue(hotspot.value),
        sourceFile: stringValue(hotspot.source_file) ?? '',
        description: stringValue(hotspot.description) ?? 'QoR hotspot',
      },
    ]
  })
}

function hotspotSeverity(value: unknown): ProjectQorHotspot['severity'] {
  return value === 'critical' || value === 'warning' || value === 'info'
    ? value
    : 'info'
}

function qorSummaryIssueValue(value: unknown): number | string | null {
  const number = flexibleNumber(value)
  if (number !== null) return number
  return stringValue(value)
}

function flexibleNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed || /^n\/?a$/i.test(trimmed)) return null
  const isPercent = trimmed.endsWith('%')
  const normalized = trimmed.replace(/,/g, '').replace(/%$/, '')
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return null
  return isPercent ? parsed / 100 : parsed
}

function stringValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function qorDimensionValue(value: unknown): QorDimension | null {
  const dimension = stringValue(value)
  if (!dimension) return null
  return QOR_DIMENSIONS.includes(dimension as QorDimension)
    ? (dimension as QorDimension)
    : null
}

function qorPolarityValue(value: unknown): QorPolarity | null {
  const polarity = stringValue(value)
  if (!polarity) return null
  return QOR_POLARITIES.includes(polarity as QorPolarity)
    ? (polarity as QorPolarity)
    : null
}

function qorConfidenceValue(value: unknown): QorMetricConfidence {
  const confidence = stringValue(value)
  return QOR_CONFIDENCES.includes(confidence as QorMetricConfidence)
    ? (confidence as QorMetricConfidence)
    : 'high'
}

function displayNameFromMetricName(metricName: string): string {
  return metricName
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function legacyMetricMapping(rawKey: string): LegacyMetricMapping | null {
  return LEGACY_METRIC_MAP[normalizeMetricKey(rawKey)] ?? null
}

function normalizeMetricKey(key: string): string {
  return key
    .replace(/\u03bc/g, 'u')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function compareWorkspaceInput(
  left: ProjectQorWorkspaceInput,
  right: ProjectQorWorkspaceInput,
): number {
  const createdDelta = Date.parse(left.createdAt) - Date.parse(right.createdAt)
  if (createdDelta !== 0 && Number.isFinite(createdDelta)) return createdDelta
  return left.workspaceId.localeCompare(right.workspaceId)
}

function compareRegressionPriority(
  left: ProjectQorRegression,
  right: ProjectQorRegression,
): number {
  const priorityOrder = { P0: 0, P1: 1, P2: 2, P3: 3 }
  const priorityDelta = priorityOrder[left.priority] - priorityOrder[right.priority]
  if (priorityDelta !== 0) return priorityDelta
  return compareDeltaMagnitude(left, right)
}

function compareProjectQorRisk(left: ProjectQorRisk, right: ProjectQorRisk): number {
  const severityOrder = { critical: 0, warning: 1, info: 2 }
  const severityDelta = severityOrder[left.severity] - severityOrder[right.severity]
  if (severityDelta !== 0) return severityDelta

  const workspaceDelta = left.workspaceName.localeCompare(right.workspaceName)
  if (workspaceDelta !== 0) return workspaceDelta

  return left.step.localeCompare(right.step) || left.metric.localeCompare(right.metric)
}

function compareDeltaMagnitude(left: ProjectQorDelta, right: ProjectQorDelta): number {
  return Math.abs(right.absoluteDelta) - Math.abs(left.absoluteDelta)
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score))
}

function roundScore(score: number): number {
  return Number(score.toFixed(1))
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6))
}
