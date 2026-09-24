// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { ResourceItem } from '@/api/plugin'
import { resourceToRow } from '@/views/pluginToolsRows'
import PluginResourceCard from './PluginResourceCard.vue'
import cardSource from './PluginResourceCard.vue?raw'

function resource(overrides: Partial<ResourceItem>): ResourceItem {
  return {
    id: 'tool:yosys',
    type: 'tool',
    name: 'yosys',
    display_name: 'Yosys',
    description: 'Open synthesis suite for RTL design with extensive passes.',
    category: 'synthesis',
    status: 'available',
    installed_version: null,
    available_versions: ['20260827'],
    active_version: null,
    active: false,
    path: null,
    managed_root: null,
    platform: 'linux-x86_64',
    size: 64 * 1024 * 1024,
    source: 'registry',
    homepage: 'https://github.com/YosysHQ/yosys',
    actions: ['install'],
    health: {},
    error: null,
    ...overrides,
  }
}

function mountCard(overrides: Partial<ResourceItem> = {}, selected = false) {
  const row = resourceToRow(resource(overrides), undefined)
  return mount(PluginResourceCard, {
    props: { row, selected, importing: false },
  })
}

describe('PluginResourceCard', () => {
  it('renders name, meta line, full description, and flow tags', () => {
    const wrapper = mountCard()

    expect(wrapper.find('.plugin-card-title strong').text()).toBe('Yosys')
    expect(wrapper.find('.plugin-card-title small').text()).toBe(
      'v20260827 · 64.00 MB · linux-x86_64',
    )
    const description = wrapper.find('.plugin-card-description')
    expect(description.text()).toBe(
      'Open synthesis suite for RTL design with extensive passes.',
    )
    expect(description.attributes('title')).toBe(
      'Open synthesis suite for RTL design with extensive passes.',
    )
    expect(wrapper.findAll('.resource-flow-tags b').map((tag) => tag.text())).toEqual([
      'Review',
      'Yosys',
    ])
  })

  it('shows the status pill matching the row status kind', () => {
    const available = mountCard()
    expect(available.find('.status-pill').classes()).toContain('available')

    const installed = mountCard({
      status: 'installed',
      installed_version: '20260827',
      actions: ['uninstall'],
    })
    expect(installed.find('.status-pill').classes()).toContain('installed')

    const error = mountCard({ status: 'error', error: 'boom' })
    expect(error.find('.status-pill').classes()).toContain('error')
    expect(error.find('.status-pill').attributes('title')).toBe('boom')
  })

  it('emits toggle from the checkbox and keyboard, not from the card body', async () => {
    const wrapper = mountCard()

    await wrapper.find('.resource-check').trigger('click')
    expect(wrapper.emitted('toggle')).toHaveLength(1)

    await wrapper.find('.plugin-card').trigger('keydown.enter')
    expect(wrapper.emitted('toggle')).toHaveLength(2)
  })

  it('emits the primary action id when its labeled button is clicked', async () => {
    const wrapper = mountCard()
    const install = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Install')!

    await install.trigger('click')
    expect(wrapper.emitted('action')).toEqual([['install']])
  })

  it('shows the homepage button only when the resource declares one', async () => {
    const withHomepage = mountCard()
    const homepageButton = withHomepage.find('[data-title="Homepage"]')
    expect(homepageButton.exists()).toBe(true)
    expect(homepageButton.attributes('aria-label')).toBe('Open homepage')
    await homepageButton.trigger('click')
    expect(withHomepage.emitted('homepage')).toHaveLength(1)

    const withoutHomepage = mountCard({ homepage: '' })
    expect(withoutHomepage.find('[data-title="Homepage"]').exists()).toBe(false)
  })

  it('hides the homepage button for non-web schemes', () => {
    const fileUrl = mountCard({ homepage: 'file:///etc/passwd' })
    expect(fileUrl.find('[data-title="Homepage"]').exists()).toBe(false)

    const customScheme = mountCard({ homepage: 'ecos-internal://open' })
    expect(customScheme.find('[data-title="Homepage"]').exists()).toBe(false)
  })

  it('hides the homepage button for malformed web URLs', () => {
    const malformed = mountCard({ homepage: 'https://' })
    expect(malformed.find('[data-title="Homepage"]').exists()).toBe(false)
  })

  it('clamps long descriptions to two lines', () => {
    expect(cardSource).toContain('-webkit-line-clamp: 2')
  })
})
