// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import {
  createProjectManifestDraft,
  type ProjectEccPdkConfigReadResult,
  type ProjectManifest,
} from '@ecos-studio/shared'
import type { Project } from '@/types'
import type { WorkspaceWizardInitialConfig } from '@/utils/workspaceNavigation'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import NewProjectWizard from './NewProjectWizard.vue'
import WorkspaceWizard from './WorkspaceWizard.vue'
import FrontendProjectWizard from './FrontendProjectWizard.vue'
import PdkResourcePickerDialog from './PdkResourcePickerDialog.vue'
import RtlImportStep from './RtlImportStep.vue'

const wizardMocks = vi.hoisted(() => {
  // Mirrors the live ECC rtl2gds discovery payload
  // (ecc chipcompiler/engine/workspace_spec.py describe_workspace_spec).
  const rtl2gdsStepIds = [
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
    'powerAnalysis',
    'lvs',
    'postRouteLec',
    'drc',
    'Harden',
  ]
  const defaultWorkspaceCreationModel = () => ({
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
          stepIds: rtl2gdsStepIds,
          skippableStepIds: ['lec', 'Timing optimization', 'postRouteLec'],
          defaultSkippedStepIds: ['lec'],
        },
      ],
    },
    parameters: [],
    pdkInstallations: [],
  })
  return {
    defaultWorkspaceCreationModel,
    importedPdks: { value: [] as Array<Record<string, unknown>> },
    loadPdks: vi.fn(async () => undefined),
    importPdk: vi.fn(),
    removePdk: vi.fn(),
    validatePdk: vi.fn(),
    locatePdk: vi.fn(),
    showToast: vi.fn(),
    loadProjectHistory: vi.fn<() => Promise<Project[]>>(async () => []),
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
    pickDirectory: vi.fn(),
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
    getWorkspaceCreationModel: vi.fn(async () => defaultWorkspaceCreationModel()),
    pathExists: vi.fn(async () => true),
  }
})

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
    dialog: {
      pickFiles: wizardMocks.pickFiles,
      pickDirectory: wizardMocks.pickDirectory,
    },
    workspaceCreationModel: { get: wizardMocks.getWorkspaceCreationModel },
    workspace: {
      scanPdkDirectory: wizardMocks.scanPdkDirectory,
      discoverHdlModules: wizardMocks.discoverHdlModules,
      pathExists: wizardMocks.pathExists,
    },
  }),
}))

vi.mock('@/utils/projectHistory', () => ({
  loadProjectHistory: wizardMocks.loadProjectHistory,
}))

vi.mock('@/utils/projectManagementRead', () => ({
  readProjectManagementManifest: wizardMocks.readProjectManagementManifest,
}))

vi.mock('@/api/frontendCatalog', () => ({
  listFrontendCatalogApi: vi.fn(async () => ({
    response: 'success',
    data: {
      version: 1,
      defaults: { core_id: '', soc_harness_id: '', toolchain_id: '', test_suite_id: '' },
      cores: [],
      soc_harnesses: [],
      toolchains: [],
      test_suites: [],
    },
  })),
  validateFrontendConfigApi: vi.fn(),
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
  it('accepts the preselected Quick Start GCD RTL on Import RTL', async () => {
    const projectContext = {
      mode: 'select' as const,
      project_name: 'gcd',
      project_root: '/projects/gcd',
      project_json_path: '/projects/gcd/project.json',
    }
    const wrapper = mount(NewProjectWizard, {
      props: {
        initialConfig: {
          directory: '/projects/gcd/ws_0001',
          project_context: projectContext,
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
    wrapper.unmount()
    const quickStartWizard = mount(NewProjectWizard, {
      props: {
        initialConfig: {
          directory: '/projects/gcd/ws_0001',
          rtl_list: ['/resources/gcd/gcd.v'],
          flow_config: { start_step: 'Synthesis', end_step: 'Harden', steps: [] },
          project_context: projectContext,
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
    const wizard = quickStartWizard.vm as unknown as { currentStep: number }
    wizard.currentStep = 2
    await flushPromises()

    expect(quickStartWizard.text()).toContain('/resources/gcd/gcd.v')
    const continueButton = quickStartWizard
      .findAll('button')
      .find((button) => button.text() === 'Continue')
    expect(continueButton?.attributes('disabled')).toBeUndefined()
    quickStartWizard.unmount()
  })

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
    wizard.currentStep = 6
    await flushPromises()
    await wrapper.find('button[aria-label="Maximize window"]').trigger('click')
    expect(wrapper.find('.new-workspace-wizard-panel').classes()).toContain('max-w-none')
    expect(wrapper.find('.new-workspace-wizard-overlay').classes()).toContain('p-0')
    expect(wizard.currentStep).toBe(6)
    await wrapper.find('button[aria-label="Restore window"]').trigger('click')
    expect(wrapper.find('.new-workspace-wizard-panel').classes()).not.toContain(
      'max-w-none',
    )
    expect(wizard.currentStep).toBe(6)
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
    wizard.currentStep = 6
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
    wizard.currentStep = 6
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
    wizard.currentStep = 6
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
    wizard.currentStep = 6
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
    wizard.currentStep = 6
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
    wizard.currentStep = 6
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
    wizard.currentStep = 6
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
    wizard.currentStep = 6
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

    for (let step = 1; step < 6; step += 1) {
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
    // The wizard config is reactive; the desktop bridge payload must stay
    // structured-cloneable or ipcRenderer.invoke throws "could not be cloned".
    expect(() =>
      structuredClone(wizardMocks.resolveBinding.mock.calls[0]?.[0]),
    ).not.toThrow()
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
    wizard.currentStep = 6
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
    wizard.currentStep = 6
    await flushPromises()

    expect(wrapper.text()).toContain('Unverified')
    expect(wizard.canProceed).toBe(false)
    expect(wizard.stepFiveBlockedReason).toContain('Tech LEF, Cell LEF, Liberty')
    wrapper.unmount()
  })

  it('requires RTL import when the project only has the init placeholder RTL', async () => {
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
      // ecc init scaffolds rtl/<design>.v without creating the file.
      base_design: {
        rtl_list: ['rtl/gcd.v'],
        parameters: { design: 'gcd' },
      },
      objectives: { primary: 'timing', directions: {} },
      workspaces: [],
      mpc: null,
      best_workspace: null,
      qor_baseline: null,
    })
    wizardMocks.pathExists.mockResolvedValueOnce(false)
    const wrapper = mount(NewProjectWizard, {
      props: {
        initialConfig: {
          directory: '/projects/gcd/ws_0002',
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
      canProceed: boolean
      currentStep: number
      importedDesignSource: { rtlList: string[]; filelist: string } | null
    }
    wizard.currentStep = 2
    await flushPromises()
    expect(wizard.importedDesignSource).toBeNull()
    expect(wizard.canProceed).toBe(false)
    expect(wrapper.text()).toContain(
      'Select RTL files or a filelist to import into the project rtl/ folder.',
    )
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
      importedDesignSource: { rtlList: string[]; filelist: string } | null
    }
    // The project's imported RTL is reused as the design source; it is not
    // resubmitted as a pending import selection.
    expect(wizard.config).toMatchObject({
      parameters: { top_module: 'gcd_top', clock: 'clk_i' },
      rtl_list: [],
      sdc: '/projects/gcd/ws_0001/origin/gcd.sdc',
    })
    expect(wizard.importedDesignSource).toMatchObject({
      rtlList: ['/projects/gcd/ws_0001/origin/gcd.v'],
    })
    wrapper.unmount()
  })

  it('reuses the project filelist when the manifest declares both RTL and filelist', async () => {
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
      importedDesignSource: { rtlList: string[]; filelist: string } | null
      effectiveSynthesisDesignInputs(): {
        rtlPaths: string[]
        filelistPath: string
      } | null
    }
    // Reuse, not a pending import: both manifest sources are exposed and the
    // filelist wins as the effective design source.
    expect(wizard.config.rtl_list).toEqual([])
    expect(wizard.filelistPath).toBe('')
    expect(wizard.importedDesignSource).toMatchObject({
      rtlList: ['/projects/gcd/ws_0001/origin/gcd.v'],
      filelist: '/projects/gcd/sources.f',
    })
    expect(wizard.effectiveSynthesisDesignInputs()).toMatchObject({
      filelistPath: '/projects/gcd/sources.f',
    })
    wrapper.unmount()
  })

  it('prefers the filelist as the design source when both sources are pending', async () => {
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
      effectiveSynthesisDesignInputs(): {
        rtlPaths: string[]
        filelistPath: string
      } | null
    }
    wizard.currentStep = 5
    wizard.config.rtl_list = ['/rtl/top.v']
    wizard.filelistPath = '/rtl/sources.f'
    await flushPromises()
    // Exclusivity is enforced by the Import RTL step; a programmatic both-set
    // state deterministically resolves to the filelist.
    expect(wizard.effectiveSynthesisDesignInputs()).toMatchObject({
      filelistPath: '/rtl/sources.f',
    })
    expect(wizard.canProceed).toBe(true)
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
      config: { rtl_list: string[] }
      currentStep: number
      filelistPath: string
    }
    wizard.currentStep = 2
    await flushPromises()
    const picker = wrapper.findComponent(RtlImportStep)
    expect(picker.exists()).toBe(true)
    const pickerVm = picker.vm as unknown as {
      pickFilelist(): Promise<void>
      manualFilePickError: string
    }

    wizardMocks.pickFiles.mockResolvedValueOnce(['/projects/gcd/ws_0001/origin/filelist'])
    await pickerVm.pickFilelist()
    await flushPromises()
    expect(wizard.filelistPath).toBe('/projects/gcd/ws_0001/origin/filelist')
    expect(pickerVm.manualFilePickError).toBe('')

    wizardMocks.pickFiles.mockResolvedValueOnce(['/projects/gcd/design.exe'])
    await pickerVm.pickFilelist()
    await flushPromises()
    expect(wizard.filelistPath).toBe('/projects/gcd/ws_0001/origin/filelist')
    expect(pickerVm.manualFilePickError).toContain('filelist')
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
    wizard.currentStep = 7
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
    wizard.currentStep = 7
    await wizard.refreshTopModuleDiscovery()
    await flushPromises()
    expect(wizardMocks.discoverHdlModules).toHaveBeenLastCalledWith(
      expect.objectContaining({ rtlPaths: ['/rtl/empty.v'] }),
    )
    expect(wizard.canProceed).toBe(false)
    expect(wrapper.text()).toContain('Return to Import RTL')
    const returnButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Return to Import RTL'))
    expect(returnButton).toBeTruthy()
    await returnButton!.trigger('click')
    await flushPromises()
    expect(wizard.currentStep).toBe(2)
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
    wizard.currentStep = 7
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
    wizard.currentStep = 7
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
    wizard.currentStep = 4
    await flushPromises()

    const startSelect = wrapper.get('select')
    const parallelCorners = wrapper.get('#sta-max-parallel-corners')
    expect((parallelCorners.element as HTMLSelectElement).value).toBe('1')
    await parallelCorners.setValue('3')
    expect((parallelCorners.element as HTMLSelectElement).value).toBe('3')
    expect(wizard.flowStartStep).toBe('Synthesis')
    await startSelect.setValue('CTS')
    await flushPromises()

    expect(wizard.flowStartStep).toBe('CTS')
    expect(wizard.selectedFlowSteps[0]).toBe('CTS')
    expect(wizard.isFlowStepSelected('Synthesis')).toBe(false)
    expect(wizard.isFlowStepSelected('CTS')).toBe(true)
    wrapper.unmount()
  })

  it('leaves flow steps unavailable when discovery has no flow definitions', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    wizardMocks.getWorkspaceCreationModel.mockResolvedValue({
      controls: {
        flowBoundaries: true,
        manualPdkFiles: true,
        mpc: true,
        pdkVersion: true,
      },
      discovery: { flowDefinitions: [] },
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
    wizard.currentStep = 4
    await flushPromises()

    expect(wizard.flowStepOptions).toEqual([])
    expect(wrapper.text()).toContain('Flow steps are unavailable')
    expect(wrapper.text()).not.toContain('preFloorplan')
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('no usable flow definition'),
    )
    warn.mockRestore()
    wrapper.unmount()
    wizardMocks.getWorkspaceCreationModel.mockResolvedValue(
      wizardMocks.defaultWorkspaceCreationModel(),
    )
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
            skippableStepIds: [],
            defaultSkippedStepIds: [],
          },
          {
            flowId: 'harden',
            stepIds: ['Synthesis', 'customStep', 'Harden'],
            skippableStepIds: [],
            defaultSkippedStepIds: [],
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
      flowStepOptions: Array<{ name: string; description: string }>
    }
    wizard.currentStep = 4
    await flushPromises()

    expect(wizard.flowStepOptions.map((step) => step.name)).toEqual([
      'Synthesis',
      'customStep',
      'Harden',
    ])
    expect(wrapper.text()).toContain('customStep step.')
    wrapper.unmount()
    wizardMocks.getWorkspaceCreationModel.mockResolvedValue(
      wizardMocks.defaultWorkspaceCreationModel(),
    )
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
    wizard.currentStep = 4
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
    wizardMocks.getWorkspaceCreationModel.mockResolvedValue(
      wizardMocks.defaultWorkspaceCreationModel(),
    )
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
          {
            flowId: 'rtl2gds',
            stepIds: ['Synthesis', 'preFloorplan', 'place', 'sta'],
            skippableStepIds: [],
            defaultSkippedStepIds: [],
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
      flowEndStep: string
      flowStepOptions: Array<{ name: string; description: string }>
    }
    wizard.currentStep = 4
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
    wizardMocks.getWorkspaceCreationModel.mockResolvedValue(
      wizardMocks.defaultWorkspaceCreationModel(),
    )
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
    wizard.currentStep = 4
    await flushPromises()

    expect(wizard.flowStartStep).toBe('preFloorplan')
    expect(wizard.selectedFlowSteps[0]).toBe('preFloorplan')
    wrapper.unmount()
  })
})

describe('workspace wizard project type routing', () => {
  const projectRoot = '/projects/cpu'
  const frontendManifest = createProjectManifestDraft({
    rootPath: projectRoot,
    name: 'project_cpu_soc',
    designName: 'simple_cpu',
    projectType: 'frontend',
  })
  const global = {
    stubs: { DesignFileTransfer: true, PdkResourcePickerDialog: true, ...primevueStubs },
  }

  beforeEach(() => {
    wizardMocks.readProjectManagementManifest.mockReset()
    wizardMocks.readProjectManagementManifest.mockResolvedValue(frontendManifest)
    wizardMocks.loadProjectHistory.mockResolvedValue([
      {
        id: projectRoot,
        path: projectRoot,
        name: 'project_cpu_soc',
        // The on-disk manifest must decide the flow even when history is stale.
        projectType: 'backend',
        lastOpened: new Date(),
      },
    ])
    wizardMocks.pickDirectory.mockResolvedValue(projectRoot)
    wizardMocks.getWorkspaceCreationModel.mockClear()
  })

  it.each(['history', 'browse'])(
    'opens frontend setup when selecting a frontend project via %s',
    async (entry) => {
      const wrapper = mount(WorkspaceWizard, { global })
      await flushPromises()
      const button = wrapper
        .findAll('button')
        .find((item) =>
          entry === 'history'
            ? item.text().includes('project_cpu_soc')
            : item.text() === 'Browse',
        )
      expect(button).toBeDefined()
      await button!.trigger('click')
      await flushPromises()

      expect(wrapper.findComponent(NewProjectWizard).exists()).toBe(false)
      const frontend = wrapper.getComponent(FrontendProjectWizard)
      expect(frontend.props('initialConfig')).toEqual({
        designTool: 'frontend',
        directory: `${projectRoot}/ws_0001`,
        parameters: { design: 'simple_cpu' },
        project_context: {
          mode: 'select',
          project_id: frontendManifest.project_id,
          project_name: 'project_cpu_soc',
          project_root: projectRoot,
          project_json_path: `${projectRoot}/project.json`,
        },
      })
      const continueButton = frontend
        .findAll('button')
        .find((item) => item.text() === 'Continue')!
      expect(continueButton.attributes('disabled')).toBeUndefined()
      await continueButton.trigger('click')
      await flushPromises()
      expect(frontend.find('h2')?.text()).toBe('Verification Setup')
      expect(wrapper.text()).not.toContain('Flow Setup')
      expect(wrapper.text()).not.toContain('preFloorplan')
      wrapper.unmount()
    },
  )

  it('opens frontend requests directly without querying the backend flow', async () => {
    const wrapper = mount(WorkspaceWizard, {
      props: {
        initialConfig: {
          designTool: 'frontend',
          directory: `${projectRoot}/ws_0003`,
          project_context: {
            mode: 'select',
            project_root: projectRoot,
            project_name: 'project_cpu_soc',
            project_json_path: `${projectRoot}/project.json`,
          },
        },
      },
      global,
    })
    await flushPromises()
    expect(wrapper.findComponent(NewProjectWizard).exists()).toBe(false)
    expect(
      wrapper.getComponent(FrontendProjectWizard).props('initialConfig')?.directory,
    ).toBe(`${projectRoot}/ws_0003`)
    expect(wizardMocks.getWorkspaceCreationModel).not.toHaveBeenCalled()
    await wrapper.get('input[placeholder="e.g. ws_0001"]').setValue('ws_0004')
    expect(wrapper.get(`p[title="${projectRoot}/ws_0004"]`).text()).toBe(
      `${projectRoot}/ws_0004`,
    )
    wrapper.unmount()
  })

  it('preserves loaded workspace configuration when discovering a frontend project', async () => {
    const initialConfig: WorkspaceWizardInitialConfig = {
      directory: `${projectRoot}/ws_0003`,
      lockWorkspaceDirectory: true,
      parameters: {
        design: 'simple_cpu',
        description: 'Existing workspace settings',
        clock: 'sys_clk',
        frequency_max: 150,
        cpu_filelist: '/rtl/cpu.f',
      },
      pdk: 'ics55',
      pdk_root: '/pdks/ics55',
      sdc: '/constraints/cpu.sdc',
      flow_config: {
        start_step: 'elab',
        end_step: 'sim',
        steps: ['elab', 'lint', 'sim'],
      },
      project_context: {
        mode: 'select',
        project_root: projectRoot,
        project_name: 'project_cpu_soc',
        project_json_path: `${projectRoot}/project.json`,
      },
    }
    const wrapper = mount(WorkspaceWizard, { props: { initialConfig }, global })
    await flushPromises()

    expect(wrapper.findComponent(NewProjectWizard).exists()).toBe(false)
    expect(
      wrapper.getComponent(FrontendProjectWizard).props('initialConfig'),
    ).toMatchObject({
      ...initialConfig,
      designTool: 'frontend',
    })
    expect(wrapper.get('textarea').element.value).toBe('Existing workspace settings')
    expect(initialConfig.parameters?.clock).toBe('sys_clk')
    expect(initialConfig.parameters?.frequency_max).toBe(150)
    wrapper.unmount()
  })

  it.each(['direct', 'manifest'])(
    'enforces the project management target lock for %s frontend routing',
    async (entry) => {
      const directory = `${projectRoot}/ws_0003`
      const wrapper = mount(WorkspaceWizard, {
        props: {
          initialConfig: {
            designTool: entry === 'direct' ? 'frontend' : undefined,
            directory,
            lockWorkspaceDirectory: true,
            project_context: {
              mode: 'select',
              project_root: projectRoot,
              project_name: 'project_cpu_soc',
              project_json_path: `${projectRoot}/project.json`,
            },
          },
        },
        global,
      })
      await flushPromises()

      expect(
        wrapper.getComponent(FrontendProjectWizard).props('lockWorkspaceDirectory'),
      ).toBe(true)
      expect(
        wrapper.get('input[placeholder="e.g. ws_0001"]').attributes('disabled'),
      ).toBeDefined()
      expect(
        wrapper.get('input[placeholder="e.g. project_fe"]').attributes('readonly'),
      ).toBeDefined()
      const buttonLabels = wrapper.findAll('button').map((button) => button.text())
      expect(buttonLabels).not.toContain('Browse')
      expect(buttonLabels).not.toContain('Create Project')
      expect(wrapper.get(`p[title="${directory}"]`).text()).toBe(directory)
      wrapper.unmount()
    },
  )

  it('keeps a locked target outside the project root at its supplied path', async () => {
    const directory = '/scratch/cpu/ws_0003'
    const wrapper = mount(WorkspaceWizard, {
      props: {
        initialConfig: {
          designTool: 'frontend',
          directory,
          lockWorkspaceDirectory: true,
          project_context: {
            mode: 'select',
            project_root: projectRoot,
            project_name: 'project_cpu_soc',
            project_json_path: `${projectRoot}/project.json`,
          },
        },
      },
      global,
    })
    await flushPromises()
    expect(wrapper.get(`p[title="${directory}"]`).text()).toBe(directory)
    expect(wrapper.find(`p[title="${projectRoot}/ws_0003"]`).exists()).toBe(false)
    wrapper.unmount()
  })

  it('blocks Continue until the selected manifest is read and reports read failures', async () => {
    let rejectRead!: (reason: Error) => void
    wizardMocks.readProjectManagementManifest.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectRead = reject
      }),
    )
    const wrapper = mount(WorkspaceWizard, {
      props: {
        initialConfig: {
          directory: `${projectRoot}/ws_0001`,
          project_context: {
            mode: 'select',
            project_root: projectRoot,
            project_name: 'cpu',
            project_json_path: `${projectRoot}/project.json`,
          },
        },
      },
      global,
    })
    await flushPromises()
    const continueButton = () =>
      wrapper.findAll('button').find((item) => item.text() === 'Continue')!
    expect(continueButton().attributes('disabled')).toBeDefined()
    rejectRead(new Error('Unreadable manifest'))
    await flushPromises()
    expect(wrapper.text()).toContain('could not be read')
    expect(continueButton().attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('keeps backend projects on the backend flow', async () => {
    wizardMocks.readProjectManagementManifest.mockResolvedValue({
      ...frontendManifest,
      project_type: 'backend',
      base_design: {
        ...frontendManifest.base_design,
        rtl_list: [`${projectRoot}/rtl/top.v`],
      },
    })
    const wrapper = mount(WorkspaceWizard, {
      props: {
        initialConfig: {
          directory: `${projectRoot}/ws_0001`,
          project_context: {
            mode: 'select',
            project_root: projectRoot,
            project_name: 'cpu',
            project_json_path: `${projectRoot}/project.json`,
          },
        },
      },
      global,
    })
    await flushPromises()
    for (let step = 0; step < 3; step += 1) {
      await wrapper
        .findAll('button')
        .find((item) => item.text() === 'Continue')!
        .trigger('click')
      await flushPromises()
    }
    expect(wrapper.findComponent(FrontendProjectWizard).exists()).toBe(false)
    expect(wrapper.text()).toContain('preFloorplan')
    wrapper.unmount()
  })
})
