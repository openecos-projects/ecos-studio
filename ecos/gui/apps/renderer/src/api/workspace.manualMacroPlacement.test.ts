import { describe, expect, it } from 'vitest'
import type { WorkspaceConfig } from '@ecos-studio/shared'
import { backendWorkspaceOptions } from './workspace'

function config(manualMacroPlacement: boolean): WorkspaceConfig {
  return {
    directory: '/workspace/manual-macro',
    origin_def: '',
    origin_verilog: '/rtl/top.v',
    parameters: {
      design: 'top',
      top_module: 'top',
      clock: 'clk',
      manual_macro_placement: manualMacroPlacement,
    },
    pdk: 'ics55',
    pdk_root: '/pdks/ics55',
    rtl_list: ['/rtl/top.v'],
  }
}

describe('manual macro-placement workspace parameter projection', () => {
  it('maps the wizard toggle onto the ECC spec key from the parameter catalog', () => {
    const options = backendWorkspaceOptions(config(true), '/workspace/manual-macro', {
      manual_macro_placement: 'macro.manual_placement',
    })

    const parameters = options.workspaceSpec.parameters as Record<string, unknown>
    expect(parameters['macro.manual_placement']).toBe(true)
  })

  it('sends an explicit false so updates can disable the gate', () => {
    const options = backendWorkspaceOptions(config(false), '/workspace/manual-macro', {
      manual_macro_placement: 'macro.manual_placement',
    })

    const parameters = options.workspaceSpec.parameters as Record<string, unknown>
    expect(parameters['macro.manual_placement']).toBe(false)
  })

  it('omits the parameter when an older ECC catalog does not advertise it', () => {
    const options = backendWorkspaceOptions(config(true), '/workspace/manual-macro')

    expect(options.workspaceSpec.parameters).not.toHaveProperty('macro.manual_placement')
  })

  it('omits the parameter when MacroPlacement is outside the selected flow range', () => {
    const workspaceConfig = config(true)
    workspaceConfig.flow_config = {
      start_step: 'place',
      end_step: 'Harden',
      steps: ['place', 'CTS', 'route', 'sta', 'Harden'],
    }

    const options = backendWorkspaceOptions(workspaceConfig, '/workspace/manual-macro', {
      manual_macro_placement: 'macro.manual_placement',
    })

    expect(options.workspaceSpec.parameters).not.toHaveProperty('macro.manual_placement')
  })
})
