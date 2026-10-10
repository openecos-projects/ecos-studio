// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  route: {
    path: '/workspace/home',
    query: { projectRoot: '/work/project', workspaceId: 'current' },
  },
}))
vi.mock('vue-router', () => ({ useRoute: () => state.route }))
import LeftSidebar from './LeftSidebar.vue'

describe('RTL workspace navigation', () => {
  it('shows only Dashboard and preserves workspace query context', () => {
    const wrapper = mount(LeftSidebar, {
      global: {
        stubs: {
          RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' },
        },
      },
    })
    const links = wrapper.findAllComponents({ name: 'RouterLink' })
    expect(wrapper.text()).not.toContain('Project')
    expect(wrapper.text()).toContain('Dashboard')
    expect(wrapper.findAll('a')).toHaveLength(1)
    expect(links.map((link) => link.props('to'))).toEqual([
      { path: '/workspace/home', query: state.route.query },
    ])
  })
})
