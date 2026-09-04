import type { ProjectManifest, ProjectQorTrendSummary } from '@ecos-studio/shared'
import { describe, expect, it } from 'vitest'
import {
  buildProjectComparisonSteps,
  type ProjectComparisonInput,
} from './projectComparisonProjection'

describe('buildProjectComparisonSteps', () => {
  it('builds the ordered configured-step union with explicit absence states', () => {
    const workspace = (workspaceId: string, startStep: string, endStep: string) => ({
      workspace_id: workspaceId,
      start_step: startStep,
      end_step: endStep,
      branch_from: null,
    })
    const manifest = {
      workspaces: [
        workspace('ws-a', 'Synthesis', 'Place'),
        workspace('ws-b', 'Synth', 'CTS'),
        workspace('ws-c', 'Synth', 'Synth'),
      ],
    } as unknown as ProjectManifest
    const inputs = [
      { workspaceId: 'ws-a' },
      { workspaceId: 'ws-b' },
    ] as unknown as ProjectComparisonInput[]
    const trend = { workspaces: [] } as unknown as ProjectQorTrendSummary

    const result = buildProjectComparisonSteps(manifest, inputs, trend, {
      'ws-a': { Synthesis: 'success', Place: 'unstart', fixFanout: 'success' },
      'ws-b': { Synth: 'success', LEC: 'success', CTS: 'unstart' },
    })

    expect(result.map((step) => step.stepId)).toEqual(['Synth', 'LEC', 'Place', 'CTS'])
    expect(result.find((step) => step.stepId === 'LEC')?.workspaces).toEqual([
      { workspaceId: 'ws-a', status: 'not_applicable', metrics: [] },
      { workspaceId: 'ws-b', status: 'success', metrics: [] },
      { workspaceId: 'ws-c', status: 'unavailable', metrics: [] },
    ])
  })
})
