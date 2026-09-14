// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ProjectQorSnapshotPanel from './ProjectQorSnapshotPanel.vue'
import type { DashboardQorInsights } from './projectDashboard'

function insights(overrides: Partial<DashboardQorInsights> = {}): DashboardQorInsights {
  return {
    status: 'available',
    dimensions: [
      {
        key: 'timing',
        label: 'Timing',
        value: 74.2,
        display: '74.2',
        state: 'PASS',
        tone: 'good',
        percent: 74.2,
      },
    ],
    diagnoses: [
      {
        id: 'timing-watch',
        state: 'WATCH',
        tone: 'warn',
        severity: 0.4,
        confidence: 'HIGH',
        evidence: ['timing.setup'],
        interventions: ['Review clock uncertainty'],
        validationRequired: 'Run STA',
      },
    ],
    evidence: {
      index: 90,
      state: 'HIGH',
      integrity: 1,
      coverage: 1,
      consistency: 1,
    },
    feasibility: { status: 'PASS', gates: [] },
    power: { totalUw: 12.5, budgetUw: 20, sourceKind: 'signoff', corner: 'tt' },
    ...overrides,
  }
}

describe('ProjectQorSnapshotPanel', () => {
  it('renders typed Qphys and diagnosis facts without recomputing them', () => {
    const wrapper = mount(ProjectQorSnapshotPanel, {
      props: { insights: insights() },
    })

    expect(wrapper.get('.dash-qphys-value').text()).toBe('74.2')
    expect(wrapper.get('.dash-qphys-state').text()).toBe('PASS')
    expect(wrapper.get('.dash-qphys-bar i').attributes('style')).toContain('74.2%')
    expect(wrapper.get('summary').text()).toContain('timing-watch')
    expect(wrapper.get('.dash-diagnosis-evidence').text()).toContain('timing.setup')
    expect(wrapper.get('.dash-diagnosis-hypothesis').text()).toBe(
      'Review clock uncertainty',
    )
    expect(wrapper.get('.dash-diagnosis-validation').text()).toContain('Run STA')
    expect(wrapper.get('.dash-qor-facts').text()).toContain('12.5 uW')
  })

  it('renders an explicit unavailable state when the extension has no dimensions', () => {
    const wrapper = mount(ProjectQorSnapshotPanel, {
      props: {
        insights: insights({
          status: 'unavailable',
          dimensions: [],
          diagnoses: [],
          evidence: null,
          feasibility: null,
          power: null,
        }),
      },
    })

    expect(wrapper.get('.dash-qphys-empty').text()).toBe('QoR v3 Snapshot unavailable')
  })
})
