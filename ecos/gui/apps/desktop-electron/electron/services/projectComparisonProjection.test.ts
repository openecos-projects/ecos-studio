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
  it('matches LEC metrics and states to their own anchors', () => {
    const manifest = { workspaces: [{ workspace_id: 'ws-a' }] } as ProjectManifest
    const inputs = [{ workspaceId: 'ws-a' }] as ProjectComparisonInput[]
    const synth = { step: 'LEC', scope: 'lec@synthesis_execution', value: 2 }
    const cts = { step: 'LEC', scope: 'lec@cts_execution', value: 3 }
    const trend = {
      workspaces: [{ workspaceId: 'ws-a', records: [synth, cts] }],
    } as unknown as ProjectQorTrendSummary

    const results = buildProjectComparisonSteps(manifest, inputs, trend, {
      'ws-a': { 'lec@synthesis': 'success', 'lec@cts': 'failed' },
    })
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepId: 'lec@synthesis',
          workspaces: [{ workspaceId: 'ws-a', status: 'success', metrics: [synth] }],
        }),
        expect.objectContaining({
          stepId: 'lec@cts',
          workspaces: [{ workspaceId: 'ws-a', status: 'failed', metrics: [cts] }],
        }),
      ]),
    )
  })
})
