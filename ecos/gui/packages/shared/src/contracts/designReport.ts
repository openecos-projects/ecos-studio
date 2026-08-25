export type DesignReportFormat = 'latex' | 'markdown' | 'csv' | 'text'

export interface DesignReportWarning {
  code: string
  message: string
  severity: 'warn' | 'error' | 'info'
}

export interface DesignInfo {
  designName: string
  workspaceName: string
  workspacePath: string
  pdk: string
  pdkVersion: string | null
  pdkCommit: string | null
  eccTool: string | null
  eccVersion: string | null
  ecosStudioVersion: string | null
  toolVersions: Record<string, string>
  gitCommit: string | null
  runId: string | null
  timestamp: string
  generatedAt: string
}

export interface PhysicalMetrics {
  dieAreaUm2: number | null
  dieAreaMm2: number | null
  coreAreaUm2: number | null
  coreAreaMm2: number | null
  coreUtilizationPct: number | null
  stdCellAreaUm2: number | null
  macroAreaUm2: number | null
  macroCount: number | null
  instanceCount: number | null
  sequentialCellCount: number | null
  combinationalCellCount: number | null
  ioPinCount: number | null
  netCount: number | null
}

export interface TimingMetrics {
  targetClockPeriodNs: number | null
  targetFrequencyMhz: number | null
  fmaxMhz: number | null
  setupWnsNs: number | null
  setupTnsNs: number | null
  holdWnsNs: number | null
  holdTnsNs: number | null
  violatingEndpointsSetup: number | null
  violatingEndpointsHold: number | null
  slewViolations: number | null
  capViolations: number | null
  fanoutViolations: number | null
  criticalPathDelayNs: number | null
}

export interface CornerTimingRecord {
  corner: string
  processCorner: string | null
  voltageV: number | null
  temperatureC: number | null
  rcCorner: string | null
  setupWnsNs: number | null
  setupTnsNs: number | null
  holdWnsNs: number | null
  holdTnsNs: number | null
  violatingEndpointsSetup: number | null
  violatingEndpointsHold: number | null
  status: 'pass' | 'fail' | 'warn' | 'unknown'
}

export interface ClockMetrics {
  clockSkewPs: number | null
  clockLatencyNs: number | null
  clockWirelengthUm: number | null
  clockMaxWirelengthUm: number | null
  clockBufferCount: number | null
  clockInverterCount: number | null
  clockTotalBuffers: number | null
  clockBufferAreaUm2: number | null
  clockPathMaxBuffer: number | null
  clockPathMinBuffer: number | null
  clockNetsCount: number | null
  clockTreeLevels: number | null
  clockCellCount: number | null
}

export interface RoutingMetrics {
  hpwlUm: number | null
  estimatedWirelengthUm: number | null
  routedWirelengthUm: number | null
  viaCount: number | null
  routingCompletionPct: number | null
  routeDrcCount: number | null
}

export interface CongestionMetrics {
  globalOverflowTotal: number | null
  globalOverflowPct: number | null
  maxOverflow: number | null
  horizontalCongestionPct: number | null
  verticalCongestionPct: number | null
  hotspotsCount: number | null
}

export interface PowerMetrics {
  totalPowerMw: number | null
  dynamicPowerMw: number | null
  switchingPowerMw: number | null
  internalPowerMw: number | null
  leakagePowerMw: number | null
  voltageV: number | null
  temperatureC: number | null
  corner: string | null
  activityMethod: string | null
}

export interface VerificationMetrics {
  drcCount: number | null
  drcStatus: 'clean' | 'violations' | 'unrun'
  lvsStatus: 'matched' | 'mismatch' | 'unrun'
  lvsMismatchCount: number | null
  antennaViolations: number | null
  ercViolations: number | null
  floatingNetsCount: number | null
  unconnectedPinsCount: number | null
}

export interface StageExecutionRecord {
  stage: string
  tool: string
  runtimeSeconds: number | null
  runtimeFormatted: string | null
  peakMemoryMb: number | null
  state: string
}

export interface ExecutionMetrics {
  totalRuntimeSeconds: number | null
  totalRuntimeFormatted: string | null
  peakMemoryMb: number | null
  stages: StageExecutionRecord[]
}

export interface EvidenceProvenanceRecord {
  category: string
  metric: string
  value: string | number | boolean | null
  unit: string
  status: string
  stage: string
  corner: string | null
  tool: string
  sourceMetricId: string
  runId: string
  timestamp: string
}

export interface DesignReportData {
  design: DesignInfo
  physical: PhysicalMetrics
  timing: TimingMetrics
  multiCornerTiming: CornerTimingRecord[]
  clock: ClockMetrics
  routing: RoutingMetrics
  congestion: CongestionMetrics
  power: PowerMetrics
  verification: VerificationMetrics
  execution: ExecutionMetrics
  provenance: EvidenceProvenanceRecord[]
  warnings: DesignReportWarning[]
}

export interface DesignReportExportOptions {
  includeMultiCorner?: boolean
  includeStageBreakdown?: boolean
  includeVerificationBreakdown?: boolean
  includeProvenance?: boolean
  latexStandalone?: boolean
  latexUseBooktabs?: boolean
  latexUseSiunitx?: boolean
  title?: string
}
