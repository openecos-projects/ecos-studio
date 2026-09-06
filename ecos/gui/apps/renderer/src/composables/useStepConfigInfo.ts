import { computed, nextTick, ref, unref, watch, type Ref } from 'vue'
import { useRoute } from 'vue-router'
import { StepEnum } from '@/api/type'
import { updateWorkspaceStepConfigurationApi } from '@/api/workspace'
import { useWorkspace } from '@/composables/useWorkspace'
import { useWorkspaceLifecycle } from '@/composables/useWorkspaceLifecycle'
import { getDesktopApi } from '@/platform/desktop'
import { resolveProjectRouteContextForWorkspace } from '@/utils/projectManifestRegistration'
import { isFlowExecutionActiveForWorkspace } from './useFlowRunner'

const stepEnumValues = Object.values(StepEnum)
const FLOW_RUNNING_SAVE_BLOCKED_MESSAGE =
  'Flow is running. Configuration is read-only until the current run finishes.'
const ROUTE_STEP_BOTTOM_LAYER = 'MET2'
const ROUTE_STEP_TOP_LAYER = 'MET5'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getStepEnumFromPath(path: string): StepEnum | undefined {
  return stepEnumValues.find((step) => step.toLowerCase() === path.toLowerCase())
}

function prettyJsonOrRaw(text: string | null): string {
  if (text == null || text === '') return ''
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T
}

function sortKeysDeep(x: unknown): unknown {
  if (x === null || typeof x !== 'object') return x
  if (Array.isArray(x)) return x.map(sortKeysDeep)
  const o = x as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(o).sort()) {
    out[k] = sortKeysDeep(o[k])
  }
  return out
}

function stableJsonSig(v: unknown): string {
  try {
    return JSON.stringify(sortKeysDeep(v))
  } catch {
    return ''
  }
}

function pinRouteStepConfigRoutingLayers(
  value: unknown,
  step: StepEnum | undefined,
): unknown {
  if (step !== StepEnum.ROUTING || !isRecord(value)) return value

  const routeBlock = isRecord(value.RT) ? value.RT : value
  routeBlock['-bottom_routing_layer'] = ROUTE_STEP_BOTTOM_LAYER
  routeBlock['-top_routing_layer'] = ROUTE_STEP_TOP_LAYER
  return value
}

export function useStepConfigInfo(stepOverride?: StepEnum | Ref<StepEnum | undefined>) {
  const route = useRoute()
  const { currentProject } = useWorkspace()
  const workspaceLifecycle = useWorkspaceLifecycle()
  const { resourceVersions } = workspaceLifecycle

  /** Must be true before first watch; otherwise the UI can hit the "has data" branch with nothing rendered. */
  const loading = ref(true)
  const error = ref<string | null>(null)
  const info = ref<Record<string, unknown> | null>(null)
  const workspaceRevision = ref<number | null>(null)
  const runtimeMessages = ref<string[]>([])
  const responseKind = ref<'idle' | 'success' | 'warning' | 'failed' | 'error'>('idle')

  const stepConfigPathResolved = ref<string | null>(null)
  const stepConfigRaw = ref<string | null>(null)
  const stepConfigReadError = ref<string | null>(null)

  /** Editable draft (matches disk when JSON is valid; baseline updates after save). */
  const stepConfigDraft = ref<unknown | null>(null)
  const stepConfigBaselineSig = ref('')

  /** Text draft when JSON is invalid */
  const stepConfigTextDraft = ref('')
  const stepConfigTextBaseline = ref('')

  const isSavingStepConfig = ref(false)
  const activeStepConfigSave = ref<symbol | null>(null)
  const stepConfigSaveError = ref<string | null>(null)
  // Specialized editors add empty containers during their first render.
  let initialEditorDraftPending = false
  let stepConfigEditorMounted = false
  const isMutationLocked = computed(() =>
    isFlowExecutionActiveForWorkspace(currentProject.value?.path),
  )
  let activeRefetchToken: symbol | null = null
  let lastLoadedStep: StepEnum | null = null

  const currentStep = computed(() => {
    const explicitStep = unref(stepOverride)
    if (explicitStep) return explicitStep
    const pathParts = route.path.split('/')
    const segment = pathParts[pathParts.length - 1] || ''
    return getStepEnumFromPath(segment)
  })

  const hasFlowStep = computed(() => currentStep.value !== undefined)

  async function fetchStepConfiguration(): Promise<void> {
    const stepEnum = currentStep.value
    const sessionId = workspaceLifecycle.currentSessionId.value
    const refetchToken = Symbol('step-config-refetch')
    activeRefetchToken = refetchToken
    const isCurrent = () => workspaceLifecycle.isCurrentSession(sessionId)
    const isLatestRefetch = () => activeRefetchToken === refetchToken
    const canApply = () => isCurrent() && isLatestRefetch()
    if (!stepEnum) {
      info.value = null
      error.value = null
      workspaceRevision.value = null
      runtimeMessages.value = []
      responseKind.value = 'idle'
      clearFileState()
      lastLoadedStep = null
      loading.value = false
      return
    }

    loading.value = lastLoadedStep !== stepEnum
    error.value = null
    workspaceRevision.value = null
    runtimeMessages.value = []
    if (lastLoadedStep !== stepEnum) {
      clearFileState()
    }

    try {
      const response = await workspaceLifecycle.runForSession(sessionId, async () => {
        const workspacePath = currentProject.value?.path
        if (!workspacePath) throw new Error('Workspace path is unavailable.')
        const projectRoot =
          routeString(route.query.projectRoot) ??
          (await resolveProjectRouteContextForWorkspace(workspacePath))?.projectRoot
        if (!projectRoot) throw new Error('Project context is unavailable.')
        return await getProjectManagement().readWorkspaceStepConfiguration({
          projectRoot,
          step: stepEnum,
          workspacePath,
        })
      })
      if (!canApply() || !response) return
      if (
        (response.status === 'available' || response.status === 'missing') &&
        (typeof response.workspaceId !== 'string' ||
          typeof response.workspaceRevision !== 'number' ||
          !Number.isInteger(response.workspaceRevision) ||
          response.workspaceRevision < 1)
      ) {
        responseKind.value = 'error'
        info.value = null
        error.value = 'Step configuration response has no valid Workspace identity.'
        clearFileState()
        return
      }
      if (response.status === 'available' && isRecord(response.options)) {
        const payload = {
          options: response.options,
          stepId: response.stepId ?? response.step,
        }
        responseKind.value = 'success'
        workspaceRevision.value = response.workspaceRevision
        info.value = payload
        await loadStepConfigFileFromInfo(payload, sessionId, refetchToken)
        if (canApply()) {
          lastLoadedStep = stepEnum
        }
        return
      }

      if (response.status === 'missing' || response.status === 'unavailable') {
        info.value = {}
        responseKind.value = 'idle'
        workspaceRevision.value = response.workspaceRevision ?? null
        clearFileState()
        lastLoadedStep = stepEnum
        return
      }

      responseKind.value = 'error'
      info.value = null
      error.value = 'Failed to load step configuration'
      clearFileState()
    } catch (e) {
      if (!canApply()) return
      responseKind.value = 'error'
      info.value = null
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      if (isLatestRefetch()) {
        loading.value = false
      }
    }
  }

  function refetch(): Promise<void> {
    return fetchStepConfiguration()
  }

  function clearFileState() {
    stepConfigPathResolved.value = null
    stepConfigRaw.value = null
    stepConfigReadError.value = null
    stepConfigDraft.value = null
    stepConfigBaselineSig.value = ''
    stepConfigTextDraft.value = ''
    stepConfigTextBaseline.value = ''
    stepConfigSaveError.value = null
  }

  function rawLooksValidJson(raw: string): boolean {
    try {
      JSON.parse(raw)
      return true
    } catch {
      return false
    }
  }

  function syncDraftFromRaw(): void {
    const raw = stepConfigRaw.value
    stepConfigSaveError.value = null
    initialEditorDraftPending = false
    if (raw == null || raw === '') {
      stepConfigDraft.value = null
      stepConfigBaselineSig.value = ''
      stepConfigTextDraft.value = ''
      stepConfigTextBaseline.value = ''
      return
    }
    if (!rawLooksValidJson(raw)) {
      stepConfigDraft.value = null
      stepConfigBaselineSig.value = ''
      stepConfigTextDraft.value = raw
      stepConfigTextBaseline.value = raw
      return
    }
    try {
      const parsed = JSON.parse(raw) as unknown
      stepConfigDraft.value = pinRouteStepConfigRoutingLayers(
        deepClone(parsed),
        currentStep.value,
      )
      stepConfigBaselineSig.value = stableJsonSig(parsed)
      // Floorplan/placement/DRC forms materialize missing containers on mount. Let
      // that view-only initialization become the baseline, but keep routing's
      // enforced layer pinning dirty so it still requires an explicit save.
      initialEditorDraftPending = currentStep.value !== StepEnum.ROUTING
      if (stepConfigEditorMounted) {
        void nextTick(markStepConfigEditorInitialized)
      }
      stepConfigTextDraft.value = ''
      stepConfigTextBaseline.value = ''
    } catch {
      stepConfigDraft.value = null
      stepConfigBaselineSig.value = ''
    }
  }

  async function loadStepConfigFileFromInfo(
    data: Record<string, unknown>,
    _sessionId: string,
    _refetchToken: symbol,
  ) {
    if (!isRecord(data.options)) return
    const stepId = typeof data.stepId === 'string' ? data.stepId : currentStep.value
    stepConfigPathResolved.value = stepId ? `${stepId} options` : 'Step options'
    stepConfigRaw.value = JSON.stringify(data.options, null, 2)
    stepConfigReadError.value = null
  }

  watch(
    currentStep,
    () => {
      void refetch()
    },
    { immediate: true },
  )

  watch(
    () => resourceVersions.value['step-config'],
    () => {
      void refetch()
    },
  )

  /** Empty when there is no runtime payload and no loaded files (loading masks idle). */
  const isEmpty = computed(() => {
    if (responseKind.value === 'idle') return true
    if (responseKind.value === 'error' || responseKind.value === 'failed') return false
    if (stepConfigPathResolved.value || stepConfigRaw.value) return false
    if (info.value && Object.keys(info.value).length > 0) return false
    return responseKind.value === 'warning' || responseKind.value === 'success'
  })

  const stepConfigDisplay = computed(() => prettyJsonOrRaw(stepConfigRaw.value))

  /** Parsed step config file for structured UI; null if parse fails */
  const stepConfigParsed = computed((): unknown | null => {
    const raw = stepConfigRaw.value
    if (raw == null || raw === '') return null
    try {
      return JSON.parse(raw) as unknown
    } catch {
      return null
    }
  })

  const stepConfigJsonInvalid = computed(() => {
    const raw = stepConfigRaw.value
    if (raw == null || raw === '') return false
    try {
      JSON.parse(raw)
      return false
    } catch {
      return true
    }
  })

  watch(
    [() => stepConfigRaw.value, () => stepConfigReadError.value],
    () => {
      if (stepConfigReadError.value) {
        stepConfigDraft.value = null
        stepConfigBaselineSig.value = ''
        stepConfigTextDraft.value = ''
        stepConfigTextBaseline.value = ''
        stepConfigSaveError.value = null
        return
      }
      syncDraftFromRaw()
    },
    { immediate: true },
  )

  function markStepConfigEditorInitialized(): void {
    stepConfigEditorMounted = true
    if (!initialEditorDraftPending || stepConfigDraft.value === null) return
    stepConfigBaselineSig.value = stableJsonSig(stepConfigDraft.value)
    initialEditorDraftPending = false
  }

  const hasStepConfigChanges = computed(() => {
    const raw = stepConfigRaw.value
    if (raw == null || raw === '') return false
    if (stepConfigReadError.value) return false
    if (!rawLooksValidJson(raw)) {
      return stepConfigTextDraft.value !== stepConfigTextBaseline.value
    }
    if (stepConfigDraft.value === null) return false
    return stableJsonSig(stepConfigDraft.value) !== stepConfigBaselineSig.value
  })

  function blockStepConfigSaveWhileFlowRunning(): boolean {
    if (!isMutationLocked.value) return false
    stepConfigSaveError.value = FLOW_RUNNING_SAVE_BLOCKED_MESSAGE
    return true
  }

  async function saveStepConfig(): Promise<boolean> {
    stepConfigSaveError.value = null
    const sessionId = workspaceLifecycle.currentSessionId.value
    const step = currentStep.value
    const saveToken = Symbol('step-config-save')
    const isCurrentSave = () => activeStepConfigSave.value === saveToken
    const canApply = () =>
      workspaceLifecycle.isCurrentSession(sessionId) && isCurrentSave()
    const setSavingForToken = (value: boolean) => {
      if (activeStepConfigSave.value === saveToken) {
        isSavingStepConfig.value = value
        if (!value) activeStepConfigSave.value = null
      }
    }
    if (!stepConfigPathResolved.value || !step) {
      stepConfigSaveError.value = 'No editable Step configuration is available'
      return false
    }
    if (blockStepConfigSaveWhileFlowRunning()) {
      return false
    }
    const rawBeforeSave = stepConfigRaw.value
    const draftBeforeSave =
      stepConfigDraft.value === null ? null : deepClone(stepConfigDraft.value)
    activeStepConfigSave.value = saveToken
    isSavingStepConfig.value = true
    try {
      if (blockStepConfigSaveWhileFlowRunning()) {
        return false
      }
      if (!rawLooksValidJson(rawBeforeSave ?? '')) {
        stepConfigSaveError.value = 'Step configuration must be valid JSON'
        return false
      }
      if (draftBeforeSave === null) {
        stepConfigSaveError.value = 'Nothing to save'
        return false
      }
      const normalizedDraft = pinRouteStepConfigRoutingLayers(draftBeforeSave, step)
      if (!isRecord(normalizedDraft)) {
        stepConfigSaveError.value = 'Step configuration must be an object'
        return false
      }
      const expectedWorkspaceRevision = workspaceLifecycle.session.value.workspaceRevision
      if (typeof expectedWorkspaceRevision !== 'number') {
        stepConfigSaveError.value = 'Workspace Revision is unavailable'
        return false
      }
      const result = await workspaceLifecycle.runForSession(sessionId, () =>
        updateWorkspaceStepConfigurationApi({
          commandId: crypto.randomUUID(),
          expectedWorkspaceRevision,
          options: normalizedDraft,
          stepId: step,
          workspaceHandle: workspaceLifecycle.session.value.workspaceId,
        }),
      )
      if (
        !canApply() ||
        !result ||
        !('workspaceRevision' in result) ||
        typeof result.workspaceRevision !== 'number'
      )
        return false
      workspaceLifecycle.updateWorkspaceRevision(result.workspaceRevision, sessionId)
      workspaceRevision.value = result.workspaceRevision
      workspaceLifecycle.invalidate(['step-config', 'step', 'home'], {
        reason: 'step-config-save',
        sessionId,
        step,
      })
      stepConfigRaw.value = JSON.stringify(normalizedDraft, null, 2)
      stepConfigBaselineSig.value = stableJsonSig(normalizedDraft)
      return true
    } catch (e) {
      if (!canApply()) return false
      stepConfigSaveError.value = e instanceof Error ? e.message : String(e)
      return false
    } finally {
      setSavingForToken(false)
    }
  }

  function resetStepConfig(): void {
    stepConfigSaveError.value = null
    syncDraftFromRaw()
  }

  async function reloadStepConfigFiles(): Promise<void> {
    await refetch()
  }

  return {
    currentStep,
    hasFlowStep,
    loading,
    error,
    info,
    runtimeMessages,
    responseKind,
    isEmpty,
    refetch,
    stepConfigPathResolved,
    workspaceRevision,
    stepConfigRaw,
    stepConfigDisplay,
    stepConfigReadError,
    stepConfigParsed,
    stepConfigJsonInvalid,
    stepConfigDraft,
    stepConfigTextDraft,
    hasStepConfigChanges,
    isSavingStepConfig,
    stepConfigSaveError,
    isMutationLocked,
    markStepConfigEditorInitialized,
    saveStepConfig,
    resetStepConfig,
    reloadStepConfigFiles,
  }
}

function getProjectManagement() {
  const api = getDesktopApi().projectManagement
  if (!api)
    throw new Error('Project management reads are unavailable in this desktop build.')
  return api
}

function routeString(value: unknown): string | null {
  const routeValue = Array.isArray(value) ? value[0] : value
  return typeof routeValue === 'string' && routeValue.trim() ? routeValue : null
}
