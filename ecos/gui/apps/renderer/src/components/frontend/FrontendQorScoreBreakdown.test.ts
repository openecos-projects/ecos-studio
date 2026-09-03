// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import FrontendQorScoreBreakdown from './FrontendQorScoreBreakdown.vue'
import type { FrontendQorScore } from '@/utils/frontendQor'

const score: FrontendQorScore = {
  label: 'Preparation readiness',
  value: 92.5,
  maximum: 100,
  scoringVersion: 1,
  components: [
    {
      id: 'source_resolution',
      label: 'Source resolution',
      earned: 22.5,
      possible: 30,
      summary: '3 of 4 RTL sources and 0 of 0 include directories resolved.',
    },
    {
      id: 'top_resolution',
      label: 'Top resolution',
      earned: 20,
      possible: 20,
      summary: '1 matching definition found; source is in prepared inputs.',
    },
    {
      id: 'interface_contract',
      label: 'Interface contract',
      earned: 40,
      possible: 40,
      summary: '61 of 61 required ports matched; 0 unexpected.',
    },
    {
      id: 'reproducibility',
      label: 'Reproducibility',
      earned: 10,
      possible: 10,
      summary: 'Input fingerprint recorded; normalized outputs persisted.',
    },
  ],
}

describe('FrontendQorScoreBreakdown', () => {
  it('renders the score, version, weighted components, and evidence', () => {
    const wrapper = mount(FrontendQorScoreBreakdown, {
      props: { score, status: 'pass' },
    })

    expect(wrapper.text()).toContain('Preparation readiness')
    expect(wrapper.text()).toContain('Scoring model v1')
    expect(wrapper.text()).toContain('92.5 / 100')
    expect(wrapper.findAll('li')).toHaveLength(4)
    expect(wrapper.findAll('[role="progressbar"]')[0].attributes()).toMatchObject({
      'aria-valuenow': '22.5',
      'aria-valuemax': '30',
    })
    expect(wrapper.findAll('.frontend-qor-score__track i')[0].attributes('style')).toBe(
      'width: 75%;',
    )
    expect(wrapper.text()).toContain('61 of 61 required ports matched')
  })
})
