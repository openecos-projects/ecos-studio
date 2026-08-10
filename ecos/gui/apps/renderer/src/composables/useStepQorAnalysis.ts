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

export type StepQorAnalysisKind = 'place' | 'route' | 'rcx' | 'sta'

export interface StepQorMetricOverview {
  id: string
  displayName: string
  value: number
  unit: string
  direction: 'higher_is_better' | 'lower_is_better' | 'target_range' | 'trend_only'
  role: 'primary' | 'secondary'
  source: StepQorFeatureSource
}

export type StepQorSummaryStatus =
  | 'pass'
  | 'blocked'
  | 'incomplete'
  | 'unavailable'
  | null

export interface StepQorFeatureSource {
  path: string
  selector: string
}

export interface StepQorDetailEvidence {
  id: string
  presentation: string
  source: StepQorFeatureSource
}

export interface StepQorAnalysisIntegrity {
  status: 'pass' | 'incomplete' | 'unavailable'
  invalidMetricSourceIds: string[]
  invalidDetailIds: string[]
}

interface StepQorAnalysisData {
  detail: Record<string, unknown> | null
  detailEvidence: StepQorDetailEvidence | null
  integrity: StepQorAnalysisIntegrity
  metrics: StepQorMetricOverview[]
}

const DETAIL_KEY_BY_STEP: Partial<Record<StepEnum, string>> = {
  [StepEnum.PLACEMENT]: 'place_map_metrics',
  [StepEnum.ROUTING]: 'route_layer_metrics',
  [StepEnum.RCX]: 'rcx_electrical_corner_metrics',
  [StepEnum.STA]: 'sta_path_group_metrics',
}

const KIND_BY_STEP: Partial<Record<StepEnum, StepQorAnalysisKind>> = {
  [StepEnum.PLACEMENT]: 'place',
  [StepEnum.ROUTING]: 'route',
  [StepEnum.RCX]: 'rcx',
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

function featureSource(value: unknown): StepQorFeatureSource | null {
  if (!isRecord(value) || stringValue(value.kind) !== 'feature') return null
  const path = stringValue(value.path)
  const selector = value.selector
  if (
    !path ||
    !path.startsWith('feature/') ||
    path.split('/').includes('..') ||
    typeof selector !== 'string' ||
    (selector !== '' && !selector.startsWith('/'))
  ) {
    return null
  }
  return { path, selector }
}

function detailData(
  metrics: unknown,
  requestedDetailKey: string | undefined,
): {
  detail: Record<string, unknown> | null
  evidence: StepQorDetailEvidence | null
  invalidDetailIds: string[]
} {
  if (!requestedDetailKey) {
    return { detail: null, evidence: null, invalidDetailIds: [] }
  }
  if (
    !isRecord(metrics) ||
    metrics.schema_version !== 3 ||
    !Array.isArray(metrics.details)
  ) {
    return { detail: null, evidence: null, invalidDetailIds: [] }
  }

  const detail = metrics.details.find(
    (item) => isRecord(item) && item.id === requestedDetailKey,
  )
  if (!isRecord(detail) || !isRecord(detail.summary)) {
    return { detail: null, evidence: null, invalidDetailIds: [] }
  }
  const source = featureSource(detail.feature_source)
  const presentation = stringValue(detail.presentation)
  if (!source || !presentation) {
    return {
      detail: null,
      evidence: null,
      invalidDetailIds: [requestedDetailKey],
    }
  }
  return {
    detail: detail.summary,
    evidence: { id: requestedDetailKey, presentation, source },
    invalidDetailIds: [],
  }
}

function metricOverview(metrics: unknown): {
  metrics: StepQorMetricOverview[]
  invalidMetricSourceIds: string[]
} {
  if (
    !isRecord(metrics) ||
    metrics.schema_version !== 3 ||
    !Array.isArray(metrics.metrics)
  ) {
    return { metrics: [], invalidMetricSourceIds: [] }
  }

  const invalidMetricSourceIds: string[] = []
  const overview = metrics.metrics
    .flatMap((item) => {
      if (!isRecord(item)) return []
      const id = stringValue(item.id)
      const source = featureSource(item.source)
      if (id && !source) {
        invalidMetricSourceIds.push(id)
        return []
      }
      const displayName = stringValue(item.display_name)
      const value = numberValue(item.value)
      const direction = metricDirection(item.direction)
      const role = item.step_role
      if (
        !id ||
        !displayName ||
        value === null ||
        !direction ||
        !source ||
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
          source,
        },
      ]
    })
    .sort((left, right) => {
      if (left.role !== right.role) return left.role === 'primary' ? -1 : 1
      return left.displayName.localeCompare(right.displayName)
    })
  return {
    metrics: overview,
    invalidMetricSourceIds: uniqueStrings(invalidMetricSourceIds),
  }
}

function analysisIntegrity(
  payload: unknown,
  invalidMetricSourceIds: string[],
  invalidDetailIds: string[],
): StepQorAnalysisIntegrity {
  const integrity =
    isRecord(payload) && isRecord(payload.integrity) ? payload.integrity : null
  const declaredMetricIds = stringArray(integrity?.invalid_metric_source_ids)
  const declaredDetailIds = stringArray(integrity?.invalid_detail_ids)
  const allMetricIds = uniqueStrings([...declaredMetricIds, ...invalidMetricSourceIds])
  const allDetailIds = uniqueStrings([...declaredDetailIds, ...invalidDetailIds])
  const declaredStatus = stringValue(integrity?.status)
  const status =
    allMetricIds.length || allDetailIds.length || declaredStatus === 'incomplete'
      ? 'incomplete'
      : declaredStatus === 'pass'
        ? 'pass'
        : 'unavailable'
  return {
    status,
    invalidMetricSourceIds: allMetricIds,
    invalidDetailIds: allDetailIds,
  }
}

function normalizeAnalysisData(
  payload: unknown,
  requestedDetailKey: string | undefined,
): StepQorAnalysisData {
  const overview = metricOverview(payload)
  const detail = detailData(payload, requestedDetailKey)
  return {
    detail: detail.detail,
    detailEvidence: detail.evidence,
    integrity: analysisIntegrity(
      payload,
      overview.invalidMetricSourceIds,
      detail.invalidDetailIds,
    ),
    metrics: overview.metrics,
  }
}

function summaryStatus(value: unknown): StepQorSummaryStatus {
  if (!isRecord(value) || value.schema_version !== 3) return null
  return value.status === 'pass' ||
    value.status === 'blocked' ||
    value.status === 'incomplete' ||
    value.status === 'unavailable'
    ? value.status
    : null
}

function summaryMissingMetrics(value: unknown): string[] {
  if (
    !isRecord(value) ||
    value.schema_version !== 3 ||
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? uniqueStrings(
        value.flatMap((item) => {
          const string = stringValue(item)
          return string ? [string] : []
        }),
      )
    : []
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values))
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
  const detailEvidence = ref<StepQorDetailEvidence | null>(null)
  const integrity = ref<StepQorAnalysisIntegrity>({
    status: 'unavailable',
    invalidMetricSourceIds: [],
    invalidDetailIds: [],
  })
  const metrics = ref<StepQorMetricOverview[]>([])
  const missingMetrics = ref<string[]>([])
  const qorStatus = ref<StepQorSummaryStatus>(null)
  const metricsPath = ref('')
  const messages = ref<string[]>([])
  const warnings = ref<string[]>([])
  let activeFetchToken: symbol | null = null

  const currentStep = computed(() => stepFromRoutePath(route.path))
  const detailKey = computed(() =>
    currentStep.value ? DETAIL_KEY_BY_STEP[currentStep.value] : undefined,
  )
  const kind = computed(() =>
    currentStep.value ? KIND_BY_STEP[currentStep.value] : undefined,
  )
  const isSupported = computed(() => Boolean(currentStep.value))
  const isEmpty = computed(
    () =>
      !loading.value &&
      !error.value &&
      !detail.value &&
      metrics.value.length === 0 &&
      integrity.value.status !== 'incomplete' &&
      warnings.value.length === 0,
  )

  function clear() {
    detail.value = null
    detailEvidence.value = null
    integrity.value = {
      status: 'unavailable',
      invalidMetricSourceIds: [],
      invalidDetailIds: [],
    }
    metrics.value = []
    missingMetrics.value = []
    qorStatus.value = null
    metricsPath.value = ''
    messages.value = []
    warnings.value = []
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

    if (!step) {
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
      const analysisData = normalizeAnalysisData(payload, requestedDetailKey)
      metricsPath.value = resolvedPath
      metrics.value = analysisData.metrics
      detail.value = analysisData.detail
      detailEvidence.value = analysisData.detailEvidence
      integrity.value = analysisData.integrity
      if (summaryRaw) {
        try {
          const summary = JSON.parse(summaryRaw) as unknown
          qorStatus.value = summaryStatus(summary)
          missingMetrics.value = summaryMissingMetrics(summary)
        } catch {
          warnings.value = ['QoR summary could not be parsed.']
        }
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

  // Same step after Agent rerun workspace switch must not keep the previous workspace cache.
  watch(
    () => currentProject.value?.path,
    (nextPath, previousPath) => {
      if (!nextPath || nextPath === previousPath) return
      void refetch()
    },
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
    detailEvidence,
    error,
    integrity,
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
    warnings,
  }
}
