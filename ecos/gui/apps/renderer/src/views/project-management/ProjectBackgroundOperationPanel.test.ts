// @vitest-environment happy-dom

import type { EccBackgroundOperation } from '@ecos-studio/shared'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const execute = vi.hoisted(() => vi.fn())
vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({
    productCommands: { execute },
  }),
}))

import ProjectBackgroundOperationPanel from './ProjectBackgroundOperationPanel.vue'
import { useBackgroundOperationStore } from '@/stores/backgroundOperationStore'

function operation(): EccBackgroundOperation {
  return {
    createdAt: Date.now() - 5_000,
    currentStep: 'STA',
    currentTool: 'opensta',
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
    workspaceRevision: 7,
  }
}

describe('ProjectBackgroundOperationPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    execute.mockResolvedValue({ accepted: true })
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    )
  })

  it('does not expose Runtime log inspection from the Project task strip', () => {
    useBackgroundOperationStore().operations = [operation()]
    const wrapper = mount(ProjectBackgroundOperationPanel, {
      props: {
        operationIds: ['operation-1'],
        workspacePath: '/projects/demo/ws_1',
      },
    })

    expect(wrapper.text()).not.toContain('View Logs')
    expect(wrapper.find('[aria-label="Runtime log"]').exists()).toBe(false)
  })

  it('shows only the revision-matched Operation selected by Project Comparison', async () => {
    useBackgroundOperationStore().operations = [operation()]
    const wrapper = mount(ProjectBackgroundOperationPanel, {
      props: {
        operationIds: ['operation-1'],
        workspacePath: '/projects/demo/ws_1',
      },
    })

    expect(wrapper.text()).toContain('STA')
    expect(wrapper.text()).not.toContain('Rev')
    expect(wrapper.text()).not.toContain('Revision')
    expect(wrapper.text()).not.toContain('operation-1')
    await wrapper.get('button[aria-label="Cancel background Flow"]').trigger('click')
    expect(execute).toHaveBeenCalledWith({
      command: 'workspace.cancel',
      payload: { operationId: 'operation-1', workspaceHandle: 'handle-1' },
    })
  })

  it('emits an explicit open command instead of changing the foreground on selection', async () => {
    useBackgroundOperationStore().operations = [operation()]
    const wrapper = mount(ProjectBackgroundOperationPanel, {
      props: {
        operationIds: ['operation-1'],
        workspacePath: '/projects/demo/ws_1',
      },
    })

    await wrapper.get('button[aria-label="Open Workspace"]').trigger('click')
    expect(wrapper.emitted('open-workspace')).toHaveLength(1)
    expect(wrapper.get('.operation-actions').text()).toContain('Open Workspace')
    expect(wrapper.get('.operation-actions').text()).toContain('Cancel')
    expect(wrapper.get('.operation-actions').text()).not.toContain('View Logs')
  })

  it('marks snapshot failures as attention and keeps Retry Snapshot', () => {
    useBackgroundOperationStore().finalizations = [
      {
        issue: 'Snapshot write failed.',
        state: 'snapshot-failed',
        workspaceDirectory: '/projects/demo/ws_1',
        workspaceHandle: 'handle-1',
        workspaceId: 'engineering-1',
      },
    ]
    const wrapper = mount(ProjectBackgroundOperationPanel, {
      props: {
        operationIds: [],
        workspacePath: '/projects/demo/ws_1',
      },
    })

    expect(wrapper.get('.operation-panel').classes()).toContain('attention')
    expect(wrapper.text()).toContain('Needs attention')
    expect(wrapper.text()).toContain('Retry Snapshot')
    expect(wrapper.text()).not.toContain('View Logs')
  })
})
