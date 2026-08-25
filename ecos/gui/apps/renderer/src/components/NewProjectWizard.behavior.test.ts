// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import NewProjectWizard from './NewProjectWizard.vue'

const wizardMocks = vi.hoisted(() => ({
  importedPdks: { value: [] as Array<Record<string, unknown>> },
  loadPdks: vi.fn(async () => undefined),
  importPdk: vi.fn(),
  removePdk: vi.fn(),
  validatePdk: vi.fn(),
  showToast: vi.fn(),
  loadProjectHistory: vi.fn(async () => []),
  readProjectManagementManifest: vi.fn(async () => null),
  resolveBinding: vi.fn(),
  scanPdkDirectory: vi.fn(),
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
})
