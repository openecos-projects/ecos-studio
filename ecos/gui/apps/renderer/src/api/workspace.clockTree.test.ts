import { describe, expect, it } from 'vitest'
import type { WorkspaceConfig } from '@ecos-studio/shared'
import { backendWorkspaceOptions } from './workspace'

function config(clockTree: boolean): WorkspaceConfig {
  return {
    directory: '/workspace/clock-tree',
    origin_def: '',
    origin_verilog: '/rtl/top.v',
    parameters: {
      design: 'top',
      top_module: 'top',
      clock: 'clk',
      clock_tree: clockTree,
    },
    pdk: 'ics55',
    pdk_root: '/pdks/ics55',
    rtl_list: ['/rtl/top.v'],
  }
}

describe('clock-tree workspace parameter projection', () => {
  it('uses the catalog display key and preserves an enabled toggle', () => {
    const options = backendWorkspaceOptions(config(true), '/workspace/clock-tree', {
      clock_tree: 'geometry.clock_tree',
    })

    const parameters = options.workspaceSpec.parameters as Record<string, unknown>
    expect(parameters['geometry.clock_tree']).toBe(true)
  })

  it('omits the parameter when an older ECC catalog does not advertise it', () => {
    const options = backendWorkspaceOptions(config(true), '/workspace/clock-tree')

    expect(options.workspaceSpec.parameters).not.toHaveProperty('geometry.clock_tree')
  })

  it('omits the parameter when CTS is outside the selected flow range', () => {
    const workspaceConfig = config(true)
    workspaceConfig.flow_config = {
      start_step: 'route',
      end_step: 'Harden',
      steps: ['route', 'filler', 'RCX', 'sta', 'powerAnalysis', 'Harden'],
    }

    const options = backendWorkspaceOptions(workspaceConfig, '/workspace/clock-tree', {
      clock_tree: 'geometry.clock_tree',
    })

    expect(options.workspaceSpec.parameters).not.toHaveProperty('geometry.clock_tree')
  })
})
