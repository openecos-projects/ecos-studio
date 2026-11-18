// @vitest-environment happy-dom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const { settings, open, isOpen } = vi.hoisted(() => ({
  settings: vi.fn(),
  open: vi.fn(),
  isOpen: vi.fn(),
}))
vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({ chipViewer: { replaySettings: settings, open, isOpen } }),
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
enableAutoUnmount(afterEach)
const loading = {
  state: 'loading',
  phase: 'Finding layout changes',
  name: 'route',
  step: 12,
  steps: 22,
  frame: 18,
  frames: 69,
}
beforeEach(() => {
  vi.useFakeTimers()
  settings.mockReset().mockResolvedValue({ enabled: false })
  open.mockReset().mockResolvedValue({ spawned: true })
  isOpen
    .mockReset()
    .mockResolvedValue({ open: true, replayLoading: { ...loading, state: 'ready' } })
})
afterEach(() => {
  vi.useRealTimers()
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

it('shows immediate loading feedback and blocks duplicate launches until startup returns', async () => {
  settings.mockResolvedValue({ enabled: true })
  let finish!: (value: { spawned: boolean }) => void
  open.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const wrapper = mount(ReplayControl, options)
  await flushPromises()
  await wrapper.get('.replay-entry').trigger('click')
  expect(wrapper.get('[role="status"]').text()).toContain('Preparing your workspace')
  expect(wrapper.get('.replay-entry').attributes('disabled')).toBeDefined()
  await wrapper.get('.replay-entry').trigger('click')
  expect(open).toHaveBeenCalledTimes(1)
  finish({ spawned: true })
  await flushPromises()
  expect(wrapper.find('[role="status"]').exists()).toBe(false)
  expect(wrapper.get('.replay-entry').attributes('disabled')).toBeUndefined()
})

it('replaces the startup dialog with an actionable error on launch failure', async () => {
  settings.mockResolvedValue({ enabled: true })
  open.mockRejectedValue(new Error('Chip Viewer is not built. Run cargo build.'))
  const wrapper = mount(ReplayControl, options)
  await flushPromises()
  await wrapper.get('.replay-entry').trigger('click')
  await flushPromises()
  expect(wrapper.find('[role="status"]').exists()).toBe(false)
  expect(wrapper.get('[role="alert"]').text()).toContain('Run cargo build')
})

it('keeps the same dialog through process startup, frame preparation and first-layout loading', async () => {
  settings.mockResolvedValue({ enabled: true })
  isOpen.mockResolvedValue({ open: true, replayLoading: loading })
  const wrapper = mount(ReplayControl, options)
  await flushPromises()
  await wrapper.get('.replay-entry').trigger('click')
  const dialog = wrapper.get('[role="status"]').element
  await flushPromises()
  expect(wrapper.get('[role="status"]').element).toBe(dialog)
  expect(wrapper.text()).toContain('Step 12 / 22')
  expect(wrapper.text()).toContain('Frame 18 / 69')
  await vi.advanceTimersByTimeAsync(1000)
  expect(wrapper.text()).toContain('Elapsed 1s')
  const percent = wrapper.get('[role="progressbar"]').attributes('aria-valuenow')
  isOpen.mockResolvedValue({
    open: true,
    replayLoading: { ...loading, phase: 'Loading the first layout', frame: 0, frames: 0 },
  })
  await vi.advanceTimersByTimeAsync(200)
  expect(wrapper.get('[role="status"]').element).toBe(dialog)
  expect(wrapper.text()).toContain('Frames: —')
  expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe(percent)
  expect(wrapper.get('.replay-entry').attributes('disabled')).toBeDefined()
  isOpen.mockResolvedValue({ open: true, replayLoading: { ...loading, state: 'ready' } })
  await vi.advanceTimersByTimeAsync(200)
  expect(wrapper.find('[role="status"]').exists()).toBe(false)
  expect(wrapper.get('.replay-entry').attributes('disabled')).toBeUndefined()
  const calls = isOpen.mock.calls.length
  await vi.advanceTimersByTimeAsync(1000)
  expect(isOpen).toHaveBeenCalledTimes(calls)
})

it('releases the loading dialog if the viewer exits during preparation', async () => {
  settings.mockResolvedValue({ enabled: true })
  isOpen.mockResolvedValue({ open: true, replayLoading: loading })
  const wrapper = mount(ReplayControl, options)
  await flushPromises()
  await wrapper.get('.replay-entry').trigger('click')
  await flushPromises()
  isOpen.mockResolvedValue({ open: false })
  await vi.advanceTimersByTimeAsync(200)
  expect(wrapper.find('[role="status"]').exists()).toBe(false)
  expect(wrapper.get('[role="alert"]').text()).toContain(
    'closed before loading completed',
  )
})

it('stops status polling when the component unmounts', async () => {
  settings.mockResolvedValue({ enabled: true })
  isOpen.mockResolvedValue({ open: true, replayLoading: loading })
  const wrapper = mount(ReplayControl, options)
  await flushPromises()
  await wrapper.get('.replay-entry').trigger('click')
  await flushPromises()
  wrapper.unmount()
  const calls = isOpen.mock.calls.length
  await vi.advanceTimersByTimeAsync(1000)
  expect(isOpen).toHaveBeenCalledTimes(calls)
})
