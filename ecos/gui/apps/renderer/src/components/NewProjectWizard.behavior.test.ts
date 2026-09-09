// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import NewProjectWizard from './NewProjectWizard.vue'

const wizardMocks = vi.hoisted(() => ({
  importedPdks: { value: [] as Array<Record<string, unknown>> },
  loadPdks: vi.fn(async () => true),
  importPdk: vi.fn(),
  removePdk: vi.fn(),
  validatePdk: vi.fn(),
  locatePdk: vi.fn(),
  showToast: vi.fn(),
  loadProjectHistory: vi.fn(async () => []),
  readProjectManagementManifest: vi.fn(async () => null),
  resolveBinding: vi.fn(),
  scanPdkDirectory: vi.fn(),
  settingsGet: vi.fn(async (_key: string): Promise<string | null> => null),
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
    settings: { get: wizardMocks.settingsGet },
    workspace: { scanPdkDirectory: wizardMocks.scanPdkDirectory },
  }),
}))

vi.mock('@/utils/projectHistory', () => ({
  loadProjectHistory: wizardMocks.loadProjectHistory,
}))

vi.mock('@/utils/projectManagementRead', () => ({
  readProjectManagementManifest: wizardMocks.readProjectManagementManifest,
}))

describe('NewProjectWizard behavior', () => {
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
        stubs: { DesignFileTransfer: true, PdkResourcePickerDialog: true },
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
        stubs: { DesignFileTransfer: true, PdkResourcePickerDialog: true },
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
        stubs: { DesignFileTransfer: true, PdkResourcePickerDialog: true },
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

  it('preselects the default PDK installation for a fresh workspace', async () => {
    wizardMocks.importedPdks.value = [
      {
        id: 'pdk:sky130:local:default',
        name: 'SkyWater 130nm',
        path: '/pdks/sky130',
        description: '',
        techNode: '130nm',
        pdkId: 'sky130',
        importedAt: '',
        detectedFiles: { directories: [], files: [] },
        source: 'imported',
        version: '',
        readiness: 'ready',
        supportsEccDefaults: true,
      },
    ]
    wizardMocks.resolveBinding.mockReset()
    wizardMocks.scanPdkDirectory.mockReset()
    wizardMocks.resolveBinding.mockResolvedValue(null)
    wizardMocks.settingsGet.mockReset()
    wizardMocks.settingsGet.mockResolvedValue('pdk:sky130:local:default')

    const wrapper = mount(NewProjectWizard, {
      props: {
        initialConfig: {
          standaloneWorkspace: true,
          directory: '/workspace/ws_default',
          rtl_list: ['/workspace/top.v'],
        },
      },
      global: {
        stubs: { DesignFileTransfer: true, PdkResourcePickerDialog: true },
      },
    })
    const wizard = wrapper.vm as unknown as {
      currentStep: number
      ensurePdksLoaded(): Promise<void>
    }
    await wizard.ensurePdksLoaded()
    wizard.currentStep = 5
    await flushPromises()

    expect(wizardMocks.settingsGet).toHaveBeenCalledWith('pdk.defaultInstallationId')
    expect(wrapper.find('button[aria-pressed="true"]').text()).toContain('SkyWater 130nm')
    wrapper.unmount()
  })

  it('ignores a stale default PDK installation id silently', async () => {
    wizardMocks.importedPdks.value = [
      {
        id: 'pdk:sky130:local:default',
        name: 'SkyWater 130nm',
        path: '/pdks/sky130',
        description: '',
        techNode: '130nm',
        pdkId: 'sky130',
        importedAt: '',
        detectedFiles: { directories: [], files: [] },
        source: 'imported',
        version: '',
        readiness: 'ready',
        supportsEccDefaults: true,
      },
    ]
    wizardMocks.resolveBinding.mockReset()
    wizardMocks.scanPdkDirectory.mockReset()
    wizardMocks.resolveBinding.mockResolvedValue(null)
    wizardMocks.settingsGet.mockReset()
    wizardMocks.settingsGet.mockResolvedValue('pdk:gone:local:removed')

    const wrapper = mount(NewProjectWizard, {
      props: {
        initialConfig: {
          standaloneWorkspace: true,
          directory: '/workspace/ws_default',
          rtl_list: ['/workspace/top.v'],
        },
      },
      global: {
        stubs: { DesignFileTransfer: true, PdkResourcePickerDialog: true },
      },
    })
    const wizard = wrapper.vm as unknown as {
      currentStep: number
      ensurePdksLoaded(): Promise<void>
    }
    await wizard.ensurePdksLoaded()
    wizard.currentStep = 5
    await flushPromises()

    expect(wrapper.find('button[aria-pressed="true"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('keeps an explicit pdk_root ahead of the default installation', async () => {
    wizardMocks.importedPdks.value = [
      {
        id: 'pdk:vendor:local:explicit',
        name: 'Vendor Explicit PDK',
        path: '/pdks/vendor-explicit',
        description: '',
        techNode: '',
        pdkId: 'vendor-pdk',
        importedAt: '',
        detectedFiles: { directories: [], files: [] },
        source: 'local',
        version: '',
        readiness: 'ready',
        supportsEccDefaults: true,
      },
    ]
    wizardMocks.resolveBinding.mockReset()
    wizardMocks.scanPdkDirectory.mockReset()
    wizardMocks.settingsGet.mockReset()
    wizardMocks.settingsGet.mockResolvedValue('pdk:sky130:local:default')

    const wrapper = mount(NewProjectWizard, {
      props: {
        initialConfig: {
          standaloneWorkspace: true,
          directory: '/workspace/ws_reconfigure',
          pdk: 'vendor-pdk',
          pdk_root: '/pdks/vendor-explicit',
          rtl_list: ['/workspace/top.v'],
        },
      },
      global: {
        stubs: { DesignFileTransfer: true, PdkResourcePickerDialog: true },
      },
    })
    const wizard = wrapper.vm as unknown as {
      currentStep: number
      ensurePdksLoaded(): Promise<void>
    }
    await wizard.ensurePdksLoaded()
    wizard.currentStep = 5
    await flushPromises()

    // The explicit pdk_root matched before the default was ever consulted.
    expect(wizardMocks.settingsGet).not.toHaveBeenCalled()
    expect(wrapper.find('button[aria-pressed="true"]').text()).toContain(
      'Vendor Explicit PDK',
    )
    wrapper.unmount()
  })

  it('does not seed the default over an explicit pdk_root that resolves nothing', async () => {
    wizardMocks.importedPdks.value = [
      {
        id: 'pdk:sky130:local:default',
        name: 'SkyWater 130nm',
        path: '/pdks/sky130',
        description: '',
        techNode: '130nm',
        pdkId: 'sky130',
        importedAt: '',
        detectedFiles: { directories: [], files: [] },
        source: 'imported',
        version: '',
        readiness: 'ready',
        supportsEccDefaults: true,
      },
    ]
    wizardMocks.resolveBinding.mockReset()
    wizardMocks.scanPdkDirectory.mockReset()
    wizardMocks.resolveBinding.mockResolvedValue(null)
    // The scan fails and no inventory entry matches the explicit root.
    wizardMocks.scanPdkDirectory.mockRejectedValue(new Error('scan failed'))
    wizardMocks.settingsGet.mockReset()
    wizardMocks.settingsGet.mockResolvedValue('pdk:sky130:local:default')

    const wrapper = mount(NewProjectWizard, {
      props: {
        initialConfig: {
          standaloneWorkspace: true,
          directory: '/workspace/ws_reconfigure',
          pdk: 'vendor-pdk',
          pdk_root: '/pdks/gone',
          rtl_list: ['/workspace/top.v'],
        },
      },
      global: {
        stubs: { DesignFileTransfer: true, PdkResourcePickerDialog: true },
      },
    })
    const wizard = wrapper.vm as unknown as {
      currentStep: number
      ensurePdksLoaded(): Promise<void>
    }
    await wizard.ensurePdksLoaded()
    wizard.currentStep = 5
    await flushPromises()

    // The explicit pdk_root counts as PDK info even when unresolved: the
    // default installation must never be seeded over it.
    expect(wizardMocks.settingsGet).not.toHaveBeenCalled()
    expect(wrapper.find('button[aria-pressed="true"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('does not seed the default over an explicit installation id that resolves nothing', async () => {
    wizardMocks.importedPdks.value = [
      {
        id: 'pdk:sky130:local:default',
        name: 'SkyWater 130nm',
        path: '/pdks/sky130',
        description: '',
        techNode: '130nm',
        pdkId: 'sky130',
        importedAt: '',
        detectedFiles: { directories: [], files: [] },
        source: 'imported',
        version: '',
        readiness: 'ready',
        supportsEccDefaults: true,
      },
    ]
    wizardMocks.resolveBinding.mockReset()
    wizardMocks.scanPdkDirectory.mockReset()
    wizardMocks.resolveBinding.mockResolvedValue(null)
    wizardMocks.settingsGet.mockReset()
    wizardMocks.settingsGet.mockResolvedValue('pdk:sky130:local:default')

    const wrapper = mount(NewProjectWizard, {
      props: {
        initialConfig: {
          standaloneWorkspace: true,
          directory: '/workspace/ws_stale_id',
          pdk_installation_id: 'pdk:gone:local:removed',
          rtl_list: ['/workspace/top.v'],
        },
      },
      global: {
        stubs: { DesignFileTransfer: true, PdkResourcePickerDialog: true },
      },
    })
    const wizard = wrapper.vm as unknown as {
      currentStep: number
      ensurePdksLoaded(): Promise<void>
    }
    await wizard.ensurePdksLoaded()
    wizard.currentStep = 5
    await flushPromises()

    expect(wizardMocks.settingsGet).not.toHaveBeenCalled()
    expect(wrapper.find('button[aria-pressed="true"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('does not seed the default over an explicit requirement that resolves nothing', async () => {
    wizardMocks.importedPdks.value = [
      {
        id: 'pdk:sky130:local:default',
        name: 'SkyWater 130nm',
        path: '/pdks/sky130',
        description: '',
        techNode: '130nm',
        pdkId: 'sky130',
        importedAt: '',
        detectedFiles: { directories: [], files: [] },
        source: 'imported',
        version: '',
        readiness: 'ready',
        supportsEccDefaults: true,
      },
    ]
    wizardMocks.resolveBinding.mockReset()
    wizardMocks.scanPdkDirectory.mockReset()
    wizardMocks.resolveBinding.mockResolvedValue(null)
    wizardMocks.settingsGet.mockReset()
    wizardMocks.settingsGet.mockResolvedValue('pdk:sky130:local:default')

    const wrapper = mount(NewProjectWizard, {
      props: {
        initialConfig: {
          standaloneWorkspace: true,
          directory: '/workspace/ws_req',
          pdk_requirement: { familyId: 'vendor-pdk', manualConfig: null, version: null },
          rtl_list: ['/workspace/top.v'],
        },
      },
      global: {
        stubs: { DesignFileTransfer: true, PdkResourcePickerDialog: true },
      },
    })
    const wizard = wrapper.vm as unknown as {
      currentStep: number
      ensurePdksLoaded(): Promise<void>
    }
    await wizard.ensurePdksLoaded()
    wizard.currentStep = 5
    await flushPromises()

    expect(wizardMocks.settingsGet).not.toHaveBeenCalled()
    expect(wrapper.find('button[aria-pressed="true"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('never seeds the default in a workspace update even without explicit PDK info', async () => {
    wizardMocks.importedPdks.value = [
      {
        id: 'pdk:sky130:local:default',
        name: 'SkyWater 130nm',
        path: '/pdks/sky130',
        description: '',
        techNode: '130nm',
        pdkId: 'sky130',
        importedAt: '',
        detectedFiles: { directories: [], files: [] },
        source: 'imported',
        version: '',
        readiness: 'ready',
        supportsEccDefaults: true,
      },
    ]
    wizardMocks.resolveBinding.mockReset()
    wizardMocks.scanPdkDirectory.mockReset()
    wizardMocks.resolveBinding.mockResolvedValue(null)
    wizardMocks.settingsGet.mockReset()
    wizardMocks.settingsGet.mockResolvedValue('pdk:sky130:local:default')

    const wrapper = mount(NewProjectWizard, {
      props: {
        initialConfig: {
          standaloneWorkspace: true,
          directory: '/workspace/ws_update',
          isWorkspaceUpdate: true,
          rtl_list: ['/workspace/top.v'],
        },
      },
      global: {
        stubs: { DesignFileTransfer: true, PdkResourcePickerDialog: true },
      },
    })
    const wizard = wrapper.vm as unknown as {
      currentStep: number
      ensurePdksLoaded(): Promise<void>
    }
    await wizard.ensurePdksLoaded()
    wizard.currentStep = 5
    await flushPromises()

    expect(wizardMocks.settingsGet).not.toHaveBeenCalled()
    expect(wrapper.find('button[aria-pressed="true"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
