import { describe, expect, it } from 'vitest'
import { extractDesignReportData } from '../designReportExtract.ts'
import { formatMarkdownReport } from './markdownFormatter.ts'

describe('markdownFormatter', () => {
  const sampleData = extractDesignReportData({
    workspacePath: '/projects/aes/ws_002',
    parameters: {
      Design: 'aes_128',
      PDK: 'ic55',
      PDK_VERSION: 'v1.0.0',
      ECC_TOOL: 'ecc-fe',
      ECC_VERSION: '1.4.2',
      ECOS_STUDIO_VERSION: '0.1.0-alpha.8',
    },
    flow: {
      steps: [
        { name: 'Synthesis_yosys', tool: 'Yosys', state: 'Success', runtime: '0:1:15', 'peak memory (mb)': 220 },
      ],
    },
    stepMetrics: {
      Harden: {
        die_area_um2: 450000,
        core_area_um2: 380000,
        utilization: 52.0,
      },
      CTS: {
        cts_clock_tree_max_level: 3,
        cts_buffer_count: 5,
        cts_buffer_area: 14.2,
      },
      STA: {
        clock_period: 20.0,
        setup_wns: 1.25,
        setup_tns: 0.0,
        hold_wns: 0.22,
        hold_tns: 0.0,
      },
      DRC: { drc_violations: 0 },
      LVS: { lvs_mismatches: 0 },
    },
  })

  it('generates structured Markdown tables without redundant ECC tool and without emojis', () => {
    const md = formatMarkdownReport(sampleData)
    expect(md).toContain('# Design Summary Report: aes_128')
    expect(md).toContain('**ECOS Studio Version**: `0.1.0-alpha.8`')
    expect(md).toContain('## 1. Design Summary')
    expect(md).toContain('## 2. Area & Physical Metrics')
    expect(md).toContain('## 3. Timing & Clock Quality')
    expect(md).toContain('450,000')
    expect(md).toContain('52 %')
    expect(md).toContain('Pass')
    expect(md).toContain('| Clock Tree Depth | 3 | levels | Maximum clock tree level |')
    expect(md).toContain('| Clock Buffers | 5 (14.20 μm²) | count | CTS inserted clock buffers |')
  })

  it('renders multi-corner table with timing measurements only', () => {
    const dataWithCorners = {
      ...sampleData,
      multiCornerTiming: [
        {
          corner: 'WCL_m40_RCworst',
          processCorner: 'WCL',
          rcCorner: 'RCworst',
          temperatureC: -40,
          voltageV: 0.9,
          setupWnsNs: 0.12,
          setupTnsNs: 0,
          holdWnsNs: 0.05,
          holdTnsNs: 0,
          status: 'pass' as const,
        },
      ],
    }
    const md = formatMarkdownReport(dataWithCorners)
    expect(md).toContain('## 4. Multi-Corner Timing Analysis')
    expect(md).toContain('| Corner | Setup WNS (ns) | Setup TNS (ns) | Hold WNS (ns) | Hold TNS (ns) | Status |')
    expect(md).toContain('| `WCL_m40_RCworst` | 0.12 | 0 | 0.05 | 0 | PASS |')
    expect(md).not.toContain('| Corner | Process |')
  })
})
