import type {
  DesignReportData,
  DesignReportExportOptions,
} from '../../contracts/designReport.ts'

function escapeLatex(text: string | null | undefined): string {
  if (text === null || text === undefined || text === '') return '---'
  return String(text)
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
}

function fmtVal(val: number | string | null | undefined, unit = '', decimals = 2): string {
  if (val === null || val === undefined) return '---'
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return '---'
    const formatted = Number.isInteger(val) ? val.toLocaleString('en-US') : val.toFixed(decimals)
    return unit ? `${formatted} ${unit}` : formatted
  }
  return unit ? `${escapeLatex(String(val))} ${unit}` : escapeLatex(String(val))
}

export function formatLatexReport(
  data: DesignReportData,
  options: DesignReportExportOptions = {},
): string {
  const {
    latexStandalone = false,
    title = `Design Summary Report: ${data.design.designName}`,
  } = options

  const lines: string[] = []

  if (latexStandalone) {
    lines.push('\\documentclass[10pt,a4paper]{article}')
    lines.push('\\usepackage[utf8]{inputenc}')
    lines.push('\\usepackage[T1]{fontenc}')
    lines.push('\\usepackage{amsmath}')
    lines.push('\\usepackage{amssymb}')
    lines.push('\\usepackage{booktabs}')
    lines.push('\\usepackage{geometry}')
    lines.push('\\geometry{margin=1in}')
    lines.push('')
    lines.push(`\\title{\\textbf{${escapeLatex(title)}}}`)
    lines.push('\\author{ECOS Studio Automated Signoff Report}')
    lines.push('\\date{\\today}')
    lines.push('')
    lines.push('\\begin{document}')
    lines.push('\\maketitle')
    lines.push('')
  }

  // Section 1: Main Design & Summary Table
  lines.push('% ==============================================================================')
  lines.push('% ECOS STUDIO DESIGN SUMMARY TABLE')
  lines.push(`% Design: ${data.design.designName} | PDK: ${data.design.pdk}`)
  lines.push(`% Generated: ${data.design.generatedAt}`)
  lines.push('% ==============================================================================')
  lines.push('\\begin{table}[htbp]')
  lines.push('\\centering')
  lines.push(`\\caption{Design Implementation and Signoff Summary: ${escapeLatex(data.design.designName)}}`)
  lines.push(`\\label{tab:ecos_design_summary_${data.design.designName.toLowerCase().replace(/[^a-z0-9]/g, '_')}}`)
  lines.push('\\begin{tabular}{llr}')
  lines.push('\\toprule')
  lines.push('\\textbf{Category} & \\textbf{Metric} & \\textbf{Value} \\\\')
  lines.push('\\midrule')

  // Design & Technology
  lines.push('\\multicolumn{3}{l}{\\textbf{Design and Technology}} \\\\')
  lines.push(`  & Design Name & ${escapeLatex(data.design.designName)} \\\\`)
  const pdkCommitShort = data.design.pdkCommit ? `@${data.design.pdkCommit.slice(0, 8)}` : null
  const pdkSuffix = pdkCommitShort ? ` (${pdkCommitShort})` : (data.design.pdkVersion ? ` (${data.design.pdkVersion})` : '')
  lines.push(`  & PDK & ${escapeLatex(data.design.pdk + pdkSuffix)} \\\\`)
  if (data.design.ecosStudioVersion) {
    lines.push(`  & ECOS Studio Version & ${escapeLatex(data.design.ecosStudioVersion)} \\\\`)
  }
  if (data.design.gitCommit) {
    lines.push(`  & Git Commit & \\texttt{${escapeLatex(data.design.gitCommit.slice(0, 8))}} \\\\`)
  }
  lines.push('\\midrule')

  // Area & Physical
  lines.push('\\multicolumn{3}{l}{\\textbf{Area and Physical Design}} \\\\')
  lines.push(`  & Die Area & ${fmtVal(data.physical.dieAreaUm2, '$\\mu\\mathrm{m}^2$')}${data.physical.dieAreaMm2 !== null ? ` (${fmtVal(data.physical.dieAreaMm2, '$\\mathrm{mm}^2$', 4)})` : ''} \\\\`)
  lines.push(`  & Core Area & ${fmtVal(data.physical.coreAreaUm2, '$\\mu\\mathrm{m}^2$')} \\\\`)
  lines.push(`  & Core Utilization & ${fmtVal(data.physical.coreUtilizationPct, '\\%')} \\\\`)
  lines.push(`  & Standard Cell Area & ${fmtVal(data.physical.stdCellAreaUm2, '$\\mu\\mathrm{m}^2$')} \\\\`)
  if (data.physical.macroCount !== null && data.physical.macroCount > 0) {
    lines.push(`  & Macro Count / Area & ${fmtVal(data.physical.macroCount)} macros / ${fmtVal(data.physical.macroAreaUm2, '$\\mu\\mathrm{m}^2$')} \\\\`)
  }
  lines.push(`  & Total Instances & ${fmtVal(data.physical.instanceCount)} \\\\`)
  if (data.physical.sequentialCellCount !== null || data.physical.combinationalCellCount !== null) {
    lines.push(`  & Sequential / Comb. Cells & ${fmtVal(data.physical.sequentialCellCount)} / ${fmtVal(data.physical.combinationalCellCount)} \\\\`)
  }
  if (data.physical.ioPinCount !== null) {
    lines.push(`  & IO Pins & ${fmtVal(data.physical.ioPinCount)} \\\\`)
  }
  if (data.physical.netCount !== null) {
    lines.push(`  & Total Nets & ${fmtVal(data.physical.netCount)} \\\\`)
  }
  lines.push('\\midrule')

  // Timing Closure
  lines.push('\\multicolumn{3}{l}{\\textbf{Timing Closure}} \\\\')
  lines.push(`  & Target Clock Period & ${fmtVal(data.timing.targetClockPeriodNs, 'ns')}${data.timing.targetFrequencyMhz !== null ? ` (${fmtVal(data.timing.targetFrequencyMhz, 'MHz')})` : ''} \\\\`)
  lines.push(`  & Achieved $F_{\\mathrm{max}}$ & ${fmtVal(data.timing.fmaxMhz, 'MHz')} \\\\`)
  lines.push(`  & Setup WNS / TNS & ${fmtVal(data.timing.setupWnsNs, 'ns')} / ${fmtVal(data.timing.setupTnsNs, 'ns')} \\\\`)
  lines.push(`  & Hold WNS / TNS & ${fmtVal(data.timing.holdWnsNs, 'ns')} / ${fmtVal(data.timing.holdTnsNs, 'ns')} \\\\`)
  if (data.timing.violatingEndpointsSetup !== null || data.timing.violatingEndpointsHold !== null) {
    lines.push(`  & Violating Endpoints (Setup / Hold) & ${fmtVal(data.timing.violatingEndpointsSetup, '', 0)} / ${fmtVal(data.timing.violatingEndpointsHold, '', 0)} \\\\`)
  }
  if (data.timing.criticalPathDelayNs !== null) {
    lines.push(`  & Critical Path Delay & ${fmtVal(data.timing.criticalPathDelayNs, 'ns')} \\\\`)
  }
  if (data.timing.slewViolations !== null || data.timing.capViolations !== null || data.timing.fanoutViolations !== null) {
    lines.push(`  & DRC Electrical (Slew / Cap / Fanout) & ${fmtVal(data.timing.slewViolations, '', 0)} / ${fmtVal(data.timing.capViolations, '', 0)} / ${fmtVal(data.timing.fanoutViolations, '', 0)} \\\\`)
  }
  lines.push('\\midrule')

  // Clock Tree & Quality
  lines.push('\\multicolumn{3}{l}{\\textbf{Clock Tree and Quality}} \\\\')
  lines.push(`  & Clock Tree Depth & ${fmtVal(data.clock.clockTreeLevels, 'levels', 0)} \\\\`)
  if (data.clock.clockBufferCount !== null || data.clock.clockTotalBuffers !== null) {
    const bufCountStr = data.clock.clockBufferCount !== null ? `${data.clock.clockBufferCount}` : `${data.clock.clockTotalBuffers}`
    const areaStr = data.clock.clockBufferAreaUm2 !== null ? ` (${fmtVal(data.clock.clockBufferAreaUm2, '$\\mu\\mathrm{m}^2$')})` : ''
    lines.push(`  & Clock Buffers & ${bufCountStr}${areaStr} \\\\`)
  }
  if (data.clock.clockPathMinBuffer !== null || data.clock.clockPathMaxBuffer !== null) {
    lines.push(`  & Clock Path Buffers (Min / Max) & ${fmtVal(data.clock.clockPathMinBuffer, '', 0)} / ${fmtVal(data.clock.clockPathMaxBuffer, '', 0)} \\\\`)
  }
  if (data.clock.clockWirelengthUm !== null) {
    lines.push(`  & Clock Wirelength & ${fmtVal(data.clock.clockWirelengthUm, '$\\mu\\mathrm{m}$')}${data.clock.clockMaxWirelengthUm !== null ? ` (Max: ${fmtVal(data.clock.clockMaxWirelengthUm, '$\\mu\\mathrm{m}$')})` : ''} \\\\`)
  }
  if (data.clock.clockNetsCount !== null) {
    lines.push(`  & Clock Nets & ${fmtVal(data.clock.clockNetsCount, 'nets', 0)} \\\\`)
  }
  if (data.clock.clockSkewPs !== null) {
    lines.push(`  & Clock Skew & ${fmtVal(data.clock.clockSkewPs, 'ps')} \\\\`)
  }
  if (data.clock.clockLatencyNs !== null) {
    lines.push(`  & Clock Insertion Latency & ${fmtVal(data.clock.clockLatencyNs, 'ns')} \\\\`)
  }
  lines.push('\\midrule')

  // Routing & Congestion
  lines.push('\\multicolumn{3}{l}{\\textbf{Routing and Congestion}} \\\\')
  lines.push(`  & Half-Perimeter Wirelength (HPWL) & ${fmtVal(data.routing.hpwlUm, '$\\mu\\mathrm{m}$')} \\\\`)
  lines.push(`  & Routed Wirelength & ${fmtVal(data.routing.routedWirelengthUm, '$\\mu\\mathrm{m}$')} \\\\`)
  lines.push(`  & Via Count & ${fmtVal(data.routing.viaCount, '', 0)} \\\\`)
  if (data.congestion.globalOverflowTotal !== null || data.congestion.globalOverflowPct !== null) {
    lines.push(`  & Global Route Overflow & ${fmtVal(data.congestion.globalOverflowTotal, '', 0)}${data.congestion.globalOverflowPct !== null ? ` (${fmtVal(data.congestion.globalOverflowPct, '\\%')})` : ''} \\\\`)
  }
  lines.push('\\midrule')

  // Power Analysis
  lines.push('\\multicolumn{3}{l}{\\textbf{Power Analysis}} \\\\')
  lines.push(`  & Total Power & ${fmtVal(data.power.totalPowerMw, 'mW')} \\\\`)
  lines.push(`  & Dynamic Power & ${fmtVal(data.power.dynamicPowerMw, 'mW')} \\\\`)
  lines.push(`  & Leakage Power & ${fmtVal(data.power.leakagePowerMw, 'mW')} \\\\`)
  lines.push('\\midrule')

  // Physical Verification
  lines.push('\\multicolumn{3}{l}{\\textbf{Physical Verification}} \\\\')
  lines.push(`  & DRC Status & ${data.verification.drcStatus === 'clean' ? 'Clean (0 violations)' : data.verification.drcStatus === 'violations' ? `Violations (${fmtVal(data.verification.drcCount, '', 0)})` : 'Unrun'} \\\\`)
  lines.push(`  & LVS Status & ${data.verification.lvsStatus === 'matched' ? 'Matched (Clean)' : data.verification.lvsStatus === 'mismatch' ? `Mismatches (${fmtVal(data.verification.lvsMismatchCount, '', 0)})` : 'Unrun'} \\\\`)

  lines.push('\\bottomrule')
  lines.push('\\end{tabular}')
  lines.push('\\end{table}')
  lines.push('')

  if (latexStandalone) {
    lines.push('\\end{document}')
  }

  return lines.join('\n')
}
