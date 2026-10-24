import { computed } from 'vue'
import { buildDrcRelatedMetrics } from '@/components/flow-insights/flowInsightsData'
import { useBackendWorkspaceSession } from '@/stores/backendWorkspaceSession'
import { buildSnapshotFlowInsights } from './snapshotFlowInsights'

export type { FlowInsightsData } from './snapshotFlowInsights'

export function useFlowInsights() {
  const session = useBackendWorkspaceSession()
  const data = computed(() => buildSnapshotFlowInsights(session.projection.data))

  return {
    data,
    stepResources: computed(() => data.value?.stepResources ?? null),
    dbTrends: computed(() => data.value?.dbTrends ?? null),
    instanceComposition: computed(() => data.value?.instanceComposition ?? null),
    drc: computed(() => data.value?.drc ?? null),
    drcRelated: computed(() => data.value?.drcRelated ?? buildDrcRelatedMetrics()),
    sta: computed(() => data.value?.sta ?? null),
    staCriticalPaths: computed(() => data.value?.staCriticalPaths ?? null),
    timingArtifacts: computed(() => data.value?.timingArtifacts ?? []),
    timingIssuesArtifact: computed(() => data.value?.timingIssuesArtifact ?? null),
    loading: computed(
      () =>
        session.projection.status === 'loading' ||
        session.projection.status === 'refreshing',
    ),
    error: computed(() =>
      session.projection.status === 'error' || session.projection.status === 'stale'
        ? (session.projection.issue.detail ?? session.projection.issue.code)
        : null,
    ),
    refresh: () => session.refresh(),
  }
}
