// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import AgentWorkspaceSetupPanel from './AgentWorkspaceSetupPanel.vue'
import type { DesktopAgentWorkspaceSetupContract } from '@ecos-studio/shared'

const discoverHdlModules = vi.fn(async () => ({
  candidates: ['gcd_top', 'child'],
  status: 'complete',
  suggested: 'gcd_top',
}))

vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({
    workspace: { discoverHdlModules },
  }),
}))

function contract(
  overrides: Partial<DesktopAgentWorkspaceSetupContract> = {},
): DesktopAgentWorkspaceSetupContract {
  return {
    design_input_mode: 'rtl',
    directory: '/projects/gcd/ws_0001',
    flow_config: {
      end_step: 'Harden',
      start_step: 'Synthesis',
      steps: ['Synthesis', 'Harden'],
    },
    parameters: {
      clock: 'clk',
      design: 'gcd',
      description: '',
      die_area_mode: 'utilitization_margin',
      frequency_max: 50,
      margin: 2,
      max_fanout: 32,
      target_density: 0.2,
      target_overflow: 0.1,
      top_module: '',
      utilitization: 0.3,
    },
    pdk: 'ics55',
    pdk_config: { cell_lef: [], liberty: [], mode: 'default', tech_lef: [] },
    pdk_config_mode: 'default',
    pdk_root: '/pdk',
    project_context: {
      mode: 'create',
      project_json_path: '/projects/gcd/project.json',
      project_name: 'gcd',
      project_root: '/projects/gcd',
    },
    requires_gui_review: true,
    rtl_list: ['/rtl/gcd.v'],
    schema_version: 'flow-agent.workspace_setup_contract.v2',
    setup_id: 'setup-1',
    title: 'Workspace run plan',
    ...overrides,
  }
}

describe('AgentWorkspaceSetupPanel top module confirmation', () => {
  it('disables confirm until a discovered Top Module is selected', async () => {
    const wrapper = mount(AgentWorkspaceSetupPanel, {
      props: {
        contract: contract(),
        choice: {
          allowFreeText: false,
          options: [
            { id: '1', label: 'Confirm', value: '1' },
            { id: '2', label: 'Cancel', value: '2' },
          ],
          promptId: 'confirm-1',
          title: 'Confirm workspace',
          variant: 'buttons',
        },
      },
      global: {
        stubs: { AgentChoiceCard: true },
      },
    })
    await flushPromises()
    expect(
      (wrapper.get('select[aria-label="Top Module Name"]').element as HTMLSelectElement)
        .value,
    ).toBe('gcd_top')
    expect(
      wrapper
        .findComponent({ name: 'AgentExecutionContractPanel' })
        .props('choiceDisabled'),
    ).toBe(false)
    wrapper.unmount()
  })

  it('does not create until the confirmed Top Module is present', async () => {
    discoverHdlModules.mockResolvedValueOnce({
      candidates: [],
      status: 'complete',
      suggested: '',
    })
    const wrapper = mount(AgentWorkspaceSetupPanel, {
      props: {
        contract: contract(),
        createSetupId: 'setup-1',
      },
    })
    await flushPromises()
    expect(wrapper.emitted('createWorkspace')).toBeUndefined()
    wrapper.unmount()
  })
})
