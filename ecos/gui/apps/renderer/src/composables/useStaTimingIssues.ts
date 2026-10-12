import { onScopeDispose, ref, watch, type Ref } from 'vue'
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
export function useStaTimingIssues(
  artifactRef?: Readonly<Ref<WorkspaceArtifactDescriptor | null>>,
) {
  const session = useBackendWorkspaceSession()
  const visible = ref(false)
  const state = ref<StaTimingIssuesState>({ status: 'idle' })
  let requestVersion = 0
  let cachedArtifactKey = ''

  watch(
    () =>
      [
        session.generation,
        session.workspaceContextId,
        session.projection.data?.revision?.status === 'ready' ||
        session.projection.data?.revision?.status === 'partial'
          ? session.projection.data.revision.data.workspaceRevision
          : null,
        artifactRef?.value?.artifactId,
        artifactRef?.value?.sourceRevision,
        artifactRef?.value?.availability,
      ] as const,
    (current, previous) => {
      requestVersion += 1
      cachedArtifactKey = ''
      state.value = { status: 'idle' }
      if (current[0] !== previous[0] || current[1] !== previous[1]) {
        visible.value = false
      } else if (visible.value && artifactRef) {
        void open(artifactRef.value)
      }
    },
  )
  onScopeDispose(() => {
    requestVersion += 1
  })

  function close(): void {
    visible.value = false
  }

  async function open(artifact: WorkspaceArtifactDescriptor | null): Promise<void> {
    visible.value = true
    const artifactKey = JSON.stringify([artifact?.artifactId, artifact?.sourceRevision])
    if (
      cachedArtifactKey === artifactKey &&
      (state.value.status === 'ready' || state.value.status === 'loading')
    )
      return
    cachedArtifactKey = artifactKey
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
        result.workspaceContextId !== contextId ||
        result.workspaceRevision !== workspaceRevision ||
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
          startPoint: issue.startPoint,
          endPoint: issue.endPoint,
          pathGroup: issue.pathGroup,
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
