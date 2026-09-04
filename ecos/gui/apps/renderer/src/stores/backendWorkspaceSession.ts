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

interface BackendWorkspaceSessionStartOptions {
  forceRefresh?: boolean
}

function queryIssue(error: unknown): ReadIssue {
  return {
    code: 'BACKEND_WORKSPACE_QUERY_FAILED',
    detail: error instanceof Error ? error.message : String(error),
  }
}

export const useBackendWorkspaceSession = defineStore('backendWorkspaceSession', () => {
  const committedByWorkspace = new Map<string, WorkspaceOverviewCore>()
  const projection = ref<QueryProjectionState<WorkspaceOverviewCore>>({
    data: null,
    status: 'idle',
  })
  const workspaceContextId = ref<string | null>(null)
  const generation = ref(-1)
  let requestSequence = 0
  let currentWorkspaceKey: string | null = null
  let unsubscribe: (() => void) | null = null
  let unregisterRenderTask: (() => void) | null = null

  function commit(result: BackendWorkspaceOverviewResult, sequence: number): void {
    if (sequence !== requestSequence) return
    workspaceContextId.value = result.workspaceContextId
    generation.value = result.generation
    projection.value = { data: result.overview, status: 'ready' }
    if (currentWorkspaceKey) cacheCommitted(currentWorkspaceKey, result.overview)
  }

  async function load(): Promise<void> {
    const sequence = ++requestSequence
    const committed = projection.value.data
    projection.value = committed
      ? { data: committed, status: 'refreshing' }
      : { data: null, status: 'loading' }
    try {
      commit(await getDesktopApi().backendWorkspace.getOverview(), sequence)
    } catch (error) {
      if (sequence !== requestSequence) return
      const issue = queryIssue(error)
      projection.value = committed
        ? { data: committed, issue, status: 'stale' }
        : { data: null, issue, status: 'error' }
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

  function start(
    workspacePath?: string,
    options: BackendWorkspaceSessionStartOptions = {},
  ): Promise<void> {
    const workspaceKey = normalizeWorkspaceKey(workspacePath)
    if (workspaceKey !== currentWorkspaceKey) {
      requestSequence += 1
      currentWorkspaceKey = workspaceKey
      workspaceContextId.value = null
      generation.value = -1
      const committed = workspaceKey ? committedByWorkspace.get(workspaceKey) : null
      if (workspaceKey && committed) {
        committedByWorkspace.delete(workspaceKey)
        committedByWorkspace.set(workspaceKey, committed)
      }
      projection.value = committed
        ? { data: committed, status: 'ready' }
        : { data: null, status: 'idle' }
    }
    unsubscribe ??= getDesktopApi().backendWorkspace.onInvalidated((event) => {
      if (
        event.workspaceContextId !== workspaceContextId.value ||
        event.generation > generation.value
      ) {
        void refresh()
      }
    })
    unregisterRenderTask ??= registerRuntimeStepRenderTask(async () => {
      await refresh()
    })
    return options.forceRefresh ? refresh() : load()
  }

  function clear(): void {
    requestSequence += 1
    currentWorkspaceKey = null
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

  function clearWorkspace(workspacePath: string): void {
    committedByWorkspace.delete(normalizeWorkspaceKey(workspacePath) ?? '')
  }

  function cacheCommitted(workspaceKey: string, overview: WorkspaceOverviewCore): void {
    committedByWorkspace.delete(workspaceKey)
    committedByWorkspace.set(workspaceKey, overview)
    while (committedByWorkspace.size > 8) {
      const oldest = committedByWorkspace.keys().next().value
      if (!oldest || oldest === currentWorkspaceKey) break
      committedByWorkspace.delete(oldest)
    }
  }

  return {
    clear,
    clearWorkspace,
    dispose,
    generation,
    load,
    projection,
    refresh,
    start,
    workspaceContextId,
  }
})

function normalizeWorkspaceKey(path?: string): string | null {
  if (!path) return null
  return path.replace(/\\/g, '/').replace(/\/+$/g, '') || null
}
