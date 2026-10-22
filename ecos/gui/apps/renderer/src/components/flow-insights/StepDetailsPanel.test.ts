// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import StepDetailsPanel from './StepDetailsPanel.vue'
import { parseStepDetails } from './stepDetails'

describe('StepDetailsPanel', () => {
  it('renders nested LVS tables and the empty violations state', () => {
    const summary = parseStepDetails({
      entity: [{ def: 54, difference: 0, entity: 'IO(without pg)', netlist: 54 }],
      connectivity: [
        {
          connected: { count: 345, percentage: 100 },
          connectivity: 'Routing',
          open: { count: 0, percentage: 0 },
          short: { count: 0, percentage: 0 },
          total: 345,
        },
      ],
      violations: [],
      run: { state: 'Success', runtime_seconds: 0.4 },
      constraints: { sdc: { availability: 'available' } },
    })

    const wrapper = mount(StepDetailsPanel, {
      props: {
        title: 'LVS Results',
        source: 'lvs.step.json',
        summary,
      },
    })

    expect(wrapper.text()).toContain('LVS Results')
    expect(wrapper.text()).toContain('lvs.step.json')
    expect(wrapper.text()).toContain('IO(without pg)')
    expect(wrapper.text()).toContain('Connected %')
    expect(wrapper.text()).toContain('No violations reported.')
    expect(wrapper.text()).not.toContain('runtime_seconds')
    expect(wrapper.text()).not.toContain('availability')
  })

  it('renders antenna counters and reports missing data explicitly', () => {
    const summary = parseStepDetails({
      antenna_check: {
        pins_missing_antenna_info: 0,
        violation_count: 0,
      },
      violations: [],
    })
    const wrapper = mount(StepDetailsPanel, {
      props: {
        title: 'Antenna Check',
        source: 'antennaCheck.step.json',
        summary,
      },
    })

    expect(wrapper.text()).toContain('Antenna Check')
    expect(wrapper.text()).toContain('Pins Missing Antenna Info')
    expect(wrapper.text()).toContain('Violation Count')
    expect(wrapper.text()).toContain('Violations · clean')

    const empty = mount(StepDetailsPanel, {
      props: {
        title: 'LVS Results',
        source: 'lvs.step.json',
        summary: null,
        emptyMessage: 'LVS analysis has not produced a result for this workspace.',
      },
    })
    expect(empty.text()).toContain('LVS analysis has not produced a result')
  })
})
