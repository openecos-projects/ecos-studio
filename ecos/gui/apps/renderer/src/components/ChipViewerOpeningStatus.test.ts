// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChipViewerOpeningStatus from './ChipViewerOpeningStatus.vue'
import { beginChipViewerOpening } from '@/composables/chipViewerOpeningStatus'

describe('ChipViewerOpeningStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('shows a named indeterminate progress control while the viewer is launching', () => {
    const opening = beginChipViewerOpening('Opening saved Chip Viewer layout', 'place')
    const wrapper = mount(ChipViewerOpeningStatus)

    expect(wrapper.text()).toContain('Opening saved Chip Viewer layout')
    expect(wrapper.text()).toContain('place')
    expect(wrapper.get('progress').attributes('aria-label')).toBe(
      'Opening saved Chip Viewer layout',
    )
    expect(wrapper.find('[role="status"]').exists()).toBe(false)

    opening.finish()
    wrapper.unmount()
  })

  it('announces the started state and removes it after confirmation', async () => {
    const opening = beginChipViewerOpening('Opening saved Chip Viewer layout')
    const wrapper = mount(ChipViewerOpeningStatus)
    opening.complete()
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[role="status"]').text()).toContain('Chip Viewer started')
    expect(wrapper.find('progress').exists()).toBe(false)

    vi.advanceTimersByTime(1400)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.chip-viewer-opening-status').exists()).toBe(false)
    wrapper.unmount()
  })
})
