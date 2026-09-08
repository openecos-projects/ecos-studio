// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ProjectResultStatus from './ProjectResultStatus.vue'
import { workspaceFixture } from './projectDashboard.fixture'
import { workspaceSummaryFixture } from '@/components/projectStepAnalysis.fixture'
import { applyProjectResultStates } from '@/utils/projectResultPresentation'

describe('Project result status', () => {
  it('distinguishes a configuration update from a first run without changing step progress', () => {
    const workspace = workspaceFixture('ws_a', {
      flowStatusHint: { state: 'unstart', label: 'Synth unstart' },
    })
    const originalSteps = structuredClone(workspace.steps)
    const analysis = workspaceSummaryFixture('ws_a', {}).analysis
    analysis.resultState = {
      workspaceRevision: 16,
      pendingStepIds: ['Synth'],
      previous: { workspaceRevision: 15, completedStepCount: 14, stepCount: 14 },
    }
    applyProjectResultStates([workspace], new Map([['ws_a', analysis]]))
    const wrapper = mount(ProjectResultStatus, {
      props: { hint: workspace.flowStatusHint, resultState: workspace.resultState },
    })
    expect(wrapper.text()).toContain('Needs rerun')
    expect(wrapper.text()).toContain('Previous run completed')
    expect(wrapper.text()).toContain('Rev 15')
    expect(wrapper.attributes('title')).toContain('Revision 16')
    expect(workspace.steps).toEqual(originalSteps)
  })

  it('keeps current failed and running states visible', () => {
    for (const state of ['failed', 'running'] as const) {
      const workspace = workspaceFixture('ws_a', {
        flowStatusHint: { state, label: `Route ${state}` },
      })
      const analysis = workspaceSummaryFixture('ws_a', {}).analysis
      analysis.resultState = { workspaceRevision: 16, pendingStepIds: ['Route'] }
      applyProjectResultStates([workspace], new Map([['ws_a', analysis]]))
      expect(workspace.flowStatusHint.label).toBe(`Route ${state}`)
    }
  })
})
