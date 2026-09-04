// @vitest-environment happy-dom

import { flushPromises, shallowMount } from '@vue/test-utils'
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
  loadProjectHistory: vi.fn(async () => [testState.project]),
  rememberProjectHistoryEntry: vi.fn(),
  removeProjectHistoryEntry: vi.fn(),
}))
vi.mock('@/utils/projectManagementRead', () => ({
  listProjectManagementEntries: vi.fn(async () => []),
  readProjectManagementManifest: vi.fn(async () =>
    JSON.stringify({
      schema_version: 1,
      project_id: 'project-demo',
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
          status: 'active',
        },
      ],
      best_workspace: null,
    }),
  ),
}))
vi.mock('@/stores/backendProjectComparisonSession', () => ({
  useBackendProjectComparisonSession: () => ({
    dispose: vi.fn(),
    execution: { operations: [] },
    findings: [],
    generation: 0,
    loadStepFindings: vi.fn(),
    projection: { data: null, status: 'idle' },
    refresh: vi.fn(),
    selectProject: vi.fn(async () => undefined),
  }),
}))
vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({
    ecc: { runtime: undefined },
    productCommands: { execute: vi.fn() },
    shutdown: undefined,
  }),
}))

import ProjectsView from './ProjectsView.vue'
import { useBackgroundOperationStore } from '@/stores/backgroundOperationStore'

describe('ProjectsView background lifecycle integration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    testState.openProject.mockReset()
    testState.route.fullPath = '/workspace/projects'
    testState.route.path = '/workspace/projects'
    testState.route.query = {}
    testState.routerPush.mockReset()
    testState.showToast.mockReset()
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
})
