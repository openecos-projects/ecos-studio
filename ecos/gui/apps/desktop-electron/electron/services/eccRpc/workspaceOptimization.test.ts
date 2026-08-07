import type { DesktopAgentWorkspaceRerunContract } from '@ecos-studio/shared'
import { describe, expect, it, vi } from 'vitest'

import { executePlaceOptimization } from './workspaceOptimization'

function contract(id: string, density?: number): DesktopAgentWorkspaceRerunContract {
  return {
    design_id: 'gcd',
    end_step: 'place',
    execution_scope: 'single_step',
    parameter_patch:
      density === undefined ? [] : [{ knob_id: 'place.target_density', value: density }],
    requires_gui_review: true,
    rerun_id: id,
    schema_version: 'flow-agent.workspace_rerun_contract.v1',
    source_flow_json_sha256: 'a'.repeat(64),
    source_stage_artifact: 'place_dreamplace/output/gcd_place.def.gz',
    source_stage_artifact_sha256: 'b'.repeat(64),
    source_workspace: '/runs/gcd',
    target_step: 'place',
    target_workspace: `/runs/${id}`,
  }
}

describe('executePlaceOptimization', () => {
  it('runs all frozen candidates and selects only the best valid HPWL', async () => {
    const execute = vi.fn(async (item: DesktopAgentWorkspaceRerunContract) => {
      if (item.rerun_id === 'candidate_2') throw new Error('fixed RPC failed')
    })
    const result = await executePlaceOptimization(
      [
        contract('baseline'),
        contract('candidate_1', 0.7),
        contract('candidate_2', 0.6),
        contract('candidate_3', 0.5),
        contract('candidate_4', 0.4),
      ],
      {
        execute,
        prepare: async (item) => ({ directory: item.target_workspace }),
        readEvidence: async (directory) => ({
          artifactRefs: ['place_dreamplace/analysis/qor_metrics.json'],
          hpwl: directory.endsWith('baseline')
            ? 1
            : directory.endsWith('candidate_1')
              ? 10
              : 12,
          metrics: {
            place_hpwl: directory.endsWith('baseline')
              ? 1
              : directory.endsWith('candidate_1')
                ? 10
                : 12,
          },
        }),
      },
    )

    expect(execute).toHaveBeenCalledTimes(5)
    expect(result.evaluations.map((item) => item.status)).toEqual([
      'succeeded',
      'succeeded',
      'failed',
      'succeeded',
      'succeeded',
    ])
    expect(result.bestCandidateId).toBe('candidate_1')
  })

  it('rejects an unfrozen or non-place contract before any execution', async () => {
    const execute = vi.fn()
    await expect(
      executePlaceOptimization(
        [
          {
            ...contract('baseline'),
            requires_gui_review: false,
          } as unknown as DesktopAgentWorkspaceRerunContract,
          contract('candidate_1', 0.7),
          contract('candidate_2', 0.6),
          contract('candidate_3', 0.5),
          contract('candidate_4', 0.4),
        ],
        {
          execute,
          prepare: async (item) => ({ directory: item.target_workspace }),
          readEvidence: async () => ({
            artifactRefs: [],
            hpwl: 1,
            metrics: { place_hpwl: 1 },
          }),
        },
      ),
    ).rejects.toThrow('frozen place-only')
    expect(execute).not.toHaveBeenCalled()
  })
})
