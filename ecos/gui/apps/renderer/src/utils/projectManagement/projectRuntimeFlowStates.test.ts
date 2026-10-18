import { describe, expect, it } from 'vitest'
import type { BackendProjectComparison } from '@ecos-studio/shared'
import {
  projectComparisonWorkspaceFlowStates,
  projectWorkspaceFlowStatesWithRuntime,
} from './projectRuntimeFlowStates'

describe('Project runtime flow states', () => {
  it('projects full CLI flow state and aggregates ECC floor substeps', () => {
    const committed = {
      ws_0001: { Synth: 'success', Floor: 'success', Place: 'success' },
      ws_0002: { Synth: 'success' },
    } as const
    const projected = projectWorkspaceFlowStatesWithRuntime(committed, [
      {
        cancelRequested: false,
        engineeringWorkspaceId: '/projects/gcd/ws_0001',
        flow: {
          steps: [
            {
              name: 'Synthesis',
              peakMemory: 64,
              runtime: '00:00:03',
              state: 'Success',
              tool: 'yosys',
            },
            {
              name: 'preFloorplan',
              peakMemory: 80,
              runtime: '00:00:01',
              state: 'Success',
              tool: 'iEDA',
            },
            {
              name: 'macroPlacement',
              peakMemory: 96,
              runtime: '',
              state: 'Ongoing',
              tool: 'iEDA',
            },
            {
              name: 'postFloorplan',
              peakMemory: 0,
              runtime: '',
              state: 'Unstart',
              tool: 'iEDA',
            },
            {
              name: 'place',
              peakMemory: 0,
              runtime: '',
              state: 'Unstart',
              tool: 'dreamplace',
            },
            {
              name: 'future-step',
              peakMemory: 0,
              runtime: '',
              state: 'Incomplete',
              tool: 'custom',
            },
          ],
        },
        kind: 'flow',
        operationId: 'operation-1',
        projectWorkspaceId: 'ws_0001',
        rerun: false,
        state: 'running',
        step: 'Floor',
        updatedAt: 2,
        workspaceRevision: 1,
      },
    ])

    expect(projected).not.toBe(committed)
    expect(projected).toEqual({
      ws_0001: { Synth: 'success', Floor: 'running', Place: 'unstart' },
      ws_0002: { Synth: 'success' },
    })
    expect(committed.ws_0001).toEqual({
      Synth: 'success',
      Floor: 'success',
      Place: 'success',
    })
  })

  it('returns committed flow state unchanged without a runtime flow snapshot', () => {
    const committed = { ws_0001: { Synth: 'success' as const } }
    expect(
      projectWorkspaceFlowStatesWithRuntime(committed, [
        {
          cancelRequested: false,
          engineeringWorkspaceId: '/projects/gcd/ws_0001',
          kind: 'flow',
          operationId: 'operation-1',
          projectWorkspaceId: 'ws_0001',
          rerun: false,
          state: 'queued',
          step: null,
          updatedAt: 2,
          workspaceRevision: 1,
        },
      ]),
    ).toBe(committed)
  })

  it('uses the refreshed comparison flow state after a runtime operation ends', () => {
    const fallback = { ws_0001: { Synth: 'unstart' as const } }
    const comparison: BackendProjectComparison = {
      identity: { designName: 'gcd', projectId: 'gcd', projectName: 'gcd' },
      refresh: { automatic: 'available' },
      recommendation: { issues: [], status: 'unavailable' },
      risks: { issues: [], status: 'unavailable' },
      stepComparisons: { issues: [], status: 'unavailable' },
      timingTriage: { issues: [], status: 'unavailable' },
      trend: { issues: [], status: 'unavailable' },
      workspaceSnapshots: {
        data: { flowStates: { ws_0001: { Synth: 'success' } }, items: [] },
        issues: [{ code: 'OPTIONAL_QOR_MISSING' }],
        status: 'partial',
      },
    }

    expect(projectComparisonWorkspaceFlowStates(comparison, fallback)).toEqual({
      ws_0001: { Synth: 'success' },
    })
  })
})
