import type {
  DesignReportData,
  DesignReportExportOptions,
} from '../../contracts/designReport.ts'

function escapeCsv(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (
    str.includes(',') ||
    str.includes('"') ||
    str.includes('\n') ||
    str.includes('\r')
  ) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function formatCsvReport(
  data: DesignReportData,
  options: DesignReportExportOptions = {},
): string {
  const { includeMultiCorner = true, includeStageBreakdown = true } = options

  const rows: string[] = []

  // CSV Header
  const headers = ['Category', 'Metric', 'Value', 'Unit']
  rows.push(headers.map(escapeCsv).join(','))

  // Helper to push a row
  function pushRow(
    category: string,
    metric: string,
    value: string | number | boolean | null | undefined,
    unit: string = '',
  ) {
    if (value === null || value === undefined || value === '') return
    rows.push([category, metric, value, unit].map(escapeCsv).join(','))
  }

  // 1. Design & Technology
  pushRow('Design & Technology', 'Design Name', data.design.designName)
  const pdkCommitShort = data.design.pdkCommit
    ? `@${data.design.pdkCommit.slice(0, 8)}`
    : null
  const pdkSuffix = pdkCommitShort
    ? ` (${pdkCommitShort})`
    : data.design.pdkVersion
      ? ` (${data.design.pdkVersion})`
      : ''
  pushRow('Design & Technology', 'PDK', `${data.design.pdk}${pdkSuffix}`)
  if (data.design.ecosStudioVersion) {
    pushRow('Design & Technology', 'ECOS Studio Version', data.design.ecosStudioVersion)
  }
  if (data.design.gitCommit) {
    pushRow('Design & Technology', 'Git Commit', data.design.gitCommit)
  }
  pushRow('Design & Technology', 'Generated At', data.design.generatedAt)

  // 2. Physical & Area
  pushRow('Physical & Area', 'Die Area', data.physical.dieAreaUm2, 'um2')
  pushRow('Physical & Area', 'Core Area', data.physical.coreAreaUm2, 'um2')
  pushRow('Physical & Area', 'Core Utilization', data.physical.coreUtilizationPct, '%')
  pushRow('Physical & Area', 'Standard Cell Area', data.physical.stdCellAreaUm2, 'um2')
  pushRow('Physical & Area', 'Macro Area', data.physical.macroAreaUm2, 'um2')
  pushRow('Physical & Area', 'Macro Count', data.physical.macroCount, 'count')
  pushRow('Physical & Area', 'Total Instances', data.physical.instanceCount, 'cells')
  pushRow(
    'Physical & Area',
    'Sequential Cells',
    data.physical.sequentialCellCount,
    'cells',
  )
  pushRow(
    'Physical & Area',
    'Combinational Cells',
    data.physical.combinationalCellCount,
    'cells',
  )
  pushRow('Physical & Area', 'IO Pins', data.physical.ioPinCount, 'pins')
  pushRow('Physical & Area', 'Total Nets', data.physical.netCount, 'nets')

  // 3. Timing & Performance
  pushRow(
    'Timing & Performance',
    'Target Clock Period',
    data.timing.targetClockPeriodNs,
    'ns',
  )
  pushRow(
    'Timing & Performance',
    'Target Frequency',
    data.timing.targetFrequencyMhz,
    'MHz',
  )
  pushRow('Timing & Performance', 'Achieved Fmax', data.timing.fmaxMhz, 'MHz')
  pushRow('Timing & Performance', 'Setup WNS', data.timing.setupWnsNs, 'ns')
  pushRow('Timing & Performance', 'Setup TNS', data.timing.setupTnsNs, 'ns')
  pushRow('Timing & Performance', 'Hold WNS', data.timing.holdWnsNs, 'ns')
  pushRow('Timing & Performance', 'Hold TNS', data.timing.holdTnsNs, 'ns')
  pushRow(
    'Timing & Performance',
    'Critical Path Delay',
    data.timing.criticalPathDelayNs,
    'ns',
  )
  pushRow(
    'Timing & Performance',
    'Setup Violating Endpoints',
    data.timing.violatingEndpointsSetup,
    'endpoints',
  )
  pushRow(
    'Timing & Performance',
    'Hold Violating Endpoints',
    data.timing.violatingEndpointsHold,
    'endpoints',
  )
  pushRow(
    'Timing & Performance',
    'Slew Violations',
    data.timing.slewViolations,
    'violations',
  )
  pushRow(
    'Timing & Performance',
    'Cap Violations',
    data.timing.capViolations,
    'violations',
  )
  pushRow(
    'Timing & Performance',
    'Fanout Violations',
    data.timing.fanoutViolations,
    'violations',
  )

  // 4. Clock Tree & Quality
  pushRow(
    'Clock Tree & Quality',
    'Clock Tree Depth',
    data.clock.clockTreeLevels,
    'levels',
  )
  pushRow(
    'Clock Tree & Quality',
    'Clock Buffer Count',
    data.clock.clockBufferCount,
    'buffers',
  )
  pushRow(
    'Clock Tree & Quality',
    'Clock Buffer Area',
    data.clock.clockBufferAreaUm2,
    'um2',
  )
  pushRow(
    'Clock Tree & Quality',
    'Clock Path Min Buffer',
    data.clock.clockPathMinBuffer,
    'buffers',
  )
  pushRow(
    'Clock Tree & Quality',
    'Clock Path Max Buffer',
    data.clock.clockPathMaxBuffer,
    'buffers',
  )
  pushRow(
    'Clock Tree & Quality',
    'Total Clock Wirelength',
    data.clock.clockWirelengthUm,
    'um',
  )
  pushRow(
    'Clock Tree & Quality',
    'Max Clock Wirelength',
    data.clock.clockMaxWirelengthUm,
    'um',
  )
  pushRow('Clock Tree & Quality', 'Clock Nets Count', data.clock.clockNetsCount, 'nets')
  pushRow('Clock Tree & Quality', 'Clock Cell Count', data.clock.clockCellCount, 'cells')
  pushRow('Clock Tree & Quality', 'Clock Skew', data.clock.clockSkewPs, 'ps')
  pushRow(
    'Clock Tree & Quality',
    'Clock Insertion Latency',
    data.clock.clockLatencyNs,
    'ns',
  )

  // 5. Multi-Corner Timing
  if (includeMultiCorner && data.multiCornerTiming.length > 0) {
    for (const c of data.multiCornerTiming) {
      const prefix = `Multi-Corner [${c.corner}]`
      pushRow(prefix, 'Setup WNS', c.setupWnsNs, 'ns')
      pushRow(prefix, 'Setup TNS', c.setupTnsNs, 'ns')
      pushRow(prefix, 'Hold WNS', c.holdWnsNs, 'ns')
      pushRow(prefix, 'Hold TNS', c.holdTnsNs, 'ns')
    }
  }

  // 6. Routing & Congestion
  pushRow('Routing & Congestion', 'HPWL', data.routing.hpwlUm, 'um')
  pushRow(
    'Routing & Congestion',
    'Routed Wirelength',
    data.routing.routedWirelengthUm,
    'um',
  )
  pushRow('Routing & Congestion', 'Via Count', data.routing.viaCount, 'vias')
  pushRow(
    'Routing & Congestion',
    'Global Route Overflow',
    data.congestion.globalOverflowTotal,
    'tracks',
  )
  pushRow('Routing & Congestion', 'Max Overflow', data.congestion.maxOverflow, 'tracks')

  // 7. Power Analysis
  pushRow('Power Analysis', 'Total Power', data.power.totalPowerMw, 'mW')
  pushRow('Power Analysis', 'Dynamic Power', data.power.dynamicPowerMw, 'mW')
  pushRow('Power Analysis', 'Switching Power', data.power.switchingPowerMw, 'mW')
  pushRow('Power Analysis', 'Internal Power', data.power.internalPowerMw, 'mW')
  pushRow('Power Analysis', 'Leakage Power', data.power.leakagePowerMw, 'mW')

  // 8. Physical Verification
  pushRow(
    'Physical Verification',
    'DRC Violations',
    data.verification.drcCount,
    'violations',
  )
  pushRow(
    'Physical Verification',
    'LVS Mismatches',
    data.verification.lvsMismatchCount,
    'mismatches',
  )

  // 9. Execution Cost
  pushRow(
    'Execution Cost',
    'Total Runtime',
    data.execution.totalRuntimeFormatted ||
      (data.execution.totalRuntimeSeconds !== null
        ? `${data.execution.totalRuntimeSeconds} s`
        : null),
  )
  pushRow('Execution Cost', 'Peak Memory', data.execution.peakMemoryMb, 'MB')
  if (includeStageBreakdown && data.execution.stages.length > 0) {
    for (const s of data.execution.stages) {
      pushRow(
        'Stage Execution',
        `${s.stage} Runtime`,
        s.runtimeFormatted ||
          (s.runtimeSeconds !== null ? `${s.runtimeSeconds} s` : null),
      )
      pushRow('Stage Execution', `${s.stage} Peak Memory`, s.peakMemoryMb, 'MB')
    }
  }

  return rows.join('\n')
}
