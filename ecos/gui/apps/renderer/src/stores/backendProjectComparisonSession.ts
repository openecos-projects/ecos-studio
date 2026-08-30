import type {
  BackendProjectComparison,
  BackendProjectComparisonQueryResult,
  ReadIssue,
} from '@ecos-studio/shared'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getDesktopApi } from '@/platform/desktop'

type QueryProjectionState<T> =
  | { status: 'idle'; data: null }
  | { status: 'loading'; data: null }
  | { status: 'ready'; data: T }
  | { status: 'refreshing'; data: T }
  | { status: 'stale'; data: T; issue: ReadIssue }
  | { status: 'error'; data: null; issue: ReadIssue }

function issue(code: string, detail?: string): ReadIssue {
  return { code, ...(detail ? { detail } : {}) }
}

export const useBackendProjectComparisonSession = defineStore(
  'backendProjectComparisonSession',
  () => {
    const projection = ref<QueryProjectionState<BackendProjectComparison>>({
      data: null,
      status: 'idle',
    })
    const projectComparisonContextId = ref<string | null>(null)
    const generation = ref(-1)
    let requestSequence = 0
    let unsubscribe: (() => void) | null = null

    function commit(
      result: BackendProjectComparisonQueryResult,
      sequence: number,
      staleData: BackendProjectComparison | null = null,
    ): void {
      if (sequence !== requestSequence) return
      if (!result.ok) {
        const queryIssue = issue(result.code, result.detail)
        projection.value = staleData
          ? { data: staleData, issue: queryIssue, status: 'stale' }
          : { data: null, issue: queryIssue, status: 'error' }
        return
      }
      projectComparisonContextId.value = result.projectComparisonContextId
      generation.value = result.generation
      projection.value = { data: result.data, status: 'ready' }
    }

    async function selectProject(projectRootLocator: string): Promise<void> {
      const sequence = ++requestSequence
      projectComparisonContextId.value = null
      generation.value = -1
      projection.value = { data: null, status: 'loading' }
      subscribe()
      try {
        const selected = await getDesktopApi().backendProjectComparison.selectProject({
          projectRootLocator,
        })
        if (sequence !== requestSequence) return
        if (!selected.ok) {
          projection.value = {
            data: null,
            issue: issue(selected.code, selected.detail),
            status: 'error',
          }
          return
        }
        projectComparisonContextId.value = selected.projectComparisonContextId
        generation.value = selected.generation
        commit(
          await getDesktopApi().backendProjectComparison.getComparison({
            projectComparisonContextId: selected.projectComparisonContextId,
          }),
          sequence,
        )
      } catch (error) {
        if (sequence !== requestSequence) return
        projection.value = {
          data: null,
          issue: issue(
            'BACKEND_PROJECT_COMPARISON_QUERY_FAILED',
            error instanceof Error ? error.message : String(error),
          ),
          status: 'error',
        }
      }
    }

    async function refresh(): Promise<void> {
      const contextId = projectComparisonContextId.value
      if (!contextId) return
      const sequence = ++requestSequence
      const committed = projection.value.data
      projection.value = committed
        ? { data: committed, status: 'refreshing' }
        : { data: null, status: 'loading' }
      try {
        commit(
          await getDesktopApi().backendProjectComparison.refreshComparison({
            projectComparisonContextId: contextId,
          }),
          sequence,
          committed,
        )
      } catch (error) {
        if (sequence !== requestSequence) return
        const queryIssue = issue(
          'BACKEND_PROJECT_COMPARISON_QUERY_FAILED',
          error instanceof Error ? error.message : String(error),
        )
        projection.value = committed
          ? { data: committed, issue: queryIssue, status: 'stale' }
          : { data: null, issue: queryIssue, status: 'error' }
      }
    }

    function subscribe(): void {
      unsubscribe ??= getDesktopApi().backendProjectComparison.onInvalidated((event) => {
        if (
          event.projectComparisonContextId === projectComparisonContextId.value &&
          event.generation > generation.value
        ) {
          void refresh()
        }
      })
    }

    function clear(): void {
      requestSequence += 1
      projectComparisonContextId.value = null
      generation.value = -1
      projection.value = { data: null, status: 'idle' }
    }

    function dispose(): void {
      unsubscribe?.()
      unsubscribe = null
      clear()
    }

    return {
      clear,
      dispose,
      generation,
      projectComparisonContextId,
      projection,
      refresh,
      selectProject,
    }
  },
)
