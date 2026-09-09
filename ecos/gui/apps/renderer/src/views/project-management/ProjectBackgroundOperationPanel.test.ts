// @vitest-environment happy-dom

import type { EccBackgroundOperation } from '@ecos-studio/shared'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { execute, operationLog } = vi.hoisted(() => ({
  execute: vi.fn(),
  operationLog: vi.fn(),
}))
vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({
    ecc: { runtime: { operationLog } },
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

  it('loads bounded Runtime logs only after explicit inspection', async () => {
    useBackgroundOperationStore().operations = [operation()]
    operationLog.mockResolvedValue({ content: 'route completed', truncated: true })
    const wrapper = mount(ProjectBackgroundOperationPanel, {
      props: {
        operationIds: ['operation-1'],
        workspacePath: '/projects/demo/ws_1',
      },
    })

    expect(operationLog).not.toHaveBeenCalled()
    await wrapper
      .findAll('.operation-action')
      .find((button) => button.text().includes('View Logs'))!
      .trigger('click')

    expect(operationLog).toHaveBeenCalledWith({
      operationId: 'operation-1',
      workspaceHandle: 'handle-1',
    })
    expect(wrapper.text()).toContain('Earlier output omitted')
    expect(wrapper.text()).toContain('route completed')
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
    expect(wrapper.text()).toContain('Revision 7')
    expect(wrapper.text()).toContain('operation-1')
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
    expect(wrapper.get('.operation-actions').text()).toContain('View Logs')
  })
})
