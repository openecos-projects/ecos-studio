import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InfoEnum } from './type'

const { getInfoApi, resolveWorkspaceStepInfoApi } = vi.hoisted(() => ({
  getInfoApi: vi.fn(),
  resolveWorkspaceStepInfoApi: vi.fn(),
}))

vi.mock('./flow', () => ({ getInfoApi }))
vi.mock('./workspaceResources', () => ({ resolveWorkspaceStepInfoApi }))

describe('loadFrontendStepDetailApi', () => {
  beforeEach(() => {
    getInfoApi.mockReset()
    resolveWorkspaceStepInfoApi.mockReset()
  })

  it('uses a local completed-step snapshot without waiting for RPC', async () => {
    const snapshot = {
      artifacts: [],
      logs: [],
      reports: [],
      state: 'Success',
      step: 'review',
      summary: { status: 'Success' },
    }
    resolveWorkspaceStepInfoApi.mockResolvedValue({
      response: 'available',
      info: snapshot,
    })
    const { loadFrontendStepDetailApi } = await import('./frontendDetail')

    await expect(
      loadFrontendStepDetailApi({
        allowRpcFallback: false,
        designTool: 'frontend',
        directory: '/work/demo',
        step: 'review',
        workspaceHandle: 'workspace-demo',
      }),
    ).resolves.toEqual(snapshot)
    expect(resolveWorkspaceStepInfoApi).toHaveBeenCalledWith({
      step: 'review',
      id: InfoEnum.frontend_detail,
    })
    expect(getInfoApi).not.toHaveBeenCalled()
  })

  it('does not enqueue a detail RPC while the full flow is active', async () => {
    resolveWorkspaceStepInfoApi.mockResolvedValue({
      response: 'available',
      info: { step: 'review' },
    })
    const { loadFrontendStepDetailApi } = await import('./frontendDetail')

    await expect(
      loadFrontendStepDetailApi({
        allowRpcFallback: false,
        designTool: 'frontend',
        directory: '/work/demo',
        step: 'review',
        workspaceHandle: 'workspace-demo',
      }),
    ).resolves.toBeNull()
    expect(getInfoApi).not.toHaveBeenCalled()
  })
})
