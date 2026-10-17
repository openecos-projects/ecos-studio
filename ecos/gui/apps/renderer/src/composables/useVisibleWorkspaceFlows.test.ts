// @vitest-environment happy-dom
import { defineComponent, ref } from 'vue'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type {
  ProjectWorkspaceFlows,
  ProjectWorkspaceFlowsRequest,
} from '@ecos-studio/shared'
import { useVisibleWorkspaceFlows } from './useVisibleWorkspaceFlows'

const { read, changed, unsubscribe } = vi.hoisted(() => ({
  read: vi.fn(),
  changed: vi.fn(),
  unsubscribe: vi.fn(),
}))
vi.mock('@/platform/desktop', () => ({
  getOptionalDesktopApi: () => ({
    projectManagement: { watchWorkspaceFlows: read, onWorkspaceFlowsChanged: changed },
  }),
}))

describe('useVisibleWorkspaceFlows', () => {
  it('ignores a late response from collapsed rows and disposes its subscription', async () => {
    const targets = ref<ProjectWorkspaceFlowsRequest>({
      projects: [{ projectRoot: '/project', workspaceIds: ['ws_1'] }],
    })
    let resolveOld!: (value: ProjectWorkspaceFlows) => void
    read
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve
          }),
      )
      .mockResolvedValue({})
    changed.mockReturnValue(unsubscribe)
    const wrapper = shallowMount(
      defineComponent({
        setup() {
          return { flows: useVisibleWorkspaceFlows(() => targets.value) }
        },
        template: '<div />',
      }),
    )
    targets.value = { projects: [] }
    await flushPromises()
    resolveOld({ '/project': { ws_1: { steps: { Synth: 'success' }, running: false } } })
    await flushPromises()
    expect(wrapper.vm.flows).toEqual({})
    wrapper.unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(read).toHaveBeenLastCalledWith({ projects: [] })
  })
})
