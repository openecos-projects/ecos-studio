import { describe, expect, it } from 'vitest'
import { workspaceFlowHint } from './projectWorkspaceFlowPresentation'

describe('workspaceFlowHint', () => {
  it('distinguishes loading, unavailable, interrupted and a fresh unstarted Flow', () => {
    expect(workspaceFlowHint()).toEqual({ state: 'unstart', label: 'Loading status…' })
    expect(
      workspaceFlowHint({ steps: {}, running: false, issue: 'unavailable' }),
    ).toEqual({ state: 'warning', label: 'Status unavailable' })
    expect(
      workspaceFlowHint({
        steps: { Synth: 'running' },
        running: false,
        issue: 'interrupted',
      }),
    ).toEqual({ state: 'failed', label: 'Interrupted' })
    expect(workspaceFlowHint({ steps: { Synth: 'unstart' }, running: false })).toEqual({
      state: 'unstart',
      label: 'Not started',
    })
  })

  it('keeps partial runs incomplete and accepts deliberately skipped steps as completed', () => {
    expect(
      workspaceFlowHint({
        steps: { Synth: 'success', Route: 'unstart' },
        running: false,
      }),
    ).toEqual({ state: 'unstart', label: '1/2 steps completed' })
    expect(
      workspaceFlowHint({
        steps: { Synth: 'reused', LEC: 'skipped', Route: 'success' },
        running: false,
      }),
    ).toEqual({ state: 'success', label: 'Completed' })
    expect(workspaceFlowHint({ steps: { Synth: 'success' }, running: true })).toEqual({
      state: 'running',
      label: 'Running',
    })
    expect(workspaceFlowHint({ steps: { Synth: 'failed' }, running: false })).toEqual({
      state: 'failed',
      label: 'Failed',
    })
  })

  it('shows the actual running step, including changes within the same phase', () => {
    const flow = {
      steps: {
        preFloorplan: 'success' as const,
        macroPlacement: 'running' as const,
        postFloorplan: 'unstart' as const,
      },
      running: true,
    }
    expect(workspaceFlowHint(flow)).toEqual({
      state: 'running',
      label: 'macroPlacement running',
    })
    expect(
      workspaceFlowHint({
        ...flow,
        steps: { ...flow.steps, macroPlacement: 'success', postFloorplan: 'running' },
      }),
    ).toEqual({ state: 'running', label: 'postFloorplan running' })
  })
})
