import { describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({
  projection: {
    data: {
      baselineComparison: {
        status: 'unavailable' as const,
        issues: [{ code: 'WORKSPACE_BASELINE_UNAVAILABLE' }],
      },
      identity: {
        baselineWorkspaceId: 'ws-base',
        projectName: 'demo',
        workspaceId: 'ws-current',
        workspaceName: 'Current',
      },
      qor: {
        status: 'ready' as const,
        issues: [],
        data: {
          metrics: [],
          score: { gate: 'pass' as const, threshold: 60, value: 82 },
          steps: [],
        },
      },
    },
    status: 'ready' as const,
  },
  refresh: vi.fn(),
}))

vi.mock('@/stores/backendWorkspaceSession', () => ({
  useBackendWorkspaceSession: () => session,
}))

import { useBackendWorkspaceQor } from './useBackendWorkspaceQor'

describe('useBackendWorkspaceQor', () => {
  it('keeps current QoR visible when the selected baseline is unavailable', () => {
    const { state } = useBackendWorkspaceQor()

    expect(state.value).toMatchObject({
      status: 'current-only',
      comparison: {
        baselineWorkspaceId: 'ws-base',
        baselineScore: null,
        score: 82,
        workspaceId: 'ws-current',
      },
    })
  })
})
