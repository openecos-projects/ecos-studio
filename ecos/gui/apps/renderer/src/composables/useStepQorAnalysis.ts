import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { InfoEnum, StepEnum } from '@/api/type'
import { resolveWorkspaceStepInfoApi } from '@/api/workspaceResources'
import { useDesktopRuntime } from '@/composables/useDesktopRuntime'
import { convertRemoteToLocalPath } from '@/composables/useHomeData'
import { useWorkspace } from '@/composables/useWorkspace'
import { useWorkspaceLifecycle } from '@/composables/useWorkspaceLifecycle'
import { readProjectTextFile } from '@/utils/projectFiles'
import { resolveProjectPathAccess } from '@/utils/projectFs'

export type StepQorAnalysisKind = 'place' | 'route' | 'sta'

export interface StepQorMetricOverview {
  id: string
  displayName: string
  value: number
  unit: string
  direction: 'higher_is_better' | 'lower_is_better' | 'target_range' | 'trend_only'
  role: 'primary' | 'secondary'
}

export type StepQorSummaryStatus = 'pass' | 'blocked' | 'incomplete' | null

const DETAIL_KEY_BY_STEP: Partial<Record<StepEnum, string>> = {
  [StepEnum.PLACEMENT]: 'place_map_metrics',
  [StepEnum.ROUTING]: 'route_layer_metrics',
  [StepEnum.STA]: 'sta_path_group_metrics',
}

const KIND_BY_STEP: Partial<Record<StepEnum, StepQorAnalysisKind>> = {
  [StepEnum.PLACEMENT]: 'place',
  [StepEnum.ROUTING]: 'route',
  [StepEnum.STA]: 'sta',
}

const stepEnumValues = Object.values(StepEnum)

function stepFromRoutePath(path: string): StepEnum | undefined {
  const segment = path.split('/').pop() || ''
  return stepEnumValues.find((step) => step.toLowerCase() === segment.toLowerCase())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function detailSummary(
  metrics: unknown,
  requestedDetailKey: string,
): Record<string, unknown> | null {
  if (
    !isRecord(metrics) ||
    metrics.schema_version !== 2 ||
    !Array.isArray(metrics.details)
  ) {
    return null
  }

  const detail = metrics.details.find(
    (item) => isRecord(item) && item.id === requestedDetailKey,
  )
  return isRecord(detail) && isRecord(detail.summary) ? detail.summary : null
}

function metricOverview(metrics: unknown): StepQorMetricOverview[] {
  if (
    !isRecord(metrics) ||
    metrics.schema_version !== 2 ||
    !Array.isArray(metrics.metrics)
  ) {
    return []
  }

  return metrics.metrics
    .flatMap((item) => {
      if (!isRecord(item)) return []
      const id = stringValue(item.id)
      const displayName = stringValue(item.display_name)
      const value = numberValue(item.value)
      const direction = metricDirection(item.direction)
      const role = item.step_role
      if (
        !id ||
        !displayName ||
        value === null ||
        !direction ||
        (role !== 'primary' && role !== 'secondary')
      ) {
        return []
      }
      return [
        {
          id,
          displayName,
          value,
          unit: stringValue(item.unit) ?? '',
          direction,
          role: role as StepQorMetricOverview['role'],
        },
      ]
    })
    .sort((left, right) => {
      if (left.role !== right.role) return left.role === 'primary' ? -1 : 1
      return left.displayName.localeCompare(right.displayName)
    })
}

function summaryStatus(value: unknown): StepQorSummaryStatus {
  if (!isRecord(value) || value.schema_version !== 2) return null
  return value.status === 'pass' ||
    value.status === 'blocked' ||
    value.status === 'incomplete'
    ? value.status
    : null
}

function summaryMissingMetrics(value: unknown): string[] {
  if (
    !isRecord(value) ||
    value.schema_version !== 2 ||
    !Array.isArray(value.missing_metrics)
  ) {
    return []
  }
  return value.missing_metrics.flatMap((item) =>
    isRecord(item)
      ? [stringValue(item.metric_id)].filter((id): id is string => Boolean(id))
      : [],
  )
}

function siblingSummaryPath(metricsPath: string): string | null {
  return metricsPath.endsWith('/qor_metrics.json')
    ? `${metricsPath.slice(0, -'qor_metrics.json'.length)}qor_summary.json`
    : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function metricDirection(value: unknown): StepQorMetricOverview['direction'] | null {
  return value === 'higher_is_better' ||
    value === 'lower_is_better' ||
    value === 'target_range' ||
    value === 'trend_only'
    ? value
    : null
}

export function useStepQorAnalysis() {
  const route = useRoute()
  const { isDesktopRuntimeAvailable } = useDesktopRuntime()
  const { currentProject } = useWorkspace()
  const workspaceLifecycle = useWorkspaceLifecycle()

  const loading = ref(true)
  const error = ref<string | null>(null)
  const detail = ref<Record<string, unknown> | null>(null)
  const metrics = ref<StepQorMetricOverview[]>([])
  const missingMetrics = ref<string[]>([])
  const qorStatus = ref<StepQorSummaryStatus>(null)
  const metricsPath = ref('')
  const messages = ref<string[]>([])
  let activeFetchToken: symbol | null = null

  const currentStep = computed(() => stepFromRoutePath(route.path))
  const detailKey = computed(() =>
    currentStep.value ? DETAIL_KEY_BY_STEP[currentStep.value] : undefined,
  )
  const kind = computed(() =>
    currentStep.value ? KIND_BY_STEP[currentStep.value] : undefined,
  )
  const isSupported = computed(() => Boolean(detailKey.value && kind.value))
  const isEmpty = computed(
    () => !loading.value && !error.value && !detail.value && metrics.value.length === 0,
  )

  function clear() {
    detail.value = null
    metrics.value = []
    missingMetrics.value = []
    qorStatus.value = null
    metricsPath.value = ''
    messages.value = []
    error.value = null
  }

  async function refetch(): Promise<void> {
    const step = currentStep.value
    const requestedDetailKey = detailKey.value
    const sessionId = workspaceLifecycle.currentSessionId.value
    const fetchToken = Symbol('step-qor-analysis')
    activeFetchToken = fetchToken
    const canApply = () =>
      workspaceLifecycle.isCurrentSession(sessionId) && activeFetchToken === fetchToken

    if (!step || !requestedDetailKey) {
      clear()
      loading.value = false
      return
    }

    loading.value = true
    clear()
    try {
      const response = await workspaceLifecycle.runForSession(sessionId, () =>
        resolveWorkspaceStepInfoApi({ step, id: InfoEnum.analysis }),
      )
      if (!canApply() || !response) return

      messages.value = response.message ?? []
      const path = typeof response.info.metrics === 'string' ? response.info.metrics : ''
      if (!path) return
      if (!isDesktopRuntimeAvailable) {
        error.value = 'Reading step analysis requires the ECOS Studio desktop runtime.'
        return
      }

      const workspacePath = currentProject.value?.path
      const localPath = workspacePath
        ? convertRemoteToLocalPath(path, workspacePath)
        : path
      const resolvedPath = await workspaceLifecycle.runForSession(sessionId, () =>
        resolveProjectPathAccess(localPath),
      )
      if (!canApply() || !resolvedPath) return

      const summaryPath = siblingSummaryPath(resolvedPath)
      const analysisFiles = await workspaceLifecycle.runForSession(sessionId, () =>
        Promise.all([
          readProjectTextFile(resolvedPath),
          summaryPath ? readProjectTextFile(summaryPath) : Promise.resolve(undefined),
        ]),
      )
      if (!canApply() || !analysisFiles) return
      const [raw, summaryRaw] = analysisFiles
      if (!canApply() || raw === undefined) return

      const payload = JSON.parse(raw) as unknown
      metricsPath.value = resolvedPath
      metrics.value = metricOverview(payload)
      detail.value = detailSummary(payload, requestedDetailKey)
      if (summaryRaw) {
        const summary = JSON.parse(summaryRaw) as unknown
        qorStatus.value = summaryStatus(summary)
        missingMetrics.value = summaryMissingMetrics(summary)
      }
    } catch (cause) {
      if (!canApply()) return
      error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      if (canApply()) loading.value = false
    }
  }

  watch(
    () => route.path,
    () => {
      void refetch()
    },
    { immediate: true },
  )

  watch(
    () => [
      workspaceLifecycle.resourceVersions.value.step,
      workspaceLifecycle.resourceVersions.value.all,
    ],
    () => {
      void refetch()
    },
  )

  return {
    currentStep,
    detail,
    error,
    isEmpty,
    isSupported,
    kind,
    loading,
    metrics,
    messages,
    missingMetrics,
    metricsPath,
    qorStatus,
    refetch,
  }
}
