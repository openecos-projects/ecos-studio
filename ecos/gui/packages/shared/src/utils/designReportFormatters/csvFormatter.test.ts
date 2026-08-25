import { describe, expect, it } from 'vitest'
import { extractDesignReportData } from '../designReportExtract.ts'
import { formatCsvReport } from './csvFormatter.ts'

describe('csvFormatter', () => {
  const sampleData = extractDesignReportData({
    workspacePath: '/projects/picorv32/ws_003',
    parameters: {
      Design: 'picorv32',
      PDK: 'ic55',
      PDK_VERSION: 'v0.12.0',
      PDK_COMMIT: '1234567890abcdef',
      ECC_TOOL: 'ecc-fe',
      ECC_VERSION: '1.4.2',
      ECOS_STUDIO_VERSION: '0.1.0-alpha.8',
    },
    flow: {
      steps: [
        { name: 'Synthesis_yosys', tool: 'Yosys', state: 'Success', runtime: '0:0:45', 'peak memory (mb)': 180 },
      ],
    },
    stepMetrics: {
      Harden: {
        die_area_um2: 250000,
        core_area_um2: 210000,
        utilization: 42.0,
      },
      CTS: {
        cts_clock_tree_max_level: 2,
        cts_buffer_count: 3,
        cts_buffer_area: 8.4,
      },
      STA: {
        clock_period: 12.5,
        setup_wns: 0.4,
        setup_tns: 0.0,
        hold_wns: 0.15,
        hold_tns: 0.0,
      },
      DRC: { drc_violations: 0 },
      LVS: { lvs_mismatches: 0 },
    },
  })

  it('generates clean, structured 4-column CSV without inaccurate tool names', () => {
    const csv = formatCsvReport(sampleData)
    const lines = csv.split('\n')
    expect(lines[0]).toBe('Category,Metric,Value,Unit')
    expect(csv).toContain('Design & Technology,Design Name,picorv32,')
    expect(csv).toContain('Design & Technology,PDK,ic55 (@12345678),')
    expect(csv).toContain('Design & Technology,ECOS Studio Version,0.1.0-alpha.8,')
    expect(csv).toContain('Physical & Area,Die Area,250000,um2')
    expect(csv).toContain('Timing & Performance,Setup WNS,0.4,ns')
    expect(csv).toContain('Clock Tree & Quality,Clock Tree Depth,2,levels')
    expect(csv).toContain('Clock Tree & Quality,Clock Buffer Count,3,buffers')
    expect(csv).toContain('Clock Tree & Quality,Clock Buffer Area,8.4,um2')
    expect(csv).toContain('Physical Verification,DRC Violations,0,violations')
    // Ensure no hardcoded tool names
    expect(csv).not.toContain('DreamPlace')
    expect(csv).not.toContain('ECC Tool')
  })
})
