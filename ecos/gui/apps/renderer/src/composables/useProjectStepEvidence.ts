import { computed, type Ref } from 'vue'
import { parseProjectManifestFlowStep } from '@ecos-studio/shared'
import type { ProjectStepFindingsProjectionState } from '@/stores/backendProjectComparisonSession'
import type { ProjectWorkspaceSummary } from '@/utils/projectManagement'
import { pendingProjectStep } from '@/utils/projectResultPresentation'
import {
  buildStepIssues,
  buildStepVerdict,
  type StepVerdict,
} from '@/components/projectStepAnalysis'

interface EvidenceProps {
  workspaceSummaries: ProjectWorkspaceSummary[]
  selectedWorkspaceId: string
  selectedStep: string
  findings?: ProjectStepFindingsProjectionState
}

export function useProjectStepEvidence(
  props: EvidenceProps,
  mode: Ref<'findings' | 'compare'>,
) {
  const currentWorkspace = computed(
    () =>
      props.workspaceSummaries.find(
        (summary) => summary.workspaceId === props.selectedWorkspaceId,
      ) ??
      props.workspaceSummaries[0] ??
      null,
  )
  const findings = computed(() => {
    const value = props.findings
    if (!value) return undefined
    const identity = value.data ?? ('projectWorkspaceId' in value ? value : null)
    return identity &&
      (identity.projectWorkspaceId !== currentWorkspace.value?.workspaceId ||
        identity.step !== props.selectedStep)
      ? undefined
      : value
  })
  const data = computed(() => findings.value?.data ?? null)
  const readOnly = computed(
    () => mode.value === 'findings' && data.value?.resultState === 'stale',
  )
  const pending = computed(() =>
    pendingProjectStep(currentWorkspace.value, props.selectedStep),
  )
  const activeWorkspace = computed(() => {
    const workspace = currentWorkspace.value
    if (!workspace || !props.findings || mode.value === 'compare') return workspace
    const step = parseProjectManifestFlowStep(props.selectedStep)
    if (!step) return workspace
    const steps = { ...workspace.analysis.steps }
    if (data.value) steps[step] = data.value.details
    else delete steps[step]
    return { ...workspace, analysis: { ...workspace.analysis, steps } }
  })
  const emptyMessage = computed(() => {
    if (mode.value === 'compare') {
      return pending.value
        ? `Configuration updated. ${props.selectedStep} is awaiting a rerun.`
        : null
    }
    if (data.value?.resultState === 'pending-rerun') {
      return `Configuration updated. ${props.selectedStep} is awaiting a rerun.`
    }
    if (data.value?.resultState === 'not-started')
      return `${props.selectedStep} has not run for this configuration.`
    if (findings.value?.status === 'error') return 'Findings could not be read.'
    return null
  })
  const notice = computed(() => {
    if (mode.value === 'compare')
      return pending.value
        ? {
            icon: 'ri-history-line',
            tone: 'stale',
            label: `Configuration updated to Revision ${currentWorkspace.value?.analysis.resultState?.workspaceRevision}. ${props.selectedStep} needs a rerun; previous results are excluded from comparison.`,
          }
        : null
    const value = findings.value
    if (!value) return null
    if (value.status === 'error')
      return {
        icon: 'ri-error-warning-line',
        tone: 'error',
        label: `Findings unavailable · ${findingsIssueLabel(value.issue.code)}`,
      }
    const previous = readOnly.value
      ? `Configuration updated to Revision ${data.value?.currentWorkspaceRevision}. Showing read-only results from Revision ${data.value?.workspaceRevision}.`
      : null
    if (value.status === 'stale')
      return {
        icon: 'ri-history-line',
        tone: 'stale',
        label: `${previous ?? 'Last committed'} · ${findingsIssueLabel(value.issue.code)}`,
      }
    if (previous) return { icon: 'ri-history-line', tone: 'stale', label: previous }
    if (emptyMessage.value)
      return { icon: 'ri-time-line', tone: 'loading', label: emptyMessage.value }
    return value.status === 'ready'
      ? null
      : { icon: 'ri-loader-4-line', tone: 'loading', label: 'Loading findings' }
  })
  const verdict = computed<StepVerdict>(() => {
    if (emptyMessage.value)
      return {
        status: 'no_data',
        label:
          mode.value === 'findings' && findings.value?.status === 'error'
            ? 'Unavailable'
            : pending.value
              ? 'Needs rerun'
              : 'Not run',
        summary: emptyMessage.value,
        facts: [],
      }
    const result = buildStepVerdict(
      activeWorkspace.value,
      props.selectedStep,
      buildStepIssues(activeWorkspace.value, props.selectedStep),
    )
    return readOnly.value
      ? {
          ...result,
          label: 'Previous result',
          facts: result.facts.map((fact) =>
            fact.label === 'Flow' ? { ...fact, label: 'Previous flow' } : fact,
          ),
        }
      : result
  })
  return { activeWorkspace, emptyMessage, notice, readOnly, verdict }
}

function findingsIssueLabel(code: string): string {
  if (code === 'ARTIFACT_REFERENCE_MISSING') return 'artifact missing'
  if (code === 'ARTIFACT_REFERENCE_OUTSIDE_WORKSPACE') return 'unsafe artifact reference'
  if (code === 'FINDINGS_ARTIFACT_TOO_LARGE') return 'artifact too large'
  if (code === 'FINDINGS_ARTIFACT_INVALID_JSON') return 'invalid artifact JSON'
  if (code === 'FINDINGS_SNAPSHOT_REVISION_CHANGED') return 'snapshot changed'
  if (code === 'ARTIFACT_REVISION_MISMATCH') return 'artifact revision changed'
  if (code === 'FINDINGS_STEP_UNAVAILABLE') return 'step results unavailable'
  if (code === 'FINDINGS_WORKSPACE_UNAVAILABLE') return 'workspace results unavailable'
  return 'read failed'
}
