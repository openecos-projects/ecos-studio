import type {
  DesignReportData,
  DesignReportExportOptions,
} from '../../contracts/designReport.ts'

function escapeTypst(text: string | null | undefined): string {
  if (text === null || text === undefined || text === '') return '---'
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/([#$*_`[\]"])/g, '\\$1')
}

function fmtVal(
  val: number | string | null | undefined,
  unit = '',
  decimals = 2,
): string {
  if (val === null || val === undefined) return '---'
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return '---'
    const formatted = Number.isInteger(val)
      ? val.toLocaleString('en-US')
      : val.toFixed(decimals)
    return unit ? `${formatted} ${unit}` : formatted
  }
  return unit ? `${escapeTypst(String(val))} ${unit}` : escapeTypst(String(val))
}

export function formatTypstReport(
  data: DesignReportData,
  options: DesignReportExportOptions = {},
): string {
  const {
    typstStandalone = false,
    title = `Design Summary Report: ${data.design.designName}`,
  } = options

  const lines: string[] = []

  if (typstStandalone) {
    lines.push('#set page(')
    lines.push('  paper: "a4",')
    lines.push('  margin: (x: 1.8cm, top: 1.5cm, bottom: 1.5cm),')
    lines.push(')')
    lines.push('#set text(')
    lines.push('  font: "New Computer Modern",')
    lines.push('  size: 9.5pt,')
    lines.push(')')
    lines.push('#set par(justify: true)')
    lines.push('')
    lines.push('#align(center)[')
    lines.push(`  #text(14pt, weight: "bold")[${escapeTypst(title)}] \\`)
    lines.push('  #v(0.25em)')
    lines.push(
      '  #text(9pt, fill: luma(90))[#datetime.today().display("[month repr:long] [day], [year]")]',
    )
    lines.push(']')
    lines.push('#v(0.4em)')
    lines.push('')
  }

  // Section 1: Main Design & Summary Table (1:1 with LaTeX table)
  lines.push(
    '// ==============================================================================',
  )
  lines.push('// ECOS STUDIO DESIGN SUMMARY TABLE')
  lines.push(`// Design: ${data.design.designName} | PDK: ${data.design.pdk}`)
  lines.push(`// Generated: ${data.design.generatedAt}`)
  lines.push(
    '// ==============================================================================',
  )
  lines.push('#figure(')
  lines.push(
    `  caption: [Design Implementation and Signoff Summary: ${escapeTypst(data.design.designName)}],`,
  )
  lines.push('  gap: 0.6em,')
  lines.push('  table(')
  lines.push('    columns: (1.2fr, 2fr, 1.2fr),')
  lines.push('    align: (left, left, right),')
  lines.push('    inset: (x: 5.5pt, y: 3pt),')
  lines.push('    stroke: none,')
  lines.push('    table.hline(stroke: 1.2pt),')
  lines.push('    table.header([*Category*], [*Metric*], [*Value*]),')
  lines.push('    table.hline(stroke: 0.6pt),')
  lines.push('')

  // Design & Technology
  lines.push('    table.cell(colspan: 3)[*Design and Technology*],')
  lines.push(`    [], [Design Name], [${escapeTypst(data.design.designName)}],`)
  const pdkCommitShort = data.design.pdkCommit
    ? `@${data.design.pdkCommit.slice(0, 8)}`
    : null
  const pdkSuffix = pdkCommitShort
    ? ` (${pdkCommitShort})`
    : data.design.pdkVersion
      ? ` (${data.design.pdkVersion})`
      : ''
  lines.push(`    [], [PDK], [${escapeTypst(data.design.pdk + pdkSuffix)}],`)
  if (data.design.ecosStudioVersion) {
    lines.push(
      `    [], [ECOS Studio Version], [${escapeTypst(data.design.ecosStudioVersion)}],`,
    )
  }
  if (data.design.gitCommit) {
    lines.push(
      `    [], [Git Commit], [\`${data.design.gitCommit.slice(0, 8).replace(/`/g, '')}\`],`,
    )
  }
  lines.push('    table.hline(stroke: 0.6pt),')
  lines.push('')

  // Area & Physical
  lines.push('    table.cell(colspan: 3)[*Area and Physical Design*],')
  lines.push(
    `    [], [Die Area], [${fmtVal(data.physical.dieAreaUm2, '$mu"m"^2$')}${data.physical.dieAreaMm2 !== null ? ` (${fmtVal(data.physical.dieAreaMm2, '$"mm"^2$', 4)})` : ''}],`,
  )
  lines.push(`    [], [Core Area], [${fmtVal(data.physical.coreAreaUm2, '$mu"m"^2$')}],`)
  lines.push(
    `    [], [Core Utilization], [${fmtVal(data.physical.coreUtilizationPct, '%')}],`,
  )
  lines.push(
    `    [], [Standard Cell Area], [${fmtVal(data.physical.stdCellAreaUm2, '$mu"m"^2$')}],`,
  )
  if (data.physical.macroCount !== null && data.physical.macroCount > 0) {
    lines.push(
      `    [], [Macro Count / Area], [${fmtVal(data.physical.macroCount)} macros / ${fmtVal(data.physical.macroAreaUm2, '$mu"m"^2$')}],`,
    )
  }
  lines.push(`    [], [Total Instances], [${fmtVal(data.physical.instanceCount)}],`)
  if (
    data.physical.sequentialCellCount !== null ||
    data.physical.combinationalCellCount !== null
  ) {
    lines.push(
      `    [], [Sequential / Comb. Cells], [${fmtVal(data.physical.sequentialCellCount)} / ${fmtVal(data.physical.combinationalCellCount)}],`,
    )
  }
  if (data.physical.ioPinCount !== null) {
    lines.push(`    [], [IO Pins], [${fmtVal(data.physical.ioPinCount)}],`)
  }
  if (data.physical.netCount !== null) {
    lines.push(`    [], [Total Nets], [${fmtVal(data.physical.netCount)}],`)
  }
  lines.push('    table.hline(stroke: 0.6pt),')
  lines.push('')

  // Timing Closure
  lines.push('    table.cell(colspan: 3)[*Timing Closure*],')
  lines.push(
    `    [], [Target Clock Period], [${fmtVal(data.timing.targetClockPeriodNs, 'ns')}${data.timing.targetFrequencyMhz !== null ? ` (${fmtVal(data.timing.targetFrequencyMhz, 'MHz')})` : ''}],`,
  )
  lines.push(`    [], [Achieved $F_"max"$], [${fmtVal(data.timing.fmaxMhz, 'MHz')}],`)
  lines.push(
    `    [], [Setup WNS / TNS], [${fmtVal(data.timing.setupWnsNs, 'ns')} / ${fmtVal(data.timing.setupTnsNs, 'ns')}],`,
  )
  lines.push(
    `    [], [Hold WNS / TNS], [${fmtVal(data.timing.holdWnsNs, 'ns')} / ${fmtVal(data.timing.holdTnsNs, 'ns')}],`,
  )
  if (
    data.timing.violatingEndpointsSetup !== null ||
    data.timing.violatingEndpointsHold !== null
  ) {
    lines.push(
      `    [], [Violating Endpoints (Setup / Hold)], [${fmtVal(data.timing.violatingEndpointsSetup, '', 0)} / ${fmtVal(data.timing.violatingEndpointsHold, '', 0)}],`,
    )
  }
  if (data.timing.criticalPathDelayNs !== null) {
    lines.push(
      `    [], [Critical Path Delay], [${fmtVal(data.timing.criticalPathDelayNs, 'ns')}],`,
    )
  }
  if (
    data.timing.slewViolations !== null ||
    data.timing.capViolations !== null ||
    data.timing.fanoutViolations !== null
  ) {
    lines.push(
      `    [], [DRC Electrical (Slew / Cap / Fanout)], [${fmtVal(data.timing.slewViolations, '', 0)} / ${fmtVal(data.timing.capViolations, '', 0)} / ${fmtVal(data.timing.fanoutViolations, '', 0)}],`,
    )
  }
  lines.push('    table.hline(stroke: 0.6pt),')
  lines.push('')

  // Clock Tree & Quality
  lines.push('    table.cell(colspan: 3)[*Clock Tree and Quality*],')
  lines.push(
    `    [], [Clock Tree Depth], [${fmtVal(data.clock.clockTreeLevels, 'levels', 0)}],`,
  )
  if (data.clock.clockBufferCount !== null || data.clock.clockTotalBuffers !== null) {
    const bufCountStr =
      data.clock.clockBufferCount !== null
        ? `${data.clock.clockBufferCount}`
        : `${data.clock.clockTotalBuffers}`
    const areaStr =
      data.clock.clockBufferAreaUm2 !== null
        ? ` (${fmtVal(data.clock.clockBufferAreaUm2, '$mu"m"^2$')})`
        : ''
    lines.push(`    [], [Clock Buffers], [${bufCountStr}${areaStr}],`)
  }
  if (data.clock.clockPathMinBuffer !== null || data.clock.clockPathMaxBuffer !== null) {
    lines.push(
      `    [], [Clock Path Buffers (Min / Max)], [${fmtVal(data.clock.clockPathMinBuffer, '', 0)} / ${fmtVal(data.clock.clockPathMaxBuffer, '', 0)}],`,
    )
  }
  if (data.clock.clockWirelengthUm !== null) {
    lines.push(
      `    [], [Clock Wirelength], [${fmtVal(data.clock.clockWirelengthUm, '$mu"m"$')}${data.clock.clockMaxWirelengthUm !== null ? ` (Max: ${fmtVal(data.clock.clockMaxWirelengthUm, '$mu"m"$')})` : ''}],`,
    )
  }
  if (data.clock.clockNetsCount !== null) {
    lines.push(`    [], [Clock Nets], [${fmtVal(data.clock.clockNetsCount, 'nets', 0)}],`)
  }
  if (data.clock.clockSkewPs !== null) {
    lines.push(`    [], [Clock Skew], [${fmtVal(data.clock.clockSkewPs, 'ps')}],`)
  }
  if (data.clock.clockLatencyNs !== null) {
    lines.push(
      `    [], [Clock Insertion Latency], [${fmtVal(data.clock.clockLatencyNs, 'ns')}],`,
    )
  }
  lines.push('    table.hline(stroke: 0.6pt),')
  lines.push('')

  // Routing & Congestion
  lines.push('    table.cell(colspan: 3)[*Routing and Congestion*],')
  lines.push(
    `    [], [Half-Perimeter Wirelength (HPWL)], [${fmtVal(data.routing.hpwlUm, '$mu"m"$')}],`,
  )
  lines.push(
    `    [], [Routed Wirelength], [${fmtVal(data.routing.routedWirelengthUm, '$mu"m"$')}],`,
  )
  lines.push(`    [], [Via Count], [${fmtVal(data.routing.viaCount, '', 0)}],`)
  if (
    data.congestion.globalOverflowTotal !== null ||
    data.congestion.globalOverflowPct !== null
  ) {
    lines.push(
      `    [], [Global Route Overflow], [${fmtVal(data.congestion.globalOverflowTotal, '', 0)}${data.congestion.globalOverflowPct !== null ? ` (${fmtVal(data.congestion.globalOverflowPct, '%')})` : ''}],`,
    )
  }
  lines.push('    table.hline(stroke: 0.6pt),')
  lines.push('')

  // Power Analysis
  lines.push('    table.cell(colspan: 3)[*Power Analysis*],')
  lines.push(`    [], [Total Power], [${fmtVal(data.power.totalPowerMw, 'mW')}],`)
  lines.push(`    [], [Dynamic Power], [${fmtVal(data.power.dynamicPowerMw, 'mW')}],`)
  lines.push(`    [], [Leakage Power], [${fmtVal(data.power.leakagePowerMw, 'mW')}],`)
  lines.push('    table.hline(stroke: 0.6pt),')
  lines.push('')

  // Physical Verification
  lines.push('    table.cell(colspan: 3)[*Physical Verification*],')
  lines.push(
    `    [], [DRC Status], [${data.verification.drcStatus === 'clean' ? 'Clean (0 violations)' : data.verification.drcStatus === 'violations' ? `Violations (${fmtVal(data.verification.drcCount, '', 0)})` : 'Unrun'}],`,
  )
  lines.push(
    `    [], [LVS Status], [${data.verification.lvsStatus === 'matched' ? 'Matched (Clean)' : data.verification.lvsStatus === 'mismatch' ? `Mismatches (${fmtVal(data.verification.lvsMismatchCount, '', 0)})` : 'Unrun'}],`,
  )

  lines.push('    table.hline(stroke: 1.2pt),')
  lines.push('  )')
  lines.push(')')
  lines.push('')

  return lines.join('\n')
}
