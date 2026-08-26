// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import StepSnapshotPanel from './StepSnapshotPanel.vue'
import panelSource from './StepSnapshotPanel.vue?raw'

describe('StepSnapshotPanel', () => {
  it('lays the snapshot area out as a fixed 4x4 grid', () => {
    expect(panelSource).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))')
    expect(panelSource).toContain('grid-template-rows: repeat(4, minmax(0, 1fr))')
  })

  it('anchors exactly one Summary entry at the first row and first column', () => {
    const wrapper = mount(StepSnapshotPanel)

    const entry = wrapper.find('.snapshot-summary-entry')
    expect(entry.exists()).toBe(true)
    expect(panelSource).toContain('grid-area: 1 / 1')
    expect(entry.attributes('aria-label')).toBe('Open data summary')
    expect(entry.find('i.ri-dashboard-2-line').exists()).toBe(true)
    expect(entry.text()).toContain('Summary')
    expect(wrapper.findAll('button')).toHaveLength(1)
  })

  it('renders action tiles right after the Summary entry', () => {
    const wrapper = mount(StepSnapshotPanel, {
      props: {
        actions: [
          {
            id: 'drc',
            icon: 'ri-shield-check-line',
            label: 'DRC',
            caption: 'Violations by layer / type',
          },
        ],
      },
    })

    const tiles = wrapper.findAll('.snapshot-tile')
    expect(tiles).toHaveLength(2)
    expect(tiles[0].classes()).toContain('snapshot-summary-entry')
    expect(tiles[1].attributes('aria-label')).toBe('Open DRC')
    expect(tiles[1].find('i.ri-shield-check-line').exists()).toBe(true)
    expect(tiles[1].text()).toContain('Violations by layer / type')
  })

  it('emits open for the Summary entry and action ids for action tiles', async () => {
    const wrapper = mount(StepSnapshotPanel, {
      props: {
        actions: [{ id: 'drc', icon: 'ri-shield-check-line', label: 'DRC' }],
      },
    })

    await wrapper.find('.snapshot-summary-entry').trigger('click')
    await wrapper.findAll('.snapshot-tile')[1].trigger('click')

    expect(wrapper.emitted('open')).toHaveLength(1)
    expect(wrapper.emitted('action')).toEqual([['drc']])
  })

  it('places extra snapshot data from the slot after the Summary entry', () => {
    const wrapper = mount(StepSnapshotPanel, {
      slots: {
        default:
          '<button class="snapshot-extra-image" type="button">All Cell Density</button>',
      },
    })

    const children = wrapper.find('.snapshot-panel').element.children
    expect(children).toHaveLength(2)
    expect(children[0].classList.contains('snapshot-summary-entry')).toBe(true)
    expect(children[1].classList.contains('snapshot-extra-image')).toBe(true)
  })
})
