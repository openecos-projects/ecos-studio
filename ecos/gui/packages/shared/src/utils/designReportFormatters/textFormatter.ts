import type {
  DesignReportData,
  DesignReportExportOptions,
} from '../../contracts/designReport.ts'

function padRight(str: string, width: number): string {
  return str.length >= width ? str : str + ' '.repeat(width - str.length)
}

function padLeft(str: string, width: number): string {
  return str.length >= width ? str : ' '.repeat(width - str.length) + str
}

function fmt(val: number | string | null | undefined, unit = '', decimals = 2): string {
  if (val === null || val === undefined) return '—'
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return '—'
    const formatted = Number.isInteger(val) ? val.toLocaleString('en-US') : val.toFixed(decimals)
    return unit ? `${formatted} ${unit}` : formatted
  }
  return unit ? `${val} ${unit}` : String(val)
}

export function formatTextReport(
  data: DesignReportData,
  options: DesignReportExportOptions = {},
): string {
  const {
    includeMultiCorner = true,
    includeStageBreakdown = true,
  } = options

  const lines: string[] = []
  const WIDTH = 78

  function separator(char = '-') {
    return char.repeat(WIDTH)
  }

  function titleBar(text: string) {
    const padded = `  ${text}  `
    const side = Math.max(0, Math.floor((WIDTH - padded.length) / 2))
    return '='.repeat(side) + padded + '='.repeat(WIDTH - side - padded.length)
  }

  function sectionHeader(text: string) {
    return `[ ${text} ]`
  }

  function row(metric: string, value: string, notes = '') {
    const col1 = padRight(`  ${metric}`, 38)
    const col2 = padRight(value, 20)
    const col3 = notes
    return `${col1} ${col2} ${col3}`
  }

  lines.push(titleBar('ECOS STUDIO — DESIGN SUMMARY REPORT'))
  lines.push(`Design Name        : ${data.design.designName}`)
  const pdkCommitShort = data.design.pdkCommit ? `@${data.design.pdkCommit.slice(0, 8)}` : null
  const pdkSuffix = pdkCommitShort ? ` (${pdkCommitShort})` : (data.design.pdkVersion ? ` (${data.design.pdkVersion})` : '')
  lines.push(`PDK / Node         : ${data.design.pdk}${pdkSuffix}`)
  if (data.design.ecosStudioVersion) {
    lines.push(`ECOS Studio Version: ${data.design.ecosStudioVersion}`)
  }
  if (data.design.gitCommit) {
    lines.push(`Git Commit         : ${data.design.gitCommit}`)
  }
  lines.push(`Generated          : ${data.design.generatedAt}`)
  lines.push(separator('='))
  lines.push('')

  //Physical Design
  lines.push(sectionHeader('1. PHYSICAL & AREA METRICS'))
  lines.push(separator('-'))
  lines.push(row('Die Area', `${fmt(data.physical.dieAreaUm2, 'um²')}${data.physical.dieAreaMm2 !== null ? ` (${fmt(data.physical.dieAreaMm2, 'mm²', 4)})` : ''}`, 'Physical boundary'))
  lines.push(row('Core Area', fmt(data.physical.coreAreaUm2, 'um²'), 'Placement boundary'))
  lines.push(row('Core Utilization', fmt(data.physical.coreUtilizationPct, '%'), 'Placed cell density'))
  lines.push(row('Standard Cell Area', fmt(data.physical.stdCellAreaUm2, 'um²'), 'Total stdcell area'))
  if (data.physical.macroCount !== null && data.physical.macroCount > 0) {
    lines.push(row('Macro Count / Area', `${fmt(data.physical.macroCount)} macros / ${fmt(data.physical.macroAreaUm2, 'um²')}`, 'Hard macros'))
  }
  lines.push(row('Total Instances', fmt(data.physical.instanceCount), 'Cells placed'))
  if (data.physical.sequentialCellCount !== null || data.physical.combinationalCellCount !== null) {
    lines.push(row('Sequential / Comb. Cells', `${fmt(data.physical.sequentialCellCount)} / ${fmt(data.physical.combinationalCellCount)}`, 'Flops / Gates'))
  }
  if (data.physical.ioPinCount !== null) {
    lines.push(row('IO Pins', fmt(data.physical.ioPinCount), 'Chip IOs'))
  }
  if (data.physical.netCount !== null) {
    lines.push(row('Total Nets', fmt(data.physical.netCount), 'Nets'))
  }
  lines.push('')

  //Timing Closure
  lines.push(sectionHeader('2. TIMING CLOSURE & PERFORMANCE'))
  lines.push(separator('-'))
  lines.push(row('Target Clock Period', fmt(data.timing.targetClockPeriodNs, 'ns'), `Target freq: ${fmt(data.timing.targetFrequencyMhz, 'MHz')}`))
  lines.push(row('Achieved Fmax', fmt(data.timing.fmaxMhz, 'MHz'), 'Max operating frequency'))
  lines.push(row('Setup Slack (WNS / TNS)', `${fmt(data.timing.setupWnsNs, 'ns')} / ${fmt(data.timing.setupTnsNs, 'ns')}`, data.timing.setupWnsNs !== null && data.timing.setupWnsNs >= 0 ? 'TIMING MET' : 'VIOLATION'))
  lines.push(row('Hold Slack (WNS / TNS)', `${fmt(data.timing.holdWnsNs, 'ns')} / ${fmt(data.timing.holdTnsNs, 'ns')}`, data.timing.holdWnsNs !== null && data.timing.holdWnsNs >= 0 ? 'TIMING MET' : 'VIOLATION'))
  if (data.timing.criticalPathDelayNs !== null) {
    lines.push(row('Critical Path Delay', fmt(data.timing.criticalPathDelayNs, 'ns'), 'Data path delay'))
  }
  if (data.timing.violatingEndpointsSetup !== null || data.timing.violatingEndpointsHold !== null) {
    lines.push(row('Violating Endpoints (Setup/Hold)', `${fmt(data.timing.violatingEndpointsSetup)} / ${fmt(data.timing.violatingEndpointsHold)}`, 'Failing paths'))
  }
  if (data.timing.slewViolations !== null || data.timing.capViolations !== null || data.timing.fanoutViolations !== null) {
    lines.push(row('DRC Violations (Slew/Cap/Fanout)', `${fmt(data.timing.slewViolations)} / ${fmt(data.timing.capViolations)} / ${fmt(data.timing.fanoutViolations)}`, 'Electrical DRC'))
  }
  lines.push('')

  //Clock Tree & Quality
  lines.push(sectionHeader('3. CLOCK TREE & QUALITY'))
  lines.push(separator('-'))
  lines.push(row('Clock Tree Depth', `${fmt(data.clock.clockTreeLevels)} levels`, 'Max tree depth'))
  if (data.clock.clockBufferCount !== null || data.clock.clockTotalBuffers !== null) {
    const bufStr = data.clock.clockBufferCount !== null ? `${data.clock.clockBufferCount}` : `${data.clock.clockTotalBuffers}`
    const areaStr = data.clock.clockBufferAreaUm2 !== null ? ` (${fmt(data.clock.clockBufferAreaUm2, 'um²')})` : ''
    lines.push(row('Clock Buffers', `${bufStr}${areaStr}`, 'CTS buffers'))
  }
  if (data.clock.clockPathMinBuffer !== null || data.clock.clockPathMaxBuffer !== null) {
    lines.push(row('Clock Path Buffers (Min/Max)', `${fmt(data.clock.clockPathMinBuffer)} / ${fmt(data.clock.clockPathMaxBuffer)}`, 'Buffers per path range'))
  }
  if (data.clock.clockWirelengthUm !== null) {
    lines.push(row('Clock Wirelength', `${fmt(data.clock.clockWirelengthUm, 'um')}${data.clock.clockMaxWirelengthUm !== null ? ` (Max: ${fmt(data.clock.clockMaxWirelengthUm, 'um')})` : ''}`, 'Total clock routing'))
  }
  if (data.clock.clockNetsCount !== null) {
    lines.push(row('Clock Nets', `${fmt(data.clock.clockNetsCount)} nets`, 'Clock net count'))
  }
  if (data.clock.clockSkewPs !== null) {
    lines.push(row('Clock Skew', fmt(data.clock.clockSkewPs, 'ps'), 'Max skew'))
  }
  if (data.clock.clockLatencyNs !== null) {
    lines.push(row('Clock Insertion Latency', fmt(data.clock.clockLatencyNs, 'ns'), 'Insertion delay'))
  }
  lines.push('')

  //Multi-Corner Timing
  if (includeMultiCorner && data.multiCornerTiming.length > 0) {
    lines.push(sectionHeader('4. MULTI-CORNER TIMING'))
    lines.push(separator('-'))
    lines.push(
      `  ${padRight('Corner', 24)} ${padLeft('Setup WNS', 11)} ${padLeft('Setup TNS', 11)} ${padLeft('Hold WNS', 11)} ${padLeft('Hold TNS', 11)}  Status`,
    )
    lines.push('  ' + '-'.repeat(WIDTH - 4))
    for (const c of data.multiCornerTiming) {
      const cName = padRight(c.corner, 24)
      const sWns = padLeft(fmt(c.setupWnsNs, 'ns'), 11)
      const sTns = padLeft(fmt(c.setupTnsNs, 'ns'), 11)
      const hWns = padLeft(fmt(c.holdWnsNs, 'ns'), 11)
      const hTns = padLeft(fmt(c.holdTnsNs, 'ns'), 11)
      const st = c.status === 'pass' ? 'PASS' : c.status === 'fail' ? 'FAIL' : '—'
      lines.push(`  ${cName} ${sWns} ${sTns} ${hWns} ${hTns}  ${st}`)
    }
    lines.push('')
  }

  //Routing & Congestion
  lines.push(sectionHeader('5. ROUTING & CONGESTION'))
  lines.push(separator('-'))
  lines.push(row('HPWL', fmt(data.routing.hpwlUm, 'um'), 'Estimated wirelength'))
  lines.push(row('Routed Wirelength', fmt(data.routing.routedWirelengthUm, 'um'), 'Final routed wirelength'))
  lines.push(row('Via Count', fmt(data.routing.viaCount), 'Vias'))
  if (data.congestion.globalOverflowTotal !== null || data.congestion.globalOverflowPct !== null) {
    lines.push(row('Global Route Overflow', `${fmt(data.congestion.globalOverflowTotal)}${data.congestion.globalOverflowPct !== null ? ` (${fmt(data.congestion.globalOverflowPct, '%')})` : ''}`, 'Tracks overflow'))
  }
  lines.push('')

  //Power Analysis
  lines.push(sectionHeader('6. POWER ANALYSIS'))
  lines.push(separator('-'))
  lines.push(row('Total Power', fmt(data.power.totalPowerMw, 'mW'), 'Total dissipation'))
  lines.push(row('Dynamic Power', fmt(data.power.dynamicPowerMw, 'mW'), 'Switching + Internal'))
  lines.push(row('Leakage Power', fmt(data.power.leakagePowerMw, 'mW'), 'Static power'))
  lines.push('')

  //Physical Verification
  lines.push(sectionHeader('7. PHYSICAL VERIFICATION'))
  lines.push(separator('-'))
  lines.push(row('DRC Status', data.verification.drcStatus === 'clean' ? 'CLEAN (0 violations)' : data.verification.drcStatus === 'violations' ? `VIOLATIONS (${fmt(data.verification.drcCount)})` : 'UNRUN', data.verification.drcStatus === 'clean' ? 'PASS' : 'FAIL'))
  lines.push(row('LVS Status', data.verification.lvsStatus === 'matched' ? 'MATCHED (Clean)' : data.verification.lvsStatus === 'mismatch' ? `MISMATCHES (${fmt(data.verification.lvsMismatchCount)})` : 'UNRUN', data.verification.lvsStatus === 'matched' ? 'PASS' : 'FAIL'))
  lines.push('')

  //Execution Cost
  lines.push(sectionHeader('8. FLOW EXECUTION COST'))
  lines.push(separator('-'))
  lines.push(row('Total Runtime', data.execution.totalRuntimeFormatted || fmt(data.execution.totalRuntimeSeconds, 's'), 'Wall clock time'))
  lines.push(row('Peak Memory Usage', fmt(data.execution.peakMemoryMb, 'MB'), 'Max resident memory'))
  if (includeStageBreakdown && data.execution.stages.length > 0) {
    lines.push('')
    lines.push(
      `  ${padRight('Stage', 18)} ${padRight('Tool', 16)} ${padLeft('Runtime', 12)} ${padLeft('Peak Mem', 12)}  State`,
    )
    lines.push('  ' + '-'.repeat(WIDTH - 4))
    for (const s of data.execution.stages) {
      const stg = padRight(s.stage, 18)
      const tl = padRight(s.tool, 16)
      const rt = padLeft(s.runtimeFormatted || fmt(s.runtimeSeconds, 's'), 12)
      const mem = padLeft(fmt(s.peakMemoryMb, 'MB'), 12)
      lines.push(`  ${stg} ${tl} ${rt} ${mem}  ${s.state}`)
    }
  }

  lines.push('')
  lines.push(separator('='))
  lines.push('END OF REPORT')

  return lines.join('\n')
}
