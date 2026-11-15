import { expect, it } from 'vitest'
import type { WorkspaceConfig } from '@ecos-studio/shared'
import { backendWorkspaceOptions } from './workspace'

it('passes the Replay toggle using the ECC catalog key and preserves the selected flow', () => {
  const config: WorkspaceConfig = {
    directory: '/work/demo',
    pdk: 'ics55',
    pdk_root: '/pdks/ics55',
    origin_def: '',
    origin_verilog: '/rtl/top.v',
    rtl_list: ['/rtl/top.v'],
    parameters: { replay_enabled: true },
    flow_config: {
      start_step: 'postFloorplan',
      end_step: 'place',
      steps: ['postFloorplan', 'preplace', 'place'],
    },
  }
  const baseline = backendWorkspaceOptions(
    { ...config, parameters: {} },
    config.directory,
  )
  const result = backendWorkspaceOptions(config, config.directory, {
    replay_enabled: 'replay.enabled',
  })
  expect(result.workspaceSpec.parameters).toHaveProperty('replay.enabled', true)
  expect(result.workspaceSpec.flow).toEqual(baseline.workspaceSpec.flow)
  expect(() => backendWorkspaceOptions(config, config.directory)).toThrow(
    'does not support Replay',
  )
})
