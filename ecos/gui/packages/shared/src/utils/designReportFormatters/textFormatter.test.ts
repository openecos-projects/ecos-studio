import { describe, expect, it } from 'vitest'
import { extractDesignReportData } from '../designReportExtract.ts'
import { formatTextReport } from './textFormatter.ts'

describe('textFormatter', () => {
  const sampleData = extractDesignReportData({
    workspacePath: '/projects/ibex/ws_004',
    parameters: {
      Design: 'ibex_core',
      PDK: 'ic55',
      PDK_VERSION: 'v0.12.0',
      ECC_TOOL: 'ecc-fe',
      ECC_VERSION: '1.4.2',
      ECOS_STUDIO_VERSION: '0.1.0-alpha.8',
    },
    flow: {
      steps: [
        {
          name: 'Synthesis_yosys',
          tool: 'Yosys',
          state: 'Success',
          runtime: '0:2:30',
          'peak memory (mb)': 350,
        },
      ],
    },
    stepMetrics: {
      Harden: {
        die_area_um2: 620000,
        core_area_um2: 500000,
        utilization: 49.2,
      },
      CTS: {
        cts_clock_tree_max_level: 2,
        cts_buffer_count: 4,
        cts_buffer_area: 11.2,
      },
      STA: {
        clock_period: 15.0,
        setup_wns: 0.35,
        setup_tns: 0.0,
        hold_wns: 0.08,
        hold_tns: 0.0,
      },
      DRC: { drc_violations: 0 },
      LVS: { lvs_mismatches: 0 },
    },
  })

  it('generates an aligned ASCII table report with ECOS studio version, rich clock metrics, and no emojis', () => {
    const txt = formatTextReport(sampleData)
    expect(txt).toContain('ECOS STUDIO — DESIGN SUMMARY REPORT')
    expect(txt).toContain('Design Name        : ibex_core')
    expect(txt).toContain('ECOS Studio Version: 0.1.0-alpha.8')
    expect(txt).toContain('[ 1. PHYSICAL & AREA METRICS ]')
    expect(txt).toContain('[ 2. TIMING CLOSURE & PERFORMANCE ]')
    expect(txt).toContain('[ 3. CLOCK TREE & QUALITY ]')
    expect(txt).toContain('620,000')
    expect(txt).toContain('49.20 %')
    expect(txt).toContain('2 levels')
    expect(txt).toContain('4 (11.20 um²)')
    expect(txt).toContain('END OF REPORT')
  })
})
