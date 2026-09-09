// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import type { ProjectManifest } from '@ecos-studio/shared'
import { describe, expect, it, vi } from 'vitest'
import NewProjectWizard from './NewProjectWizard.vue'

const wizardMocks = vi.hoisted(() => ({
  importedPdks: { value: [] as Array<Record<string, unknown>> },
  loadPdks: vi.fn(async () => undefined),
  importPdk: vi.fn(),
  removePdk: vi.fn(),
  validatePdk: vi.fn(),
  locatePdk: vi.fn(),
  showToast: vi.fn(),
  loadProjectHistory: vi.fn(async () => []),
  readProjectManagementManifest: vi.fn<() => Promise<ProjectManifest | null>>(
    async () => null,
  ),
  resolveBinding: vi.fn(),
  scanPdkDirectory: vi.fn(),
  discoverHdlModules: vi.fn(async (request: { rtlPaths?: string[] }) => {
    if (request.rtlPaths?.includes('/rtl/empty.v')) {
      return { candidates: [], status: 'complete', suggested: '' }
    }
    return {
      candidates: ['gcd_top', 'child'],
      status: 'complete',
      suggested: 'gcd_top',
    }
  }),
  getWorkspaceCreationModel: vi.fn(async () => ({
    controls: {
      flowBoundaries: true,
      manualPdkFiles: true,
      mpc: true,
      pdkVersion: true,
    },
    discovery: {},
    parameters: [],
    pdkInstallations: [],
  })),
}))

vi.mock('../composables/usePdkManager', () => ({
  usePdkManager: () => wizardMocks,
}))

vi.mock('../composables/useWorkspace', () => ({
  useWorkspace: () => ({ showToast: wizardMocks.showToast }),
}))

vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({
    pdkInventory: { resolveBinding: wizardMocks.resolveBinding },
    workspaceCreationModel: { get: wizardMocks.getWorkspaceCreationModel },
    workspace: {
      scanPdkDirectory: wizardMocks.scanPdkDirectory,
      discoverHdlModules: wizardMocks.discoverHdlModules,
    },
  }),
}))

vi.mock('@/utils/projectHistory', () => ({
  loadProjectHistory: wizardMocks.loadProjectHistory,
}))

vi.mock('@/utils/projectManagementRead', () => ({
  readProjectManagementManifest: wizardMocks.readProjectManagementManifest,
}))

const primevueStubs = {
  Select: {
    props: ['modelValue', 'options', 'placeholder', 'ariaLabel', 'filter'],
    inheritAttrs: false,
    template: `<div role="combobox" :aria-label="ariaLabel || $attrs['aria-label']">{{
      modelValue || placeholder || ''
    }}</div>`,
  },
}

describe('NewProjectWizard behavior', () => {
  it('loads the ECC-backed Workspace Creation Model', async () => {
    const wrapper = mount(NewProjectWizard, {
      props: { initialConfig: { standaloneWorkspace: true } },
      global: {
        stubs: {
          DesignFileTransfer: true,
          PdkResourcePickerDialog: true,
          ...primevueStubs,
        },
      },
    })

    await flushPromises()

    expect(wizardMocks.getWorkspaceCreationModel).toHaveBeenCalled()
    wrapper.unmount()
  })
  it('reuses an imported PDK after resolving a configured symlink path', async () => {
    wizardMocks.importedPdks.value = [
      {
        id: 'pdk:ics55:local:canonical',
        name: 'ics55',
        path: '/real/pdk',
        description: '',
        techNode: '55nm',
        pdkId: 'ics55',
        importedAt: '',
        detectedFiles: { directories: [], files: [] },
        source: 'local',
        version: '',
        readiness: 'ready',
        supportsEccDefaults: true,
      },
    ]
    wizardMocks.loadPdks.mockClear()
    wizardMocks.resolveBinding.mockReset()
    wizardMocks.scanPdkDirectory.mockReset()
    wizardMocks.scanPdkDirectory.mockResolvedValue({
      canonicalPath: '/real/pdk',
      name: 'ics55',
      description: '',
      techNode: '55nm',
      pdkId: 'ics55',
      detectedFiles: { directories: [], files: [] },
    })

    const wrapper = mount(NewProjectWizard, {
      props: {
        initialConfig: {
          standaloneWorkspace: true,
          lockWorkspaceDirectory: true,
          directory: '/workspace/ws_0001',
          pdk: 'ics55',
          pdk_root: '/link/pdk',
          rtl_list: ['/workspace/top.v'],
        },
      },
      global: {
        stubs: {
          DesignFileTransfer: true,
          PdkResourcePickerDialog: true,
          ...primevueStubs,
        },
      },
    })

    await flushPromises()

    for (let step = 1; step < 5; step += 1) {
      const continueButton = wrapper
        .findAll('button')
        .find((button) => button.text().includes('Continue'))
      expect(continueButton).toBeDefined()
      await continueButton!.trigger('click')
    }
    await flushPromises()

    expect(wizardMocks.loadPdks).toHaveBeenCalledWith(true)
    expect(wizardMocks.scanPdkDirectory).toHaveBeenCalledWith('/link/pdk')
    expect(wrapper.find('button[aria-pressed="true"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Project Pinned')
    wrapper.unmount()
  })

  it('restores the backend Binding when multiple Installations match', async () => {
    wizardMocks.importedPdks.value = [
      {
        id: 'pdk:vendor:local:first',
        name: 'Vendor PDK First',
        path: '/pdks/vendor-first',
        description: '',
        techNode: '',
        pdkId: 'vendor-pdk',
        importedAt: '',
        source: 'imported',
        version: '',
        readiness: 'unverified',
        supportsEccDefaults: false,
      },
      {
        id: 'pdk:vendor:local:second',
        name: 'Vendor PDK Second',
        path: '/pdks/vendor-second',
        description: '',
        techNode: '',
        pdkId: 'vendor-pdk',
        importedAt: '',
        source: 'imported',
        version: '',
        readiness: 'unverified',
        supportsEccDefaults: false,
      },
    ]
    wizardMocks.resolveBinding.mockResolvedValue({
      installationId: 'pdk:vendor:local:second',
      projectId: 'proj_demo',
      projectRoot: '/projects/demo',
    })

    const wrapper = mount(NewProjectWizard, {
      props: {
        initialConfig: {
          directory: '/projects/demo/ws_0001',
          pdk: 'vendor-pdk',
          pdk_root: '',
          pdk_requirement: {
            familyId: 'vendor-pdk',
            version: null,
            manualConfig: null,
          },
          project_context: {
            mode: 'select',
            project_id: 'proj_demo',
            project_name: 'demo',
            project_root: '/projects/demo',
            project_json_path: '/projects/demo/project.json',
          },
          rtl_list: ['/projects/demo/top.v'],
        },
      },
      global: {
        stubs: {
          DesignFileTransfer: true,
          PdkResourcePickerDialog: true,
          ...primevueStubs,
        },
      },
    })

    await flushPromises()

    const wizard = wrapper.vm as unknown as {
      ensurePdksLoaded(): Promise<void>
      selectedPdkId: string
    }
    await wizard.ensurePdksLoaded()

    expect(wizardMocks.resolveBinding).toHaveBeenCalledWith({
      projectId: 'proj_demo',
      projectRoot: '/projects/demo',
      requirement: {
        familyId: 'vendor-pdk',
        version: null,
        manualConfig: null,
      },
    })
    expect(wizard.selectedPdkId).toBe('pdk:vendor:local:second')
    wrapper.unmount()
  })

  it('offers Locate for a missing Installation', async () => {
    wizardMocks.importedPdks.value = [
      {
        id: 'pdk:vendor:local:missing',
        name: 'Missing Vendor PDK',
        path: '/pdks/missing',
        description: 'PDK root is unavailable',
        techNode: '',
        pdkId: 'vendor-pdk',
        importedAt: '',
        source: 'imported',
        version: '',
        readiness: 'missing',
        supportsEccDefaults: false,
      },
    ]
    wizardMocks.locatePdk.mockReset()
    const wrapper = mount(NewProjectWizard, {
      props: {
        initialConfig: {
          pdk: 'vendor-pdk',
          pdk_installation_id: 'pdk:vendor:local:missing',
        },
      },
      global: {
        stubs: {
          DesignFileTransfer: true,
          PdkResourcePickerDialog: true,
          ...primevueStubs,
        },
      },
    })
    const wizard = wrapper.vm as unknown as {
      currentStep: number
      ensurePdksLoaded(): Promise<void>
    }
    await wizard.ensurePdksLoaded()
    wizard.currentStep = 5
    await flushPromises()

    const locate = wrapper.findAll('button').find((button) => button.text() === 'Locate')
    expect(locate).toBeDefined()
    await locate!.trigger('click')
    expect(wizardMocks.locatePdk).toHaveBeenCalledWith('pdk:vendor:local:missing')
    wrapper.unmount()
  })

  it('blocks Manual configuration until every resource category is selected', async () => {
    wizardMocks.importedPdks.value = [
      {
        id: 'pdk:vendor:local:manual',
        name: 'Vendor PDK',
        path: '/pdks/vendor',
        description: '',
        techNode: '',
        pdkId: 'vendor-pdk',
        importedAt: '',
        source: 'imported',
        version: '',
        readiness: 'unverified',
        supportsEccDefaults: false,
      },
    ]
    const wrapper = mount(NewProjectWizard, {
      props: {
        initialConfig: {
          pdk: 'vendor-pdk',
          pdk_installation_id: 'pdk:vendor:local:manual',
        },
      },
      global: {
        stubs: {
          DesignFileTransfer: true,
          PdkResourcePickerDialog: true,
          ...primevueStubs,
        },
      },
    })
    const wizard = wrapper.vm as unknown as {
      canProceed: boolean
      currentStep: number
      ensurePdksLoaded(): Promise<void>
      stepFiveBlockedReason: string
    }
    await wizard.ensurePdksLoaded()
    wizard.currentStep = 5
    await flushPromises()

    expect(wrapper.text()).toContain('Unverified')
    expect(wizard.canProceed).toBe(false)
    expect(wizard.stepFiveBlockedReason).toContain('Tech LEF, Cell LEF, Liberty')
    wrapper.unmount()
  })

  it('reuses design files and chip identity from the selected Project', async () => {
    wizardMocks.readProjectManagementManifest.mockResolvedValueOnce({
      schema_version: 1,
      project_id: 'proj_gcd',
      name: 'gcd',
      design_name: 'gcd',
      description: '',
      root_path: '/projects/gcd',
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
      base_design: {
        rtl_list: ['/projects/gcd/ws_0001/origin/gcd.v'],
        sdc: '/projects/gcd/ws_0001/origin/gcd.sdc',
        top_module: 'gcd_top',
        clock: 'clk_i',
        parameters: { design: 'gcd' },
      },
      objectives: { primary: 'timing', directions: {} },
      workspaces: [],
      mpc: null,
      best_workspace: null,
      qor_baseline: null,
    })
    const wrapper = mount(NewProjectWizard, {
      props: {
        initialConfig: {
          directory: '/projects/gcd/ws_0002',
          lockWorkspaceDirectory: true,
          managedWorkspaceRoot: '/projects/gcd',
          parameters: { design: 'gcd' },
          project_context: {
            mode: 'select',
            project_id: 'proj_gcd',
            project_name: 'gcd',
            project_root: '/projects/gcd',
            project_json_path: '/projects/gcd/project.json',
          },
        },
      },
      global: {
        stubs: {
          DesignFileTransfer: true,
          PdkResourcePickerDialog: true,
          ...primevueStubs,
        },
      },
    })

    await flushPromises()

    const wizard = wrapper.vm as unknown as {
      config: {
        parameters: Record<string, unknown>
        rtl_list: string[]
        sdc?: string
      }
    }
    expect(wizard.config).toMatchObject({
      parameters: { top_module: 'gcd_top', clock: 'clk_i' },
      rtl_list: ['/projects/gcd/ws_0001/origin/gcd.v'],
      sdc: '/projects/gcd/ws_0001/origin/gcd.sdc',
    })
    wrapper.unmount()
  })

  it('prefills filelist only when the Project Manifest has both RTL and filelist', async () => {
    wizardMocks.readProjectManagementManifest.mockResolvedValueOnce({
      schema_version: 1,
      project_id: 'proj_gcd',
      name: 'gcd',
      design_name: 'gcd',
      description: '',
      root_path: '/projects/gcd',
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
      base_design: {
        rtl_list: ['/projects/gcd/ws_0001/origin/gcd.v'],
        filelist: '/projects/gcd/sources.f',
        sdc: '/projects/gcd/ws_0001/origin/gcd.sdc',
        top_module: 'gcd_top',
        clock: 'clk_i',
        parameters: { design: 'gcd' },
      },
      objectives: { primary: 'timing', directions: {} },
      workspaces: [],
      mpc: null,
      best_workspace: null,
      qor_baseline: null,
    })
    const wrapper = mount(NewProjectWizard, {
      props: {
        initialConfig: {
          directory: '/projects/gcd/ws_0002',
          lockWorkspaceDirectory: true,
          managedWorkspaceRoot: '/projects/gcd',
          parameters: { design: 'gcd' },
          project_context: {
            mode: 'select',
            project_id: 'proj_gcd',
            project_name: 'gcd',
            project_root: '/projects/gcd',
            project_json_path: '/projects/gcd/project.json',
          },
        },
      },
      global: {
        stubs: {
          DesignFileTransfer: true,
          PdkResourcePickerDialog: true,
          ...primevueStubs,
        },
      },
    })
    await flushPromises()
    const wizard = wrapper.vm as unknown as {
      config: { rtl_list: string[]; filelist?: string }
      filelistPath: string
    }
    expect(wizard.config.rtl_list).toEqual([])
    expect(wizard.filelistPath).toBe('/projects/gcd/sources.f')
    wrapper.unmount()
  })

  it('does not leave Design Files when both RTL and filelist are set', async () => {
    const wrapper = mount(NewProjectWizard, {
      props: { initialConfig: { standaloneWorkspace: true } },
      global: {
        stubs: {
          DesignFileTransfer: true,
          PdkResourcePickerDialog: true,
          ...primevueStubs,
        },
      },
    })
    await flushPromises()
    const wizard = wrapper.vm as unknown as {
      canProceed: boolean
      config: { rtl_list: string[] }
      currentStep: number
      filelistPath: string
    }
    wizard.currentStep = 4
    wizard.config.rtl_list = ['/rtl/top.v']
    wizard.filelistPath = '/rtl/sources.f'
    await flushPromises()
    expect(wizard.canProceed).toBe(false)
    wrapper.unmount()
  })

  it('shows discovered Top Module candidates instead of a free-text field', async () => {
    const wrapper = mount(NewProjectWizard, {
      props: {
        initialConfig: {
          standaloneWorkspace: true,
          rtl_list: ['/rtl/gcd.v'],
          parameters: { design: 'gcd', clock: 'clk', top_module: '' },
        },
      },
      global: {
        stubs: {
          DesignFileTransfer: true,
          PdkResourcePickerDialog: true,
          ...primevueStubs,
        },
      },
    })
    await flushPromises()
    const wizard = wrapper.vm as unknown as {
      currentStep: number
      refreshTopModuleDiscovery(): Promise<void>
    }
    wizard.currentStep = 6
    await wizard.refreshTopModuleDiscovery()
    await flushPromises()
    expect(wizardMocks.discoverHdlModules).toHaveBeenCalled()
    expect(wrapper.text()).toContain('gcd_top')
    expect(wrapper.find('input[placeholder="top"]').exists()).toBe(false)
    expect(wrapper.find('input[placeholder="Filter modules"]').exists()).toBe(false)
    expect(wrapper.get('[aria-label="Top Module Name"]').text()).toContain('gcd_top')
    wrapper.unmount()
  })

  it('blocks create when discovery finds no modules', async () => {
    const wrapper = mount(NewProjectWizard, {
      props: {
        initialConfig: {
          standaloneWorkspace: true,
          rtl_list: ['/rtl/empty.v'],
          parameters: { design: 'gcd', clock: 'clk' },
        },
      },
      global: {
        stubs: {
          DesignFileTransfer: true,
          PdkResourcePickerDialog: true,
          ...primevueStubs,
        },
      },
    })
    await flushPromises()
    const wizard = wrapper.vm as unknown as {
      canProceed: boolean
      currentStep: number
      refreshTopModuleDiscovery(): Promise<void>
    }
    wizard.currentStep = 6
    await wizard.refreshTopModuleDiscovery()
    await flushPromises()
    expect(wizardMocks.discoverHdlModules).toHaveBeenLastCalledWith(
      expect.objectContaining({ rtlPaths: ['/rtl/empty.v'] }),
    )
    expect(wizard.canProceed).toBe(false)
    expect(wrapper.text()).toContain('Return to Design Files')
    const returnButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Return to Design Files'))
    expect(returnButton).toBeTruthy()
    await returnButton!.trigger('click')
    await flushPromises()
    expect(wizard.currentStep).toBe(4)
    wrapper.unmount()
  })

  it('keeps Top Module read-only when Update Workspace does not change input paths', async () => {
    const wrapper = mount(NewProjectWizard, {
      props: {
        title: 'Update Workspace',
        initialConfig: {
          lockWorkspaceDirectory: true,
          directory: '/projects/gcd/ws_0001',
          rtl_list: ['/rtl/gcd.v'],
          parameters: { design: 'gcd', top_module: 'gcd_top', clock: 'clk' },
        },
      },
      global: {
        stubs: {
          DesignFileTransfer: true,
          PdkResourcePickerDialog: true,
          ...primevueStubs,
        },
      },
    })
    await flushPromises()
    const wizard = wrapper.vm as unknown as {
      currentStep: number
      refreshTopModuleDiscovery(): Promise<void>
      topModuleIsReadOnly: boolean
      config: { parameters: Record<string, unknown> }
    }
    wizard.currentStep = 6
    await wizard.refreshTopModuleDiscovery()
    await flushPromises()
    expect(wizard.topModuleIsReadOnly).toBe(true)
    expect(wizard.config.parameters.top_module).toBe('gcd_top')
    expect(wrapper.find('.p-select').exists()).toBe(false)
    const topInput = wrapper.get('input[aria-label="Top Module Name"]')
    expect(topInput.attributes('readonly')).toBeDefined()
    expect((topInput.element as HTMLInputElement).value).toBe('gcd_top')
    wrapper.unmount()
  })

  it('requires reconfirmation after Update Workspace changes RTL paths', async () => {
    const wrapper = mount(NewProjectWizard, {
      props: {
        title: 'Update Workspace',
        initialConfig: {
          lockWorkspaceDirectory: true,
          directory: '/projects/gcd/ws_0001',
          rtl_list: ['/rtl/gcd.v'],
          parameters: { design: 'gcd', top_module: 'gcd_top', clock: 'clk' },
        },
      },
      global: {
        stubs: {
          DesignFileTransfer: true,
          PdkResourcePickerDialog: true,
          ...primevueStubs,
        },
      },
    })
    await flushPromises()
    const wizard = wrapper.vm as unknown as {
      config: { rtl_list: string[] }
      currentStep: number
      refreshTopModuleDiscovery(): Promise<void>
    }
    wizard.config.rtl_list = ['/rtl/new.v']
    wizard.currentStep = 6
    await wizard.refreshTopModuleDiscovery()
    await flushPromises()
    expect(wrapper.find('input[placeholder="top"]').exists()).toBe(false)
    expect(wrapper.get('[aria-label="Top Module Name"]').text()).toContain('gcd_top')
    wrapper.unmount()
  })
})
