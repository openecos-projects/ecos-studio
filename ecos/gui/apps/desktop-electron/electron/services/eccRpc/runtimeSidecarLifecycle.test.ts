import { describe, expect, it, vi } from 'vitest'
import { RuntimeSidecarLifecycle } from './runtimeSidecarLifecycle'

describe('RuntimeSidecarLifecycle', () => {
  it('retains a failed final snapshot and releases only after a successful retry', async () => {
    const captureFinalSnapshot = vi
      .fn()
      .mockRejectedValueOnce(new Error('snapshot damaged'))
      .mockResolvedValueOnce(undefined)
    const closeSidecar = vi.fn().mockResolvedValue(undefined)
    const lifecycle = new RuntimeSidecarLifecycle({
      captureFinalSnapshot,
      closeSidecar,
      emitError: vi.fn(),
      emitIdle: vi.fn(),
      hasActiveOperations: () => false,
    })

    lifecycle.finalizeOperation('workspace-1')
    await lifecycle.waitForFinalSnapshot()

    expect(lifecycle.finalization()).toEqual({
      issue: 'Failed to persist final ECC snapshot: snapshot damaged',
      state: 'snapshot-failed',
      workspaceId: 'workspace-1',
    })
    expect(closeSidecar).not.toHaveBeenCalled()

    await expect(lifecycle.retryFinalSnapshot()).resolves.toBe(true)
    expect(captureFinalSnapshot).toHaveBeenCalledTimes(2)
    expect(closeSidecar).toHaveBeenCalledOnce()
    expect(lifecycle.finalization()).toBeNull()
  })
})
