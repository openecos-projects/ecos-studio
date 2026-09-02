import {
  createProjectManifestDraft,
  registerWorkspaceInManifest,
} from '@ecos-studio/shared'
import { describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({
  readProjectManagementWorkspaceTexts: vi.fn(),
}))

vi.mock('@/utils/projectManagementRead', () => ({
  readProjectManagementWorkspaceTexts: testState.readProjectManagementWorkspaceTexts,
}))

import {
  FRONTEND_FLOW_STEPS,
  parseFrontendWorkspaceFlowStateMap,
  readFrontendProjectWorkspaceData,
} from './frontendProjectWorkspaceData'

describe('frontend project workspace data', () => {
  it('uses the ECC-FE flow order', () => {
    expect(FRONTEND_FLOW_STEPS).toEqual(['prepare', 'review', 'elab', 'lint', 'sim'])
  })

  it('normalizes ECC-FE flow states without accepting backend steps', () => {
    expect(
      parseFrontendWorkspaceFlowStateMap(
        JSON.stringify({
          steps: [
            { name: 'prepare', state: 'Success' },
            { name: 'review', state: 'Ongoing' },
            { name: 'elab', state: 'Pending' },
            { name: 'lint', state: 'Incomplete' },
            { name: 'sim', state: 'Invalid' },
            { name: 'Synthesis', state: 'Success' },
          ],
        }),
      ),
    ).toEqual({
      prepare: 'success',
      review: 'running',
      elab: 'running',
      lint: 'failed',
      sim: 'failed',
    })
  })

  it('reads bounded detail reports and flow state together', async () => {
    testState.readProjectManagementWorkspaceTexts.mockResolvedValue({
      texts: {
        'home/flow.json': JSON.stringify({
          steps: [
            { name: 'prepare', state: 'Success' },
            { name: 'review', state: 'Ongoing' },
          ],
        }),
        'prepare_fe/report/frontend_detail.json': '{"step":"prepare"}',
        'prepare_fe/analysis/qor_metrics.json': '{"schema_version":3}',
        'prepare_fe/analysis/qor_summary.json': '{"schema_version":4}',
        'prepare_fe/analysis/qor_hotspots.json': '{"schema_version":3}',
        'review_fe/report/frontend_detail.json': null,
      },
      unavailablePaths: [],
    })
    const manifest = registerWorkspaceInManifest(
      createProjectManifestDraft({
        rootPath: '/projects/cpu',
        name: 'cpu',
        designName: 'cpu',
        projectType: 'frontend',
      }),
      {
        projectRoot: '/projects/cpu',
        workspacePath: '/projects/cpu/ws_0001',
      },
    )

    await expect(
      readFrontendProjectWorkspaceData('/projects/cpu', manifest),
    ).resolves.toMatchObject({
      analysisInputs: {
        ws_0001: {
          frontendDetailTexts: {
            prepare: '{"step":"prepare"}',
            review: null,
          },
          frontendQorMetricTexts: {
            prepare: '{"schema_version":3}',
          },
          frontendQorSummaryTexts: {
            prepare: '{"schema_version":4}',
          },
          frontendQorHotspotTexts: {
            prepare: '{"schema_version":3}',
          },
        },
      },
      flowStates: {
        ws_0001: { prepare: 'success', review: 'running' },
      },
    })
    expect(testState.readProjectManagementWorkspaceTexts).toHaveBeenCalledWith(
      '/projects/cpu',
      '/projects/cpu/ws_0001',
      expect.arrayContaining([
        'home/flow.json',
        'prepare_fe/report/frontend_detail.json',
        'sim_verilator/report/frontend_detail.json',
        'prepare_fe/analysis/qor_metrics.json',
        'sim_verilator/analysis/qor_summary.json',
      ]),
    )
  })
})
