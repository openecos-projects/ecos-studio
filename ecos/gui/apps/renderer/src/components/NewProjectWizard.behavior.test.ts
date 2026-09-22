// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import type { ProjectEccPdkConfigReadResult, ProjectManifest } from '@ecos-studio/shared'
import { describe, expect, it, vi } from 'vitest'
import NewProjectWizard from './NewProjectWizard.vue'
import PdkResourcePickerDialog from './PdkResourcePickerDialog.vue'

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
  readProjectEccPdkConfig: vi.fn<() => Promise<ProjectEccPdkConfigReadResult>>(
    async () => ({
      exists: false,
      pdkName: '',
      pdkRoot: '',
      externalPaths: [],
      overrides: {},
    }),
  ),
  writeProjectEccPdkConfig: vi.fn(),
  scanPdkDirectory: vi.fn(),
  pickFiles: vi.fn(),
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
    projectEccConfig: {
      read: wizardMocks.readProjectEccPdkConfig,
      write: wizardMocks.writeProjectEccPdkConfig,
    },
    dialog: { pickFiles: wizardMocks.pickFiles },
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
  it('maximizes and restores the wizard without losing its current step', async () => {
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
    const wizard = wrapper.vm as unknown as { currentStep: number }
    wizard.currentStep = 5
    await flushPromises()
    await wrapper.find('button[aria-label="Maximize window"]').trigger('click')
    expect(wrapper.find('.new-workspace-wizard-panel').classes()).toContain('max-w-none')
    expect(wrapper.find('.new-workspace-wizard-overlay').classes()).toContain('p-0')
    expect(wizard.currentStep).toBe(5)
    await wrapper.find('button[aria-label="Restore window"]').trigger('click')
    expect(wrapper.find('.new-workspace-wizard-panel').classes()).not.toContain(
      'max-w-none',
    )
    expect(wizard.currentStep).toBe(5)
    wrapper.unmount()
  })

  it('offers ecc.toml external paths and their files in the Manual resource picker', async () => {
    wizardMocks.importedPdks.value = [
      {
        id: 'pdk:ics55:ready',
        name: 'ICS55',
        path: '/pdks/ics55',
        pdkId: 'ics55',
        readiness: 'ready',
        supportsEccDefaults: true,
        defaultResources: {
          techLef: '/pdks/ics55/tech.lef',
          cellLefs: ['/pdks/ics55/cell.lef'],
          liberty: ['/pdks/ics55/cell.lib'],
        },
      },
    ]
    wizardMocks.readProjectEccPdkConfig.mockResolvedValueOnce({
      exists: true,
      pdkName: 'ics55',
      pdkRoot: '/pdks/ics55',
      externalPaths: ['/macros/sram'],
      overrides: {},
    })
    wizardMocks.scanPdkDirectory.mockReset()
    wizardMocks.scanPdkDirectory.mockImplementation(async (path: string) => ({
      canonicalPath: path,
      detectedFiles: {
        directories: [],
        files: path === '/macros/sram' ? ['sram.lib'] : ['cell.lib'],
      },
    }))
    const wrapper = mount(NewProjectWizard, {
      props: { initialConfig: { directory: '/projects/demo/ws_0001' } },
      global: { stubs: { DesignFileTransfer: true, ...primevueStubs } },
    })
    const wizard = wrapper.vm as unknown as {
      currentStep: number
      pdkConfigMode: 'default' | 'manual'
      activePdkWizardStep: 'tech_lef' | 'cell_lef' | 'liberty'
      pdkSelections: Record<'tech_lef' | 'cell_lef' | 'liberty', string[]>
    }
    wizard.currentStep = 5
    await flushPromises()
    wizard.pdkConfigMode = 'manual'
    wizard.activePdkWizardStep = 'liberty'
    await flushPromises()
    await wrapper.find('button[title="Update selection"]').trigger('click')
    await flushPromises()
    const picker = wrapper.findComponent(PdkResourcePickerDialog)
    expect(picker.exists()).toBe(true)
    await picker.find('button[title="/macros/sram"]').trigger('click')
    expect(picker.text()).toContain('/macros/sram')
    expect(picker.text()).toContain('sram.lib')
    await picker.find('button[title*="sram.lib"]').trigger('click')
    await picker.find('button[title="Add to selection"]').trigger('click')
    await picker
      .findAll('button')
      .find((button) => button.text() === 'Save')!
      .trigger('click')
    expect(wizard.pdkSelections.liberty).toContain('/macros/sram/sram.lib')
    wrapper.unmount()
  })

  it('ignores an older project ecc.toml read after switching projects', async () => {
    wizardMocks.importedPdks.value = [
      {
        id: 'pdk:ics55:ready',
        name: 'ICS55',
        path: '/pdks/ics55',
        pdkId: 'ics55',
        readiness: 'ready',
        supportsEccDefaults: true,
        defaultResources: {
          techLef: '/pdks/ics55/tech.lef',
          cellLefs: ['/pdks/ics55/cell.lef'],
          liberty: ['/pdks/ics55/cell.lib'],
        },
      },
    ]
    let resolveOld!: (result: ProjectEccPdkConfigReadResult) => void
    wizardMocks.readProjectEccPdkConfig.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        }),
    )
    wizardMocks.readProjectEccPdkConfig.mockResolvedValueOnce({
      exists: true,
      pdkName: 'ics55',
      pdkRoot: '/pdks/ics55',
      externalPaths: [],
      overrides: { tech: 'new/tech.lef' },
    })
    const wrapper = mount(NewProjectWizard, {
      props: { initialConfig: { directory: '/projects/old/ws_0001' } },
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
      projectContext: { project_root: string; project_name: string }
    }
    wizard.currentStep = 5
    await flushPromises()
    expect(wizardMocks.readProjectEccPdkConfig).toHaveBeenCalledWith('/projects/old')
    wizard.projectContext.project_root = '/projects/new'
    wizard.projectContext.project_name = 'new'
    await flushPromises()
    expect(wrapper.text()).toContain('/pdks/ics55/new/tech.lef')
    resolveOld({
      exists: true,
      pdkName: 'ics55',
      pdkRoot: '/pdks/ics55',
      externalPaths: [],
      overrides: { tech: 'old/tech.lef' },
    })
    await flushPromises()
    expect(wrapper.text()).not.toContain('/pdks/ics55/old/tech.lef')
    expect(wrapper.text()).toContain('/pdks/ics55/new/tech.lef')
    wrapper.unmount()
  })

  it('clears external PDK paths when switching to another project', async () => {
    wizardMocks.readProjectEccPdkConfig.mockResolvedValue({
      exists: false,
      pdkName: '',
      pdkRoot: '',
      externalPaths: [],
      overrides: {},
    })
    const wrapper = mount(NewProjectWizard, {
      props: {
        initialConfig: {
          directory: '/projects/old/ws_0001',
          pdk_external_paths: ['/old/macros'],
          project_context: {
            mode: 'select',
            project_name: 'old',
            project_root: '/projects/old',
            project_json_path: '/projects/old/project.json',
          },
        },
      },
      global: { stubs: { DesignFileTransfer: true, ...primevueStubs } },
    })
    const wizard = wrapper.vm as unknown as {
      currentStep: number
      externalPdkPaths: string[]
      projectContext: { project_root: string }
    }
    wizard.currentStep = 5
    await flushPromises()
    expect(wizard.externalPdkPaths).toEqual(['/old/macros'])

    wizard.projectContext.project_root = '/projects/new'
    await flushPromises()
    expect(wizard.externalPdkPaths).toEqual([])
    wrapper.unmount()
  })

  it('reports external PDK persistence failures except for missing new project roots', async () => {
    wizardMocks.writeProjectEccPdkConfig.mockRejectedValueOnce(
      new Error('external PDK path does not exist: /missing/macros'),
    )
    const wrapper = mount(NewProjectWizard, {
      props: { initialConfig: { standaloneWorkspace: true } },
      global: { stubs: { DesignFileTransfer: true, ...primevueStubs } },
    })
    const wizard = wrapper.vm as unknown as {
      persistExternalPdkPaths(
        projectRoot: string,
        externalPaths: string[],
        pdkRoot: string,
      ): Promise<void>
    }
    await wizard.persistExternalPdkPaths('/projects/demo', ['/missing/macros'], '')
    expect(wizardMocks.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        summary: 'External PDK Update Failed',
      }),
    )
    wrapper.unmount()
  })

  it('shows the selected PDK root and ECC default files without a project override', async () => {
    wizardMocks.importedPdks.value = [
      {
        id: 'pdk:ics55:default',
        name: 'ICS55',
        path: '/pdks/ics55',
        pdkId: 'ics55',
        readiness: 'ready',
        supportsEccDefaults: true,
        defaultResources: {
          techLef: '/pdks/ics55/prtech/tech.lef',
          cellLefs: ['/pdks/ics55/lef/cell.lef'],
          liberty: ['/pdks/ics55/lib/cell.lib'],
        },
      },
    ]
    const wrapper = mount(NewProjectWizard, {
      props: {
        initialConfig: {
          standaloneWorkspace: true,
          pdk_installation_id: 'pdk:ics55:default',
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
      canProceed: boolean
      config: { pdk_effective_resources?: unknown }
    }
    await wizard.ensurePdksLoaded()
    wizard.currentStep = 5
    await flushPromises()
    expect(wrapper.text()).toContain('/pdks/ics55')
    expect(wrapper.text()).toContain('/pdks/ics55/prtech/tech.lef')
    expect(wrapper.text()).toContain('No external PDK paths declared.')
    expect(wizard.canProceed).toBe(true)
    expect(wizard.config.pdk_effective_resources).toBeUndefined()
    wrapper.unmount()
  })

  it('matches a declared PDK root symlink to the installed canonical root', async () => {
    wizardMocks.importedPdks.value = [
      {
        id: 'pdk:ics55:canonical',
        name: 'ICS55',
        path: '/pdks/ics55',
        pdkId: 'ics55',
        readiness: 'ready',
        supportsEccDefaults: true,
        defaultResources: {
          techLef: '/pdks/ics55/tech.lef',
          cellLefs: ['/pdks/ics55/cell.lef'],
          liberty: ['/pdks/ics55/cell.lib'],
        },
      },
    ]
    wizardMocks.readProjectEccPdkConfig.mockResolvedValueOnce({
      exists: true,
      pdkName: 'ics55',
      pdkRoot: '/link/pdk',
      externalPaths: [],
      overrides: {},
    })
    wizardMocks.scanPdkDirectory.mockResolvedValueOnce({ canonicalPath: '/pdks/ics55' })
    const wrapper = mount(NewProjectWizard, {
      props: { initialConfig: { directory: '/projects/demo/ws_0001' } },
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
      selectedPdkId: string
      canProceed: boolean
    }
    wizard.currentStep = 5
    await flushPromises()
    expect(wizard.selectedPdkId).toBe('pdk:ics55:canonical')
    expect(wrapper.text()).toContain('/link/pdk')
    expect(wizard.canProceed).toBe(true)
    wrapper.unmount()
  })

  it('resolves a relative declared PDK root against the project root', async () => {
    wizardMocks.importedPdks.value = [
      {
        id: 'pdk:ics55:relative',
        name: 'ICS55',
        path: '/pdks/ics55',
        pdkId: 'ics55',
        readiness: 'ready',
        supportsEccDefaults: true,
        defaultResources: {
          techLef: '/pdks/ics55/tech.lef',
          cellLefs: ['/pdks/ics55/cell.lef'],
          liberty: ['/pdks/ics55/cell.lib'],
        },
      },
    ]
    wizardMocks.readProjectEccPdkConfig.mockResolvedValueOnce({
      exists: true,
      pdkName: 'ics55',
      pdkRoot: '../pdks/ics55',
      externalPaths: [],
      overrides: {},
    })
    wizardMocks.scanPdkDirectory.mockImplementationOnce(async (path: string) => {
      expect(path).toBe('/projects/pdks/ics55')
      return { canonicalPath: '/pdks/ics55' }
    })
    const wrapper = mount(NewProjectWizard, {
      props: { initialConfig: { directory: '/projects/demo/ws_0001' } },
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
      pdkOptions: Array<{ id: string; path: string }>
      selectedPdkId: string
      canProceed: boolean
    }
    wizard.currentStep = 5
    await flushPromises()
    expect(wizardMocks.readProjectEccPdkConfig).toHaveBeenCalled()
    expect(wizardMocks.scanPdkDirectory).toHaveBeenCalled()
    expect(wizard.pdkOptions).toHaveLength(1)
    expect(wizard.selectedPdkId).toBe('pdk:ics55:relative')
    expect(wizard.canProceed).toBe(true)
    wrapper.unmount()
  })

  it('shows effective defaults and project paths across configuration modes', async () => {
    wizardMocks.importedPdks.value = [
      {
        id: 'pdk:ics55:local',
        name: 'ICS55',
        path: '/pdks/ics55',
        pdkId: 'ics55',
        readiness: 'ready',
        supportsEccDefaults: true,
        defaultResources: {
          techLef: '/pdks/ics55/default/tech.lef',
          cellLefs: ['/pdks/ics55/default/cell.lef'],
          liberty: ['/pdks/ics55/default/cell.lib'],
        },
      },
    ]
    wizardMocks.readProjectEccPdkConfig.mockResolvedValueOnce({
      exists: true,
      pdkName: 'ics55',
      pdkRoot: '/pdks/ics55',
      externalPaths: ['/macros/sram'],
      overrides: { tech: 'custom/tech.lef', libs: ['/macros/sram/sram.lib'] },
    })
    wizardMocks.scanPdkDirectory.mockResolvedValueOnce({
      canonicalPath: '/macros/sram',
      detectedFiles: { directories: [], files: [] },
    })
    const wrapper = mount(NewProjectWizard, {
      props: {
        initialConfig: {
          directory: '/projects/demo/ws_0001',
          pdk_external_paths: ['/macros/stale'],
          project_context: {
            mode: 'select',
            project_id: 'proj_demo',
            project_name: 'demo',
            project_root: '/projects/demo',
            project_json_path: '/projects/demo/project.json',
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
    const wizard = wrapper.vm as unknown as {
      currentStep: number
      pdkConfigMode: 'default' | 'manual'
      selectedPdkId: string
      config: {
        pdk_effective_resources?: {
          tech_lef: string[]
          cell_lef: string[]
          liberty: string[]
        }
      }
      updatePdkResourceSelection(files: string[]): void
    }
    wizard.currentStep = 5
    await flushPromises()
    expect(wizard.selectedPdkId).toBe('pdk:ics55:local')
    expect(wrapper.text()).toContain('/pdks/ics55')
    expect(wrapper.text()).toContain('/macros/sram')
    expect(wrapper.text()).not.toContain('/macros/stale')
    expect(wrapper.text()).toContain('/pdks/ics55/custom/tech.lef')
    expect(wizard.config.pdk_effective_resources).toEqual({
      tech_lef: ['/pdks/ics55/custom/tech.lef'],
      cell_lef: ['/pdks/ics55/default/cell.lef'],
      liberty: ['/macros/sram/sram.lib'],
    })

    wizard.pdkConfigMode = 'manual'
    await flushPromises()
    expect(wrapper.text()).toContain('/pdks/ics55/custom/tech.lef')
    wizard.updatePdkResourceSelection(['/pdks/ics55/user/tech.lef'])
    wizard.pdkConfigMode = 'default'
    await flushPromises()
    expect(wrapper.text()).toContain('/pdks/ics55/custom/tech.lef')
    wizard.pdkConfigMode = 'manual'
    await flushPromises()
    expect(wrapper.text()).toContain('/pdks/ics55/user/tech.lef')
    wrapper.unmount()
  })

  it('shows ECC defaults without ecc.toml overrides and blocks a mismatched project PDK', async () => {
    wizardMocks.importedPdks.value = [
      {
        id: 'pdk:ics55:local',
        name: 'ICS55',
        path: '/pdks/ics55',
        pdkId: 'ics55',
        readiness: 'ready',
        supportsEccDefaults: true,
        defaultResources: {
          techLef: '/pdks/ics55/default/tech.lef',
          cellLefs: ['/pdks/ics55/default/cell.lef'],
          liberty: ['/pdks/ics55/default/cell.lib'],
        },
      },
    ]
    wizardMocks.readProjectEccPdkConfig.mockResolvedValueOnce({
      exists: true,
      pdkName: 'ics55',
      pdkRoot: '/pdks/other',
      externalPaths: ['/macros/memory'],
      overrides: {},
    })
    wizardMocks.scanPdkDirectory.mockResolvedValueOnce({
      canonicalPath: '/macros/memory',
      detectedFiles: { directories: [], files: [] },
    })
    const wrapper = mount(NewProjectWizard, {
      props: {
        initialConfig: {
          directory: '/projects/demo/ws_0001',
          project_context: {
            mode: 'select',
            project_id: 'proj_demo',
            project_name: 'demo',
            project_root: '/projects/demo',
            project_json_path: '/projects/demo/project.json',
          },
          pdk_installation_id: 'pdk:ics55:local',
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
    const wizard = wrapper.vm as unknown as { currentStep: number; canProceed: boolean }
    wizard.currentStep = 5
    await flushPromises()
    expect(wrapper.text()).toContain('/pdks/other')
    expect(wrapper.text()).toContain('/macros/memory')
    expect(wizard.canProceed).toBe(false)
    expect(wrapper.text()).toContain('does not match an available installation')
    wrapper.unmount()
  })

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
      project_type: 'backend',
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
      project_type: 'backend',
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

  it('accepts an extensionless filelist picked from the dialog', async () => {
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
      designFileError: string
      filelistPath: string
      importDesignInput: (type: string) => Promise<void>
    }

    wizardMocks.pickFiles.mockResolvedValueOnce(['/projects/gcd/ws_0001/origin/filelist'])
    await wizard.importDesignInput('filelist')
    await flushPromises()
    expect(wizard.filelistPath).toBe('/projects/gcd/ws_0001/origin/filelist')
    expect(wizard.designFileError).toBe('')

    wizardMocks.pickFiles.mockResolvedValueOnce(['/projects/gcd/design.exe'])
    await wizard.importDesignInput('filelist')
    await flushPromises()
    expect(wizard.filelistPath).toBe('/projects/gcd/ws_0001/origin/filelist')
    expect(wizard.designFileError).toContain('FILELIST')
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

  it('lets a project-managed workspace choose its flow start step', async () => {
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
      currentStep: number
      flowStartStep: string
      selectedFlowSteps: string[]
      isFlowStepSelected(stepName: string): boolean
    }
    wizard.currentStep = 3
    await flushPromises()

    const startSelect = wrapper.get('select')
    expect(wizard.flowStartStep).toBe('Synthesis')
    await startSelect.setValue('CTS')
    await flushPromises()

    expect(wizard.flowStartStep).toBe('CTS')
    expect(wizard.selectedFlowSteps[0]).toBe('CTS')
    expect(wizard.isFlowStepSelected('Synthesis')).toBe(false)
    expect(wizard.isFlowStepSelected('CTS')).toBe(true)
    wrapper.unmount()
  })

  it('falls back to the canonical ECC chain when discovery has no flow definitions', async () => {
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
      currentStep: number
      flowStepOptions: Array<{ name: string; description: string }>
    }
    wizard.currentStep = 3
    await flushPromises()

    expect(wizard.flowStepOptions.map((step) => step.name)).toEqual([
      'Synthesis',
      'lec',
      'preFloorplan',
      'macroPlacement',
      'postFloorplan',
      'place',
      'CTS',
      'legalization',
      'Timing optimization',
      'route',
      'filler',
      'RCX',
      'sta',
      'lvs',
      'postRouteLec',
      'drc',
      'Harden',
    ])
    expect(wrapper.text()).toContain('preFloorplan')
    expect(wrapper.text()).toContain('macroPlacement')
    wrapper.unmount()
  })

  it('prefers the flow definition matching the current flowId', async () => {
    wizardMocks.getWorkspaceCreationModel.mockResolvedValue({
      controls: {
        flowBoundaries: true,
        manualPdkFiles: true,
        mpc: true,
        pdkVersion: true,
      },
      discovery: {
        flowDefinitions: [
          {
            flowId: 'rtl2gds',
            stepIds: ['Synthesis', 'preFloorplan', 'macroPlacement', 'Harden'],
          },
          { flowId: 'harden', stepIds: ['Synthesis', 'customStep', 'Harden'] },
        ],
      },
      parameters: [],
      pdkInstallations: [],
    })
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
      currentStep: number
      flowStepOptions: Array<{ name: string; description: string }>
    }
    wizard.currentStep = 3
    await flushPromises()

    expect(wizard.flowStepOptions.map((step) => step.name)).toEqual([
      'Synthesis',
      'customStep',
      'Harden',
    ])
    expect(wrapper.text()).toContain('customStep step.')
    wrapper.unmount()
    wizardMocks.getWorkspaceCreationModel.mockResolvedValue({
      controls: {
        flowBoundaries: true,
        manualPdkFiles: true,
        mpc: true,
        pdkVersion: true,
      },
      discovery: {},
      parameters: [],
      pdkInstallations: [],
    })
  })

  it('marks steps reported as skippable by the flow definition', async () => {
    wizardMocks.getWorkspaceCreationModel.mockResolvedValue({
      controls: {
        flowBoundaries: true,
        manualPdkFiles: true,
        mpc: true,
        pdkVersion: true,
      },
      discovery: {
        flowDefinitions: [
          {
            flowId: 'rtl2gds',
            stepIds: [
              'Synthesis',
              'lec',
              'preFloorplan',
              'Timing optimization',
              'Harden',
            ],
            skippableStepIds: ['lec', 'Timing optimization'],
            defaultSkippedStepIds: ['lec'],
          },
        ],
      },
      parameters: [],
      pdkInstallations: [],
    })
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
      currentStep: number
      skippableFlowStepNames: ReadonlySet<string>
      defaultSkippedFlowStepNames: ReadonlySet<string>
      runnableFlowSteps: string[]
    }
    wizard.currentStep = 3
    await flushPromises()

    expect([...wizard.skippableFlowStepNames]).toEqual(['lec', 'Timing optimization'])
    expect([...wizard.defaultSkippedFlowStepNames]).toEqual(['lec'])
    expect(wizard.runnableFlowSteps).toEqual([
      'Synthesis',
      'preFloorplan',
      'Timing optimization',
      'Harden',
    ])
    const buttons = wrapper.findAll('button')
    const skippedCards = buttons.filter((button) => button.text().includes('Skipped'))
    expect(skippedCards).toHaveLength(1)
    expect(skippedCards[0].text()).toContain('lec')
    expect(skippedCards[0].classes()).toContain('border-dashed')
    const lecCheckbox = skippedCards[0].find('input[type="checkbox"]')
    expect((lecCheckbox.element as HTMLInputElement).checked).toBe(false)
    const skippableCards = buttons.filter((button) => button.text().includes('Skippable'))
    expect(skippableCards).toHaveLength(1)
    expect(skippableCards[0].text()).toContain('Timing optimization')
    const skippableCheckbox = skippableCards[0].find('input[type="checkbox"]')
    expect((skippableCheckbox.element as HTMLInputElement).checked).toBe(true)
    wrapper.unmount()
    wizardMocks.getWorkspaceCreationModel.mockResolvedValue({
      controls: {
        flowBoundaries: true,
        manualPdkFiles: true,
        mpc: true,
        pdkVersion: true,
      },
      discovery: {},
      parameters: [],
      pdkInstallations: [],
    })
  })

  it('uses the rtl2gds definition for legacy preset flowIds and resets stale boundaries', async () => {
    wizardMocks.getWorkspaceCreationModel.mockResolvedValue({
      controls: {
        flowBoundaries: true,
        manualPdkFiles: true,
        mpc: true,
        pdkVersion: true,
      },
      discovery: {
        flowDefinitions: [
          { flowId: 'rtl2gds', stepIds: ['Synthesis', 'preFloorplan', 'place', 'sta'] },
        ],
      },
      parameters: [],
      pdkInstallations: [],
    })
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
      currentStep: number
      flowEndStep: string
      flowStepOptions: Array<{ name: string; description: string }>
    }
    wizard.currentStep = 3
    await flushPromises()

    // Default end step 'Harden' is absent from the discovered chain, so the
    // boundary resets to the last discovered step.
    expect(wizard.flowStepOptions.map((step) => step.name)).toEqual([
      'Synthesis',
      'preFloorplan',
      'place',
      'sta',
    ])
    expect(wizard.flowEndStep).toBe('sta')
    expect(wrapper.text()).toContain('preFloorplan')
    wrapper.unmount()
    wizardMocks.getWorkspaceCreationModel.mockResolvedValue({
      controls: {
        flowBoundaries: true,
        manualPdkFiles: true,
        mpc: true,
        pdkVersion: true,
      },
      discovery: {},
      parameters: [],
      pdkInstallations: [],
    })
  })

  it("maps a persisted 'Floorplan' start step to preFloorplan", async () => {
    const wrapper = mount(NewProjectWizard, {
      props: {
        initialConfig: {
          standaloneWorkspace: true,
          flow_config: { start_step: 'Floorplan', end_step: 'Harden', steps: [] },
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
      flowStartStep: string
      selectedFlowSteps: string[]
    }
    wizard.currentStep = 3
    await flushPromises()

    expect(wizard.flowStartStep).toBe('preFloorplan')
    expect(wizard.selectedFlowSteps[0]).toBe('preFloorplan')
    wrapper.unmount()
  })
})
