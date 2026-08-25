import { describe, expect, it } from 'vitest'
import { extractDesignReportData } from '../designReportExtract.ts'
import { formatLatexReport } from './latexFormatter.ts'

describe('latexFormatter', () => {
  const sampleData = extractDesignReportData({
    workspacePath: '/projects/gcd/ws_001',
    parameters: {
      Design: 'gcd_core',
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
          runtime: '0:0:30',
          'peak memory (mb)': 120,
        },
      ],
    },
    stepMetrics: {
      Harden: {
        die_area_um2: 100000,
        core_area_um2: 80000,
        utilization: 45.0,
      },
      CTS: {
        cts_clock_tree_max_level: 2,
        cts_buffer_count: 3,
        cts_buffer_area: 8.4,
        clock_path_min_buffer: 2,
        clock_path_max_buffer: 2,
        total_clock_wirelength: 224087,
      },
      STA: {
        clock_period: 10.0,
        setup_wns: 0.5,
        setup_tns: 0.0,
        hold_wns: 0.1,
        hold_tns: 0.0,
        total_power: 0.027,
        dynamic_power: 0.024,
        leakage_power: 0.003,
        corners: {
          nom_tt_025C_1v80: { setup_wns: 0.5, setup_tns: 0, hold_wns: 0.1, hold_tns: 0 },
        },
      },
      DRC: { drc_violations: 0 },
      LVS: { lvs_mismatches: 0 },
    },
  })

  it('generates a clean single LaTeX table with booktabs, rich clock metrics, and escaped strings', () => {
    const tex = formatLatexReport(sampleData, { latexStandalone: false })
    expect(tex).toContain('\\begin{table}[!htbp]')
    expect(tex).toContain('\\toprule')
    expect(tex).toContain('\\midrule')
    expect(tex).toContain('\\bottomrule')
    expect(tex).toContain('gcd\\_core')
    expect(tex).toContain('100,000')
    expect(tex).toContain('Clock Tree Depth & 2 levels')
    expect(tex).toContain('Clock Buffers & 3 (8.40 $\\mu\\mathrm{m}^2$)')
    expect(tex).toContain('Clock Path Buffers (Min / Max) & 2 / 2')
    expect(tex).toContain('Total Power & 0.03 mW')
    expect(tex).toContain('\\end{table}')
    // Verified: ECC Tool and redundant second table removed
    expect(tex).not.toContain('ECC Tool')
    expect(tex).not.toContain('MULTI-CORNER TIMING EVIDENCE')
    expect(tex).not.toContain('Flow Stage Execution Cost Breakdown')
    // Ensure there is exactly 1 table
    const tableMatches = tex.match(/\\begin\{table\}/g) || []
    expect(tableMatches.length).toBe(1)
  })

  it('generates a full standalone document when requested', () => {
    const tex = formatLatexReport(sampleData, { latexStandalone: true })
    expect(tex).toContain('\\documentclass')
    expect(tex).toContain('\\begin{document}')
    expect(tex).toContain('\\end{document}')
  })
})
