import { describe, expect, it } from 'vitest'
import {
  normalizeWorkspaceFlowConfig,
  workspaceReconfigureInitialConfig,
} from './workspaceReconfigure'

describe('workspaceReconfigureInitialConfig', () => {
  it('maps the ECC canonical projection without reading derived files', () => {
    const result = workspaceReconfigureInitialConfig(
      {
        configuration: {
          workspaceSpec: {
            schemaVersion: 1,
            design: { name: 'gcd', topModule: 'gcd_top', clockPort: 'clk' },
            inputMode: 'rtl',
            inputs: [
              { inputId: 'rtl-main', role: 'rtl' },
              { inputId: 'constraints', role: 'sdc' },
            ],
            parameters: {
              'design.frequency_mhz': 250,
              'floorplan.core_margin': [3, 4],
              'macro.manual_placement': true,
              'cts.max_fanout': '32',
              'placement:place.stop_overflow': 0.13,
              'place.target_density': 0.4,
              'placement:place.target_density': 0.25,
              'floorplan.die_builder.mode': 'die_util',
              'floorplan.die_builder.die_size.width_micron': 100,
              'floorplan.die_builder.die_size.height_micron': 200,
            },
            pdk: {
              familyId: 'ics55',
              mode: 'manual',
              files: [
                { fileId: 'tech', role: 'tech' },
                { fileId: 'cells', role: 'lef' },
                { fileId: 'lib', role: 'liberty' },
              ],
            },
            flow: {
              flowId: 'rtl2gds',
              fromStepId: 'Synthesis',
              throughStepId: 'STA',
              stepSubprocess: false,
            },
          },
          workspaceBindings: {
            inputs: { 'rtl-main': '/ws/origin/gcd.v', constraints: '/ws/origin/gcd.sdc' },
            pdk: {
              root: '/pdk',
              files: {
                tech: '/pdk/tech.lef',
                cells: '/pdk/cells.lef',
                lib: '/pdk/typ.lib',
              },
            },
          },
        },
        directory: '/ws',
        flow: {
          steps: [
            {
              name: 'Synthesis',
              tool: 'yosys',
              state: 'Success',
              runtime: '',
              peakMemory: 0,
            },
            {
              name: 'FixFanout',
              tool: 'ecc',
              state: 'Success',
              runtime: '',
              peakMemory: 0,
            },
            { name: 'STA', tool: 'ecc', state: 'Unstart', runtime: '', peakMemory: 0 },
          ],
        },
        lastEventId: 'event-1',
        operations: [],
        parameters: {},
        workspaceHandle: 'workspace-1',
      },
      '/ws',
      null,
    )

    expect(result).toMatchObject({
      pdk: 'ics55',
      pdk_root: '/pdk',
      rtl_list: ['/ws/origin/gcd.v'],
      sdc: '',
      parameters: {
        design: 'gcd',
        top_module: 'gcd_top',
        frequency_max: 250,
        margin: 3,
        manual_macro_placement: true,
        max_fanout: 32,
        target_overflow: 0.13,
        target_density: 0.25,
        die_area_mode: 'utilization_margin',
      },
      flow_config: { steps: ['Synthesis', 'STA'], step_subprocess: false },
      pdk_config: {
        tech_lef: ['/pdk/tech.lef'],
        cell_lef: ['/pdk/cells.lef'],
        liberty: ['/pdk/typ.lib'],
      },
    })
  })
})

describe('normalizeWorkspaceFlowConfig', () => {
  it.each([true, false])(
    'restores saved step subprocess mode %s when reconfiguring',
    (stepSubprocess) => {
      expect(
        normalizeWorkspaceFlowConfig(
          JSON.stringify({
            options: { execution: { step_subprocess: stepSubprocess } },
            steps: [{ name: 'Synthesis', state: 'pass' }, 'Filler', { name: 'LVS' }],
          }),
        ),
      ).toEqual({
        start_step: 'Synthesis',
        end_step: 'LVS',
        steps: ['Synthesis', 'Filler', 'LVS'],
        step_subprocess: stepSubprocess,
      })
    },
  )

  it.each([
    null,
    'invalid json',
    '{}',
    JSON.stringify({ options: { execution: { step_subprocess: 'false' } } }),
  ])(
    'keeps legacy defaults for absent or malformed execution settings: %s',
    (flowText) => {
      expect(normalizeWorkspaceFlowConfig(flowText)).toEqual({
        start_step: 'Synthesis',
        end_step: 'Harden',
        steps: ['Synthesis', 'Harden'],
      })
    },
  )
})
