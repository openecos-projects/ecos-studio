import { computed, ref, watch } from 'vue'
import type { WorkspaceResourceIndex } from '@ecos-studio/shared'
import { getWorkspaceResourceIndexApi } from '@/api/workspaceResources'
import {
  dashboardMetrics,
  metricsFromAnalysis,
  mpcConstraintsFromParameters,
  qorStepsFromIndex,
  qorSummaryStatus,
  type DashboardQorStep,
} from '@/components/home/dashboardData'
import { useWorkspace } from '@/composables/useWorkspace'
import { readOptionalProjectTextFile } from '@/utils/projectFiles'
import { resolveProjectPathAccess } from '@/utils/projectFs'

function siblingSummaryPath(metricsPath: string): string | null {
  return metricsPath.endsWith('/qor_metrics.json')
    ? `${metricsPath.slice(0, -'qor_metrics.json'.length)}qor_summary.json`
    : null
}

function metricsFromText(value: string | null): Map<string, number> {
  if (!value) return new Map()
  try {
    return metricsFromAnalysis(JSON.parse(value))
  } catch {
    return new Map()
  }
}

export function useDashboardOverview() {
  const { currentProject, resourceVersions } = useWorkspace()
  const index = ref<WorkspaceResourceIndex | null>(null)
  const qorSteps = ref<DashboardQorStep[]>([])
  const metricValues = ref(new Map<string, number>())
  const loading = ref(false)
  const error = ref<string | null>(null)
  let loadToken = 0

  const parameters = computed(() => index.value?.parameters ?? null)
  const mpcConstraints = computed(() => mpcConstraintsFromParameters(parameters.value))
  const keyMetrics = computed(() =>
    dashboardMetrics(parameters.value, metricValues.value),
  )

  async function load(): Promise<void> {
    const projectPath = currentProject.value?.path
    const token = ++loadToken
    if (!projectPath) {
      index.value = null
      qorSteps.value = []
      metricValues.value = new Map()
      error.value = null
      loading.value = false
      return
    }

    loading.value = true
    error.value = null
    try {
      const nextIndex = await getWorkspaceResourceIndexApi()
      if (token !== loadToken || currentProject.value?.path !== projectPath) return

      const nextSteps = qorStepsFromIndex(nextIndex)
      const metricGroups = await Promise.all(
        nextSteps.map(async (step) => {
          if (!step.metricsPath) return { metrics: new Map<string, number>(), step }
          const metricsPath = await resolveProjectPathAccess(step.metricsPath)
          if (!metricsPath) return { metrics: new Map<string, number>(), step }

          const [metricsRaw, summaryRaw] = await Promise.all([
            readOptionalProjectTextFile(metricsPath),
            (() => {
              const summaryPath = siblingSummaryPath(metricsPath)
              return summaryPath
                ? readOptionalProjectTextFile(summaryPath)
                : Promise.resolve(null)
            })(),
          ])
          const metrics = metricsFromText(metricsRaw)
          let status: DashboardQorStep['status'] = 'unavailable'
          if (summaryRaw) {
            try {
              status = qorSummaryStatus(JSON.parse(summaryRaw))
            } catch {
              status = 'incomplete'
            }
          }
          return { metrics, step: { ...step, status } }
        }),
      )
      if (token !== loadToken || currentProject.value?.path !== projectPath) return

      const nextMetricValues = new Map<string, number>()
      for (const group of metricGroups) {
        for (const [id, value] of group.metrics) nextMetricValues.set(id, value)
      }
      index.value = nextIndex
      qorSteps.value = metricGroups.map((group) => group.step)
      metricValues.value = nextMetricValues
    } catch (cause) {
      if (token !== loadToken || currentProject.value?.path !== projectPath) return
      error.value = cause instanceof Error ? cause.message : String(cause)
      index.value = null
      qorSteps.value = []
      metricValues.value = new Map()
    } finally {
      if (token === loadToken) loading.value = false
    }
  }

  watch(
    () => [
      currentProject.value?.path,
      resourceVersions.value.home,
      resourceVersions.value.parameters,
      resourceVersions.value.step,
      resourceVersions.value.all,
    ],
    () => {
      void load()
    },
    { immediate: true },
  )

  return {
    error,
    index,
    keyMetrics,
    loading,
    mpcConstraints,
    qorSteps,
    reload: load,
  }
}
