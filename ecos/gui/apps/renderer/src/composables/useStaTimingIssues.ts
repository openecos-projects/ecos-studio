import { ref, watch } from 'vue'
import type { WorkspaceArtifactDescriptor } from '@ecos-studio/shared'
import { getDesktopApi } from '@/platform/desktop'
import { useBackendWorkspaceSession } from '@/stores/backendWorkspaceSession'
import type { StaCriticalPath } from '@/components/flow-insights/flowInsightsData'

export type StaTimingIssuesState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; issues: StaCriticalPath[]; missingCorners: string[] }
  | { status: 'unavailable'; code: string }

export function staTimingIssuesLabel(code: string): string {
  if (code === 'ARTIFACT_REFERENCE_MISSING') {
    return 'The full timing issue list is not available for this snapshot: the STA timing issues artifact is not indexed or the file is missing.'
  }
  if (code === 'ARTIFACT_REFERENCE_OUTSIDE_WORKSPACE') {
    return 'Full timing issues unavailable: the artifact reference is unsafe.'
  }
  if (code === 'ARTIFACT_TOO_LARGE')
    return 'Full timing issues unavailable: the analysis file is too large.'
  if (code === 'ARTIFACT_INVALID_JSON')
    return 'Full timing issues unavailable: the analysis file is not valid.'
  return 'The full timing issue list could not be read.'
}

/**
 * Lazy full STA timing issue list for the flow-insights STA panel. The
 * bounded timingPreview projection renders the overview; opening the detail
 * dialog loads sta_timing_issues.json (with stage lists) through the backend
 * artifact channel.
 */
export function useStaTimingIssues() {
  const session = useBackendWorkspaceSession()
  const visible = ref(false)
  const state = ref<StaTimingIssuesState>({ status: 'idle' })
  let requestVersion = 0

  watch(
    () => session.generation,
    () => {
      requestVersion += 1
      visible.value = false
      state.value = { status: 'idle' }
    },
  )

  function close(): void {
    visible.value = false
  }

  async function open(artifact: WorkspaceArtifactDescriptor | null): Promise<void> {
    visible.value = true
    if (state.value.status === 'ready' || state.value.status === 'loading') return
    const version = ++requestVersion
    if (!artifact) {
      state.value = { status: 'unavailable', code: 'ARTIFACT_REFERENCE_MISSING' }
      return
    }
    const contextId = session.workspaceContextId
    const revision = session.projection.data?.revision
    const committedRevision =
      revision && (revision.status === 'ready' || revision.status === 'partial')
        ? revision.data.workspaceRevision
        : null
    const workspaceRevision = artifact.sourceRevision ?? committedRevision
    if (!contextId || workspaceRevision === null) {
      state.value = { status: 'unavailable', code: 'WORKSPACE_REVISION_UNAVAILABLE' }
      return
    }
    const generation = session.generation
    state.value = { status: 'loading' }
    try {
      const result = await getDesktopApi().backendWorkspace.getArtifact({
        artifactId: artifact.artifactId,
        workspaceContextId: contextId,
        workspaceRevision,
      })
      if (
        version !== requestVersion ||
        session.workspaceContextId !== contextId ||
        session.generation !== generation
      ) {
        return
      }
      if (
        result.artifact.status !== 'ready' ||
        result.artifact.data.artifactId !== artifact.artifactId ||
        !result.artifact.data.timingIssues
      ) {
        state.value = {
          status: 'unavailable',
          code:
            result.artifact.status === 'ready'
              ? 'ARTIFACT_INVALID_JSON'
              : (result.artifact.issues[0]?.code ?? 'ARTIFACT_READ_FAILED'),
        }
        return
      }
      const detail = result.artifact.data.timingIssues
      state.value = {
        status: 'ready',
        issues: detail.issues.map((issue) => ({
          id: issue.issueId,
          corner: issue.corner,
          analysisType: issue.analysisType,
          slackNs: issue.slackNs,
          stageCount: issue.stages.length,
          stages: issue.stages,
        })),
        missingCorners: detail.missingCorners,
      }
    } catch {
      if (version !== requestVersion) return
      state.value = { status: 'unavailable', code: 'ARTIFACT_READ_FAILED' }
    }
  }

  return { close, open, state, visible }
}
