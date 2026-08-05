import { computed, ref, watch } from 'vue'
import {
  joinLocalPath,
  type WorkspaceResourceIndex,
  type WorkspaceStepResource,
} from '@ecos-studio/shared'
import { getWorkspaceResourceIndexApi } from '@/api/workspaceResources'
import {
  dashboardMetricSourceStepIndexes,
  dashboardMetrics,
  instanceMetricsFromDbFeature,
  maxFanoutFromParameters,
  metricsFromAnalysis,
  mpcDisplayNameFromParameters,
  mpcConstraintsFromParameters,
  qorSummaryCounts,
  qorStepsFromIndex,
  qorSummaryStatus,
  synthesisMetricsFromStat,
  timingMetricsFromQorSummary,
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

function mergeMetrics(
  groups: readonly ReadonlyMap<string, number>[],
): Map<string, number> {
  const merged = new Map<string, number>()
  for (const group of groups) {
    for (const [metricId, value] of group) merged.set(metricId, value)
  }
  return merged
}

async function readAuthorizedProjectTextFile(path: string): Promise<string | null> {
  const authorizedPath = await resolveProjectPathAccess(path)
  return authorizedPath ? await readOptionalProjectTextFile(authorizedPath) : null
}

async function synthesisDashboardMetrics(
  step: WorkspaceStepResource,
): Promise<Map<string, number>> {
  const statPath = step.resources.feature.stat
  if (!statPath?.exists) return new Map()

  const [statRaw, timingRaw] = await Promise.all([
    readAuthorizedProjectTextFile(statPath.path),
    readAuthorizedProjectTextFile(
      joinLocalPath(step.directory, 'feature/post_synthesis/qor_summary.json'),
    ),
  ])
  return mergeMetrics([
    metricsFromTextWith(statRaw, synthesisMetricsFromStat),
    metricsFromTextWith(timingRaw, timingMetricsFromQorSummary),
  ])
}

async function dbFeatureDashboardMetrics(
  step: WorkspaceStepResource,
): Promise<Map<string, number>> {
  const stepName = step.name.trim().toLowerCase()
  if (
    !['floorplan', 'fixfanout', 'place', 'cts', 'legalization', 'route'].includes(
      stepName,
    )
  ) {
    return new Map()
  }

  const dbPath = step.resources.feature.db
  if (!dbPath?.exists) return new Map()
  return metricsFromTextWith(
    await readAuthorizedProjectTextFile(dbPath.path),
    instanceMetricsFromDbFeature,
  )
}

function metricsFromTextWith(
  value: string | null,
  parse: (value: unknown) => Map<string, number>,
): Map<string, number> {
  if (!value) return new Map()
  try {
    return parse(JSON.parse(value))
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
  const maxFanout = computed(() => maxFanoutFromParameters(parameters.value))
  const mpcDisplayName = computed(() => mpcDisplayNameFromParameters(parameters.value))
  const mpcConstraints = computed(() => mpcConstraintsFromParameters(parameters.value))
  const keyMetrics = computed(() => dashboardMetrics(metricValues.value))

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
      const sourceIndexes = dashboardMetricSourceStepIndexes(nextIndex.flow.steps)
      const metricGroups = await Promise.all(
        nextSteps.map(async (step, index) => {
          const sourceStep = nextIndex.flow.steps[index]
          const dbMetrics =
            sourceIndexes.includes(index) && sourceStep
              ? dbFeatureDashboardMetrics(sourceStep)
              : Promise.resolve(new Map<string, number>())
          if (!step.metricsPath) {
            return { metrics: await dbMetrics, step }
          }
          const metricsPath = await resolveProjectPathAccess(step.metricsPath)
          if (!metricsPath) {
            return { metrics: await dbMetrics, step }
          }

          const [metricsRaw, summaryRaw, dbFeatureMetrics] = await Promise.all([
            readOptionalProjectTextFile(metricsPath),
            (() => {
              const summaryPath = siblingSummaryPath(metricsPath)
              return summaryPath
                ? readOptionalProjectTextFile(summaryPath)
                : Promise.resolve(null)
            })(),
            dbMetrics,
          ])
          const qorMetrics = metricsFromText(metricsRaw)
          const metrics = mergeMetrics([qorMetrics, dbFeatureMetrics])
          let status: DashboardQorStep['status'] = 'unavailable'
          if (summaryRaw) {
            try {
              const summary = JSON.parse(summaryRaw)
              status = qorSummaryStatus(summary)
              return {
                metrics,
                step: { ...step, ...qorSummaryCounts(summary), status },
              }
            } catch {
              status = 'incomplete'
            }
          }
          return { metrics, step: { ...step, status } }
        }),
      )
      if (token !== loadToken || currentProject.value?.path !== projectPath) return

      const latestSourceStep =
        sourceIndexes.length === 1 ? nextIndex.flow.steps[sourceIndexes[0]!] : null
      const nextMetricValues =
        latestSourceStep?.name.trim().toLowerCase() === 'synthesis'
          ? await synthesisDashboardMetrics(latestSourceStep)
          : mergeMetrics(
              sourceIndexes.flatMap((index) => {
                const group = metricGroups[index]
                return group ? [group.metrics] : []
              }),
            )
      if (token !== loadToken || currentProject.value?.path !== projectPath) return

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
    maxFanout,
    mpcDisplayName,
    mpcConstraints,
    qorSteps,
    reload: load,
  }
}
