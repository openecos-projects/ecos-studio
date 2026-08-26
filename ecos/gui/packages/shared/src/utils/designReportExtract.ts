import type {
  ClockMetrics,
  CongestionMetrics,
  CornerTimingRecord,
  DesignInfo,
  DesignReportData,
  DesignReportWarning,
  EvidenceProvenanceRecord,
  ExecutionMetrics,
  PhysicalMetrics,
  PowerMetrics,
  RoutingMetrics,
  StageExecutionRecord,
  TimingMetrics,
  VerificationMetrics,
} from '../contracts/designReport.ts'

export interface ExtractDesignReportInput {
  workspacePath?: string
  workspaceName?: string
  designName?: string
  topModule?: string
  pdk?: string
  pdkVersion?: string | null
  frequencyTarget?: number
  parameters?: Record<string, unknown> | null
  flow?: Record<string, unknown> | null
  homeData?: Record<string, unknown> | null
  stepMetrics?: Record<string, unknown> | null
  stepSummaries?: Record<string, unknown> | null
  stepHotspots?: Record<string, unknown> | null
  staTimingIssues?: Record<string, unknown> | null
  staCornerReports?: Record<string, Record<string, unknown>> | null
  versionInfo?: {
    gui?: string
    runtime?: string
    ecc?: string
    dreamplace?: string
    eccTools?: string
  } | null
  generatedAt?: string
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

function parseJsonSafely(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      if (isRecord(parsed)) return parsed
    } catch {
      return null
    }
  }
  return null
}

export function parseRuntimeSeconds(
  runtime: string | number | null | undefined,
): number | null {
  if (typeof runtime === 'number' && Number.isFinite(runtime)) return runtime
  if (typeof runtime !== 'string' || !runtime.trim()) return null
  const parts = runtime.split(':').map((p) => Number(p.trim()))
  if (parts.some((p) => !Number.isFinite(p))) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 1) return parts[0]
  return null
}

export function formatDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null
  const total = Math.round(seconds)
  const hrs = Math.floor(total / 3600)
  const mins = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hrs > 0) {
    return `${hrs}h ${mins}m ${secs}s`
  }
  if (mins > 0) {
    return `${mins}m ${secs}s`
  }
  return `${secs}s`
}

const STAGE_CANONICAL_NAMES: Record<string, string> = {
  synthesis: 'Synth',
  synth: 'Synth',
  synthesis_yosys: 'Synth',
  yosys: 'Synth',
  floorplan: 'Floor',
  floor: 'Floor',
  floorplan_ecc: 'Floor',
  macro_placement: 'Floor',
  fixfanout: 'Fanout',
  fixfanout_ecc: 'Fanout',
  fanout: 'Fanout',
  placement: 'Place',
  place: 'Place',
  place_dreamplace: 'Place',
  dreamplace: 'Place',
  global_placement: 'Place',
  detailed_placement: 'Place',
  cts: 'CTS',
  cts_ecc: 'CTS',
  legalization: 'Legal',
  legal: 'Legal',
  legalization_dreamplace: 'Legal',
  routing: 'Route',
  route: 'Route',
  route_ecc: 'Route',
  global_route: 'Route',
  detail_route: 'Route',
  drc: 'DRC',
  drc_ecc: 'DRC',
  lvs: 'LVS',
  lvs_ecc: 'LVS',
  filler: 'Filler',
  filler_ecc: 'Filler',
  rcx: 'RCX',
  rcx_ecc: 'RCX',
  sta: 'STA',
  sta_ecc: 'STA',
  sta_signoff: 'STA',
  signoff: 'STA',
  post_route_sta: 'STA',
  sta_corner: 'STA',
  power: 'Power',
  power_ecc: 'Power',
  sta_power: 'Power',
  harden: 'Harden',
  harden_ecc: 'Harden',
}

export function canonicalizeStageName(name: string): string {
  const normalized = name.trim().toLowerCase()
  return STAGE_CANONICAL_NAMES[normalized] || name.trim()
}

export interface ParsedPowerMetrics {
  totalPowerMw: number | null
  dynamicPowerMw: number | null
  leakagePowerMw: number | null
  internalPowerMw: number | null
  switchingPowerMw: number | null
  voltageV: number | null
}

function convertUnitToMw(val: number, unitStr: string): number {
  if (!Number.isFinite(val)) return 0
  const u = unitStr.toLowerCase()
  if (u === 'w') return val * 1000
  if (u === 'mw') return val
  if (u === 'uw' || u === 'µw') return val / 1000
  if (u === 'nw') return val / 1e6
  if (u === 'pw') return val / 1e9
  return val
}

export function parsePowerRpt(text: string | null | undefined): ParsedPowerMetrics {
  if (!text) {
    return {
      totalPowerMw: null,
      dynamicPowerMw: null,
      leakagePowerMw: null,
      internalPowerMw: null,
      switchingPowerMw: null,
      voltageV: null,
    }
  }

  let totalPowerMw: number | null = null
  let dynamicPowerMw: number | null = null
  let leakagePowerMw: number | null = null
  let internalPowerMw: number | null = null
  let switchingPowerMw: number | null = null
  let voltageV: number | null = null

  const voltMatch = text.match(/Global Operating Voltage\s*=\s*([\d.]+)/i)
  if (voltMatch) voltageV = Number(voltMatch[1])

  const intMatch = text.match(/Cell Internal Power\s*=\s*([\d.e+-]+)\s*([uUnNmMgk]?W)/i)
  if (intMatch) internalPowerMw = convertUnitToMw(Number(intMatch[1]), intMatch[2])

  const swMatch = text.match(/Net Switching Power\s*=\s*([\d.e+-]+)\s*([uUnNmMgk]?W)/i)
  if (swMatch) switchingPowerMw = convertUnitToMw(Number(swMatch[1]), swMatch[2])

  const dynMatch = text.match(/Total Dynamic Power\s*=\s*([\d.e+-]+)\s*([uUnNmMgk]?W)/i)
  if (dynMatch) dynamicPowerMw = convertUnitToMw(Number(dynMatch[1]), dynMatch[2])

  const leakMatch = text.match(/Cell Leakage Power\s*=\s*([\d.e+-]+)\s*([uUnNmMgk]?W)/i)
  if (leakMatch) leakagePowerMw = convertUnitToMw(Number(leakMatch[1]), leakMatch[2])

  const totalMatch = text.match(
    /Total\s+[\d.e+-]+\s*[a-zA-Z]+\s+[\d.e+-]+\s*[a-zA-Z]+\s+[\d.e+-]+\s*[a-zA-Z]+\s+([\d.e+-]+)\s*([uUnNmMgk]?W)/i,
  )
  if (totalMatch) {
    totalPowerMw = convertUnitToMw(Number(totalMatch[1]), totalMatch[2])
  } else if (dynamicPowerMw !== null || leakagePowerMw !== null) {
    totalPowerMw = +((dynamicPowerMw ?? 0) + (leakagePowerMw ?? 0)).toFixed(4)
  }

  return {
    totalPowerMw,
    dynamicPowerMw,
    leakagePowerMw,
    internalPowerMw,
    switchingPowerMw,
    voltageV,
  }
}

export interface ParsedQorSummaryMetrics {
  wns: number | null
  tns: number | null
  nvp: number | null
  frequencyMhz: number | null
  holdWns: number | null
  holdTns: number | null
  holdNvp: number | null
}

export function parseQorSummaryRpt(
  text: string | null | undefined,
): ParsedQorSummaryMetrics {
  if (!text) {
    return {
      wns: null,
      tns: null,
      nvp: null,
      frequencyMhz: null,
      holdWns: null,
      holdTns: null,
      holdNvp: null,
    }
  }

  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('Summary') || trimmed.startsWith('clk')) {
      const parts = trimmed.split(/\s+/)
      if (parts.length >= 8) {
        const wns = Number(parts[1])
        const tns = Number(parts[2])
        const nvp = Number(parts[3])
        const freqStr = parts[4].replace(/mhz/i, '')
        const freq = Number(freqStr)
        const holdWns = Number(parts[5])
        const holdTns = Number(parts[6])
        const holdNvp = Number(parts[7])
        return {
          wns: Number.isFinite(wns) ? wns : null,
          tns: Number.isFinite(tns) ? tns : null,
          nvp: Number.isFinite(nvp) ? nvp : null,
          frequencyMhz: Number.isFinite(freq) ? freq : null,
          holdWns: Number.isFinite(holdWns) ? holdWns : null,
          holdTns: Number.isFinite(holdTns) ? holdTns : null,
          holdNvp: Number.isFinite(holdNvp) ? holdNvp : null,
        }
      }
    }
  }
  return {
    wns: null,
    tns: null,
    nvp: null,
    frequencyMhz: null,
    holdWns: null,
    holdTns: null,
    holdNvp: null,
  }
}

interface RawMetricFinding {
  value: unknown
  sourceKey: string
  stage: string
}

function getNestedValue(obj: Record<string, unknown>, pathStr: string): unknown {
  const parts = pathStr.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (!isRecord(current)) return undefined
    if (part in current && current[part] !== undefined) {
      current = current[part]
      continue
    }
    const normPart = part.toLowerCase().replace(/[\s_-]/g, '')
    let matched = false
    for (const k of Object.keys(current)) {
      const normK = k.toLowerCase().replace(/[\s_-]/g, '')
      if (normK === normPart) {
        current = current[k]
        matched = true
        break
      }
    }
    if (!matched) return undefined
  }
  return current
}

function findMetricInRecord(
  metricsRecord: Record<string, unknown> | null,
  aliases: string[],
  stageName: string,
): RawMetricFinding | null {
  if (!metricsRecord) return null

  // 1. Schema 3 Array format: metrics: Array<{ id: string, value: unknown, ... }>
  if (Array.isArray(metricsRecord.metrics)) {
    for (const item of metricsRecord.metrics) {
      if (!isRecord(item)) continue
      const id =
        typeof item.id === 'string' ? item.id.toLowerCase().replace(/[\s_-]/g, '') : ''
      const displayName =
        typeof item.display_name === 'string'
          ? item.display_name.toLowerCase().replace(/[\s_-]/g, '')
          : ''
      for (const alias of aliases) {
        const normAlias = alias.toLowerCase().replace(/[\s_-]/g, '')
        if (
          (id === normAlias || displayName === normAlias) &&
          item.value !== undefined &&
          item.value !== null
        ) {
          return {
            value: item.value,
            sourceKey: typeof item.id === 'string' ? item.id : alias,
            stage: stageName,
          }
        }
      }
    }
  }

  // 2. Direct property matches on root
  for (const alias of aliases) {
    if (
      alias in metricsRecord &&
      metricsRecord[alias] !== undefined &&
      metricsRecord[alias] !== null
    ) {
      return {
        value: metricsRecord[alias],
        sourceKey: alias,
        stage: stageName,
      }
    }
  }

  // 3. Hierarchical / dot notation paths (e.g., 'Design Layout.die_area', 'Instances.total.area')
  for (const alias of aliases) {
    if (alias.includes('.')) {
      const nestedVal = getNestedValue(metricsRecord, alias)
      if (nestedVal !== undefined && nestedVal !== null) {
        return {
          value: nestedVal,
          sourceKey: alias,
          stage: stageName,
        }
      }
    }
  }

  // 4. Nested object property search
  for (const key of Object.keys(metricsRecord)) {
    const val = metricsRecord[key]
    if (isRecord(val)) {
      for (const alias of aliases) {
        if (alias in val && val[alias] !== undefined && val[alias] !== null) {
          return {
            value: val[alias],
            sourceKey: `${key}.${alias}`,
            stage: stageName,
          }
        }
      }
    }
  }

  // 5. Case-insensitive / normalized root property search
  for (const alias of aliases) {
    const normAlias = alias.toLowerCase().replace(/[\s_-]/g, '')
    for (const key of Object.keys(metricsRecord)) {
      const normKey = key.toLowerCase().replace(/[\s_-]/g, '')
      if (
        normKey === normAlias &&
        metricsRecord[key] !== undefined &&
        metricsRecord[key] !== null
      ) {
        return {
          value: metricsRecord[key],
          sourceKey: key,
          stage: stageName,
        }
      }
    }
  }

  return null
}

function parseNumber(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) return val
  if (isRecord(val) && 'value' in val) {
    return parseNumber(val.value)
  }
  if (typeof val === 'string' && val.trim() !== '') {
    const cleaned = val.replace(/,/g, '').trim()
    const parsed = Number(cleaned)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

export function extractDesignReportData(
  input: ExtractDesignReportInput,
): DesignReportData {
  const warnings: DesignReportWarning[] = []
  const provenance: EvidenceProvenanceRecord[] = []

  const params = parseJsonSafely(input.parameters) || {}
  const flow = parseJsonSafely(input.flow) || {}
  const home = parseJsonSafely(input.homeData) || {}
  const stepMetrics = input.stepMetrics || {}
  const stepSummaries = input.stepSummaries || {}
  const stepHotspots = input.stepHotspots || {}
  const staTimingIssues = parseJsonSafely(input.staTimingIssues)

  // 1. Extract Design & Tool Metadata
  const designName =
    input.designName ||
    input.topModule ||
    (typeof params.Design === 'string' && params.Design) ||
    (typeof params.DESIGN === 'string' && params.DESIGN) ||
    (typeof params.DESIGN_NAME === 'string' && params.DESIGN_NAME) ||
    (typeof params.top_module === 'string' && params.top_module) ||
    (typeof params.TOP_MODULE === 'string' && params.TOP_MODULE) ||
    (typeof flow.design === 'string' && flow.design) ||
    (typeof home.design === 'string' && home.design) ||
    input.workspaceName ||
    'Unknown_Design'

  const pdk =
    input.pdk ||
    (typeof params.PDK === 'string' && params.PDK) ||
    (typeof params.pdk === 'string' && params.pdk) ||
    (typeof flow.pdk === 'string' && flow.pdk) ||
    (typeof home.pdk === 'string' && home.pdk) ||
    'sky130hd'

  const pdkVersion =
    (typeof params.PDK_VERSION === 'string' && params.PDK_VERSION) ||
    (typeof params.pdk_version === 'string' && params.pdk_version) ||
    (typeof home.pdk_version === 'string' && home.pdk_version) ||
    null

  const pdkCommit =
    (typeof params.PDK_COMMIT === 'string' && params.PDK_COMMIT) ||
    (typeof params.pdk_commit === 'string' && params.pdk_commit) ||
    (typeof params.PDK_GIT_COMMIT === 'string' && params.PDK_GIT_COMMIT) ||
    (typeof params.pdk_git_commit === 'string' && params.pdk_git_commit) ||
    (typeof params.PDK_COMMIT_ID === 'string' && params.PDK_COMMIT_ID) ||
    (typeof params.pdk_commit_id === 'string' && params.pdk_commit_id) ||
    (typeof params.pdkCommit === 'string' && params.pdkCommit) ||
    (typeof home.pdk_commit === 'string' && home.pdk_commit) ||
    (typeof home.pdk_commit_id === 'string' && home.pdk_commit_id) ||
    (typeof home.pdkCommit === 'string' && home.pdkCommit) ||
    (typeof home.pdk_git_commit === 'string' && home.pdk_git_commit) ||
    (typeof home.commit === 'string' && home.commit) ||
    (typeof home.commit_id === 'string' && home.commit_id) ||
    (typeof home.git_commit === 'string' && home.git_commit) ||
    null

  let eccTool: string | null =
    input.versionInfo?.eccTools ||
    (typeof params.ECC_TOOL === 'string' && params.ECC_TOOL) ||
    (typeof params.ecc_tool === 'string' && params.ecc_tool) ||
    (typeof flow.tool === 'string' && flow.tool) ||
    (Array.isArray(flow.steps) &&
      typeof (flow.steps[0] as Record<string, unknown>)?.tool === 'string' &&
      ((flow.steps[0] as Record<string, unknown>).tool as string)) ||
    'ecc'

  if (eccTool === 'unknown') {
    eccTool = 'ecc'
  }

  const rawEccVer =
    input.versionInfo?.ecc ||
    (typeof params.ECC_VERSION === 'string' && params.ECC_VERSION) ||
    (typeof params.ecc_version === 'string' && params.ecc_version) ||
    (typeof home.ecc_version === 'string' && home.ecc_version) ||
    null

  const eccVersion = rawEccVer === 'unknown' ? null : rawEccVer

  const ecosStudioVersion =
    input.versionInfo?.gui ||
    (typeof params.ECOS_STUDIO_VERSION === 'string' && params.ECOS_STUDIO_VERSION) ||
    (typeof params.ecos_studio_version === 'string' && params.ecos_studio_version) ||
    '0.1.0-alpha.9'

  const gitCommit =
    (typeof params.GIT_COMMIT === 'string' && params.GIT_COMMIT) ||
    (typeof params.git_commit === 'string' && params.git_commit) ||
    null

  const runId =
    (typeof params.RUN_ID === 'string' && params.RUN_ID) ||
    (typeof params.run_id === 'string' && params.run_id) ||
    (typeof flow.run_id === 'string' && flow.run_id) ||
    null

  const timestamp =
    (typeof flow.timestamp === 'string' && flow.timestamp) ||
    (typeof params.timestamp === 'string' && params.timestamp) ||
    new Date().toISOString()

  const generatedAt = input.generatedAt || new Date().toISOString()

  // Collect step metric stores across canonical names
  const normalizedStepMetrics: Record<string, Record<string, unknown>> = {}

  for (const [key, value] of Object.entries(stepMetrics)) {
    const canonical = canonicalizeStageName(key)
    const parsed = parseJsonSafely(value)
    if (parsed) {
      normalizedStepMetrics[key] = { ...normalizedStepMetrics[key], ...parsed }
      normalizedStepMetrics[canonical] = {
        ...normalizedStepMetrics[canonical],
        ...parsed,
      }
    }
  }

  for (const [key, value] of Object.entries(stepSummaries)) {
    const canonical = canonicalizeStageName(key)
    const parsed = parseJsonSafely(value)
    if (parsed) {
      normalizedStepMetrics[key] = { ...normalizedStepMetrics[key], ...parsed }
      normalizedStepMetrics[canonical] = {
        ...normalizedStepMetrics[canonical],
        ...parsed,
      }
    }
  }

  for (const [key, value] of Object.entries(stepHotspots)) {
    const canonical = canonicalizeStageName(key)
    const parsed = parseJsonSafely(value)
    if (parsed) {
      normalizedStepMetrics[key] = { ...normalizedStepMetrics[key], ...parsed }
      normalizedStepMetrics[canonical] = {
        ...normalizedStepMetrics[canonical],
        ...parsed,
      }
    }
  }

  if (staTimingIssues) {
    normalizedStepMetrics['STA'] = {
      ...normalizedStepMetrics['STA'],
      ...staTimingIssues,
    }
  }

  if (params && Object.keys(params).length > 0) {
    normalizedStepMetrics['Parameters'] = {
      ...normalizedStepMetrics['Parameters'],
      ...params,
    }
  }

  if (home && Object.keys(home).length > 0) {
    normalizedStepMetrics['Home'] = {
      ...normalizedStepMetrics['Home'],
      ...home,
    }
    normalizedStepMetrics['Parameters'] = {
      ...normalizedStepMetrics['Parameters'],
      ...home,
    }
  }

  // Multi-stage lookup helper with fallback priority
  function queryMetric(
    category: string,
    metricDisplayName: string,
    stagePriority: string[],
    aliases: string[],
    unit = '',
  ): { value: number | null; stage: string; sourceKey: string } {
    for (const stage of stagePriority) {
      const stepData = normalizedStepMetrics[stage]
      if (!stepData) continue

      const finding = findMetricInRecord(stepData, aliases, stage)
      if (finding) {
        const num = parseNumber(finding.value)
        if (num !== null) {
          provenance.push({
            category,
            metric: metricDisplayName,
            value: num,
            unit,
            status: 'VERIFIED',
            stage: finding.stage,
            corner: null,
            tool: stage,
            sourceMetricId: finding.sourceKey,
            runId: runId || 'run_latest',
            timestamp,
          })
          return { value: num, stage: finding.stage, sourceKey: finding.sourceKey }
        }
      }
    }

    // Check parameters as fallback for design-wide settings
    for (const alias of aliases) {
      if (alias in params && params[alias] !== undefined && params[alias] !== null) {
        const num = parseNumber(params[alias])
        if (num !== null) {
          provenance.push({
            category,
            metric: metricDisplayName,
            value: num,
            unit,
            status: 'CONFIGURED',
            stage: 'Parameters',
            corner: null,
            tool: 'Configuration',
            sourceMetricId: alias,
            runId: runId || 'run_latest',
            timestamp,
          })
          return { value: num, stage: 'Parameters', sourceKey: alias }
        }
      }
      if (alias in home && home[alias] !== undefined && home[alias] !== null) {
        const num = parseNumber(home[alias])
        if (num !== null) {
          return { value: num, stage: 'Home', sourceKey: alias }
        }
      }
    }

    return { value: null, stage: '', sourceKey: '' }
  }

  // 2. Physical Metrics
  const dieAreaRes = queryMetric(
    'Physical',
    'Die Area',
    ['Harden', 'Route', 'Legal', 'Place', 'Floor'],
    [
      'Design Layout.die_area',
      'die_area_um2',
      'die_area',
      'dieArea',
      'die_area_um',
      'die_area_mm2',
    ],
    'um2',
  )
  let dieAreaUm2 = dieAreaRes.value
  if (dieAreaUm2 !== null && dieAreaUm2 < 100) {
    dieAreaUm2 = dieAreaUm2 * 1e6
  }
  const dieAreaMm2 = dieAreaUm2 !== null ? +(dieAreaUm2 / 1e6).toFixed(4) : null

  const coreAreaRes = queryMetric(
    'Physical',
    'Core Area',
    ['Harden', 'Route', 'Legal', 'Place', 'Floor'],
    ['Design Layout.core_area', 'core_area_um2', 'core_area', 'coreArea', 'core_area_um'],
    'um2',
  )
  let coreAreaUm2 = coreAreaRes.value
  if (coreAreaUm2 !== null && coreAreaUm2 < 100) {
    coreAreaUm2 = coreAreaUm2 * 1e6
  }
  const coreAreaMm2 = coreAreaUm2 !== null ? +(coreAreaUm2 / 1e6).toFixed(4) : null

  const utilRes = queryMetric(
    'Physical',
    'Core Utilization',
    ['Harden', 'Route', 'Legal', 'Place', 'Floor'],
    [
      'Design Layout.core_usage',
      'Design Layout.die_usage',
      'core_utilization',
      'utilization',
      'core_utilization_pct',
      'utilization_pct',
      'coreUtilization',
    ],
    '%',
  )
  let coreUtilizationPct = utilRes.value
  if (
    coreUtilizationPct !== null &&
    coreUtilizationPct > 0 &&
    coreUtilizationPct <= 1.0
  ) {
    coreUtilizationPct = +(coreUtilizationPct * 100).toFixed(2)
  }

  if (
    coreUtilizationPct !== null &&
    (coreUtilizationPct < 0 || coreUtilizationPct > 100)
  ) {
    warnings.push({
      code: 'PHYS_UTIL_OUT_OF_RANGE',
      message: `Core utilization ${coreUtilizationPct}% is outside standard range (0-100%).`,
      severity: 'warn',
    })
  }

  const stdCellAreaRes = queryMetric(
    'Physical',
    'Standard Cell Area',
    ['Harden', 'Route', 'Legal', 'Place', 'Floor', 'Synth'],
    [
      'Instances.total.area',
      'Instances.logic.area',
      'design.area',
      'stdcell_area',
      'std_cell_area',
      'cell_area',
      'stdCellArea',
      'area',
    ],
    'um2',
  )
  const stdCellAreaUm2 = stdCellAreaRes.value

  const macroAreaRes = queryMetric(
    'Physical',
    'Macro Area',
    ['Harden', 'Route', 'Place', 'Floor'],
    ['Instances.macros.area', 'macro_area', 'macro_area_um2', 'macroArea'],
    'um2',
  )
  const macroAreaUm2 = macroAreaRes.value

  const macroCountRes = queryMetric(
    'Physical',
    'Macro Count',
    ['Harden', 'Route', 'Place', 'Floor'],
    ['Instances.macros.num', 'macro_count', 'num_macros', 'macroCount'],
    'count',
  )
  const macroCount = macroCountRes.value

  const instCountRes = queryMetric(
    'Physical',
    'Total Instances',
    ['Harden', 'Route', 'Legal', 'Place', 'CTS', 'Fanout', 'Floor', 'Synth'],
    [
      'Design Statis.num_instances',
      'Instances.total.num',
      'design.num_cells',
      'instance_count',
      'instances',
      'instanceCount',
      'num_cells',
      'total_instances',
    ],
    'count',
  )
  const instanceCount = instCountRes.value

  const seqCellRes = queryMetric(
    'Physical',
    'Sequential Cell Count',
    ['Harden', 'Route', 'CTS', 'Place', 'Synth'],
    [
      'Instances.clock.num',
      'sequential_cells',
      'seq_cells',
      'sequential_cell_count',
      'flip_flops',
      'registers',
    ],
    'count',
  )
  const sequentialCellCount = seqCellRes.value

  const combCellRes = queryMetric(
    'Physical',
    'Combinational Cell Count',
    ['Harden', 'Route', 'Place', 'Synth'],
    [
      'Instances.logic.num',
      'combinational_cells',
      'comb_cells',
      'combinational_cell_count',
      'logic_cells',
    ],
    'count',
  )
  const combinationalCellCount = combCellRes.value

  const ioPinRes = queryMetric(
    'Physical',
    'IO Pin Count',
    ['Harden', 'Route', 'Floor', 'Synth'],
    [
      'Design Statis.num_iopins',
      'Instances.total.pin_num',
      'design.num_ports',
      'io_pin_count',
      'io_pins',
      'ioPins',
      'num_ports',
      'pins',
    ],
    'count',
  )
  const ioPinCount = ioPinRes.value

  const netCountRes = queryMetric(
    'Physical',
    'Total Nets',
    ['Harden', 'Route', 'Legal', 'Place', 'CTS', 'Fanout', 'Floor', 'Synth'],
    [
      'Design Statis.num_nets',
      'design.num_wires',
      'net_count',
      'nets',
      'netCount',
      'num_wires',
    ],
    'count',
  )
  const netCount = netCountRes.value

  const physical: PhysicalMetrics = {
    dieAreaUm2,
    dieAreaMm2,
    coreAreaUm2,
    coreAreaMm2,
    coreUtilizationPct,
    stdCellAreaUm2,
    macroAreaUm2,
    macroCount,
    instanceCount,
    sequentialCellCount,
    combinationalCellCount,
    ioPinCount,
    netCount,
  }

  // 3. Timing & Clock Quality
  let targetClockPeriodNs: number | null = null
  let targetFrequencyMhz: number | null = null

  const clockPeriodRes = queryMetric(
    'Timing',
    'Target Clock Period',
    ['STA', 'CTS', 'Route', 'Place', 'Synth', 'Parameters', 'Home'],
    [
      'clock_period',
      'CLOCK_PERIOD',
      'target_clock_period',
      'target_clock_period_ns',
      'clockPeriod',
      'target_period',
      'PERIOD',
      'period',
      'SDC_CLOCK_PERIOD',
      'sdc_clock_period',
      'summary.clock_period',
      'summary.setup.clock_period',
      'summary.target_clock_period',
    ],
    'ns',
  )
  if (clockPeriodRes.value !== null && clockPeriodRes.value > 0) {
    targetClockPeriodNs = clockPeriodRes.value
    targetFrequencyMhz = +(1000 / targetClockPeriodNs).toFixed(2)
  } else {
    // Check frequency target aliases
    const freqRes = queryMetric(
      'Timing',
      'Target Frequency',
      ['STA', 'Parameters', 'Home', 'Synth'],
      [
        'Frequency max [MHz]',
        'Frequency max',
        'Frequency [MHz]',
        'Frequency',
        'frequency_max_mhz',
        'frequency_max',
        'CLOCK_FREQ_MHZ',
        'target_frequency_mhz',
        'clock_frequency_mhz',
        'target_frequency',
        'frequencyTarget',
        'FREQUENCY',
        'frequency',
      ],
      'MHz',
    )
    if (freqRes.value !== null && freqRes.value > 0) {
      targetFrequencyMhz = freqRes.value
      targetClockPeriodNs = +(1000 / targetFrequencyMhz).toFixed(3)
    } else if (input.frequencyTarget && input.frequencyTarget > 0) {
      targetFrequencyMhz = input.frequencyTarget
      targetClockPeriodNs = +(1000 / targetFrequencyMhz).toFixed(3)
    }
  }

  let setupWnsNs: number | null = null
  const setupWnsRes = queryMetric(
    'Timing',
    'Setup WNS',
    ['STA', 'Route', 'CTS', 'Place', 'Synth'],
    [
      'sta_setup_wns',
      'setup_wns',
      'setup.wns',
      'summary.setup.wns',
      'summary.wns',
      'worst_negative_slack_setup',
      'worst_negative_slack',
      'worstSetup.wns',
      'wns',
    ],
    'ns',
  )
  setupWnsNs = setupWnsRes.value

  let setupTnsNs: number | null = null
  const setupTnsRes = queryMetric(
    'Timing',
    'Setup TNS',
    ['STA', 'Route', 'CTS', 'Place', 'Synth'],
    [
      'sta_setup_tns',
      'setup_tns',
      'setup.tns',
      'summary.setup.tns',
      'summary.tns',
      'total_negative_slack_setup',
      'total_negative_slack',
      'tns',
    ],
    'ns',
  )
  setupTnsNs = setupTnsRes.value

  let holdWnsNs: number | null = null
  const holdWnsRes = queryMetric(
    'Timing',
    'Hold WNS',
    ['STA', 'Route', 'CTS', 'Place'],
    [
      'sta_hold_wns',
      'hold_wns',
      'hold.wns',
      'summary.hold.wns',
      'hold_worst_negative_slack',
      'worstHold.wns',
    ],
    'ns',
  )
  holdWnsNs = holdWnsRes.value

  let holdTnsNs: number | null = null
  const holdTnsRes = queryMetric(
    'Timing',
    'Hold TNS',
    ['STA', 'Route', 'CTS', 'Place'],
    [
      'sta_hold_tns',
      'hold_tns',
      'hold.tns',
      'summary.hold.tns',
      'hold_total_negative_slack',
    ],
    'ns',
  )
  holdTnsNs = holdTnsRes.value

  let violatingEndpointsSetup: number | null = null
  const endpSetupRes = queryMetric(
    'Timing',
    'Setup Violating Endpoints',
    ['STA', 'Route'],
    [
      'violating_endpoints_setup',
      'setup.nvp',
      'summary.setup.nvp',
      'setup_violating_endpoints',
      'setup_nvp',
      'setupViolationCount',
      'nvp',
    ],
    'endpoints',
  )
  violatingEndpointsSetup = endpSetupRes.value

  let violatingEndpointsHold: number | null = null
  const endpHoldRes = queryMetric(
    'Timing',
    'Hold Violating Endpoints',
    ['STA', 'Route'],
    [
      'violating_endpoints_hold',
      'hold.nvp',
      'summary.hold.nvp',
      'hold_violating_endpoints',
      'hold_nvp',
      'holdViolationCount',
    ],
    'endpoints',
  )
  violatingEndpointsHold = endpHoldRes.value

  function parseCornerAttributes(name: string): {
    process: string | null
    temperatureC: number | null
    voltageV: number | null
    rcCorner: string | null
  } {
    let process: string | null = null
    let temperatureC: number | null = null
    let voltageV: number | null = null
    let rcCorner: string | null = null

    const parts = name.split(/[/_]/)
    for (const p of parts) {
      const trimmed = p.trim()
      if (/^(MAX|MIN|ML|TYP|WCL|ss|ff|tt|fs|sf)$/i.test(trimmed)) {
        process = trimmed.toUpperCase()
      }
      const tempMatch = trimmed.match(/^(?:m(\d+)|(-?\d+)C?)$/i)
      if (tempMatch) {
        if (tempMatch[1]) {
          temperatureC = -Number(tempMatch[1])
        } else if (tempMatch[2]) {
          temperatureC = Number(tempMatch[2])
        }
      }
      const voltMatch = trimmed.match(/(\d+)v(\d+)/i)
      if (voltMatch) {
        voltageV = Number(`${voltMatch[1]}.${voltMatch[2]}`)
      }
      if (/^(Cworst|RCworst|Cbest|RCbest|TYPICAL|typical|best|worst)$/i.test(trimmed)) {
        rcCorner = trimmed
      }
    }

    return { process, temperatureC, voltageV, rcCorner }
  }

  // 4. Multi-Corner Timing Extraction
  const multiCornerTiming: CornerTimingRecord[] = []
  const allCornersSources: Array<Record<string, unknown> | undefined> = [
    normalizedStepMetrics['STA']?.corners as Record<string, unknown> | undefined,
    normalizedStepMetrics['sta_ecc']?.corners as Record<string, unknown> | undefined,
    normalizedStepMetrics['Synth']?.corners as Record<string, unknown> | undefined,
    input.staCornerReports ?? undefined,
  ]

  const mergedCorners: Record<string, Record<string, unknown>> = {}
  for (const cSrc of allCornersSources) {
    if (isRecord(cSrc)) {
      for (const [cName, cData] of Object.entries(cSrc)) {
        if (isRecord(cData)) {
          mergedCorners[cName] = { ...mergedCorners[cName], ...cData }
        }
      }
    }
  }

  for (const [cornerName, cVal] of Object.entries(mergedCorners)) {
    if (!isRecord(cVal)) continue
    const inferred = parseCornerAttributes(cornerName)

    const setupObj = isRecord(cVal.setup) ? cVal.setup : null
    const holdObj = isRecord(cVal.hold) ? cVal.hold : null
    const summaryObj = isRecord(cVal.summary) ? cVal.summary : null
    const summarySetup = isRecord(summaryObj?.setup) ? summaryObj.setup : null
    const summaryHold = isRecord(summaryObj?.hold) ? summaryObj.hold : null

    const cSetupWns = parseNumber(
      cVal.setup_wns ?? cVal.wns ?? setupObj?.wns ?? summarySetup?.wns,
    )
    const cSetupTns = parseNumber(
      cVal.setup_tns ?? cVal.tns ?? setupObj?.tns ?? summarySetup?.tns,
    )
    const cHoldWns = parseNumber(cVal.hold_wns ?? holdObj?.wns ?? summaryHold?.wns)
    const cHoldTns = parseNumber(cVal.hold_tns ?? holdObj?.tns ?? summaryHold?.tns)
    const cVoltage = parseNumber(cVal.voltage ?? cVal.voltage_v ?? inferred.voltageV)
    const cTemp = parseNumber(
      cVal.temperature ?? cVal.temperature_c ?? inferred.temperatureC,
    )
    const cProcess =
      (typeof cVal.process === 'string' && cVal.process) || inferred.process
    const cRc = (typeof cVal.rc === 'string' && cVal.rc) || inferred.rcCorner
    const cEndpSetup = parseNumber(
      cVal.violating_endpoints_setup ?? setupObj?.nvp ?? summarySetup?.nvp,
    )
    const cEndpHold = parseNumber(
      cVal.violating_endpoints_hold ?? holdObj?.nvp ?? summaryHold?.nvp,
    )

    const pass =
      (cSetupWns === null || cSetupWns >= 0) && (cHoldWns === null || cHoldWns >= 0)
    const status = pass ? 'pass' : 'fail'

    multiCornerTiming.push({
      corner: cornerName,
      processCorner: cProcess,
      voltageV: cVoltage,
      temperatureC: cTemp,
      rcCorner: cRc,
      setupWnsNs: cSetupWns,
      setupTnsNs: cSetupTns,
      holdWnsNs: cHoldWns,
      holdTnsNs: cHoldTns,
      violatingEndpointsSetup: cEndpSetup,
      violatingEndpointsHold: cEndpHold,
      status,
    })
  }

  // If top-level timing metrics were missing, roll them up from multi-corner timing
  if (multiCornerTiming.length > 0) {
    const validSetupWns = multiCornerTiming
      .map((c) => c.setupWnsNs)
      .filter((v): v is number => v !== null)
    const validSetupTns = multiCornerTiming
      .map((c) => c.setupTnsNs)
      .filter((v): v is number => v !== null)
    const validHoldWns = multiCornerTiming
      .map((c) => c.holdWnsNs)
      .filter((v): v is number => v !== null)
    const validHoldTns = multiCornerTiming
      .map((c) => c.holdTnsNs)
      .filter((v): v is number => v !== null)

    if (setupWnsNs === null && validSetupWns.length > 0) {
      setupWnsNs = Math.min(...validSetupWns)
    }
    if (setupTnsNs === null && validSetupTns.length > 0) {
      setupTnsNs = Math.min(...validSetupTns)
    }
    if (holdWnsNs === null && validHoldWns.length > 0) {
      holdWnsNs = Math.min(...validHoldWns)
    }
    if (holdTnsNs === null && validHoldTns.length > 0) {
      holdTnsNs = Math.min(...validHoldTns)
    }
    if (violatingEndpointsSetup === null) {
      violatingEndpointsSetup = multiCornerTiming.reduce(
        (sum, c) => sum + (c.violatingEndpointsSetup ?? 0),
        0,
      )
    }
    if (violatingEndpointsHold === null) {
      violatingEndpointsHold = multiCornerTiming.reduce(
        (sum, c) => sum + (c.violatingEndpointsHold ?? 0),
        0,
      )
    }
  }

  // Calculate Achieved Fmax
  let fmaxMhz: number | null = null
  const fmaxRes = queryMetric(
    'Timing',
    'Achieved Fmax',
    ['STA', 'Route', 'CTS'],
    [
      'sta_frequency_mhz',
      'frequency_mhz',
      'fmax',
      'achieved_frequency',
      'summary.setup.frequency_mhz',
      'setup.frequency_mhz',
      'summary.frequency_mhz',
    ],
    'MHz',
  )
  if (fmaxRes.value !== null) {
    fmaxMhz = fmaxRes.value
  } else if (targetClockPeriodNs !== null && setupWnsNs !== null) {
    const minPeriod = targetClockPeriodNs - setupWnsNs
    if (minPeriod > 0) {
      fmaxMhz = +(1000 / minPeriod).toFixed(2)
    }
  } else if (targetClockPeriodNs !== null) {
    fmaxMhz = +(1000 / targetClockPeriodNs).toFixed(2)
  }

  const slewViolRes = queryMetric(
    'Timing',
    'Max Slew Violations',
    ['STA', 'Route', 'CTS', 'Synth'],
    [
      'slew_violations',
      'max_slew_violations',
      'slew_viols',
      'trans_violations',
      'transition_violations',
      'max_transition_violations',
      'max_slew',
      'slew_violation_count',
      'summary.slew.violations',
      'slew.violations',
      'check_slew',
    ],
    'violations',
  )
  let slewViolations = slewViolRes.value
  if (slewViolations === null && setupWnsNs !== null && setupWnsNs >= 0) {
    slewViolations = 0
  }

  const capViolRes = queryMetric(
    'Timing',
    'Max Cap Violations',
    ['STA', 'Route', 'CTS', 'Synth'],
    [
      'cap_violations',
      'max_cap_violations',
      'cap_viols',
      'max_cap',
      'capacitance_violations',
      'max_capacitance_violations',
      'cap_violation_count',
      'summary.cap.violations',
      'cap.violations',
      'check_cap',
    ],
    'violations',
  )
  let capViolations = capViolRes.value
  if (capViolations === null && setupWnsNs !== null && setupWnsNs >= 0) {
    capViolations = 0
  }

  const fanoutViolRes = queryMetric(
    'Timing',
    'Max Fanout Violations',
    ['STA', 'Route', 'Fanout', 'CTS', 'Synth'],
    [
      'fanout_violations',
      'max_fanout_violations',
      'fanout_viols',
      'fanout_max_violations',
      'max_fanout',
      'fanout_violation_count',
      'summary.fanout.violations',
      'fanout.violations',
      'check_fanout',
    ],
    'violations',
  )
  let fanoutViolations = fanoutViolRes.value
  if (fanoutViolations === null && setupWnsNs !== null && setupWnsNs >= 0) {
    fanoutViolations = 0
  }

  const critPathRes = queryMetric(
    'Timing',
    'Critical Path Delay',
    ['STA', 'Route', 'CTS', 'Synth'],
    [
      'critical_path_delay',
      'critical_path_delay_ns',
      'crit_path_delay',
      'data_path_delay',
      'arrival_time',
      'data_arrival_time',
      'path_delay',
      'worst_path_delay',
    ],
    'ns',
  )
  let criticalPathDelayNs = critPathRes.value
  if (
    criticalPathDelayNs === null &&
    targetClockPeriodNs !== null &&
    setupWnsNs !== null
  ) {
    const derived = targetClockPeriodNs - setupWnsNs
    if (derived > 0) {
      criticalPathDelayNs = +derived.toFixed(3)
    }
  } else if (criticalPathDelayNs === null && fmaxMhz !== null && fmaxMhz > 0) {
    criticalPathDelayNs = +(1000 / fmaxMhz).toFixed(3)
  }

  const timing: TimingMetrics = {
    targetClockPeriodNs,
    targetFrequencyMhz,
    fmaxMhz,
    setupWnsNs,
    setupTnsNs,
    holdWnsNs,
    holdTnsNs,
    violatingEndpointsSetup,
    violatingEndpointsHold,
    slewViolations,
    capViolations,
    fanoutViolations,
    criticalPathDelayNs,
  }

  // 5. Clock Quality
  const skewRes = queryMetric(
    'Clock',
    'Clock Skew',
    ['CTS', 'STA', 'Route'],
    [
      'cts_worst_optimized_skew_ns',
      'worst_optimized_skew_ns',
      'cts_worst_skew_ns',
      'worst_skew_ns',
      'clock_skew',
      'skew_ps',
      'skew',
      'max_clock_skew',
      'cts_clock_skew',
      'worst_skew',
    ],
    'ps',
  )
  let clockSkewPs: number | null = null
  if (skewRes.value !== null) {
    if (
      skewRes.sourceKey.endsWith('_ns') ||
      (skewRes.value > 0 && skewRes.value < 10.0)
    ) {
      clockSkewPs = +(skewRes.value * 1000).toFixed(1)
    } else {
      clockSkewPs = +skewRes.value.toFixed(1)
    }
  }

  const latencyRes = queryMetric(
    'Clock',
    'Clock Insertion Latency',
    ['CTS', 'STA', 'Route'],
    [
      'cts_worst_max_insertion_latency_ns',
      'worst_max_insertion_latency_ns',
      'cts_insertion_latency_ns',
      'worst_insertion_latency_ns',
      'clock_latency',
      'latency_ns',
      'insertion_latency',
      'clock_insertion_delay',
      'cts_latency',
      'insertion_delay',
    ],
    'ns',
  )
  const clockLatencyNs = latencyRes.value

  const clockWirelengthRes = queryMetric(
    'Clock',
    'Clock Wirelength',
    ['CTS', 'Route'],
    [
      'total_clock_wirelength',
      'CTS.total_clock_wirelength',
      'clock_wirelength',
      'clock_wire_length',
      'clock_wirelength_um',
    ],
    'um',
  )
  const clockWirelengthUm = clockWirelengthRes.value

  const clockMaxWirelengthRes = queryMetric(
    'Clock',
    'Max Clock Wirelength',
    ['CTS', 'Route'],
    ['cts_clock_wirelength_max', 'max_clock_wirelength', 'CTS.max_clock_wirelength'],
    'um',
  )
  const clockMaxWirelengthUm = clockMaxWirelengthRes.value

  const clockBufferCountRes = queryMetric(
    'Clock',
    'Clock Buffer Count',
    ['CTS', 'Route', 'Place', 'Floor'],
    [
      'cts_buffer_count',
      'CTS.buffer_num',
      'buffer_num',
      'clock_buffer_count',
      'clock_buffers',
      'num_clock_buffers',
    ],
    'count',
  )
  const clockBufferCount = clockBufferCountRes.value

  const clockBufferAreaRes = queryMetric(
    'Clock',
    'Clock Buffer Area',
    ['CTS', 'Route'],
    ['cts_buffer_area', 'CTS.buffer_area', 'buffer_area', 'clock_buffer_area'],
    'um2',
  )
  const clockBufferAreaUm2 = clockBufferAreaRes.value

  const clockPathMaxBufferRes = queryMetric(
    'Clock',
    'Clock Path Max Buffer',
    ['CTS'],
    ['clock_path_max_buffer', 'CTS.clock_path_max_buffer', 'max_buffer_per_path'],
    'count',
  )
  const clockPathMaxBuffer = clockPathMaxBufferRes.value

  const clockPathMinBufferRes = queryMetric(
    'Clock',
    'Clock Path Min Buffer',
    ['CTS'],
    ['clock_path_min_buffer', 'CTS.clock_path_min_buffer', 'min_buffer_per_path'],
    'count',
  )
  const clockPathMinBuffer = clockPathMinBufferRes.value

  const clockNetsCountRes = queryMetric(
    'Clock',
    'Clock Nets Count',
    ['CTS', 'Route', 'Harden'],
    ['Nets.num_clock', 'num_clock_nets', 'clock_nets', 'num_clock'],
    'count',
  )
  const clockNetsCount = clockNetsCountRes.value

  const clockInverterCountRes = queryMetric(
    'Clock',
    'Clock Inverter Count',
    ['CTS', 'Route'],
    [
      'cts_inverter_count',
      'clock_inverter_count',
      'clock_inverters',
      'num_clock_inverters',
    ],
    'count',
  )
  const clockInverterCount = clockInverterCountRes.value

  const clockTreeLevelsRes = queryMetric(
    'Clock',
    'Clock Tree Levels',
    ['CTS', 'STA'],
    [
      'cts_clock_tree_max_level',
      'CTS.max_level_of_clock_tree',
      'max_level_of_clock_tree',
      'clock_tree_max_level',
      'clock_tree_levels',
      'clock_levels',
      'tree_depth',
      'max_level',
      'clock_max_level',
    ],
    'levels',
  )
  const clockTreeLevels = clockTreeLevelsRes.value

  const clockCellCountRes = queryMetric(
    'Clock',
    'Clock Cell Count',
    ['CTS', 'Route', 'Harden'],
    ['Instances.clock.num', 'clock_cell_count', 'clock_cells'],
    'count',
  )
  const clockCellCount = clockCellCountRes.value

  const clockTotalBuffers =
    clockCellCount !== null
      ? clockCellCount
      : clockBufferCount !== null || clockInverterCount !== null
        ? (clockBufferCount ?? 0) + (clockInverterCount ?? 0)
        : null

  const clock: ClockMetrics = {
    clockSkewPs,
    clockLatencyNs,
    clockWirelengthUm,
    clockMaxWirelengthUm,
    clockBufferCount,
    clockInverterCount,
    clockTotalBuffers,
    clockBufferAreaUm2,
    clockPathMaxBuffer,
    clockPathMinBuffer,
    clockNetsCount,
    clockTreeLevels,
    clockCellCount,
  }

  // 6. Routing Metrics
  const hpwlRes = queryMetric(
    'Routing',
    'Half-Perimeter Wirelength',
    ['Place', 'Floor'],
    ['place_hpwl', 'hpwl', 'hpwl_um', 'half_perimeter_wirelength'],
    'um',
  )
  const hpwlUm = hpwlRes.value

  const estWirelengthRes = queryMetric(
    'Routing',
    'Estimated Wirelength',
    ['Place', 'CTS', 'Route'],
    [
      'place_flute_wirelength',
      'place_grwl',
      'estimated_wirelength',
      'estimated_wirelength_um',
    ],
    'um',
  )
  const estimatedWirelengthUm = estWirelengthRes.value

  const routedWirelengthRes = queryMetric(
    'Routing',
    'Routed Wirelength',
    ['Route', 'Harden'],
    [
      'route_dr_total_wirelength',
      'route_wirelength',
      'Nets.wire_len',
      'routed_wirelength',
      'routed_wirelength_um',
      'wirelength',
      'wire_len',
    ],
    'um',
  )
  const routedWirelengthUm = routedWirelengthRes.value

  const viaCountRes = queryMetric(
    'Routing',
    'Via Count',
    ['Route', 'Harden'],
    [
      'route_dr_total_via_count',
      'route_via_count',
      'Nets.num_via',
      'via_count',
      'vias',
      'num_vias',
      'num_via',
    ],
    'count',
  )
  const viaCount = viaCountRes.value

  const routingCompletionRes = queryMetric(
    'Routing',
    'Routing Completion',
    ['Route', 'Harden', 'STA'],
    [
      'routing_completion',
      'routing_completion_pct',
      'route_completion',
      'route_completion_pct',
      'completion_pct',
      'drc_completion',
      'routed_pct',
      'Nets.routed_pct',
      'routed_nets_pct',
      'route_dr_routed_net_pct',
    ],
    '%',
  )
  let routingCompletionPct = routingCompletionRes.value
  if (
    routingCompletionPct !== null &&
    routingCompletionPct > 0 &&
    routingCompletionPct <= 1.0
  ) {
    routingCompletionPct = +(routingCompletionPct * 100).toFixed(1)
  }
  if (routingCompletionPct === null) {
    const isRouteSuccess =
      Array.isArray(flow.steps) &&
      flow.steps.some(
        (st: unknown) =>
          isRecord(st) &&
          typeof st.name === 'string' &&
          /^(Route|route_ecc|Harden|Harden_ecc)$/i.test(st.name) &&
          /^(Success|Complete)$/i.test(String(st.state)),
      )
    if (isRouteSuccess || (routedWirelengthUm !== null && routedWirelengthUm > 0)) {
      routingCompletionPct = 100.0
    }
  }

  const routeDrcRes = queryMetric(
    'Routing',
    'Route DRC Violations',
    ['Route'],
    [
      'route_dr_total_violation_count',
      'route_drc_count',
      'drc_violations',
      'route_violations',
    ],
    'count',
  )
  const routeDrcCount = routeDrcRes.value

  const routing: RoutingMetrics = {
    hpwlUm,
    estimatedWirelengthUm,
    routedWirelengthUm,
    viaCount,
    routingCompletionPct,
    routeDrcCount,
  }

  // 7. Congestion Metrics
  const globalOverflowTotalRes = queryMetric(
    'Congestion',
    'Global Overflow Total',
    ['Route', 'Place'],
    [
      'route_la_total_overflow',
      'place_congestion_egr_overflow_total',
      'global_overflow',
      'global_overflow_total',
      'total_overflow',
    ],
    'tracks',
  )
  const globalOverflowTotal = globalOverflowTotalRes.value

  const globalOverflowPctRes = queryMetric(
    'Congestion',
    'Global Overflow Pct',
    ['Route', 'Place'],
    ['global_overflow_pct', 'overflow_pct'],
    '%',
  )
  const globalOverflowPct = globalOverflowPctRes.value

  const maxOverflowRes = queryMetric(
    'Congestion',
    'Max Overflow',
    ['Route', 'Place'],
    ['place_congestion_egr_overflow_max', 'max_overflow', 'peak_overflow'],
    'tracks',
  )
  const maxOverflow = maxOverflowRes.value

  const hCongestionRes = queryMetric(
    'Congestion',
    'Horizontal Congestion Pct',
    ['Place', 'Route'],
    [
      'place_rudy_utilization_max',
      'place_lutrudy_utilization_max',
      'horizontal_congestion_pct',
      'h_congestion_pct',
    ],
    '%',
  )
  const horizontalCongestionPct = hCongestionRes.value

  const vCongestionRes = queryMetric(
    'Congestion',
    'Vertical Congestion Pct',
    ['Place', 'Route'],
    ['place_rudy_utilization_max', 'vertical_congestion_pct', 'v_congestion_pct'],
    '%',
  )
  const verticalCongestionPct = vCongestionRes.value

  const hotspotsCountRes = queryMetric(
    'Congestion',
    'Congestion Hotspots',
    ['Route', 'Place'],
    ['hotspots_count', 'num_hotspots', 'hotspot_count'],
    'count',
  )
  const hotspotsCount = hotspotsCountRes.value

  const congestion: CongestionMetrics = {
    globalOverflowTotal,
    globalOverflowPct,
    maxOverflow,
    horizontalCongestionPct,
    verticalCongestionPct,
    hotspotsCount,
  }

  // 8. Power Metrics
  let totalPowerMw: number | null = null
  const totPowerRes = queryMetric(
    'Power',
    'Total Power',
    ['Power', 'STA', 'Route', 'Harden'],
    [
      'total_power',
      'total_power_mw',
      'power.total',
      'power_total',
      'power_mw',
      'sta_total_power',
      'power.total_power',
    ],
    'mW',
  )
  totalPowerMw = totPowerRes.value

  const dynPowerRes = queryMetric(
    'Power',
    'Dynamic Power',
    ['Power', 'STA', 'Route', 'Harden'],
    [
      'dynamic_power',
      'dynamic_power_mw',
      'power.dynamic',
      'power_dynamic',
      'sta_dynamic_power',
    ],
    'mW',
  )
  const dynamicPowerMw = dynPowerRes.value

  const swPowerRes = queryMetric(
    'Power',
    'Switching Power',
    ['Power', 'STA', 'Route', 'Harden'],
    ['switching_power', 'switching_power_mw', 'power.switching', 'power_switching'],
    'mW',
  )
  const switchingPowerMw = swPowerRes.value

  const intPowerRes = queryMetric(
    'Power',
    'Internal Power',
    ['Power', 'STA', 'Route', 'Harden'],
    ['internal_power', 'internal_power_mw', 'power.internal', 'power_internal'],
    'mW',
  )
  const internalPowerMw = intPowerRes.value

  const leakPowerRes = queryMetric(
    'Power',
    'Leakage Power',
    ['Power', 'STA', 'Route', 'Harden'],
    [
      'leakage_power',
      'leakage_power_mw',
      'power.leakage',
      'power_leakage',
      'sta_leakage_power',
    ],
    'mW',
  )
  const leakagePowerMw = leakPowerRes.value

  if (totalPowerMw === null && (dynamicPowerMw !== null || leakagePowerMw !== null)) {
    totalPowerMw = +((dynamicPowerMw ?? 0) + (leakagePowerMw ?? 0)).toFixed(3)
  }

  const voltRes = queryMetric(
    'Power',
    'Operating Voltage',
    ['Power', 'STA', 'Parameters'],
    ['voltage', 'voltage_v', 'VOLTAGE', 'VDD', 'vdd', 'supply_voltage'],
    'V',
  )
  const voltageV = voltRes.value

  const tempRes = queryMetric(
    'Power',
    'Operating Temperature',
    ['Power', 'STA', 'Parameters'],
    ['temperature', 'temperature_c', 'TEMPERATURE', 'TEMP', 'temp', 'operating_temp'],
    '°C',
  )
  const temperatureC = tempRes.value

  const power: PowerMetrics = {
    totalPowerMw,
    dynamicPowerMw,
    switchingPowerMw,
    internalPowerMw,
    leakagePowerMw,
    voltageV,
    temperatureC,
    corner: typeof params.POWER_CORNER === 'string' ? params.POWER_CORNER : null,
    activityMethod:
      typeof params.POWER_ACTIVITY === 'string' ? params.POWER_ACTIVITY : null,
  }

  // 9. Physical Verification & Signoff
  const drcCountRes = queryMetric(
    'Verification',
    'DRC Violations',
    ['DRC', 'Harden', 'Route'],
    ['drc_count', 'drc_violations', 'violations_count', 'errors', 'drc_errors'],
    'violations',
  )
  const drcCount = drcCountRes.value
  const drcStatus = drcCount === null ? 'unrun' : drcCount === 0 ? 'clean' : 'violations'

  const lvsCountRes = queryMetric(
    'Verification',
    'LVS Mismatches',
    ['LVS', 'Harden'],
    ['lvs_count', 'lvs_mismatches', 'mismatches', 'lvs_errors'],
    'mismatches',
  )
  const lvsMismatchCount = lvsCountRes.value
  const lvsStatus =
    lvsMismatchCount === null ? 'unrun' : lvsMismatchCount === 0 ? 'matched' : 'mismatch'

  const antennaRes = queryMetric(
    'Verification',
    'Antenna Violations',
    ['DRC', 'Route'],
    ['antenna_violations', 'antenna_errors', 'antenna_count'],
    'violations',
  )
  const antennaViolations = antennaRes.value

  const ercRes = queryMetric(
    'Verification',
    'ERC Violations',
    ['DRC', 'LVS'],
    ['erc_violations', 'erc_errors', 'erc_count'],
    'violations',
  )
  const ercViolations = ercRes.value

  const floatingNetsRes = queryMetric(
    'Verification',
    'Floating Nets',
    ['LVS', 'DRC'],
    ['floating_nets', 'floating_net_count'],
    'nets',
  )
  const floatingNetsCount = floatingNetsRes.value

  const unconnectedPinsRes = queryMetric(
    'Verification',
    'Unconnected Pins',
    ['LVS', 'DRC'],
    ['unconnected_pins', 'unconnected_pin_count'],
    'pins',
  )
  const unconnectedPinsCount = unconnectedPinsRes.value

  const verification: VerificationMetrics = {
    drcCount,
    drcStatus,
    lvsStatus,
    lvsMismatchCount,
    antennaViolations,
    ercViolations,
    floatingNetsCount,
    unconnectedPinsCount,
  }

  // 10. Execution & Flow Runtime
  const stages: StageExecutionRecord[] = []
  let totalRuntimeSeconds = 0
  let peakMemoryMb: number | null = null

  if (Array.isArray(flow.steps)) {
    for (const rawStep of flow.steps) {
      if (!isRecord(rawStep)) continue
      const name = typeof rawStep.name === 'string' ? rawStep.name : 'Unknown'
      const tool = typeof rawStep.tool === 'string' ? rawStep.tool : name
      const state = typeof rawStep.state === 'string' ? rawStep.state : 'Unknown'
      const runtimeRaw = rawStep.runtime
      const runtimeSec = parseRuntimeSeconds(
        typeof runtimeRaw === 'string' || typeof runtimeRaw === 'number'
          ? runtimeRaw
          : null,
      )
      const memoryRaw =
        rawStep['peak memory (mb)'] ??
        rawStep.peak_memory_mb ??
        rawStep.peakMemoryMb ??
        (isRecord(rawStep.info) ? rawStep.info['peak memory (mb)'] : null)
      const memMb = parseNumber(memoryRaw)

      if (runtimeSec !== null) {
        totalRuntimeSeconds += runtimeSec
      }
      if (memMb !== null && (peakMemoryMb === null || memMb > peakMemoryMb)) {
        peakMemoryMb = memMb
      }

      stages.push({
        stage: canonicalizeStageName(name),
        tool,
        runtimeSeconds: runtimeSec,
        runtimeFormatted: formatDuration(runtimeSec),
        peakMemoryMb: memMb,
        state,
      })
    }
  }

  const execution: ExecutionMetrics = {
    totalRuntimeSeconds: totalRuntimeSeconds > 0 ? totalRuntimeSeconds : null,
    totalRuntimeFormatted: formatDuration(totalRuntimeSeconds),
    peakMemoryMb,
    stages,
  }

  const toolVersions: Record<string, string> = {}
  if (isRecord(flow.tools)) {
    for (const [k, v] of Object.entries(flow.tools)) {
      if (typeof v === 'string') toolVersions[k] = v
    }
  }

  const design: DesignInfo = {
    designName,
    workspaceName: input.workspaceName || designName,
    workspacePath: input.workspacePath || '',
    pdk,
    pdkVersion,
    pdkCommit,
    eccTool,
    eccVersion,
    ecosStudioVersion,
    toolVersions,
    gitCommit,
    runId,
    timestamp,
    generatedAt,
  }

  return {
    design,
    physical,
    timing,
    multiCornerTiming,
    clock,
    routing,
    congestion,
    power,
    verification,
    execution,
    provenance,
    warnings,
  }
}
