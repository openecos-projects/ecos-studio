// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import FlowLogPanel from './FlowLogPanel.vue'

it('reads a live log at the refresh interval even when the segment is replaced at EOF', async () => {
  vi.useFakeTimers()
  const segment = {
    stepName: 'placement',
    tool: 'dreamplace',
    state: 'Ongoing',
    live: true,
    startedAtMs: 1,
    failed: false,
    missing: false,
    logPath: 'placement/run.log',
  }
  const ensureContent = vi.fn().mockResolvedValue(true)
  const wrapper = mount(FlowLogPanel, {
    props: {
      activeStepName: 'placement',
      contentByKey: {},
      ensureContent,
      error: null,
      executionActive: true,
      loading: false,
      selectedNode: null,
      segments: [segment],
    },
    global: { stubs: { Dialog: true, FlowLogCodeViewer: true } },
  })
  try {
    expect(ensureContent).toHaveBeenCalled()
    ensureContent.mockClear()
    await wrapper.setProps({ segments: [{ ...segment, lastReadOffsetBytes: 10 }] })
    await wrapper.setProps({ segments: [{ ...segment, lastReadOffsetBytes: 10 }] })
    expect(ensureContent).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(ensureContent).toHaveBeenCalledTimes(1)
    await wrapper.setProps({ segments: [{ ...segment, live: false, state: 'Success' }] })
    expect(ensureContent).toHaveBeenCalledTimes(2)
  } finally {
    wrapper.unmount()
    vi.useRealTimers()
  }
})
