// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ProjectComparisonRefreshStatus from './ProjectComparisonRefreshStatus.vue'

describe('ProjectComparisonRefreshStatus', () => {
  it('keeps an explicit Refresh command when automatic refresh is unavailable', async () => {
    const wrapper = mount(ProjectComparisonRefreshStatus, {
      props: { automatic: 'unavailable', refreshing: false },
    })

    expect(wrapper.text()).toContain('Auto-refresh unavailable')
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('refresh')).toEqual([[]])
  })

  it('stays absent while automatic refresh is available', () => {
    const wrapper = mount(ProjectComparisonRefreshStatus, {
      props: { automatic: 'available', refreshing: false },
    })

    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })
})
