import type {
  DesignReportData,
  DesignReportExportOptions,
} from '../../contracts/designReport.ts'

function fmt(
  val: number | string | boolean | null | undefined,
  unit = '',
  decimals = 2,
): string {
  if (val === null || val === undefined) return '—'
  if (typeof val === 'boolean') return val ? 'true' : 'false'
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return '—'
    const formatted = Number.isInteger(val)
      ? val.toLocaleString('en-US')
      : val.toFixed(decimals)
    return unit ? `${formatted} ${unit}` : formatted
  }
  return unit ? `${val} ${unit}` : String(val)
}

export function formatMarkdownReport(
  data: DesignReportData,
  options: DesignReportExportOptions = {},
): string {
  const {
    includeMultiCorner = true,
    includeStageBreakdown = true,
    includeVerificationBreakdown = true,
  } = options

  const lines: string[] = []

  lines.push(`# Design Summary Report: ${data.design.designName}`)
  lines.push('')

  const metaParts: string[] = []
  const pdkCommitShort = data.design.pdkCommit
    ? `@${data.design.pdkCommit.slice(0, 8)}`
    : null
  const pdkSuffix = pdkCommitShort
    ? ` (${pdkCommitShort})`
    : data.design.pdkVersion
      ? ` (${data.design.pdkVersion})`
      : ''
  metaParts.push(`**PDK**: \`${data.design.pdk}${pdkSuffix}\``)
  if (data.design.ecosStudioVersion) {
    metaParts.push(`**ECOS Studio Version**: \`${data.design.ecosStudioVersion}\``)
  }
  metaParts.push(`**Generated**: \`${data.design.generatedAt}\``)
  lines.push(`> ${metaParts.join(' | ')}`)

  if (data.design.gitCommit || data.design.runId) {
    const trackingParts: string[] = []
    if (data.design.gitCommit) {
      trackingParts.push(`**Git Commit**: \`${data.design.gitCommit.slice(0, 8)}\``)
    }
    if (data.design.runId) {
      trackingParts.push(`**Run ID**: \`${data.design.runId}\``)
    }
    lines.push(`> ${trackingParts.join(' | ')}`)
  }
  lines.push('')

  const setupStatus =
    data.timing.setupWnsNs === null
      ? '—'
      : data.timing.setupWnsNs >= 0
        ? 'Pass'
        : 'Violation'
  const holdStatus =
    data.timing.holdWnsNs === null
      ? '—'
      : data.timing.holdWnsNs >= 0
        ? 'Pass'
        : 'Violation'

  const clockTreeSummary =
    data.clock.clockTreeLevels !== null
      ? `${data.clock.clockTreeLevels} levels${data.clock.clockBufferCount !== null ? `, ${data.clock.clockBufferCount} buffers` : ''}`
      : data.clock.clockBufferCount !== null
        ? `${data.clock.clockBufferCount} buffers`
        : data.clock.clockCellCount !== null
          ? `${data.clock.clockCellCount} clock cells`
          : data.clock.clockSkewPs !== null
            ? `${data.clock.clockSkewPs} ps skew`
            : '—'

  //Design Summary
  lines.push('## 1. Design Summary')
  lines.push('')
  lines.push('| Metric | Value | Reference Unit | Status / Notes |')
  lines.push('| :--- | :--- | :--- | :--- |')
  lines.push(
    `| **Die Area** | ${fmt(data.physical.dieAreaUm2)}${data.physical.dieAreaMm2 !== null ? ` (${fmt(data.physical.dieAreaMm2, 'mm²', 4)})` : ''} | $\\mu\\text{m}^2$ | Physical boundary |`,
  )
  lines.push(
    `| **Core Area** | ${fmt(data.physical.coreAreaUm2)} | $\\mu\\text{m}^2$ | Core boundary |`,
  )
  lines.push(
    `| **Core Utilization** | ${fmt(data.physical.coreUtilizationPct, '%')} | % | Placement density |`,
  )
  lines.push(
    `| **Instance Count** | ${fmt(data.physical.instanceCount)} | cells | Total standard cells & macros |`,
  )
  lines.push(
    `| **Target Frequency** | ${fmt(data.timing.targetFrequencyMhz, 'MHz')} | MHz | ${data.timing.targetClockPeriodNs !== null ? `Clock period: ${fmt(data.timing.targetClockPeriodNs, 'ns')}` : '—'} |`,
  )
  lines.push(
    `| **Achieved $F_{\\text{max}}$** | ${fmt(data.timing.fmaxMhz, 'MHz')} | MHz | Based on worst setup slack |`,
  )
  lines.push(
    `| **Setup Slack (WNS / TNS)** | ${fmt(data.timing.setupWnsNs, 'ns')} / ${fmt(data.timing.setupTnsNs, 'ns')} | ns | ${setupStatus} |`,
  )
  lines.push(
    `| **Hold Slack (WNS / TNS)** | ${fmt(data.timing.holdWnsNs, 'ns')} / ${fmt(data.timing.holdTnsNs, 'ns')} | ns | ${holdStatus} |`,
  )
  lines.push(
    `| **Clock Tree QoR** | ${clockTreeSummary} | levels / count | Clock tree structure & buffers |`,
  )
  lines.push(
    `| **Routed Wirelength** | ${fmt(data.routing.routedWirelengthUm, 'μm')} | $\\mu\\text{m}$ | Total detailed route wirelength |`,
  )
  lines.push(
    `| **Via Count** | ${fmt(data.routing.viaCount)} | count | Total routing vias |`,
  )
  lines.push(
    `| **Global Route Overflow** | ${fmt(data.congestion.globalOverflowTotal)}${data.congestion.globalOverflowPct !== null ? ` (${fmt(data.congestion.globalOverflowPct, '%')})` : ''} | tracks | Congestion state |`,
  )
  lines.push(
    `| **Total Power** | ${fmt(data.power.totalPowerMw, 'mW')} | mW | Dynamic: ${fmt(data.power.dynamicPowerMw, 'mW')}, Leakage: ${fmt(data.power.leakagePowerMw, 'mW')} |`,
  )
  lines.push(
    `| **DRC / LVS Status** | ${data.verification.drcStatus === 'clean' ? 'DRC Clean (0)' : `DRC Violations (${fmt(data.verification.drcCount)})`} / ${data.verification.lvsStatus === 'matched' ? 'LVS Matched' : `LVS Mismatch (${fmt(data.verification.lvsMismatchCount)})`} | status | Signoff verification |`,
  )
  lines.push(
    `| **Total Runtime** | ${data.execution.totalRuntimeFormatted || fmt(data.execution.totalRuntimeSeconds, 's')} | time | Peak Memory: ${fmt(data.execution.peakMemoryMb, 'MB')} |`,
  )
  lines.push('')

  //Area & Physical Breakdown
  lines.push('## 2. Area & Physical Metrics')
  lines.push('')
  lines.push('| Metric | Value | Unit | Description |')
  lines.push('| :--- | :--- | :--- | :--- |')
  lines.push(
    `| Die Area | ${fmt(data.physical.dieAreaUm2)} | $\\mu\\text{m}^2$ | Overall die boundary area |`,
  )
  lines.push(
    `| Core Area | ${fmt(data.physical.coreAreaUm2)} | $\\mu\\text{m}^2$ | Standard cell placement area |`,
  )
  lines.push(
    `| Core Utilization | ${fmt(data.physical.coreUtilizationPct, '%')} | % | Ratio of cell area to core area |`,
  )
  lines.push(
    `| Standard Cell Area | ${fmt(data.physical.stdCellAreaUm2)} | $\\mu\\text{m}^2$ | Sum of standard cell areas |`,
  )
  lines.push(
    `| Macro Area / Count | ${fmt(data.physical.macroAreaUm2, 'μm²')} / ${fmt(data.physical.macroCount)} | $\\mu\\text{m}^2$ / count | Hard macros & memory blocks |`,
  )
  lines.push(
    `| Total Instances | ${fmt(data.physical.instanceCount)} | count | Total placed cell instances |`,
  )
  lines.push(
    `| Sequential Cells | ${fmt(data.physical.sequentialCellCount)} | count | Flip-flops and latches |`,
  )
  lines.push(
    `| Combinational Cells | ${fmt(data.physical.combinationalCellCount)} | count | Logic gates |`,
  )
  lines.push(
    `| IO Pins | ${fmt(data.physical.ioPinCount)} | count | Boundary IO pin count |`,
  )
  lines.push(
    `| Total Nets | ${fmt(data.physical.netCount)} | count | Logical and physical net count |`,
  )
  lines.push('')

  //Timing & Clock Quality
  lines.push('## 3. Timing & Clock Quality')
  lines.push('')
  lines.push('| Parameter | Target / Value | Unit | Status |')
  lines.push('| :--- | :--- | :--- | :--- |')
  lines.push(
    `| Target Clock Period | ${fmt(data.timing.targetClockPeriodNs)} | ns | ${data.timing.targetFrequencyMhz !== null ? `Target frequency: ${fmt(data.timing.targetFrequencyMhz, 'MHz')}` : '—'} |`,
  )
  lines.push(
    `| Maximum Frequency ($F_{\\text{max}}$) | ${fmt(data.timing.fmaxMhz)} | MHz | Maximum achievable clock rate |`,
  )
  lines.push(
    `| Setup Worst Negative Slack (WNS) | ${fmt(data.timing.setupWnsNs)} | ns | ${setupStatus === 'Pass' ? 'Pass' : setupStatus === 'Violation' ? 'Fail' : '—'} |`,
  )
  lines.push(
    `| Setup Total Negative Slack (TNS) | ${fmt(data.timing.setupTnsNs)} | ns | Cumulative setup violation |`,
  )
  lines.push(
    `| Hold Worst Negative Slack (WNS) | ${fmt(data.timing.holdWnsNs)} | ns | ${holdStatus === 'Pass' ? 'Pass' : holdStatus === 'Violation' ? 'Fail' : '—'} |`,
  )
  lines.push(
    `| Hold Total Negative Slack (TNS) | ${fmt(data.timing.holdTnsNs)} | ns | Cumulative hold violation |`,
  )
  lines.push(
    `| Critical Path Delay | ${fmt(data.timing.criticalPathDelayNs)} | ns | Worst data path propagation time |`,
  )
  lines.push(
    `| Setup Violating Endpoints | ${fmt(data.timing.violatingEndpointsSetup)} | endpoints | Endpoints failing setup check |`,
  )
  const slewStr =
    data.timing.slewViolations !== null
      ? `${data.timing.slewViolations}`
      : data.timing.setupWnsNs !== null && data.timing.setupWnsNs >= 0
        ? '0'
        : '—'
  const capStr =
    data.timing.capViolations !== null
      ? `${data.timing.capViolations}`
      : data.timing.setupWnsNs !== null && data.timing.setupWnsNs >= 0
        ? '0'
        : '—'
  const fanoutStr =
    data.timing.fanoutViolations !== null
      ? `${data.timing.fanoutViolations}`
      : data.timing.setupWnsNs !== null && data.timing.setupWnsNs >= 0
        ? '0'
        : '—'
  lines.push(
    `| Max Slew / Cap / Fanout Violations | ${slewStr} / ${capStr} / ${fanoutStr} | violations | Design rule electrical violations |`,
  )
  lines.push(
    `| Clock Tree Depth | ${fmt(data.clock.clockTreeLevels)} | levels | Maximum clock tree level |`,
  )
  if (data.clock.clockBufferCount !== null || data.clock.clockTotalBuffers !== null) {
    const bufCountStr =
      data.clock.clockBufferCount !== null
        ? `${data.clock.clockBufferCount}`
        : `${data.clock.clockTotalBuffers}`
    const areaStr =
      data.clock.clockBufferAreaUm2 !== null
        ? ` (${fmt(data.clock.clockBufferAreaUm2, 'μm²')})`
        : ''
    lines.push(
      `| Clock Buffers | ${bufCountStr}${areaStr} | count | CTS inserted clock buffers |`,
    )
  }
  if (data.clock.clockPathMinBuffer !== null || data.clock.clockPathMaxBuffer !== null) {
    lines.push(
      `| Clock Path Buffers (Min / Max) | ${fmt(data.clock.clockPathMinBuffer)} / ${fmt(data.clock.clockPathMaxBuffer)} | count | Buffer count per path range |`,
    )
  }
  if (data.clock.clockWirelengthUm !== null) {
    lines.push(
      `| Clock Wirelength | ${fmt(data.clock.clockWirelengthUm, 'μm')}${data.clock.clockMaxWirelengthUm !== null ? ` (Max: ${fmt(data.clock.clockMaxWirelengthUm, 'μm')})` : ''} | $\\mu\\text{m}$ | Total clock routing length |`,
    )
  }
  if (data.clock.clockNetsCount !== null) {
    lines.push(
      `| Clock Nets | ${fmt(data.clock.clockNetsCount)} | nets | Dedicated clock nets |`,
    )
  }
  if (data.clock.clockSkewPs !== null) {
    lines.push(
      `| Clock Skew | ${fmt(data.clock.clockSkewPs, 'ps')} | ps | Worst arrival difference across sinks |`,
    )
  }
  if (data.clock.clockLatencyNs !== null) {
    lines.push(
      `| Clock Insertion Latency | ${fmt(data.clock.clockLatencyNs, 'ns')} | ns | Delay from root clock to leaf registers |`,
    )
  }
  lines.push('')

  //Multi-Corner Timing
  if (includeMultiCorner && data.multiCornerTiming.length > 0) {
    lines.push('## 4. Multi-Corner Timing Analysis')
    lines.push('')
    lines.push(
      '| Corner | Setup WNS (ns) | Setup TNS (ns) | Hold WNS (ns) | Hold TNS (ns) | Status |',
    )
    lines.push('| :--- | :--- | :--- | :--- | :--- | :--- |')
    for (const c of data.multiCornerTiming) {
      lines.push(
        `| \`${c.corner}\` | ${fmt(c.setupWnsNs)} | ${fmt(c.setupTnsNs)} | ${fmt(c.holdWnsNs)} | ${fmt(c.holdTnsNs)} | ${c.status === 'pass' ? 'PASS' : c.status === 'fail' ? 'FAIL' : '—'} |`,
      )
    }
    lines.push('')
  }

  //Routing, Congestion & Power
  lines.push('## 5. Routing, Congestion & Power')
  lines.push('')
  lines.push('| Category | Metric | Value | Unit |')
  lines.push('| :--- | :--- | :--- | :--- |')
  lines.push(
    `| Routing | Half-Perimeter Wirelength (HPWL) | ${fmt(data.routing.hpwlUm)} | $\\mu\\text{m}$ |`,
  )
  lines.push(
    `| Routing | Routed Wirelength | ${fmt(data.routing.routedWirelengthUm)} | $\\mu\\text{m}$ |`,
  )
  lines.push(`| Routing | Total Via Count | ${fmt(data.routing.viaCount)} | count |`)
  lines.push(
    `| Congestion | Global Route Overflow | ${fmt(data.congestion.globalOverflowTotal)} | tracks |`,
  )
  lines.push(
    `| Congestion | Max Overflow | ${fmt(data.congestion.maxOverflow)} | tracks |`,
  )
  lines.push(`| Power | Total Power | ${fmt(data.power.totalPowerMw)} | mW |`)
  lines.push(`| Power | Dynamic Power | ${fmt(data.power.dynamicPowerMw)} | mW |`)
  lines.push(`| Power | Switching Power | ${fmt(data.power.switchingPowerMw)} | mW |`)
  lines.push(`| Power | Internal Power | ${fmt(data.power.internalPowerMw)} | mW |`)
  lines.push(`| Power | Leakage Power | ${fmt(data.power.leakagePowerMw)} | mW |`)
  lines.push('')

  //Physical Verification
  if (includeVerificationBreakdown) {
    lines.push('## 6. Physical Verification & Signoff')
    lines.push('')
    lines.push('| Verification Check | Result | Violation Count | Status |')
    lines.push('| :--- | :--- | :--- | :--- |')
    lines.push(
      `| Design Rule Check (DRC) | ${data.verification.drcStatus === 'clean' ? 'Clean' : data.verification.drcStatus === 'violations' ? 'Violations Found' : 'Unrun'} | ${fmt(data.verification.drcCount)} | ${data.verification.drcStatus === 'clean' ? 'PASS' : data.verification.drcStatus === 'violations' ? 'FAIL' : '—'} |`,
    )
    lines.push(
      `| Layout vs Schematic (LVS) | ${data.verification.lvsStatus === 'matched' ? 'Netlist Matched' : data.verification.lvsStatus === 'mismatch' ? 'Mismatches Found' : 'Unrun'} | ${fmt(data.verification.lvsMismatchCount)} | ${data.verification.lvsStatus === 'matched' ? 'PASS' : data.verification.lvsStatus === 'mismatch' ? 'FAIL' : '—'} |`,
    )
    lines.push('')
  }

  //Stage Breakdown
  if (includeStageBreakdown && data.execution.stages.length > 0) {
    lines.push('## 7. Flow Stage Execution Breakdown')
    lines.push('')
    lines.push('| Stage | Tool | Runtime | Peak Memory (MB) | State |')
    lines.push('| :--- | :--- | :--- | :--- | :--- |')
    for (const s of data.execution.stages) {
      lines.push(
        `| **${s.stage}** | \`${s.tool}\` | ${s.runtimeFormatted || fmt(s.runtimeSeconds, 's')} | ${fmt(s.peakMemoryMb)} | ${s.state} |`,
      )
    }
    lines.push('')
  }

  return lines.join('\n')
}
