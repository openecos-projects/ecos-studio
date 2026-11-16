import { expect, it } from 'vitest'
import type { WorkspaceConfig } from '@ecos-studio/shared'
import { backendWorkspaceOptions } from './workspace'

it.each([false, true, undefined])(
  'transports workspace execution mode %s as a flow option',
  (mode) => {
    const config: WorkspaceConfig = {
      directory: '/work/demo',
      pdk: 'ics55',
      pdk_root: '/pdks/ics55',
      origin_def: '',
      origin_verilog: '/rtl/top.v',
      rtl_list: ['/rtl/top.v'],
      parameters: {},
      flow_config: {
        start_step: 'Synthesis',
        end_step: 'Harden',
        steps: ['Synthesis', 'Harden'],
        ...(mode === undefined ? {} : { step_subprocess: mode }),
      },
    }
    const result = backendWorkspaceOptions(config, config.directory)
    expect(result.workspaceSpec.flow).toEqual({
      flowId: 'rtl2gds',
      fromStepId: 'Synthesis',
      throughStepId: 'Harden',
      ...(mode === undefined ? {} : { stepSubprocess: mode }),
    })
    expect(result.workspaceSpec.parameters).not.toHaveProperty(
      'execution.step_subprocess',
    )
  },
)
