// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MpcTemplatePreview from './MpcTemplatePreview.vue'
import type { MpcSpecDesign } from '@/utils/mpcSpec'

const design: MpcSpecDesign = {
  index: 0,
  designName: 'mpc-frame-template',
  directory: './designs/template',
  dbu: null,
  die: {
    llx: null,
    lly: null,
    width: null,
    manufacturing_grid: 0.005,
  },
  core: { llx: 10, lly: 10, width: 80, height: 90 },
  ioPins: {
    declaredCount: 2,
    list: [
      {
        name: 'clock',
        info: 'FrameTop clock input.',
        drive_strength: 'high',
        bounding_box: { llx: null, lly: null, width: null, height: null },
      },
      {
        name: 'reset',
        info: 'FrameTop reset input.',
        bounding_box: { llx: 1, lly: 2, width: 3, height: 4 },
      },
    ],
    other: { naming: 'frame-interface' },
  },
  other: { floorplan_source: 'template' },
  coreTemplate: {
    name: '@MODULE@',
    minimum_area: 100,
    maximum_area: 10000,
    ports: [{ name: 'clock', direction: 'input', width: 1 }],
    future_constraint: { required: true },
  },
}

describe('MpcTemplatePreview', () => {
  it('renders top-level MPC resources separately from core template constraints', () => {
    const wrapper = mount(MpcTemplatePreview, { props: { design } })

    expect(wrapper.text()).toContain('MPC Resources')
    expect(wrapper.text()).toContain('Top-level design resources')
    expect(wrapper.text()).toContain('Core Template')
    expect(wrapper.text()).toContain('Constraints and interface')
    expect(wrapper.text()).toContain('mpc-frame-template')
    expect(wrapper.text()).toContain('./designs/template')
    expect(wrapper.text()).toContain('floorplan source')
    expect(wrapper.text()).toContain('frame-interface')
    expect(wrapper.text()).toContain('Design Limits')
    expect(wrapper.text()).toContain('minimum area')
    expect(wrapper.text()).toContain('Other Constraints')
    expect(wrapper.findAll('.mpc-preview-section--geometry')).toHaveLength(2)
  })

  it('keeps unknown pin and geometry fields while formatting empty geometry values', () => {
    const wrapper = mount(MpcTemplatePreview, { props: { design } })
    const pinTable = wrapper.find('.mpc-preview-table-wrap--pins table')

    expect(pinTable.findAll('th').map((cell) => cell.text())).toEqual([
      'name',
      'info',
      'drive strength',
      'Bounding Box',
    ])
    expect(pinTable.text()).toContain('high')
    expect(pinTable.text()).toContain('llx: 1')
    expect(wrapper.text()).toContain('manufacturing grid')
    expect(wrapper.text()).toContain('0.005')
    expect(wrapper.find('.mpc-preview-section__heading span').text()).toBe('2')
  })
})
