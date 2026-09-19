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
  comparisonProjection: { data: null as unknown, status: 'idle' },
  selectProject: vi.fn(async (_projectRoot: string) => undefined),
  pickDirectory: vi.fn(async (_options?: unknown) => '/projects/demo'),
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
  readProjectManagementManifest: vi.fn(async (projectRoot: string) => ({
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
  })),
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
vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({
    dialog: { pickDirectory: (options: unknown) => testState.pickDirectory(options) },
    resources: { list: vi.fn(async () => ({ resources: [] })) },
    ecc: { runtime: undefined },
    productCommands: { execute: vi.fn() },
    shutdown: undefined,
  }),
}))

import ProjectsView from './ProjectsView.vue'
import { useBackgroundOperationStore } from '@/stores/backgroundOperationStore'
import { loadProjectHistory, rememberProjectHistoryEntry } from '@/utils/projectHistory'
import { importProjectManagementWorkspace } from '@/utils/projectManagementRead'
import { consumeWorkspaceWizardRequest } from '@/utils/workspaceNavigation'

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
    vi.mocked(loadProjectHistory).mockReset()
    vi.mocked(loadProjectHistory).mockResolvedValue([testState.project])
    vi.mocked(rememberProjectHistoryEntry).mockReset()
    vi.mocked(rememberProjectHistoryEntry).mockResolvedValue([testState.project])
    vi.mocked(importProjectManagementWorkspace).mockClear()
    consumeWorkspaceWizardRequest()
    testState.comparisonProjection = { data: null, status: 'idle' }
    testState.selectProject.mockReset()
    testState.selectProject.mockImplementation(async () => undefined)
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

  it('requests the workspace wizard from a project row New action', async () => {
    const wrapper = shallowMount(ProjectsView)
    await flushPromises()

    await wrapper.get('button[aria-label="New workspace in demo"]').trigger('click')
    await flushPromises()

    expect(consumeWorkspaceWizardRequest()).toEqual({
      initialConfig: expect.objectContaining({
        directory: '/projects/demo/ws_0002',
        managedWorkspaceRoot: '/projects/demo',
        lockWorkspaceDirectory: true,
      }),
    })
  })

  it('notifies when the picked workspace is already registered', async () => {
    vi.mocked(importProjectManagementWorkspace).mockResolvedValueOnce({
      status: 'already_registered',
      manifest: {
        schema_version: 1,
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

  it('exposes the field names used by Quick Start project creation', async () => {
    const wrapper = shallowMount(ProjectsView)
    await flushPromises()

    await wrapper.get('button.project-toolbar-action.primary').trigger('click')

    expect(wrapper.find('input[name="project-name"]').exists()).toBe(true)
    expect(wrapper.find('input[name="design-name"]').exists()).toBe(true)
    expect(wrapper.find('input[name="project-storage-location"]').exists()).toBe(true)
    expect(wrapper.find('select[name="managed-mpc"]').exists()).toBe(true)
  })
})
