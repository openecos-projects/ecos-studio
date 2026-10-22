// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  route: {
    path: '/workspace/home',
    query: { projectRoot: '/work/project', workspaceId: 'current' },
  },
  keyMetrics: [
    { id: 'instances', label: 'Instance Number', unit: '', value: 423 },
    { id: 'die-area', label: 'Die Area', unit: 'um2', value: 1000 },
  ],
  projection: {
    data: {
      identity: {
        projectName: 'soc-demo',
        workspaceId: 'ws_0002',
        workspaceName: 'soc-demo',
      },
      configuration: {
        status: 'ready' as const,
        data: {
          pdk: 'ics55',
          design: 'gcd',
          topModule: 'gcd',
          dieArea: 1000,
          frequencyMaxMhz: 500,
          clock: 'clk',
        },
      },
    },
  },
  currentProject: { path: '/work/project/soc-demo', name: 'soc-demo' },
}))
vi.mock('vue-router', () => ({ useRoute: () => state.route }))
vi.mock('@/composables/useDashboardOverview', () => ({
  useDashboardOverview: () => ({
    keyMetrics: state.keyMetrics,
    mpcDisplayName: { value: null },
  }),
}))
vi.mock('@/composables/useWorkspace', () => ({
  useWorkspace: () => ({ currentProject: state.currentProject }),
}))
vi.mock('@/stores/backendWorkspaceSession', () => ({
  useBackendWorkspaceSession: () => ({ projection: state.projection }),
}))
import PrimeVue from 'primevue/config'
import LeftSidebar from './LeftSidebar.vue'

const routerLinkStub = {
  RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' },
}

describe('RTL workspace navigation', () => {
  it('shows Dashboard and insight modules while preserving workspace context', () => {
    const wrapper = mount(LeftSidebar, { global: { stubs: routerLinkStub } })
    const links = wrapper.findAllComponents({ name: 'RouterLink' })
    expect(wrapper.text()).not.toContain('Project')
    expect(wrapper.text()).toContain('Dashboard')
    expect(wrapper.findAll('a')).toHaveLength(8)
    expect(links.map((link) => link.props('to'))).toEqual([
      { path: '/workspace/home', query: state.route.query },
      ...['resources', 'db-trends', 'drc', 'timing', 'power', 'lvs', 'antenna'].map(
        (insight) => ({
          path: '/workspace/home',
          query: { ...state.route.query, insight },
        }),
      ),
    ])
    expect(links.map((link) => link.text())).toEqual([
      'Dashboard',
      'Step Trends',
      'DB Trends',
      'DRC',
      'Timing',
      'Power',
      'LVS',
      'Antenna',
    ])
  })

  it('opens the key metrics dialog from the Metrics button under Dashboard', async () => {
    const wrapper = mount(LeftSidebar, {
      global: { stubs: routerLinkStub, plugins: [PrimeVue] },
    })
    const metricsButton = wrapper.get('button[aria-haspopup="dialog"]')
    expect(metricsButton.text()).toContain('Metrics')
    const navButtons = wrapper.findAll('nav > a, nav > button')
    expect(navButtons[0]?.text()).toContain('Dashboard')
    expect(navButtons[1]?.element).toBe(metricsButton.element)
    await metricsButton.trigger('click')
    await nextTick()
    const dialogText = document.body.textContent ?? ''
    // Chip basic info renders above the key metrics section.
    expect(dialogText.indexOf('Chip Basic Info')).toBeGreaterThanOrEqual(0)
    expect(dialogText.indexOf('Chip Basic Info')).toBeLessThan(
      dialogText.indexOf('Key Metrics'),
    )
    expect(dialogText).toContain('soc-demo')
    const workspaceLabel = Array.from(document.body.querySelectorAll('dt')).find(
      (element) => element.textContent?.trim() === 'Workspace',
    )
    expect(workspaceLabel?.parentElement?.querySelector('dd')?.textContent).toBe(
      'ws_0002',
    )
    expect(dialogText).toContain('ics55')
    expect(dialogText).toContain('500 MHz')
    expect(dialogText).toContain('Instance Number')
    expect(dialogText).toContain('423')
    wrapper.unmount()
  })
})
