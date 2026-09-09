// @vitest-environment happy-dom

import type { EccBackgroundOperation } from '@ecos-studio/shared'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginWorkspaceCreation,
  finishWorkspaceCreation,
} from '@/utils/workspaceNavigation'

const testState = vi.hoisted(() => ({
  currentProject: { path: '/projects/open/ws_open' } as { path: string } | null,
  execute: vi.fn(),
  openProject: vi.fn(),
  push: vi.fn(),
  showToast: vi.fn(),
}))
const { discoverProjectForWorkspace } = vi.hoisted(() => ({
  discoverProjectForWorkspace: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: testState.push }),
}))
vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({ productCommands: { execute: testState.execute } }),
}))
vi.mock('@/composables/useWorkspace', () => ({
  useWorkspace: () => ({
    currentProject: {
      get value() {
        return testState.currentProject
      },
    },
    openProject: testState.openProject,
    showToast: testState.showToast,
  }),
}))
vi.mock('@/utils/projectManagementRead', () => ({
  discoverProjectForWorkspace,
}))

import BackgroundTasksButton from './BackgroundTasksButton.vue'
import NotificationCenter from './NotificationCenter.vue'
import { useBackgroundOperationStore } from '@/stores/backgroundOperationStore'

function operation(
  overrides: Partial<EccBackgroundOperation> = {},
): EccBackgroundOperation {
  return {
    createdAt: Date.now() - 10_000,
    currentStep: 'Route',
    currentTool: 'openroad',
    error: null,
    kind: 'flow',
    operationId: 'operation-1',
    origin: 'gui',
    rerun: false,
    result: null,
    state: 'running',
    step: '',
    updatedAt: Date.now(),
    workspaceDirectory: '/projects/demo/ws_1',
    workspaceHandle: 'handle-1',
    workspaceId: 'engineering-1',
    workspaceRevision: 2,
    ...overrides,
  }
}

describe('BackgroundTasksButton', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    testState.currentProject = { path: '/projects/open/ws_open' }
    testState.execute.mockResolvedValue({
      accepted: true,
      operationId: 'operation-1',
      state: 'running',
    })
    testState.openProject.mockImplementation(async (project: { path: string }) => {
      testState.currentProject = { path: project.path }
      return true
    })
    discoverProjectForWorkspace.mockResolvedValue({
      name: 'demo',
      root_path: '/projects/demo',
      workspaces: [{ workspace_path: '/projects/demo/ws_1' }],
    })
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    )
  })

  it('shows Flow and creation tasks without shifting the trigger', async () => {
    const store = useBackgroundOperationStore()
    store.operations = [operation()]
    const creationToken = beginWorkspaceCreation('/projects/demo/ws_2')!
    const wrapper = mount(BackgroundTasksButton)

    expect(wrapper.get('.background-tasks-trigger').text()).toContain('2')
    await wrapper.get('.background-tasks-trigger').trigger('click')
    expect(wrapper.text()).toContain('ws_1')
    expect(wrapper.text()).toContain('Route')
    expect(wrapper.text()).toContain('ws_2')
    expect(wrapper.text()).toContain('Creating Workspace')

    finishWorkspaceCreation(creationToken)
    wrapper.unmount()
  })

  it('opens the matching Workspace from a running task and cancels by its original identity', async () => {
    const store = useBackgroundOperationStore()
    store.operations = [operation()]
    const wrapper = mount(BackgroundTasksButton)
    await wrapper.get('.background-tasks-trigger').trigger('click')

    await wrapper.get('.background-task-main').trigger('click')
    await vi.waitFor(() => {
      expect(testState.openProject).toHaveBeenCalledWith(
        expect.objectContaining({
          id: '/projects/demo/ws_1',
          path: '/projects/demo/ws_1',
        }),
        expect.objectContaining({ shouldActivate: expect.any(Function) }),
      )
    })
    expect(testState.push).toHaveBeenCalledWith({
      path: '/workspace/home',
      query: {
        projectRoot: '/projects/demo',
        projectName: 'demo',
        workspaceId: 'ws_1',
      },
    })
    expect(wrapper.find('.background-tasks-view').exists()).toBe(false)
    wrapper.unmount()
  })

  it('reuses the current window when that Workspace is already open', async () => {
    testState.currentProject = { path: '/projects/demo/ws_1' }
    const store = useBackgroundOperationStore()
    store.operations = [operation()]
    const wrapper = mount(BackgroundTasksButton)
    await wrapper.get('.background-tasks-trigger').trigger('click')
    await wrapper.get('.background-task-main').trigger('click')
    await vi.waitFor(() => {
      expect(testState.push).toHaveBeenCalledWith({
        path: '/workspace/home',
        query: {
          projectRoot: '/projects/demo',
          projectName: 'demo',
          workspaceId: 'ws_1',
        },
      })
    })
    expect(testState.openProject).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('does not steal the window when opening the Workspace is deferred', async () => {
    testState.openProject.mockImplementation(async () => true)
    const store = useBackgroundOperationStore()
    store.operations = [operation()]
    const wrapper = mount(BackgroundTasksButton)
    await wrapper.get('.background-tasks-trigger').trigger('click')
    await wrapper.get('.background-task-main').trigger('click')
    await vi.waitFor(() => {
      expect(testState.openProject).toHaveBeenCalled()
    })
    expect(testState.push).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('reports when the matching Workspace cannot be opened', async () => {
    testState.openProject.mockResolvedValue(false)
    const store = useBackgroundOperationStore()
    store.operations = [operation()]
    const wrapper = mount(BackgroundTasksButton)
    await wrapper.get('.background-tasks-trigger').trigger('click')
    await wrapper.get('.background-task-main').trigger('click')
    await vi.waitFor(() => {
      expect(testState.showToast).toHaveBeenCalledWith(
        expect.objectContaining({ summary: 'Workspace not opened' }),
      )
    })
    expect(testState.push).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('cancels a running task by its original identity', async () => {
    const store = useBackgroundOperationStore()
    store.operations = [operation()]
    const wrapper = mount(BackgroundTasksButton)
    await wrapper.get('.background-tasks-trigger').trigger('click')
    await wrapper.get('.background-task-cancel').trigger('click')
    expect(testState.execute).toHaveBeenCalledWith({
      command: 'workspace.cancel',
      payload: { operationId: 'operation-1', workspaceHandle: 'handle-1' },
    })
    expect(store.operations[0]?.cancelRequested).toBe(true)
    wrapper.unmount()
  })

  it('shows retained snapshot failures outside the active count and retries them', async () => {
    const store = useBackgroundOperationStore()
    store.finalizations = [
      {
        issue: 'Snapshot write failed.',
        state: 'snapshot-failed',
        workspaceDirectory: '/projects/demo/ws_1',
        workspaceHandle: 'handle-1',
        workspaceId: 'engineering-1',
      },
    ]
    testState.execute.mockResolvedValueOnce({ recovered: true })
    const wrapper = mount(BackgroundTasksButton)

    expect(wrapper.get('.background-tasks-trigger').text()).toContain('!')
    await wrapper.get('.background-tasks-trigger').trigger('click')
    expect(wrapper.text()).toContain('Snapshot write failed.')
    await wrapper.get('.background-task-retry').trigger('click')

    expect(testState.execute).toHaveBeenCalledWith({
      command: 'workspace.retrySnapshot',
      payload: { workspaceHandle: 'handle-1' },
    })
    wrapper.unmount()
  })

  it('keeps unfinished creation recovery in the task list without a Project Management shortcut', async () => {
    const store = useBackgroundOperationStore()
    store.creations = [
      {
        creationId: 'creation-1',
        issue: 'Application exited during creation.',
        stage: 'intent-recorded',
        status: 'unfinished',
        targetDirectory: '/projects/demo/ws_2',
        updatedAt: Date.now(),
      },
    ]
    const wrapper = mount(BackgroundTasksButton)
    await wrapper.get('.background-tasks-trigger').trigger('click')

    expect(wrapper.text()).toContain('Application exited during creation.')
    expect(wrapper.find('.background-task-recovery-actions').exists()).toBe(false)
    expect(wrapper.find('.background-tasks-view').exists()).toBe(false)
    expect(testState.push).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('keeps the background task and notification popovers mutually exclusive', async () => {
    const backgroundTasks = mount(BackgroundTasksButton)
    const notifications = mount(NotificationCenter)

    await backgroundTasks.get('.background-tasks-trigger').trigger('click')
    expect(backgroundTasks.find('.background-tasks-popover').exists()).toBe(true)

    await notifications.get('.notification-trigger').trigger('click')
    expect(notifications.find('.notification-panel').exists()).toBe(true)
    expect(backgroundTasks.find('.background-tasks-popover').exists()).toBe(false)

    await backgroundTasks.get('.background-tasks-trigger').trigger('click')
    expect(backgroundTasks.find('.background-tasks-popover').exists()).toBe(true)
    expect(notifications.find('.notification-panel').exists()).toBe(false)

    backgroundTasks.unmount()
    notifications.unmount()
  })
})
