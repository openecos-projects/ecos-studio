import { computed } from 'vue'
import type { DashboardMetric, DashboardQorStep } from '@/components/home/dashboardData'
import { useBackendWorkspaceSession } from '@/stores/backendWorkspaceSession'

export function useDashboardOverview() {
  const session = useBackendWorkspaceSession()
  const overview = computed(() => session.projection.data)
  const configuration = computed(() => {
    const section = overview.value?.configuration
    return section?.status === 'ready' || section?.status === 'partial'
      ? section.data
      : null
  })
  const qor = computed(() => {
    const section = overview.value?.qor
    return section?.status === 'ready' || section?.status === 'partial'
      ? section.data
      : null
  })
  const keyMetrics = computed<DashboardMetric[]>(() => {
    const section = overview.value?.keyMetrics
    return section?.status === 'ready' || section?.status === 'partial'
      ? section.data.items
      : []
  })
  const qorSteps = computed<DashboardQorStep[]>(() =>
    (qor.value?.steps ?? []).map((step) => ({
      id: step.stepId,
      label: step.name,
      status: step.status,
      summaryMetricCount: step.summaryMetricCount,
    })),
  )

  return {
    keyMetrics,
    maxFanout: computed(() => configuration.value?.maxFanout ?? null),
    mpcConstraints: computed(() => configuration.value?.mpcConstraints ?? null),
    mpcDisplayName: computed(() => configuration.value?.mpcDisplayName ?? null),
    qorSteps,
  }
}
