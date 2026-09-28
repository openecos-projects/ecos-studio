import { ref, watch } from 'vue'
import { getDesktopApi } from '@/platform/desktop'
import { useBackendWorkspaceSession } from '@/stores/backendWorkspaceSession'

export type ChecklistEvidenceState =
  | { status: 'loading' }
  | { status: 'ready'; text: string }
  | { status: 'unavailable'; code: string }

export function checklistEvidenceLabel(code: string): string {
  if (code === 'ARTIFACT_REFERENCE_MISSING') {
    return 'Evidence is not available for this snapshot: the checklist artifact is not indexed or the file is missing.'
  }
  if (code === 'ARTIFACT_REFERENCE_OUTSIDE_WORKSPACE') {
    return 'Evidence unavailable: the checklist artifact reference is unsafe.'
  }
  if (code === 'ARTIFACT_TOO_LARGE')
    return 'Evidence unavailable: checklist.json is too large.'
  if (code === 'ARTIFACT_INVALID_JSON')
    return 'Evidence unavailable: checklist.json is not valid.'
  if (code === 'CHECKLIST_FINDING_NOT_FOUND') {
    return 'This finding is not present in the committed checklist.json.'
  }
  return 'Evidence could not be read.'
}

/**
 * Lazy checklist evidence for the Home findings dialog. The bounded checklist
 * projection renders the list; expanding a finding loads its original
 * checklist.json record through the backend artifact channel.
 */
export function useChecklistEvidence() {
  const session = useBackendWorkspaceSession()
  const expandedFindingId = ref<string | null>(null)
  const states = ref<Record<string, ChecklistEvidenceState>>({})
  let requestVersion = 0

  watch(
    () => session.generation,
    () => {
      requestVersion += 1
      expandedFindingId.value = null
      states.value = {}
    },
  )

  function evidenceState(findingId: string): ChecklistEvidenceState | null {
    return states.value[findingId] ?? null
  }

  async function toggleFinding(findingId: string): Promise<void> {
    if (expandedFindingId.value === findingId) {
      expandedFindingId.value = null
      return
    }
    expandedFindingId.value = findingId
    if (states.value[findingId]) return
    const version = ++requestVersion
    const contextId = session.workspaceContextId
    const revision = session.projection.data?.revision
    const workspaceRevision =
      revision && (revision.status === 'ready' || revision.status === 'partial')
        ? revision.data.workspaceRevision
        : null
    if (!contextId || workspaceRevision === null) {
      states.value = {
        ...states.value,
        [findingId]: { status: 'unavailable', code: 'WORKSPACE_REVISION_UNAVAILABLE' },
      }
      return
    }
    const generation = session.generation
    states.value = { ...states.value, [findingId]: { status: 'loading' } }
    try {
      const result = await getDesktopApi().backendWorkspace.getChecklistEvidence({
        findingId,
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
        result.evidence.status !== 'ready' ||
        result.evidence.data.findingId !== findingId
      ) {
        states.value = {
          ...states.value,
          [findingId]: {
            status: 'unavailable',
            code:
              result.evidence.status === 'ready'
                ? 'ARTIFACT_READ_FAILED'
                : (result.evidence.issues[0]?.code ?? 'ARTIFACT_READ_FAILED'),
          },
        }
        return
      }
      states.value = {
        ...states.value,
        [findingId]: {
          status: 'ready',
          text: JSON.stringify(result.evidence.data.item, null, 2),
        },
      }
    } catch {
      if (version !== requestVersion) return
      states.value = {
        ...states.value,
        [findingId]: { status: 'unavailable', code: 'ARTIFACT_READ_FAILED' },
      }
    }
  }

  return { expandedFindingId, evidenceState, toggleFinding }
}
