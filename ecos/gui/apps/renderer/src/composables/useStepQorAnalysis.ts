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

export function useStepQorAnalysis() {
  const route = useRoute()
  const { isDesktopRuntimeAvailable } = useDesktopRuntime()
  const { currentProject } = useWorkspace()
  const workspaceLifecycle = useWorkspaceLifecycle()

  const loading = ref(true)
  const error = ref<string | null>(null)
  const detail = ref<Record<string, unknown> | null>(null)
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
  const isEmpty = computed(() => !loading.value && !error.value && !detail.value)

  function clear() {
    detail.value = null
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
      const localPath = workspacePath ? convertRemoteToLocalPath(path, workspacePath) : path
      const resolvedPath = await workspaceLifecycle.runForSession(sessionId, () =>
        resolveProjectPathAccess(localPath),
      )
      if (!canApply() || !resolvedPath) return

      const raw = await workspaceLifecycle.runForSession(sessionId, () =>
        readProjectTextFile(resolvedPath),
      )
      if (!canApply() || raw === undefined) return

      const metrics = JSON.parse(raw) as unknown
      metricsPath.value = resolvedPath
      if (isRecord(metrics) && isRecord(metrics[requestedDetailKey])) {
        detail.value = metrics[requestedDetailKey]
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
    () => [workspaceLifecycle.resourceVersions.value.step, workspaceLifecycle.resourceVersions.value.all],
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
    messages,
    metricsPath,
    refetch,
  }
}
