import { computed, shallowRef } from 'vue'
import {
  SNAPSHOT_REBUILD_REQUIRED,
  type WorkspaceOpenSnapshotErrorCode,
} from '@ecos-studio/shared'
import { getDesktopApi } from '@/platform/desktop'

export interface SnapshotOpenRecoveryRequest {
  /** Stable ECC open-policy code (ADR-0009); drives the dialog copy. */
  code: WorkspaceOpenSnapshotErrorCode
  /** Human-readable explanation ECC sent alongside the stable code. */
  detail: string
  directory: string
  /** Re-runs the exact open attempt that failed. */
  retry: () => Promise<boolean>
}

interface PendingSnapshotOpenRecovery extends SnapshotOpenRecoveryRequest {
  token: number
}

const pendingRequest = shallowRef<PendingSnapshotOpenRecovery | null>(null)
let requestSequence = 0

/**
 * Shared state for the ADR-0009 open-policy dialog: a failed `workspace.open`
 * classified as `snapshot_rebuild_required` offers an explicit rebuild entry,
 * while `snapshot_identity_mismatch` only explains the refusal. Deleting the
 * committed snapshot is the deliberate user-confirmed rebuild path — ECC
 * rebuilds a missing snapshot transparently on the next open and never
 * overwrites an existing one.
 */
export function useSnapshotOpenRecovery() {
  function requestSnapshotOpenRecovery(request: SnapshotOpenRecoveryRequest): void {
    requestSequence += 1
    pendingRequest.value = { ...request, token: requestSequence }
  }

  function dismissSnapshotOpenRecovery(): void {
    pendingRequest.value = null
  }

  async function rebuildSnapshotAndRetry(): Promise<boolean> {
    const request = pendingRequest.value
    if (!request || request.code !== SNAPSHOT_REBUILD_REQUIRED) return false
    await getDesktopApi().workspace.deleteEngineeringSnapshot(request.directory)
    const opened = await request.retry()
    // A retry that fails with the same policy code replaces the pending
    // request; only clear the dialog when it still shows this attempt.
    if (pendingRequest.value?.token === request.token) pendingRequest.value = null
    return opened
  }

  return {
    pendingRequest: computed(() => pendingRequest.value),
    dismissSnapshotOpenRecovery,
    rebuildSnapshotAndRetry,
    requestSnapshotOpenRecovery,
  }
}
