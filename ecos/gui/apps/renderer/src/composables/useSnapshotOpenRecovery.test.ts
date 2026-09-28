import { beforeEach, describe, expect, it, vi } from 'vitest'

const { deleteEngineeringSnapshotMock } = vi.hoisted(() => ({
  deleteEngineeringSnapshotMock: vi.fn(),
}))

vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({
    workspace: { deleteEngineeringSnapshot: deleteEngineeringSnapshotMock },
  }),
}))

import { useSnapshotOpenRecovery } from './useSnapshotOpenRecovery'

describe('useSnapshotOpenRecovery', () => {
  beforeEach(() => {
    deleteEngineeringSnapshotMock.mockReset()
    useSnapshotOpenRecovery().dismissSnapshotOpenRecovery()
  })

  it('never deletes the snapshot for an identity mismatch request', async () => {
    const recovery = useSnapshotOpenRecovery()
    recovery.requestSnapshotOpenRecovery({
      code: 'snapshot_identity_mismatch',
      detail: 'Engineering Snapshot workspace identity mismatch',
      directory: '/work/copied',
      retry: vi.fn(),
    })

    await expect(recovery.rebuildSnapshotAndRetry()).resolves.toBe(false)
    expect(deleteEngineeringSnapshotMock).not.toHaveBeenCalled()
    expect(recovery.pendingRequest.value).not.toBeNull()
  })

  it('keeps a replacement request when the retry fails with the same policy code', async () => {
    const recovery = useSnapshotOpenRecovery()
    recovery.requestSnapshotOpenRecovery({
      code: 'snapshot_rebuild_required',
      detail: 'first failure',
      directory: '/work/demo',
      retry: async () => {
        // The retried open fails closed again and re-requests recovery.
        recovery.requestSnapshotOpenRecovery({
          code: 'snapshot_rebuild_required',
          detail: 'still corrupt',
          directory: '/work/demo',
          retry: vi.fn(),
        })
        return false
      },
    })
    deleteEngineeringSnapshotMock.mockResolvedValueOnce(true)

    await expect(recovery.rebuildSnapshotAndRetry()).resolves.toBe(false)
    expect(recovery.pendingRequest.value?.detail).toBe('still corrupt')
  })

  it('clears the dialog when the retry fails without a new request', async () => {
    const recovery = useSnapshotOpenRecovery()
    recovery.requestSnapshotOpenRecovery({
      code: 'snapshot_rebuild_required',
      detail: 'first failure',
      directory: '/work/demo',
      retry: async () => false,
    })
    deleteEngineeringSnapshotMock.mockResolvedValueOnce(true)

    await expect(recovery.rebuildSnapshotAndRetry()).resolves.toBe(false)
    expect(recovery.pendingRequest.value).toBeNull()
  })

  it('does nothing without a pending request', async () => {
    const recovery = useSnapshotOpenRecovery()
    await expect(recovery.rebuildSnapshotAndRetry()).resolves.toBe(false)
    expect(deleteEngineeringSnapshotMock).not.toHaveBeenCalled()
  })
})
