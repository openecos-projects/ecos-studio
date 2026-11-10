import { ref } from 'vue'

/**
 * Optimistic run request set when the user starts a flow and cleared once
 * runtime events take over. Cleared together with the runtime event buffer
 * (see `disconnectRuntimeEvents`): an optimistic cursor pointing into a
 * buffer that no longer exists must never resurrect a running step.
 */
export interface BackendOptimisticRun {
  projectPath: string
  resetAll: boolean
  runtimeEventCursor: unknown
  stepPath: string
}

const optimisticRun = ref<BackendOptimisticRun | null>(null)

export function setBackendOptimisticRun(request: BackendOptimisticRun | null): void {
  optimisticRun.value = request
}

export function clearBackendOptimisticRun(): void {
  optimisticRun.value = null
}

export function backendOptimisticRunValue(): BackendOptimisticRun | null {
  return optimisticRun.value
}
