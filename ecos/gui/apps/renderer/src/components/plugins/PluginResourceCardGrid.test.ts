// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { ResourceItem } from '@/api/plugin'
import { resourceToRow } from '@/views/pluginToolsRows'
import PluginResourceCardGrid from './PluginResourceCardGrid.vue'
import gridSource from './PluginResourceCardGrid.vue?raw'

function resource(overrides: Partial<ResourceItem>): ResourceItem {
  return {
    id: 'tool:yosys',
    type: 'tool',
    name: 'yosys',
    display_name: 'Yosys',
    description: 'Open synthesis suite',
    category: 'synthesis',
    status: 'available',
    installed_version: null,
    available_versions: ['20260827'],
    active_version: null,
    active: false,
    path: null,
    managed_root: null,
    platform: 'linux-x86_64',
    size: null,
    source: 'registry',
    homepage: '',
    actions: ['install'],
    health: {},
    error: null,
    ...overrides,
  }
}

function rows() {
  return [
    resourceToRow(resource({}), undefined),
    resourceToRow(
      resource({ id: 'tool:verilator', name: 'verilator', display_name: 'Verilator' }),
      undefined,
    ),
  ]
}

function mountGrid(overrides: Record<string, unknown> = {}) {
  return mount(PluginResourceCardGrid, {
    props: {
      rows: rows(),
      loading: false,
      importingIds: new Set<string>(),
      ...overrides,
    },
  })
}

describe('PluginResourceCardGrid', () => {
  it('renders one card per row', () => {
    const wrapper = mountGrid()

    expect(wrapper.findAll('.plugin-card')).toHaveLength(2)
    expect(gridSource).toContain('grid-template-columns: minmax(0, 1fr)')
    expect(gridSource).not.toContain('auto-fill')
  })

  it('shows the loading state instead of the grid', () => {
    const wrapper = mountGrid({ loading: true, rows: [] })

    expect(wrapper.find('.resource-loading').exists()).toBe(true)
    expect(wrapper.find('.resource-card-grid').exists()).toBe(false)
  })

  it('shows the empty state and re-raises clear-filters', async () => {
    const wrapper = mountGrid({ rows: [] })

    expect(wrapper.find('.resource-empty').exists()).toBe(true)
    await wrapper.find('.clear-filters-btn').trigger('click')
    expect(wrapper.emitted('clearFilters')).toHaveLength(1)
  })

  it('re-raises card action events with row context', async () => {
    const wrapper = mountGrid()

    const install = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Install')!
    await install.trigger('click')
    const actions = wrapper.emitted('action')!
    expect(actions).toHaveLength(1)
    const [row, actionId] = actions[0] as [unknown, string]
    expect(actionId).toBe('install')
    expect((row as { id: string }).id).toBe('tool:yosys')
  })
})
