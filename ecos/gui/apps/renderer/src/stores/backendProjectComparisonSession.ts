import type {
  BackendProjectComparison,
  BackendProjectComparisonQueryResult,
  BackendProjectExecutionSnapshot,
  BackendProjectExecutionSnapshotResult,
  BackendProjectStepFindings,
  BackendProjectStepFindingsResult,
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

export type ProjectStepFindingsProjectionState =
  | { status: 'idle'; data: null }
  | { status: 'loading'; data: null; projectWorkspaceId: string; step: string }
  | { status: 'ready'; data: BackendProjectStepFindings }
  | { status: 'stale'; data: BackendProjectStepFindings; issue: ReadIssue }
  | {
      status: 'error'
      data: null
      issue: ReadIssue
      projectWorkspaceId: string
      step: string
    }

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
    const execution = ref<BackendProjectExecutionSnapshot>({ operations: [] })
    const executionGeneration = ref(-1)
    const findings = ref<ProjectStepFindingsProjectionState>({
      data: null,
      status: 'idle',
    })
    let requestSequence = 0
    let executionRequestSequence = 0
    let findingsRequestSequence = 0
    let unsubscribe: (() => void) | null = null
    let unsubscribeExecution: (() => void) | null = null

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
      execution.value = { operations: [] }
      executionGeneration.value = -1
      findings.value = { data: null, status: 'idle' }
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
        const comparison = await getDesktopApi().backendProjectComparison.getComparison({
          projectComparisonContextId: selected.projectComparisonContextId,
        })
        commit(comparison, sequence)
        if (sequence === requestSequence && comparison.ok) {
          await reloadExecution()
        }
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

    async function reload(explicit: boolean): Promise<void> {
      const contextId = projectComparisonContextId.value
      if (!contextId) return
      const sequence = ++requestSequence
      const committed = projection.value.data
      projection.value = committed
        ? { data: committed, status: 'refreshing' }
        : { data: null, status: 'loading' }
      try {
        const request = { projectComparisonContextId: contextId }
        const comparison = await (explicit
          ? getDesktopApi().backendProjectComparison.refreshComparison(request)
          : getDesktopApi().backendProjectComparison.getComparison(request))
        commit(comparison, sequence, committed)
        if (sequence === requestSequence && comparison.ok) await reloadExecution()
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

    function refresh(): Promise<void> {
      return reload(true)
    }

    async function loadStepFindings(
      projectWorkspaceId: string,
      step: string,
    ): Promise<void> {
      const contextId = projectComparisonContextId.value
      if (!contextId) return
      const sequence = ++findingsRequestSequence
      findings.value = { data: null, projectWorkspaceId, status: 'loading', step }
      try {
        const result = await getDesktopApi().backendProjectComparison.getStepFindings({
          projectComparisonContextId: contextId,
          projectWorkspaceId,
          step,
        })
        commitFindings(result, sequence, contextId, projectWorkspaceId, step)
      } catch (error) {
        if (sequence !== findingsRequestSequence) return
        findings.value = {
          data: null,
          issue: issue(
            'FINDINGS_READ_FAILED',
            error instanceof Error ? error.message : String(error),
          ),
          projectWorkspaceId,
          status: 'error',
          step,
        }
      }
    }

    function commitFindings(
      result: BackendProjectStepFindingsResult,
      sequence: number,
      contextId: string,
      projectWorkspaceId: string,
      step: string,
    ): void {
      if (
        sequence !== findingsRequestSequence ||
        contextId !== projectComparisonContextId.value
      ) {
        return
      }
      if (
        !result.ok ||
        result.generation !== generation.value ||
        result.projectComparisonContextId !== contextId ||
        result.data.projectWorkspaceId !== projectWorkspaceId ||
        result.data.step !== step
      ) {
        findings.value = {
          data: null,
          issue: issue(
            result.ok ? 'FINDINGS_SNAPSHOT_REVISION_CHANGED' : result.code,
            result.ok ? undefined : result.detail,
          ),
          projectWorkspaceId,
          status: 'error',
          step,
        }
        return
      }
      findings.value =
        result.freshness === 'last-committed'
          ? {
              data: result.data,
              issue: result.issue ?? issue('FINDINGS_READ_FAILED'),
              status: 'stale',
            }
          : { data: result.data, status: 'ready' }
    }

    function commitExecution(
      result: BackendProjectExecutionSnapshotResult,
      sequence: number,
    ): void {
      if (
        sequence !== executionRequestSequence ||
        !result.ok ||
        result.projectComparisonContextId !== projectComparisonContextId.value ||
        result.generation < executionGeneration.value
      ) {
        return
      }
      execution.value = result.data
      executionGeneration.value = result.generation
    }

    async function reloadExecution(): Promise<void> {
      const contextId = projectComparisonContextId.value
      if (!contextId) return
      const sequence = ++executionRequestSequence
      try {
        commitExecution(
          await getDesktopApi().backendProjectComparison.getExecutionSnapshot({
            projectComparisonContextId: contextId,
          }),
          sequence,
        )
      } catch {
        if (sequence === executionRequestSequence) execution.value = { operations: [] }
      }
    }

    function subscribe(): void {
      unsubscribe ??= getDesktopApi().backendProjectComparison.onInvalidated((event) => {
        if (
          event.projectComparisonContextId === projectComparisonContextId.value &&
          event.generation > generation.value
        ) {
          void reload(false)
        }
      })
      unsubscribeExecution ??=
        getDesktopApi().backendProjectComparison.onExecutionInvalidated((event) => {
          if (
            event.projectComparisonContextId === projectComparisonContextId.value &&
            event.generation > executionGeneration.value
          ) {
            void reloadExecution()
          }
        })
    }

    function clear(): void {
      requestSequence += 1
      executionRequestSequence += 1
      findingsRequestSequence += 1
      projectComparisonContextId.value = null
      generation.value = -1
      execution.value = { operations: [] }
      executionGeneration.value = -1
      findings.value = { data: null, status: 'idle' }
      projection.value = { data: null, status: 'idle' }
    }

    function dispose(): void {
      const contextId = projectComparisonContextId.value
      if (contextId) {
        void getDesktopApi()
          .backendProjectComparison.closeProject({
            projectComparisonContextId: contextId,
          })
          .catch(() => undefined)
      }
      unsubscribe?.()
      unsubscribe = null
      unsubscribeExecution?.()
      unsubscribeExecution = null
      clear()
    }

    return {
      clear,
      dispose,
      execution,
      executionGeneration,
      findings,
      generation,
      projectComparisonContextId,
      loadStepFindings,
      projection,
      refresh,
      selectProject,
    }
  },
)
