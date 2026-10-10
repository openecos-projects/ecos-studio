import { computed, shallowRef } from 'vue'
import type { ResourceStalenessItem } from '@ecos-studio/shared'

export interface ResourceStalenessConfirmationRequest {
  resources: ResourceStalenessItem[]
  runLabel: string
  /** Re-runs the exact run attempt that the guard blocked. */
  retry: (allowStale: boolean) => Promise<void>
}

interface PendingResourceStalenessRequest extends ResourceStalenessConfirmationRequest {
  token: number
}

const pendingRequest = shallowRef<PendingResourceStalenessRequest | null>(null)
let requestSequence = 0

/**
 * Shared state for the pre-run stale-resource dialog: when Electron main
 * refuses a flow run with RESOURCE_UPDATE_AVAILABLE, the runner converts the
 * error into a confirmation request here. A retry that trips the guard again
 * replaces the pending request; the token guards against clearing a newer
 * request when an older attempt settles.
 */
export function useResourceStalenessGuard() {
  function requestStalenessConfirmation(
    request: ResourceStalenessConfirmationRequest,
  ): void {
    requestSequence += 1
    pendingRequest.value = { ...request, token: requestSequence }
  }

  function dismiss(): void {
    pendingRequest.value = null
  }

  async function runAnyway(): Promise<void> {
    const request = pendingRequest.value
    if (!request) return
    await request.retry(true)
    if (pendingRequest.value?.token === request.token) pendingRequest.value = null
  }

  async function retryAfterUpdates(): Promise<void> {
    const request = pendingRequest.value
    if (!request) return
    await request.retry(false)
    if (pendingRequest.value?.token === request.token) pendingRequest.value = null
  }

  return {
    pendingRequest: computed(() => pendingRequest.value),
    dismiss,
    requestStalenessConfirmation,
    runAnyway,
    retryAfterUpdates,
  }
}
