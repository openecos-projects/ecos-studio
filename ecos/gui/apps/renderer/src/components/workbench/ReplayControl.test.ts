// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, expect, it, vi } from 'vitest'

const { settings, open } = vi.hoisted(() => ({ settings: vi.fn(), open: vi.fn() }))
vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({ chipViewer: { replaySettings: settings, open } }),
}))
vi.mock('@/composables/useWorkspace', () => ({
  useWorkspace: () => ({
    currentProject: ref({ path: '/work/demo' }),
    resourceVersions: ref({ parameters: 0, all: 0 }),
  }),
}))
import ReplayControl from './ReplayControl.vue'

const options = {
  global: {
    stubs: {
      Dialog: { props: ['visible'], template: '<div v-if="visible"><slot /></div>' },
    },
  },
}
beforeEach(() => {
  settings.mockReset().mockResolvedValue({ enabled: false })
  open.mockReset().mockResolvedValue({ spawned: true })
})

it('hides the entry when capture was not enabled', async () => {
  const wrapper = mount(ReplayControl, options)
  await flushPromises()
  expect(wrapper.find('.replay-entry').exists()).toBe(false)
})

it('launches Replay for the active workspace when enabled', async () => {
  settings.mockResolvedValue({ enabled: true })
  const wrapper = mount(ReplayControl, options)
  await flushPromises()
  await wrapper.get('.replay-entry').trigger('click')
  await flushPromises()
  expect(open).toHaveBeenCalledWith({
    projectPath: '/work/demo',
    step: 'replay',
    mode: 'replay',
  })
})

it('explains why an enabled workspace has no capture yet', async () => {
  settings.mockResolvedValue({ enabled: true })
  open.mockRejectedValue(new Error('Enable capture and rerun'))
  const wrapper = mount(ReplayControl, options)
  await flushPromises()
  await wrapper.get('.replay-entry').trigger('click')
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toBe('Enable capture and rerun')
})
