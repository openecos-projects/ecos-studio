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
  execute: vi.fn(),
  push: vi.fn(),
  route: { path: '/workspace/home' },
}))

vi.mock('vue-router', () => ({
  useRoute: () => testState.route,
  useRouter: () => ({ push: testState.push }),
}))
vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({ productCommands: { execute: testState.execute } }),
}))

import BackgroundTasksButton from './BackgroundTasksButton.vue'
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
    testState.execute.mockResolvedValue({
      accepted: true,
      operationId: 'operation-1',
      state: 'running',
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

  it('inspects a task in Project Management and cancels by its original identity', async () => {
    const store = useBackgroundOperationStore()
    store.operations = [operation()]
    const wrapper = mount(BackgroundTasksButton)
    await wrapper.get('.background-tasks-trigger').trigger('click')

    await wrapper.get('.background-task-main').trigger('click')
    expect(testState.push).toHaveBeenCalledWith({
      path: '/workspace/projects',
      query: {
        operationId: 'operation-1',
        workspacePath: '/projects/demo/ws_1',
      },
    })

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

  it('routes unfinished creation recovery to Project Management', async () => {
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
    await wrapper.get('.background-tasks-view').trigger('click')
    expect(testState.push).toHaveBeenCalledWith({
      path: '/workspace/projects',
    })
    wrapper.unmount()
  })

  it('shows safe-drain blocker counts and lets the user cancel shutdown', async () => {
    const store = useBackgroundOperationStore()
    store.shutdownStatus = {
      activeFlows: 2,
      attemptId: 'attempt-1',
      finalizations: 1,
      forceEligible: false,
      pendingCreations: 1,
      scope: 'application',
      snapshotFailures: 0,
      state: 'draining',
    }
    const cancelShutdown = vi.spyOn(store, 'cancelShutdown').mockResolvedValue(undefined)
    const wrapper = mount(BackgroundTasksButton)

    expect(wrapper.text()).toContain('Waiting to close safely')
    await wrapper.get('.shutdown-waiting').trigger('click')
    expect(wrapper.text()).toContain('2 Flows')
    await wrapper.get('.shutdown-actions button').trigger('click')
    expect(cancelShutdown).toHaveBeenCalledOnce()
    wrapper.unmount()
  })
})
