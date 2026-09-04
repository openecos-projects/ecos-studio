// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const execute = vi.hoisted(() => vi.fn())
vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({ productCommands: { execute } }),
}))

import ProjectCreationRecoveryPanel from './ProjectCreationRecoveryPanel.vue'
import { useBackgroundOperationStore } from '@/stores/backgroundOperationStore'

describe('ProjectCreationRecoveryPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    )
  })

  it('shows recovery evidence and preserves files when abandoning registration', async () => {
    const store = useBackgroundOperationStore()
    store.creations = [
      {
        creationId: 'creation-1',
        issue: 'Application exited during creation.',
        projectId: 'project-1',
        stage: 'intent-recorded',
        status: 'unfinished',
        targetDirectory: '/projects/demo/ws_2',
        updatedAt: Date.now(),
      },
    ]
    execute.mockResolvedValue({ abandoned: true })
    const wrapper = mount(ProjectCreationRecoveryPanel)

    expect(wrapper.text()).toContain('/projects/demo/ws_2')
    expect(wrapper.text()).toContain('intent-recorded')
    await wrapper.findAll('button')[1]!.trigger('click')
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('files will remain'))
    expect(execute).toHaveBeenCalledWith({
      command: 'workspace.abandonCreation',
      payload: { creationId: 'creation-1' },
    })
  })

  it('requires manual quarantine for an invalid journal', () => {
    const store = useBackgroundOperationStore()
    store.creations = [
      {
        creationId: 'invalid-1',
        issue: 'Invalid schema.',
        status: 'invalid',
        updatedAt: Date.now(),
      },
    ]
    const wrapper = mount(ProjectCreationRecoveryPanel)

    expect(wrapper.text()).toContain('Manual quarantine required')
    expect(wrapper.find('button').exists()).toBe(false)
  })
})
