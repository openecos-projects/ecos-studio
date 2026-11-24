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

  it('submits clock-tree and Replay options alongside scoped placement settings', () => {
    const workspaceConfig = config(true)
    workspaceConfig.parameters.replay_enabled = true
    workspaceConfig.flow_config = {
      start_step: 'synthesis',
      end_step: 'filler',
      steps: ['synthesis', 'pre_floorplan', 'placement', 'cts', 'routing', 'filler'],
    }
    const options = backendWorkspaceOptions(workspaceConfig, '/workspace/clock-tree', {
      clock_tree: 'geometry.clock_tree',
      replay_enabled: 'replay.enabled',
      target_density: 'place.target_density',
      target_overflow: 'place.stop_overflow',
    })

    expect(options.workspaceSpec.parameters).toMatchObject({
      'geometry.clock_tree': true,
      'replay.enabled': true,
      'placement:place.target_density': 0.2,
      'placement:place.stop_overflow': 0.1,
    })
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
