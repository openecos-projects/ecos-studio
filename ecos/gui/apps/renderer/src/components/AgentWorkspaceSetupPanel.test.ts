// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopAgentWorkspaceSetupContract } from '@ecos-studio/shared'
import AgentWorkspaceSetupPanel from './AgentWorkspaceSetupPanel.vue'
import source from './AgentWorkspaceSetupPanel.vue?raw'

const mocks = vi.hoisted(() => ({
  installResourceApi: vi.fn(),
  listResourcesApi: vi.fn(),
  readMpcSpecApi: vi.fn(),
}))

vi.mock('@/api/plugin', () => mocks)

const registryMpc = {
  id: 'mpc:mpc-frame',
  type: 'mpc',
  name: 'mpc-frame',
  display_name: 'MPC Frame',
  description: '',
  category: 'mpc',
  status: 'available',
  installed_version: null,
  available_versions: ['0.1.0'],
  active_version: null,
  active: false,
  path: null,
  managed_root: '/resources/mpcs',
  platform: 'all-platform',
  size: null,
  source: 'registry',
  homepage: '',
  actions: ['install'],
  health: {},
  error: null,
} as const

const installedMpc = {
  ...registryMpc,
  status: 'installed',
  installed_version: '0.1.0',
  path: '/resources/mpcs/mpc-frame/0.1.0',
  actions: ['uninstall'],
  health: { status: 'ok', managed: true },
} as const

const workspaceContract = {
  schema_version: 'flow-agent.workspace_setup_contract.v2',
  title: 'Workspace run plan',
  setup_id: 'setup-mpc-ui',
  requires_gui_review: true,
  mpc_enabled: true,
  directory: '/projects/gcd/workspaces/ws_0001',
  pdk: 'ics55',
  pdk_root: '/pdk/ics55',
  rtl_list: ['/projects/gcd/rtl/gcd.v'],
  filelist: null,
  sdc: null,
  design_input_mode: 'rtl',
  pdk_config: { mode: 'default', tech_lef: [], cell_lef: [], liberty: [] },
  pdk_config_mode: 'default',
  project_context: {
    mode: 'create',
    project_name: 'gcd',
    project_root: '/projects/gcd',
    project_json_path: '/projects/gcd/project.json',
  },
  parameters: {
    clock: 'clk',
    design: 'gcd',
    description: '',
    die_area_mode: 'utilitization_margin',
    frequency_max: 50,
    margin: 0.1,
    max_fanout: 16,
    target_density: 0.7,
    target_overflow: 0.1,
    top_module: 'gcd',
    utilitization: 0.7,
  },
  flow_config: {
    start_step: 'Synthesis',
    end_step: 'Harden',
    steps: ['Synthesis', 'Floorplan', 'Placement', 'CTS', 'Routing', 'Harden'],
  },
} as unknown as DesktopAgentWorkspaceSetupContract

describe('AgentWorkspaceSetupPanel', () => {
  beforeEach(() => {
    mocks.installResourceApi.mockReset()
    mocks.listResourcesApi.mockReset()
    mocks.readMpcSpecApi.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves and injects the selected MPC before workspace creation', async () => {
    mocks.listResourcesApi
      .mockResolvedValueOnce([registryMpc])
      .mockResolvedValueOnce([installedMpc])
    mocks.installResourceApi.mockResolvedValue({
      status: 'started',
      resource_id: registryMpc.id,
    })
    mocks.readMpcSpecApi.mockResolvedValue({
      resource_id: installedMpc.id,
      installed_version: installedMpc.installed_version,
      spec_path: `${installedMpc.path}/spec/spec.json.in`,
      spec: {
        number: 1,
        designs: [
          {
            design_name: 'frame',
            core_template: { minimum_area: 100 },
            io_pins: { number: 0, list: [] },
          },
        ],
      },
    })

    const wrapper = mount(AgentWorkspaceSetupPanel, {
      props: { contract: workspaceContract },
      global: { stubs: { AgentExecutionContractPanel: { template: '<div />' } } },
    })
    await flushPromises()
    await wrapper.setProps({ createSetupId: workspaceContract.setup_id })
    await flushPromises()

    expect(mocks.installResourceApi).toHaveBeenCalledWith(registryMpc.id, '0.1.0')
    expect(wrapper.emitted('createWorkspace')).toHaveLength(1)
    expect(wrapper.emitted('createWorkspace')?.[0]?.[1]).toMatchObject({
      mpc_enabled: true,
      mpc: { display_name: 'MPC Frame', design: { design_name: 'frame' } },
      parameters: { MPC: { resource_id: registryMpc.id } },
    })
  })

  it('waits for an in-progress install before creating the workspace', async () => {
    vi.useFakeTimers()
    mocks.listResourcesApi
      .mockResolvedValueOnce([registryMpc])
      .mockResolvedValueOnce([
        { ...registryMpc, status: 'installing', actions: ['cancel'] },
      ])
      .mockResolvedValueOnce([installedMpc])
    mocks.installResourceApi.mockResolvedValue({
      status: 'started',
      resource_id: registryMpc.id,
    })
    mocks.readMpcSpecApi.mockResolvedValue({
      resource_id: installedMpc.id,
      installed_version: installedMpc.installed_version,
      spec_path: `${installedMpc.path}/spec/spec.json.in`,
      spec: {
        number: 1,
        designs: [{ design_name: 'frame', core_template: { minimum_area: 100 } }],
      },
    })

    const wrapper = mount(AgentWorkspaceSetupPanel, {
      props: { contract: workspaceContract },
      global: { stubs: { AgentExecutionContractPanel: { template: '<div />' } } },
    })
    await flushPromises()
    await wrapper.setProps({ createSetupId: workspaceContract.setup_id })
    await flushPromises()
    await vi.runAllTimersAsync()
    await flushPromises()

    expect(wrapper.emitted('createWorkspace')).toHaveLength(1)
    expect(wrapper.emitted('createWorkspace')?.[0]?.[1]).toMatchObject({
      mpc: { resource_id: registryMpc.id },
      parameters: { MPC: { core_template: { minimum_area: 100 } } },
    })
  })

  it('keeps confirmation available when Use has no usable resource', async () => {
    mocks.listResourcesApi.mockResolvedValue([])
    const wrapper = mount(AgentWorkspaceSetupPanel, {
      props: { contract: workspaceContract },
      global: { stubs: { AgentExecutionContractPanel: { template: '<div />' } } },
    })
    await flushPromises()
    await wrapper.setProps({ createSetupId: workspaceContract.setup_id })
    await flushPromises()

    expect(wrapper.emitted('createWorkspace')).toHaveLength(1)
    expect(wrapper.emitted('createWorkspace')?.[0]?.[1]).toMatchObject({
      mpc_enabled: true,
    })
    expect(wrapper.emitted('createWorkspace')?.[0]?.[1]).not.toHaveProperty('mpc')
  })

  it('creates from the frozen contract without reopening NewProjectWizard', () => {
    expect(source).toContain("emit('createWorkspace'")
    expect(source).toContain('() => props.createSetupId')
    expect(source).toContain('workspaceConfig(resolvedContract.value)')
    expect(source).not.toContain('NewProjectWizard')
  })

  it('uses the frozen project MPC snapshot without a second review control', () => {
    expect(source).toContain('const mpc = contract.mpc')
    expect(source).toContain('resolveMpc(contract)')
    expect(source).toContain('installResourceApi')
    expect(source).toContain('listResourcesApi')
    expect(source).toContain('readMpcSpecApi')
    expect(source).not.toContain('Use a SoC-MPC template for this workspace')
  })

  it('renders the complete resolved specification in a two-column table', () => {
    expect(source).toContain('AgentExecutionContractPanel')
    expect(source).toContain(':rows="specRows"')
    for (const field of [
      'Workspace',
      'Flow',
      'RTL',
      'Filelist',
      'SDC',
      'PDK Root',
      'Top Module',
      'Use SoC-MPC',
      'SoC-MPC Template',
      'SoC-MPC Design',
      'SoC-MPC Spec',
    ])
      expect(source).toContain(field)
    expect(source).not.toContain('<dl')
  })

  it('keeps MPC selection exclusively in the resolved specification', () => {
    expect(source).not.toContain('<template #review-extra>')
    expect(source).not.toContain('No usable SoC-MPC template is selected.')
  })

  it('allows confirmation without an MPC template', () => {
    expect(source).toContain(':choice-disabled="choiceDisabled"')
    expect(source).not.toContain("'Unavailable'")
  })

  it('shows Workspace Name from the directory leaf and Design Name separately', () => {
    expect(source).toContain("['Workspace Name', workspaceName]")
    expect(source).toContain("['Design Name', parameters.design]")
    expect(source).toContain("['Project Root', contract.project_context.project_root]")
  })

  it('omits die dimensions derived by automatic floorplanning', () => {
    expect(source).not.toContain("['Die Width'")
    expect(source).not.toContain("['Die Height'")
  })

  it('keeps the specification selectable and permits retrying a failed setup id', () => {
    expect(source).toContain('AgentExecutionContractPanel')
    expect(source).toContain('if (!setupId) {')
    expect(source).toContain("submittedSetupId.value = ''")
    expect(source).toContain('resolvedContract.value?.setup_id !== contract.setup_id')
  })

  it('renders the confirmation after the resolved specification', () => {
    expect(source).toContain('confirmationText?: string')
    expect(source).toContain(':confirmation-text="confirmationText"')
    expect(source).toContain(':choice="choice"')
    expect(source).toContain(':choice-disabled="choiceDisabled"')
  })

  it('collapses committed setups into a short summary with progressive status', () => {
    expect(source).toContain(':summary="committedSummary"')
    expect(source).toContain(
      "return [workspaceName, design, flow].filter(Boolean).join(' · ')",
    )
    expect(source).toContain("return 'Running'")
    expect(source).toContain("return 'Review'")
    expect(source).toContain("return 'Cancelled'")
    expect(source).toContain("return 'Confirmed'")
  })

  it('shows a user-facing run-plan title instead of frozen-contract jargon', () => {
    expect(source).toContain('displayAgentContractTitle')
    expect(source).toContain(':title="displayTitle"')
  })
})
