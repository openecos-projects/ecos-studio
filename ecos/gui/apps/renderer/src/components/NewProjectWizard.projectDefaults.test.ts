// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EccPersistedEngineeringSnapshot } from '@ecos-studio/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readPersistedEngineeringSnapshot } from '../../../desktop-electron/electron/services/eccCli/engineeringSnapshotReader'
import { readProjectManifest } from '../../../desktop-electron/electron/services/eccCli/persistedState'
import { discoverHdlModules } from '../../../desktop-electron/electron/services/hdlModuleDiscovery'
import { ProjectManagementReadService } from '../../../desktop-electron/electron/services/projectManagementReadService'
import NewProjectWizard from './NewProjectWizard.vue'

const desktopMocks = vi.hoisted(() => ({
  readManifest: vi.fn(),
  discover: vi.fn(),
  exists: vi.fn(),
}))

vi.mock('@/composables/usePdkManager', () => ({
  usePdkManager: () => ({
    importedPdks: { value: [] },
    loadPdks: vi.fn(),
  }),
}))
vi.mock('@/composables/useWorkspace', () => ({
  useWorkspace: () => ({ showToast: vi.fn() }),
}))
vi.mock('@/utils/projectHistory', () => ({ loadProjectHistory: async () => [] }))
vi.mock('@/utils/projectManagementRead', () => ({
  readProjectManagementManifest: desktopMocks.readManifest,
}))
vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({
    workspaceCreationModel: {
      get: async () => ({
        discovery: {
          flowDefinitions: [{ flowId: 'rtl2gds', stepIds: ['Synthesis', 'Harden'] }],
        },
        parameters: [],
        pdkInstallations: [],
      }),
    },
    workspace: {
      discoverHdlModules: desktopMocks.discover,
      pathExists: desktopMocks.exists,
    },
  }),
}))

const temporaryDirectories: string[] = []

afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  )
})

async function createProjectWithWorkspace(mode: 'rtl' | 'filelist') {
  const root = await mkdtemp(join(tmpdir(), 'ecos-wizard-project-defaults-'))
  temporaryDirectories.push(root)
  const workspaceRoot = join(root, 'ws_0001')
  const rtlRoot = join(root, 'rtl')
  const originRoot = join(workspaceRoot, 'origin')
  await mkdir(rtlRoot, { recursive: true })
  await mkdir(originRoot, { recursive: true })
  await mkdir(join(workspaceRoot, 'home'), { recursive: true })
  const sources = {
    'top.v': 'module top(input clk, output y); helper u(.clk(clk), .y(y)); endmodule',
    'helper.v': 'module helper(input clk, output y); assign y = clk; endmodule',
  }
  for (const [name, content] of Object.entries(sources)) {
    await writeFile(join(rtlRoot, name), content)
    await writeFile(join(originRoot, name), content)
  }
  const filelistContent = 'top.v\nhelper.v\n'
  const frozenFilelist = join(originRoot, mode === 'rtl' ? 'filelist' : 'sources.f')
  await writeFile(join(rtlRoot, 'sources.f'), filelistContent)
  await writeFile(frozenFilelist, filelistContent)
  const now = '2026-10-29T00:00:00.000Z'
  await writeFile(
    join(root, 'project.json'),
    JSON.stringify({
      schema_version: 1,
      project_id: 'project_top',
      name: 'top',
      design_name: 'top',
      root_path: root,
      created_at: now,
      updated_at: now,
      base_design: {
        top_module: 'top',
        clock: 'clk',
        rtl_list: mode === 'rtl' ? ['rtl/top.v', 'rtl/helper.v'] : ['rtl/sources.f'],
      },
      objectives: {},
      workspaces: [
        {
          workspace_id: 'ws_0001',
          name: 'ws_0001',
          workspace_path: 'ws_0001',
          lifecycle: 'active',
          created_at: now,
          updated_at: now,
        },
      ],
      qor_baseline: null,
    }),
  )
  const snapshot: EccPersistedEngineeringSnapshot = {
    artifacts: [],
    cause: 'workspace.created',
    checklist: { items: [] },
    flow: { steps: [] },
    hotspotPreview: { hotspotCount: 0, hotspots: [], hotspotsTruncated: false },
    metrics: [],
    parameters: {},
    schemaVersion: 6,
    signoffAssessment: { status: 'ready', groups: [], risks: [] },
    timingPreview: { issueCount: 0, issues: [], issuesTruncated: false },
    workspaceId: 'ws_0001',
    workspaceRevision: 1,
    workspaceSpec: {
      design: { topModule: 'top', clockPort: 'clk' },
      inputs: [{ inputId: 'filelist', role: 'filelist' }],
    },
    workspaceBindings: { inputs: { filelist: frozenFilelist } },
  }
  await writeFile(
    join(workspaceRoot, 'home', 'engineering-snapshot.json'),
    JSON.stringify(snapshot),
  )
  return { root, frozenFilelist, sources }
}

describe('new workspace from persisted project design defaults', () => {
  it.each(['rtl', 'filelist'] as const)(
    'retains top-module discovery after a workspace was created from %s',
    async (mode) => {
      const { root, frozenFilelist, sources } = await createProjectWithWorkspace(mode)
      const service = new ProjectManagementReadService(
        { discover: async () => null, load: readProjectManifest },
        undefined,
        async (path) => {
          const snapshot = await readPersistedEngineeringSnapshot(path)
          return {
            workspaceSpec: snapshot.workspaceSpec ?? {},
            workspaceBindings: snapshot.workspaceBindings ?? {},
          }
        },
      )
      desktopMocks.readManifest.mockImplementation(() => service.readManifest(root))
      desktopMocks.discover.mockImplementation(discoverHdlModules)
      desktopMocks.exists.mockImplementation(async (path: string) => {
        try {
          await stat(path)
          return true
        } catch {
          return false
        }
      })
      const wrapper = mount(NewProjectWizard, {
        props: {
          initialConfig: {
            directory: join(root, 'ws_0002'),
            managedWorkspaceRoot: root,
            lockProjectContext: true,
            project_context: {
              mode: 'select',
              project_name: 'top',
              project_root: root,
              project_json_path: join(root, 'project.json'),
            },
          },
        },
        global: {
          stubs: {
            RtlImportStep: true,
            PdkResourcePickerDialog: true,
            TopModuleField: true,
          },
        },
      })
      try {
        const wizard = wrapper.vm as unknown as {
          currentStep: number
          isLoadingProjectManifest: boolean
          topModuleDiscovery: { status: string; candidates: string[]; suggested: string }
          config: { parameters: { top_module: string } }
          refreshTopModuleDiscovery(): Promise<void>
        }
        await vi.waitFor(() => expect(wizard.isLoadingProjectManifest).toBe(false))
        wizard.currentStep = 7
        await flushPromises()
        await wizard.refreshTopModuleDiscovery()

        expect(wizard.config.parameters.top_module).toBe('top')
        expect(wizard.topModuleDiscovery).toMatchObject({
          status: 'complete',
          candidates: ['top', 'helper'],
          suggested: 'top',
        })
        expect(desktopMocks.discover).toHaveBeenLastCalledWith(
          expect.objectContaining({
            filelistPath: frozenFilelist,
          }),
        )
        for (const [name, content] of Object.entries(sources)) {
          expect(await readFile(join(root, 'rtl', name), 'utf8')).toBe(content)
          expect(await readFile(join(root, 'ws_0001', 'origin', name), 'utf8')).toBe(
            content,
          )
        }
      } finally {
        wrapper.unmount()
      }
    },
  )
})
