import { describe, expect, it } from 'vitest'
import type { ChecklistFinding } from '@ecos-studio/shared'
import { dashboardFlowSteps, stepCheckState } from './flowDashboardData'

function finding(state: string, blocked = false): ChecklistFinding {
  return {
    id: 'check',
    step: 'placement',
    title: 'Placement',
    summary: '',
    category: 'gate',
    state,
    blocked,
  }
}

describe('dashboard flow data', () => {
  it('keeps execution, checklist and missing resource states independent', () => {
    const steps = dashboardFlowSteps(
      [
        { stepId: 'sta', name: 'STA', order: 2, state: 'succeeded' },
        {
          stepId: 'placement',
          name: 'Place',
          order: 1,
          state: 'running',
          runtimeSeconds: 65.5,
          peakMemoryMb: 1024,
        },
      ],
      [finding('failed', true)],
      [],
    )
    expect(steps.map((step) => step.id)).toEqual(['placement', 'sta'])
    expect(steps[0]).toMatchObject({
      status: 'running',
      checkState: 'blocked',
      runtime: '00:01:05.5',
      peakMemoryMb: 1024,
    })
    expect(steps[1]).toMatchObject({
      status: 'succeeded',
      checkState: 'unavailable',
      runtime: '',
      peakMemoryMb: null,
      thumbnail: null,
      macroPlacementSource: null,
    })
  })

  it('offers preFloorplan geometry as the macro-placement fallback before its own run', () => {
    const steps = dashboardFlowSteps(
      [
        { stepId: 'pre_floorplan', name: 'Pre Floorplan', order: 0, state: 'succeeded' },
        {
          stepId: 'macro_placement',
          name: 'Macro Placement',
          order: 1,
          state: 'not-started',
        },
      ],
      [],
      [
        {
          id: 'preFloorplan-image',
          kind: 'layout',
          label: 'Pre Floorplan',
          step: 'pre_floorplan',
          url: 'blob:preFloorplan',
          hasGeometry: true,
          availability: 'available',
          reason: null,
        },
      ],
    )

    expect(steps[0]).toMatchObject({
      id: 'pre_floorplan',
      thumbnail: { id: 'preFloorplan-image' },
      macroPlacementSource: null,
    })
    expect(steps[1]).toMatchObject({
      id: 'macro_placement',
      status: 'queued',
      thumbnail: null,
      macroPlacementSource: { id: 'preFloorplan-image' },
    })
  })

  it.each([
    [[], 'unavailable'],
    [[finding('pass')], 'passed'],
    [[finding('warning')], 'warning'],
    [[finding('failed')], 'blocked'],
    [[finding('pass', true)], 'blocked'],
    [[finding('pass'), finding('unknown')], 'unavailable'],
  ])(
    'does not infer checklist success from missing or unknown evidence',
    (findings, expected) => {
      expect(stepCheckState(findings as ChecklistFinding[])).toBe(expected)
    },
  )

  it('matches checklist and layout by canonical step identity, not list position', () => {
    const steps = dashboardFlowSteps(
      [{ stepId: 'placement', name: 'placement', order: 0, state: 'succeeded' }],
      [finding('pass')],
      [
        {
          id: 'place-image',
          kind: 'layout',
          label: 'Place',
          step: 'placement',
          url: 'blob:place',
          hasGeometry: true,
          availability: 'available',
          reason: null,
        },
      ],
    )
    expect(steps[0]).toMatchObject({
      checkState: 'passed',
      thumbnail: { id: 'place-image' },
    })
  })

  it('shows unavailable instead of stale committed findings when checklistStatus is unknown', () => {
    const steps = dashboardFlowSteps(
      [
        {
          stepId: 'placement',
          name: 'placement',
          order: 0,
          state: 'running',
          checklistStatus: 'unknown',
        },
      ],
      [finding('failed', true)],
      [],
    )
    expect(steps[0]).toMatchObject({
      status: 'running',
      checkState: 'unavailable',
    })
  })
})
