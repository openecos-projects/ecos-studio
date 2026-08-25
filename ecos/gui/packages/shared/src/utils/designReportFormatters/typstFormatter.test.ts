import { describe, expect, it } from 'vitest'
import { extractDesignReportData } from '../designReportExtract.ts'
import { formatTypstReport } from './typstFormatter.ts'

describe('typstFormatter', () => {
  const sampleData = extractDesignReportData({
    workspacePath: '/projects/aes/ws_002',
    parameters: {
      Design: 'aes_128',
      PDK: 'ic55',
      PDK_VERSION: 'v1.0.0',
      PDK_COMMIT: 'e83fa201b9',
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
          runtime: '0:1:15',
          'peak memory (mb)': 220,
        },
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

  it('generates structured Typst publication table with inline PDK commit matching LaTeX 1:1', () => {
    const typ = formatTypstReport(sampleData)
    expect(typ).toContain('#figure(')
    expect(typ).toContain(
      'caption: [Design Implementation and Signoff Summary: aes\\_128]',
    )
    expect(typ).toContain('table.header([*Category*], [*Metric*], [*Value*])')
    expect(typ).toContain('table.cell(colspan: 3)[*Design and Technology*]')
    expect(typ).toContain('ic55 (@e83fa201)')
    expect(typ).toContain('0.1.0-alpha.8')
    expect(typ).toContain('table.cell(colspan: 3)[*Area and Physical Design*]')
    expect(typ).toContain('450,000 $mu"m"^2$')
    expect(typ).toContain('52 %')
    expect(typ).toContain('table.cell(colspan: 3)[*Timing Closure*]')
    expect(typ).toContain('Target Clock Period')
    expect(typ).toContain('table.cell(colspan: 3)[*Physical Verification*]')
    expect(typ).toContain('Clean (0 violations)')
    expect(typ).toContain('Matched (Clean)')
  })

  it('renders standalone Typst document with New Computer Modern font matching LaTeX article geometry', () => {
    const typ = formatTypstReport(sampleData, { typstStandalone: true })
    expect(typ).toContain('#set page(')
    expect(typ).toContain('paper: "a4"')
    expect(typ).toContain('font: "New Computer Modern"')
    expect(typ).toContain('#align(center)[')
    expect(typ).toContain('#text(14pt, weight: "bold")[Design Summary Report: aes\\_128]')
  })
})
