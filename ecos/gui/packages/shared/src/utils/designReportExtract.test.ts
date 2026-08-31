import { describe, expect, it } from 'vitest'
import {
  canonicalizeStageName,
  extractDesignReportData,
  formatDuration,
  parsePowerRpt,
  parseQorSummaryRpt,
  parseRuntimeSeconds,
} from './designReportExtract.ts'

describe('designReportExtract', () => {
  describe('helper functions', () => {
    it('canonicalizes various stage name spellings', () => {
      expect(canonicalizeStageName('synthesis')).toBe('Synth')
      expect(canonicalizeStageName('Synthesis_yosys')).toBe('Synth')
      expect(canonicalizeStageName('Floorplan_ecc')).toBe('Floor')
      expect(canonicalizeStageName('place_dreamplace')).toBe('Place')
      expect(canonicalizeStageName('CTS_ecc')).toBe('CTS')
      expect(canonicalizeStageName('route_ecc')).toBe('Route')
      expect(canonicalizeStageName('drc_ecc')).toBe('DRC')
      expect(canonicalizeStageName('lvs_ecc')).toBe('LVS')
      expect(canonicalizeStageName('sta_ecc')).toBe('STA')
      expect(canonicalizeStageName('Harden_ecc')).toBe('Harden')
      expect(canonicalizeStageName('CustomStep')).toBe('CustomStep')
    })

    it('parses runtime strings and numbers', () => {
      expect(parseRuntimeSeconds('0:1:6')).toBe(66)
      expect(parseRuntimeSeconds('1:30:15')).toBe(5415)
      expect(parseRuntimeSeconds('45')).toBe(45)
      expect(parseRuntimeSeconds(120)).toBe(120)
      expect(parseRuntimeSeconds('')).toBeNull()
      expect(parseRuntimeSeconds(null)).toBeNull()
    })

    it('formats duration in seconds to human readable strings', () => {
      expect(formatDuration(45)).toBe('45s')
      expect(formatDuration(125)).toBe('2m 5s')
      expect(formatDuration(3665)).toBe('1h 1m 5s')
      expect(formatDuration(null)).toBeNull()
      expect(formatDuration(-10)).toBeNull()
    })

    it('parses power.rpt text into structured power metrics', () => {
      const samplePowerRpt = `
Design : gcd
Operating Conditions: ICS_N55_H7BL_ss_mos_Cworst_1.08_-40
Global Operating Voltage = 1.08

Dynamic Power Units = 1mW
Leakage Power Units = 1nW

Cell Internal Power  =   20.9663 uW
Net Switching Power  =    6.3762 uW
Total Dynamic Power  =   27.3425 uW
Cell Leakage Power   =    4.2913 nW

--------------------------------------------------------------------------------------------------
Total          2.0966e-02 mW     6.3762e-03 mW         4.2913 nW     2.7347e-02 mW
`
      const parsed = parsePowerRpt(samplePowerRpt)
      expect(parsed.voltageV).toBe(1.08)
      expect(parsed.internalPowerMw).toBeCloseTo(0.020966, 5)
      expect(parsed.switchingPowerMw).toBeCloseTo(0.006376, 5)
      expect(parsed.dynamicPowerMw).toBeCloseTo(0.027342, 5)
      expect(parsed.leakagePowerMw).toBeCloseTo(0.00000429, 7)
      expect(parsed.totalPowerMw).toBeCloseTo(0.027347, 5)
    })

    it('parses qor_summary.rpt text into structured timing metrics', () => {
      const sampleQorRpt = `
Path Group                  WNS        TNS     NVP      FREQ      WNS(H)     TNS(H)  NVP(H)
-------------------------------------------------------------------------------------------
clk                      16.882        0.0       0     321MHz      0.256        0.0       0
-------------------------------------------------------------------------------------------
Summary                  16.882        0.0       0     321MHz      0.256        0.0       0
-------------------------------------------------------------------------------------------
`
      const parsed = parseQorSummaryRpt(sampleQorRpt)
      expect(parsed.wns).toBe(16.882)
      expect(parsed.tns).toBe(0.0)
      expect(parsed.nvp).toBe(0)
      expect(parsed.frequencyMhz).toBe(321)
      expect(parsed.holdWns).toBe(0.256)
      expect(parsed.holdTns).toBe(0.0)
      expect(parsed.holdNvp).toBe(0)
    })
  })

  describe('extractDesignReportData', () => {
    it('extracts complete flow metrics correctly across all stages and parses Schema 3 format', () => {
      const result = extractDesignReportData({
        workspacePath: '/projects/gcd/ws_001',
        workspaceName: 'gcd_run1',
        parameters: {
          Design: 'gcd',
          PDK: 'sky130hd',
          PDK_VERSION: 'v0.12.0',
          PDK_COMMIT: '1234567890abcdef',
          ECC_TOOL: 'ecc-fe',
          ECC_VERSION: '1.4.2',
          ECOS_STUDIO_VERSION: '0.1.0-alpha.8',
          GIT_COMMIT: 'abcdef1234567890',
          CLOCK_PERIOD: 10.0,
          POWER_CORNER: 'nom_tt_025C_1v80',
        },
        flow: {
          timestamp: '2026-08-25T12:00:00Z',
          steps: [
            {
              name: 'Synthesis_yosys',
              tool: 'Yosys',
              state: 'Success',
              runtime: '0:0:30',
              'peak memory (mb)': 120,
            },
            {
              name: 'Floorplan_ecc',
              tool: 'OpenROAD',
              state: 'Success',
              runtime: '0:0:15',
              'peak memory (mb)': 200,
            },
            {
              name: 'place_dreamplace',
              tool: 'DreamPlace',
              state: 'Success',
              runtime: '0:1:00',
              'peak memory (mb)': 450,
            },
            {
              name: 'CTS_ecc',
              tool: 'OpenROAD',
              state: 'Success',
              runtime: '0:0:45',
              'peak memory (mb)': 310,
            },
            {
              name: 'route_ecc',
              tool: 'OpenROAD',
              state: 'Success',
              runtime: '0:2:30',
              'peak memory (mb)': 600,
            },
            {
              name: 'sta_ecc',
              tool: 'OpenSTA',
              state: 'Success',
              runtime: '0:0:20',
              'peak memory (mb)': 280,
            },
            {
              name: 'drc_ecc',
              tool: 'KLayout',
              state: 'Success',
              runtime: '0:0:10',
              'peak memory (mb)': 150,
            },
            {
              name: 'lvs_ecc',
              tool: 'Netgen',
              state: 'Success',
              runtime: '0:0:10',
              'peak memory (mb)': 140,
            },
            {
              name: 'Harden_ecc',
              tool: 'OpenROAD',
              state: 'Success',
              runtime: '0:0:40',
              'peak memory (mb)': 520,
            },
          ],
        },
        stepMetrics: {
          Synth: {
            schema_version: 3,
            metrics: [
              { id: 'sequential_cells', value: 32 },
              { id: 'combinational_cells', value: 540 },
              { id: 'instances', value: 572 },
            ],
          },
          Floor: {
            'Design Layout': {
              die_area: 100000,
              core_area: 80000,
            },
            'Design Statis': {
              num_iopins: 54,
            },
            macro_count: 0,
            macro_area: 0,
          },
          Place: {
            utilization: 48.5,
            hpwl: 125000,
          },
          CTS: {
            clock_skew: 42.5,
            clock_latency: 1.25,
            clock_buffer_count: 12,
            clock_inverter_count: 8,
            clock_tree_levels: 3,
            clock_wirelength: 4500,
          },
          Route: {
            Nets: {
              wire_len: 158000,
              num_via: 3200,
            },
            routing_completion: 100,
            global_overflow: 0,
            global_overflow_pct: 0,
            max_overflow: 0,
            net_count: 590,
          },
          STA: {
            clock_period: 10.0,
            setup_wns: 0.85,
            setup_tns: 0.0,
            hold_wns: 0.12,
            hold_tns: 0.0,
            violating_endpoints_setup: 0,
            violating_endpoints_hold: 0,
            slew_violations: 0,
            cap_violations: 0,
            fanout_violations: 0,
            critical_path_delay: 9.15,
            total_power: 1.45,
            dynamic_power: 1.32,
            switching_power: 0.85,
            internal_power: 0.47,
            leakage_power: 0.13,
            voltage: 1.8,
            temperature: 25,
            corners: {
              nom_tt_025C_1v80: {
                setup_wns: 0.85,
                setup_tns: 0.0,
                hold_wns: 0.12,
                hold_tns: 0.0,
                voltage: 1.8,
                temperature: 25,
              },
              ss_100C_1v60: {
                setup_wns: -0.25,
                setup_tns: -1.2,
                hold_wns: 0.35,
                hold_tns: 0.0,
                voltage: 1.6,
                temperature: 100,
              },
            },
          },
          DRC: {
            drc_violations: 0,
            antenna_violations: 0,
            erc_violations: 0,
          },
          LVS: {
            lvs_mismatches: 0,
          },
          Harden: {
            'Design Layout': {
              die_area: 100000,
            },
            Instances: {
              total: {
                area: 38800,
                num: 572,
              },
            },
          },
        },
      })

      // Design
      expect(result.design.designName).toBe('gcd')
      expect(result.design.pdk).toBe('sky130hd')
      expect(result.design.pdkVersion).toBe('v0.12.0')
      expect(result.design.pdkCommit).toBe('1234567890abcdef')
      expect(result.design.eccTool).toBe('ecc-fe')
      expect(result.design.eccVersion).toBe('1.4.2')
      expect(result.design.ecosStudioVersion).toBe('0.1.0-alpha.8')
      expect(result.design.gitCommit).toBe('abcdef1234567890')

      // Physical
      expect(result.physical.dieAreaUm2).toBe(100000)
      expect(result.physical.dieAreaMm2).toBe(0.1)
      expect(result.physical.coreAreaUm2).toBe(80000)
      expect(result.physical.coreUtilizationPct).toBe(48.5)
      expect(result.physical.stdCellAreaUm2).toBe(38800)
      expect(result.physical.instanceCount).toBe(572)
      expect(result.physical.sequentialCellCount).toBe(32)
      expect(result.physical.combinationalCellCount).toBe(540)
      expect(result.physical.ioPinCount).toBe(54)
      expect(result.physical.netCount).toBe(590)

      // Timing
      expect(result.timing.targetClockPeriodNs).toBe(10.0)
      expect(result.timing.targetFrequencyMhz).toBe(100.0)
      expect(result.timing.setupWnsNs).toBe(0.85)
      expect(result.timing.setupTnsNs).toBe(0.0)
      expect(result.timing.holdWnsNs).toBe(0.12)
      expect(result.timing.holdTnsNs).toBe(0.0)
      expect(result.timing.fmaxMhz).toBe(+(1000 / (10.0 - 0.85)).toFixed(2))
      expect(result.timing.criticalPathDelayNs).toBe(9.15)
      expect(result.timing.slewViolations).toBe(0)
      expect(result.timing.capViolations).toBe(0)
      expect(result.timing.fanoutViolations).toBe(0)
      expect(result.timing.violatingEndpointsSetup).toBe(0)

      // Multi-corner
      expect(result.multiCornerTiming).toHaveLength(2)
      expect(result.multiCornerTiming[0].corner).toBe('nom_tt_025C_1v80')
      expect(result.multiCornerTiming[0].status).toBe('pass')
      expect(result.multiCornerTiming[1].corner).toBe('ss_100C_1v60')
      expect(result.multiCornerTiming[1].status).toBe('fail')

      // Clock
      expect(result.clock.clockSkewPs).toBe(42.5)
      expect(result.clock.clockLatencyNs).toBe(1.25)
      expect(result.clock.clockBufferCount).toBe(12)
      expect(result.clock.clockInverterCount).toBe(8)
      expect(result.clock.clockTotalBuffers).toBe(20)

      // Routing
      expect(result.routing.hpwlUm).toBe(125000)
      expect(result.routing.routedWirelengthUm).toBe(158000)
      expect(result.routing.viaCount).toBe(3200)
      expect(result.routing.routingCompletionPct).toBe(100)

      // Power
      expect(result.power.totalPowerMw).toBe(1.45)
      expect(result.power.dynamicPowerMw).toBe(1.32)
      expect(result.power.leakagePowerMw).toBe(0.13)

      // Verification
      expect(result.verification.drcStatus).toBe('clean')
      expect(result.verification.drcCount).toBe(0)
      expect(result.verification.lvsStatus).toBe('matched')
      expect(result.verification.lvsMismatchCount).toBe(0)

      // Execution
      expect(result.execution.totalRuntimeSeconds).toBe(380)
      expect(result.execution.totalRuntimeFormatted).toBe('6m 20s')
      expect(result.execution.peakMemoryMb).toBe(600)
      expect(result.execution.stages).toHaveLength(9)

      // Provenance
      expect(result.provenance.length).toBeGreaterThan(10)
    })

    it('handles partially completed or missing flow gracefully without throwing', () => {
      const result = extractDesignReportData({
        workspacePath: '/projects/partial_design',
        parameters: {
          Design: 'partial_alu',
        },
        flow: null,
        stepMetrics: {
          Synth: {
            instances: 150,
          },
        },
      })

      expect(result.design.designName).toBe('partial_alu')
      expect(result.physical.instanceCount).toBe(150)
      expect(result.physical.dieAreaUm2).toBeNull()
      expect(result.timing.setupWnsNs).toBeNull()
      expect(result.multiCornerTiming).toEqual([])
      expect(result.verification.drcStatus).toBe('unrun')
      expect(result.execution.stages).toEqual([])
    })

    it('flags warnings on abnormal values like out of range utilization', () => {
      const result = extractDesignReportData({
        workspacePath: '/projects/bad_util',
        stepMetrics: {
          Place: {
            utilization: 125.0, // > 100%
          },
        },
      })

      expect(result.warnings.some((w) => w.code === 'PHYS_UTIL_OUT_OF_RANGE')).toBe(true)
    })

    it('extracts target clock period and frequency from "Frequency max [MHz]" parameter', () => {
      const result = extractDesignReportData({
        workspacePath: '/media/projects/gcd/ws_0001',
        parameters: {
          PDK: 'ics55',
          Design: 'gcd',
          'Frequency max [MHz]': 50,
          'Max fanout': 32,
        },
        stepMetrics: {
          STA: {
            setup_wns: 16.622,
          },
        },
      })

      expect(result.timing.targetFrequencyMhz).toBe(50)
      expect(result.timing.targetClockPeriodNs).toBe(20.0)
      expect(result.timing.setupWnsNs).toBe(16.622)
    })
  })
})
