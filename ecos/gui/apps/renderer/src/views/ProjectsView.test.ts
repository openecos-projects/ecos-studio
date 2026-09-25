// @vitest-environment happy-dom

import { flushPromises, shallowMount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({
  currentProject: null,
  openProject: vi.fn(),
  project: {
    id: '/projects/demo',
    name: 'demo',
    path: '/projects/demo',
    designTool: 'backend' as const,
    lastOpened: new Date('2026-09-04T00:00:00.000Z'),
  },
  route: { fullPath: '/workspace/projects', path: '/workspace/projects', query: {} },
  routerPush: vi.fn(),
  showToast: vi.fn(),
  registerProjectRoot: vi.fn(async (path: string) => path),
  registerProjectReadRoot: vi.fn(async (path: string) => path),
  comparisonProjection: { data: null as unknown, status: 'idle' },
  projectManifestOverride: null as unknown,
  selectProject: vi.fn(async (_projectRoot: string) => undefined),
  pickDirectory: vi.fn(async (_options?: unknown) => '/projects/demo'),
  stepOutputs: vi.fn(
    async (_request: unknown): Promise<EccWorkspaceStepOutputsResult> => ({
      design: 'gcd',
      directory: '/projects/demo/ws_0001',
      sdc: null,
      steps: [],
    }),
  ),
}))

vi.mock('vue-router', () => ({
  useRoute: () => testState.route,
  useRouter: () => ({ push: testState.routerPush, replace: vi.fn() }),
}))
vi.mock('../composables/useWorkspace', async () => {
  const { ref } = await import('vue')
  return {
    useWorkspace: () => ({
      currentProject: ref(testState.currentProject),
      openProject: testState.openProject,
      showToast: testState.showToast,
    }),
  }
})
vi.mock('@/utils/projectHistory', () => ({
  loadProjectHistory: vi.fn(),
  rememberProjectHistoryEntry: vi.fn(),
  removeProjectHistoryEntry: vi.fn(),
}))
vi.mock('@/utils/projectManagementRead', () => ({
  importProjectManagementWorkspace: vi.fn(async (projectRoot: string) => ({
    status: 'imported',
    manifest: {
      schema_version: 1,
      project_id: `project-${projectRoot}`,
      name: projectRoot.split('/').pop() ?? 'demo',
      design_name: 'gcd',
      description: '',
      root_path: projectRoot,
      created_at: '2026-09-04T00:00:00.000Z',
      updated_at: '2026-09-04T00:00:00.000Z',
      base_design: { parameters: {}, rtl_list: [] },
      objectives: { primary: 'timing', directions: {} },
      workspaces: [
        {
          workspace_id: 'ws_0001',
          name: 'ws_0001',
          workspace_path: `${projectRoot}/ws_0001`,
          status: 'active',
        },
      ],
      best_workspace: null,
    },
    workspaceId: 'ws_0001',
    workspacePath: `${projectRoot}/ws_0001`,
  })),
  listProjectManagementEntries: vi.fn(async () => []),
  readProjectManagementManifest: vi.fn(
    async (projectRoot: string) =>
      testState.projectManifestOverride ?? {
        schema_version: 1,
        project_id: `project-${projectRoot}`,
        name: projectRoot.split('/').pop() ?? 'demo',
        design_name: 'gcd',
        description: '',
        root_path: projectRoot,
        created_at: '2026-09-04T00:00:00.000Z',
        updated_at: '2026-09-04T00:00:00.000Z',
        base_design: { parameters: {}, rtl_list: [] },
        objectives: { primary: 'timing', directions: {} },
        workspaces: [
          {
            workspace_id: 'ws_0001',
            name: 'ws_0001',
            workspace_path: `${projectRoot}/ws_0001`,
            status: 'not_started',
          },
        ],
        best_workspace: null,
      },
  ),
}))
vi.mock('@/stores/backendProjectComparisonSession', () => ({
  useBackendProjectComparisonSession: () => ({
    dispose: vi.fn(),
    execution: { operations: [] },
    findings: [],
    generation: 0,
    loadStepFindings: vi.fn(),
    get projection() {
      return testState.comparisonProjection
    },
    refresh: vi.fn(),
    selectProject: (projectRoot: string) => testState.selectProject(projectRoot),
  }),
}))
vi.mock('./project-management/frontendProjectWorkspaceData', () => ({
  readFrontendProjectWorkspaceData: vi.fn(async () => ({
    flowStates: { ws_0001: { prepare: 'success' } },
    analysisInputs: { ws_0001: {} },
  })),
}))
vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({
    dialog: { pickDirectory: (options: unknown) => testState.pickDirectory(options) },
    ecc: { runtime: undefined },
    productCommands: { execute: vi.fn() },
    runtime: {
      workspace: {
        stepOutputs: (request: unknown) => testState.stepOutputs(request),
      },
    },
    workspace: {
      registerProjectRoot: (path: string) => testState.registerProjectRoot(path),
      registerProjectReadRoot: (path: string) => testState.registerProjectReadRoot(path),
    },
    shutdown: undefined,
  }),
}))

import ProjectsView from './ProjectsView.vue'
import { useBackgroundOperationStore } from '@/stores/backgroundOperationStore'
import { loadProjectHistory, rememberProjectHistoryEntry } from '@/utils/projectHistory'
import { importProjectManagementWorkspace } from '@/utils/projectManagementRead'
import { readFrontendProjectWorkspaceData } from './project-management/frontendProjectWorkspaceData'
import {
  consumeWorkspaceWizardRequest,
  useWorkspaceWizardRequest,
} from '@/utils/workspaceNavigation'
import type { EccWorkspaceStepOutputsResult } from '@ecos-studio/shared'

function historyProject(index: number) {
  return {
    id: `/projects/project-${index}`,
    name: `project-${index}`,
    path: `/projects/project-${index}`,
    lastOpened: new Date('2026-09-04T00:00:00.000Z'),
  }
}

describe('ProjectsView background lifecycle integration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    testState.openProject.mockReset()
    testState.route.fullPath = '/workspace/projects'
    testState.route.path = '/workspace/projects'
    testState.route.query = {}
    testState.routerPush.mockReset()
    testState.showToast.mockReset()
    testState.registerProjectRoot.mockReset()
    testState.registerProjectRoot.mockImplementation(async (path: string) => path)
    testState.registerProjectReadRoot.mockReset()
    testState.registerProjectReadRoot.mockImplementation(async (path: string) => path)
    vi.mocked(loadProjectHistory).mockReset()
    vi.mocked(loadProjectHistory).mockResolvedValue([testState.project])
    vi.mocked(rememberProjectHistoryEntry).mockReset()
    vi.mocked(rememberProjectHistoryEntry).mockResolvedValue([testState.project])
    vi.mocked(importProjectManagementWorkspace).mockClear()
    testState.comparisonProjection = { data: null, status: 'idle' }
    testState.projectManifestOverride = null
    testState.selectProject.mockReset()
    testState.selectProject.mockImplementation(async () => undefined)
    vi.mocked(readFrontendProjectWorkspaceData).mockClear()
    testState.pickDirectory.mockReset()
    testState.pickDirectory.mockResolvedValue('/projects/demo')
  })

  it('imports a workspace through the main-owned import API', async () => {
    const wrapper = shallowMount(ProjectsView)
    await flushPromises()

    await wrapper.get('button[aria-label="More actions for demo"]').trigger('click')
    const importAction = wrapper
      .findAll('.row-action-menu-item')
      .find((item) => item.text().includes('Import workspace'))
    expect(importAction).toBeDefined()
    await importAction!.trigger('click')
    await flushPromises()

    expect(importProjectManagementWorkspace).toHaveBeenCalledWith('/projects/demo')
    expect(testState.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ summary: 'Workspace imported' }),
    )
    expect(testState.showToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ summary: 'Workspace not imported' }),
    )
  })

  it('loads frontend project steps without opening a backend comparison session', async () => {
    const { createProjectManifestDraft, registerWorkspaceInManifest } =
      await import('@ecos-studio/shared')
    const projectRoot = '/projects/cpu'
    const manifest = registerWorkspaceInManifest(
      createProjectManifestDraft({
        rootPath: projectRoot,
        name: 'cpu',
        designName: 'core',
        projectType: 'frontend',
      }),
      { projectRoot, workspacePath: `${projectRoot}/ws_0001` },
    )
    vi.mocked(loadProjectHistory).mockResolvedValueOnce([
      {
        id: projectRoot,
        name: 'cpu',
        path: projectRoot,
        projectType: 'frontend',
        lastOpened: new Date(),
      },
    ])
    testState.projectManifestOverride = manifest

    const wrapper = shallowMount(ProjectsView)
    await flushPromises()

    expect(wrapper.text()).toContain('Frontend')
    expect(wrapper.text()).toContain('prepare')
    expect(wrapper.text()).toContain('sim')
    expect(readFrontendProjectWorkspaceData).toHaveBeenCalledWith(projectRoot, manifest)
    expect(testState.selectProject).not.toHaveBeenCalled()
  })

  it('notifies when the picked workspace is already registered', async () => {
    vi.mocked(importProjectManagementWorkspace).mockResolvedValueOnce({
      status: 'already_registered',
      manifest: {
        schema_version: 1,
        project_type: 'backend',
        project_id: 'project-/projects/demo',
        name: 'demo',
        design_name: 'gcd',
        description: '',
        root_path: '/projects/demo',
        created_at: '2026-09-04T00:00:00.000Z',
        updated_at: '2026-09-04T00:00:00.000Z',
        base_design: { parameters: {}, rtl_list: [] },
        objectives: { primary: 'timing', directions: {} },
        workspaces: [
          {
            workspace_id: 'ws_0001',
            name: 'ws_0001',
            workspace_path: '/projects/demo/ws_0001',
            source_workspace_id: null,
            branch_from: null,
            start_step: 'Synth',
            end_step: 'Synth',
            status: 'success',
            created_at: '2026-09-04T00:00:00.000Z',
            updated_at: '2026-09-04T00:00:00.000Z',
            parameter_patch: {},
            metrics_summary: {},
            step_metrics: {},
          },
        ],
        best_workspace: null,
        mpc: null,
        qor_baseline: null,
      },
      workspaceId: 'ws_0001',
      workspacePath: '/projects/demo/ws_0001',
    })
    const wrapper = shallowMount(ProjectsView)
    await flushPromises()

    await wrapper.get('button[aria-label="More actions for demo"]').trigger('click')
    const importAction = wrapper
      .findAll('.row-action-menu-item')
      .find((item) => item.text().includes('Import workspace'))
    await importAction!.trigger('click')
    await flushPromises()

    expect(testState.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ summary: 'Workspace already registered' }),
    )
  })

  async function mountWithKnownProgress(shouldBlock: () => boolean) {
    testState.selectProject.mockImplementation(async () => {
      if (shouldBlock()) {
        await new Promise<void>(() => undefined)
      }
      testState.comparisonProjection = {
        data: {
          refresh: { automatic: 'available' },
          workspaceSnapshots: {
            status: 'ready',
            data: { flowStates: { ws_0001: { Synth: 'success' } }, items: [] },
          },
        },
        status: 'ready',
      }
    })
    const wrapper = shallowMount(ProjectsView)
    await flushPromises()
    await wrapper.get('button.project-tree-row').trigger('click')
    await flushPromises()
    return wrapper
  }

  function knownProgressHint(wrapper: VueWrapper) {
    return wrapper.findComponent({ name: 'ProjectResultStatus' }).props('hint')
  }

  it('keeps known workspace progress while an already-registered import reapplies the manifest', async () => {
    let blockSelects = false
    const wrapper = await mountWithKnownProgress(() => blockSelects)
    expect(knownProgressHint(wrapper)).toMatchObject({
      label: 'Success',
      state: 'success',
    })

    blockSelects = true
    vi.mocked(importProjectManagementWorkspace).mockResolvedValueOnce({
      status: 'already_registered',
      manifest: {
        schema_version: 1,
        project_type: 'backend',
        project_id: 'project-/projects/demo',
        name: 'demo',
        design_name: 'gcd',
        description: '',
        root_path: '/projects/demo',
        created_at: '2026-09-04T00:00:00.000Z',
        updated_at: '2026-09-04T00:00:00.000Z',
        base_design: { parameters: {}, rtl_list: [] },
        objectives: { primary: 'timing', directions: {} },
        workspaces: [
          {
            workspace_id: 'ws_0001',
            name: 'ws_0001',
            workspace_path: '/projects/demo/ws_0001',
            source_workspace_id: null,
            branch_from: null,
            start_step: 'Synth',
            end_step: 'Synth',
            status: 'not_started',
            created_at: '2026-09-04T00:00:00.000Z',
            updated_at: '2026-09-04T00:00:00.000Z',
            parameter_patch: {},
            metrics_summary: {},
            step_metrics: {},
          },
        ],
        best_workspace: null,
        mpc: null,
        qor_baseline: null,
      },
      workspaceId: 'ws_0001',
      workspacePath: '/projects/demo/ws_0001',
    })

    await wrapper.get('button[aria-label="More actions for demo"]').trigger('click')
    const importAction = wrapper
      .findAll('.row-action-menu-item')
      .find((item) => item.text().includes('Import workspace'))
    await importAction!.trigger('click')
    await flushPromises()

    expect(knownProgressHint(wrapper)).toMatchObject({
      label: 'Success',
      state: 'success',
    })
  })

  it('keeps known workspace progress while re-importing the selected project', async () => {
    let blockSelects = false
    const wrapper = await mountWithKnownProgress(() => blockSelects)
    expect(knownProgressHint(wrapper)).toMatchObject({
      label: 'Success',
      state: 'success',
    })

    blockSelects = true
    const importButton = wrapper
      .findAll('button.project-toolbar-action')
      .find((button) => button.text().includes('Import'))
    await importButton!.trigger('click')
    await flushPromises()

    expect(testState.pickDirectory).toHaveBeenCalledOnce()
    expect(knownProgressHint(wrapper)).toMatchObject({
      label: 'Success',
      state: 'success',
    })
  })

  it('keeps opening after the Project Management route is normalized', async () => {
    testState.route.fullPath = '/projects'
    testState.route.path = '/projects'
    testState.openProject.mockImplementation(
      async (_project: unknown, options: { shouldActivate?: () => boolean }) => {
        expect(options.shouldActivate?.()).toBe(true)
        testState.route.fullPath = '/workspace/projects'
        testState.route.path = '/workspace/projects'
        return true
      },
    )

    const wrapper = shallowMount(ProjectsView)
    await flushPromises()
    await wrapper.get('button[aria-label="Open workspace ws_0001"]').trigger('click')
    await flushPromises()

    expect(testState.showToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ summary: 'Workspace ready' }),
    )
    expect(testState.routerPush).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/workspace/home' }),
    )
  })

  it('disables mutations during shutdown and mounts the shared task surfaces', async () => {
    const background = useBackgroundOperationStore()
    background.shutdownStatus = {
      activeFlows: 1,
      attemptId: 'attempt-1',
      finalizations: 0,
      forceEligible: false,
      pendingCreations: 1,
      scope: 'application',
      snapshotFailures: 0,
      state: 'draining',
    }

    const wrapper = shallowMount(ProjectsView)
    await flushPromises()

    expect(
      (wrapper.get('button.project-toolbar-action.primary').element as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(wrapper.findComponent({ name: 'ProjectCreationRecoveryPanel' }).exists()).toBe(
      true,
    )
    expect(
      wrapper.findComponent({ name: 'ProjectBackgroundOperationPanel' }).exists(),
    ).toBe(true)
  })

  it('keeps Show all pinned outside the scrolling project list', async () => {
    vi.mocked(loadProjectHistory).mockResolvedValue(
      Array.from({ length: 21 }, (_, index) => historyProject(index + 1)),
    )

    const wrapper = shallowMount(ProjectsView)
    await flushPromises()

    expect(wrapper.findAll('.project-workspace-tree')).toHaveLength(20)
    expect(wrapper.find('.project-list .project-list-preview-toggle').exists()).toBe(
      false,
    )
    const toggle = wrapper.get('.project-list-preview-toggle')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(toggle.text()).toContain('Show all 21 projects')

    await toggle.trigger('click')

    expect(wrapper.findAll('.project-workspace-tree')).toHaveLength(21)
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(toggle.text()).toContain('Show fewer projects')
  })

  it('hides the project preview toggle when the list fits', async () => {
    const wrapper = shallowMount(ProjectsView)
    await flushPromises()

    expect(wrapper.findAll('.project-workspace-tree')).toHaveLength(1)
    expect(wrapper.find('.project-list-preview-toggle').exists()).toBe(false)
  })

  describe('workspace branch popover', () => {
    function stepEntry(
      step: string,
      state: string,
      artifacts: { verilog?: boolean; def?: boolean } = {},
    ) {
      return {
        step,
        state,
        tool: 'ecc',
        verilog: artifacts.verilog
          ? { exists: true, path: `/projects/demo/ws_0001/output/${step}/gcd.v` }
          : null,
        def: artifacts.def
          ? { exists: true, path: `/projects/demo/ws_0001/output/${step}/gcd.def` }
          : null,
      }
    }

    beforeEach(() => {
      consumeWorkspaceWizardRequest()
      testState.stepOutputs.mockReset()
      testState.stepOutputs.mockResolvedValue({
        design: 'gcd',
        directory: '/projects/demo/ws_0001',
        sdc: null,
        steps: [
          stepEntry('Synthesis', 'Success', { verilog: true }),
          stepEntry('lec', 'Skipped'),
          stepEntry('Floorplan', 'Incomplete', { verilog: true, def: true }),
          stepEntry('place', 'Unstart', { verilog: true, def: true }),
          stepEntry('CTS', 'Success', { def: true }),
          stepEntry('route', 'Success', { verilog: true }),
        ],
      })
    })

    async function openBranchPopover() {
      const wrapper = shallowMount(ProjectsView)
      await flushPromises()
      await wrapper.get('button[aria-label="More actions for ws_0001"]').trigger('click')
      await wrapper.get('.workspace-flow-trigger').trigger('click')
      await flushPromises()
      expect(wrapper.find('.workspace-flow-popover').exists()).toBe(true)
      expect(testState.stepOutputs).toHaveBeenCalledWith({
        designTool: 'backend',
        directory: '/projects/demo/ws_0001',
      })
      expect(testState.registerProjectRoot).toHaveBeenCalledWith('/projects/demo/ws_0001')
      expect(testState.registerProjectReadRoot).toHaveBeenCalledWith('/projects/demo')
      return wrapper
    }

    function popoverRow(wrapper: VueWrapper, step: string) {
      const row = wrapper
        .findAll('.popover-step-row')
        .find((candidate) => candidate.find('span')?.text() === step)
      expect(row, `popover row for ${step}`).toBeDefined()
      return row!
    }

    it('maps the persisted Incomplete state to a failed step row', async () => {
      const wrapper = await openBranchPopover()

      const row = popoverRow(wrapper, 'Floorplan')
      expect(row.get('em').text()).toBe('!')
      expect(row.get('em').classes()).toContain('step-failed')
    })

    it('retries a failed step-output request without reusing the error state', async () => {
      testState.stepOutputs.mockReset()
      testState.stepOutputs
        .mockRejectedValueOnce(new Error('temporary read failure'))
        .mockResolvedValueOnce({
          design: 'gcd',
          directory: '/projects/demo/ws_0001',
          sdc: null,
          steps: [stepEntry('Synthesis', 'Success', { verilog: true })],
        })

      const wrapper = await openBranchPopover()

      expect(wrapper.text()).toContain('Step outputs unavailable.')
      await wrapper.get('.popover-step-retry').trigger('click')
      await flushPromises()

      expect(wrapper.find('.popover-step-retry').exists()).toBe(false)
      expect(popoverRow(wrapper, 'Synthesis').get('em').text()).toBe('S')
      expect(testState.stepOutputs).toHaveBeenCalledTimes(2)
    })

    it('only allows branching from completed steps with a verilog output', async () => {
      const wrapper = await openBranchPopover()

      // Unstart rows may still carry stale artifacts from an earlier run.
      expect((popoverRow(wrapper, 'place').element as HTMLButtonElement).disabled).toBe(
        true,
      )
      expect(
        (popoverRow(wrapper, 'Floorplan').element as HTMLButtonElement).disabled,
      ).toBe(true)
      // A def-only row has no origin verilog for the new workspace.
      const ctsRow = popoverRow(wrapper, 'CTS')
      expect((ctsRow.element as HTMLButtonElement).disabled).toBe(true)
      expect(ctsRow.find('.popover-step-add').exists()).toBe(false)

      const routeRow = popoverRow(wrapper, 'route')
      expect((routeRow.element as HTMLButtonElement).disabled).toBe(false)
      expect(routeRow.find('.popover-step-add').exists()).toBe(true)
    })

    it('skips disabled start steps when picking the branch target start step', async () => {
      const wrapper = await openBranchPopover()

      await popoverRow(wrapper, 'Synthesis').trigger('click')
      await flushPromises()
      await wrapper.get('.branch-draft-dialog button.primary-button').trigger('click')
      await flushPromises()

      const request = useWorkspaceWizardRequest().value
      expect(request?.initialConfig?.parameters?.['start_step']).toBe('Floorplan')
    })
  })
})
