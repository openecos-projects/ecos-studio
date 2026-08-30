import type {
  BackendWorkspaceOverviewResult,
  ReadIssue,
  WorkspaceOverviewCore,
} from '@ecos-studio/shared'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getDesktopApi } from '@/platform/desktop'
import { registerRuntimeStepRenderTask } from '@/composables/runtimeStepRenderSync'

type QueryProjectionState<T> =
  | { status: 'idle'; data: null }
  | { status: 'loading'; data: null }
  | { status: 'ready'; data: T }
  | { status: 'refreshing'; data: T }
  | { status: 'stale'; data: T; issue: ReadIssue }
  | { status: 'error'; data: null; issue: ReadIssue }

function queryIssue(error: unknown): ReadIssue {
  return {
    code: 'BACKEND_WORKSPACE_QUERY_FAILED',
    detail: error instanceof Error ? error.message : String(error),
  }
}

export const useBackendWorkspaceSession = defineStore('backendWorkspaceSession', () => {
  const projection = ref<QueryProjectionState<WorkspaceOverviewCore>>({
    data: null,
    status: 'idle',
  })
  const workspaceContextId = ref<string | null>(null)
  const generation = ref(-1)
  let requestSequence = 0
  let unsubscribe: (() => void) | null = null
  let unregisterRenderTask: (() => void) | null = null

  function commit(result: BackendWorkspaceOverviewResult, sequence: number): void {
    if (sequence !== requestSequence) return
    workspaceContextId.value = result.workspaceContextId
    generation.value = result.generation
    projection.value = { data: result.overview, status: 'ready' }
  }

  async function load(): Promise<void> {
    const sequence = ++requestSequence
    projection.value = { data: null, status: 'loading' }
    try {
      commit(await getDesktopApi().backendWorkspace.getOverview(), sequence)
    } catch (error) {
      if (sequence !== requestSequence) return
      projection.value = { data: null, issue: queryIssue(error), status: 'error' }
    }
  }

  async function refresh(): Promise<void> {
    const sequence = ++requestSequence
    const committed = projection.value.data
    projection.value = committed
      ? { data: committed, status: 'refreshing' }
      : { data: null, status: 'loading' }
    try {
      commit(await getDesktopApi().backendWorkspace.refreshOverview(), sequence)
    } catch (error) {
      if (sequence !== requestSequence) return
      const issue = queryIssue(error)
      projection.value = committed
        ? { data: committed, issue, status: 'stale' }
        : { data: null, issue, status: 'error' }
    }
  }

  function start(): Promise<void> {
    unsubscribe ??= getDesktopApi().backendWorkspace.onInvalidated((event) => {
      if (
        event.workspaceContextId === workspaceContextId.value &&
        event.generation > generation.value
      ) {
        void refresh()
      }
    })
    unregisterRenderTask ??= registerRuntimeStepRenderTask(async () => {
      await refresh()
    })
    return load()
  }

  function clear(): void {
    requestSequence += 1
    workspaceContextId.value = null
    generation.value = -1
    projection.value = { data: null, status: 'idle' }
  }

  function dispose(): void {
    unsubscribe?.()
    unsubscribe = null
    unregisterRenderTask?.()
    unregisterRenderTask = null
    clear()
  }

  return {
    clear,
    dispose,
    generation,
    load,
    projection,
    refresh,
    start,
    workspaceContextId,
  }
})
