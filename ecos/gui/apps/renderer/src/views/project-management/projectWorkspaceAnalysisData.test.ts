import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectManifest } from '@/utils/projectManagement'

const testState = vi.hoisted(() => ({
  readProjectManagementWorkspaceTexts: vi.fn(),
}))

vi.mock('@/utils/projectManagementRead', () => ({
  readProjectManagementWorkspaceTexts: testState.readProjectManagementWorkspaceTexts,
}))

import { readProjectManagementWorkspaceData } from './projectWorkspaceAnalysisData'

const manifest = {
  workspaces: [
    {
      workspace_id: 'ws_0001',
      workspace_path: '/projects/gcd/ws_0001',
    },
  ],
} as ProjectManifest

describe('readProjectManagementWorkspaceData', () => {
  beforeEach(() => {
    testState.readProjectManagementWorkspaceTexts.mockReset()
  })

  it('keeps available flow and QoR inputs when another optional artifact is unavailable', async () => {
    testState.readProjectManagementWorkspaceTexts.mockResolvedValue({
      texts: {
        'home/flow.json': '{"steps":[]}',
        'Synthesis_yosys/analysis/qor_metrics.json': '{"area":42}',
        'Synthesis_yosys/analysis/qor_summary.json': null,
      },
      unavailablePaths: ['Synthesis_yosys/analysis/qor_summary.json'],
    })

    const result = await readProjectManagementWorkspaceData('/projects/gcd', manifest)

    expect(testState.readProjectManagementWorkspaceTexts).toHaveBeenCalledWith(
      '/projects/gcd',
      '/projects/gcd/ws_0001',
      expect.arrayContaining([
        'home/flow.json',
        'Synthesis_yosys/analysis/qor_metrics.json',
        'Synthesis_yosys/analysis/qor_summary.json',
      ]),
    )
    expect(result.flowStates).toEqual({ ws_0001: {} })
    expect(result.analysisInputs.ws_0001?.stepMetricTexts?.Synth).toBe('{"area":42}')
    expect(result.analysisInputs.ws_0001?.stepSummaryTexts?.Synth).toBeNull()
  })
})
