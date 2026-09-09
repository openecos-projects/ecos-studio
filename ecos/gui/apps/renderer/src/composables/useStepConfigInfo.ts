import { computed, nextTick, ref, unref, watch, type Ref } from 'vue'
import { useRoute } from 'vue-router'
import { sameFlowStepName, StepEnum } from '@/api/type'
import {
  readWorkspaceStepConfigurationApi,
  updateWorkspaceStepConfigurationApi,
} from '@/api/workspace'
import { useWorkspace } from '@/composables/useWorkspace'
import { useWorkspaceLifecycle } from '@/composables/useWorkspaceLifecycle'
import { isFlowExecutionActiveForWorkspace } from './useFlowRunner'

const stepEnumValues = Object.values(StepEnum)
const FLOW_RUNNING_SAVE_BLOCKED_MESSAGE =
  'Flow is running. Configuration is read-only until the current run finishes.'

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

function parameterValues(records: unknown[]): Record<string, unknown> | null {
  const values: Record<string, unknown> = {}
  for (const record of records) {
    if (!isRecord(record) || typeof record.param !== 'string' || !('value' in record)) {
      return null
    }
    values[record.param] = record.value
  }
  return values
}

function parameterDescriptions(records: unknown[]): Record<string, string> {
  return Object.fromEntries(
    records.flatMap((record) => {
      if (
        !isRecord(record) ||
        typeof record.param !== 'string' ||
        typeof record.description !== 'string'
      ) {
        return []
      }
      return [[record.param, record.description]]
    }),
  )
}

export function useStepConfigInfo(stepOverride?: StepEnum | Ref<StepEnum | undefined>) {
  const route = useRoute()
  const { currentProject, showToast, workspaceSession } = useWorkspace()
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
  const stepConfigParameterDescriptions = ref<Record<string, string>>({})

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
        const session = workspaceSession.value
        if (!currentProject.value?.path) throw new Error('Workspace path is unavailable.')
        if (session.state !== 'active' || !session.workspaceId) {
          return null
        }
        return await readWorkspaceStepConfigurationApi({
          step: stepEnum,
          workspaceHandle: session.workspaceId,
        })
      })
      if (!canApply()) return
      if (!response) {
        info.value = null
        const waiting = ['validating', 'loading', 'switching'].includes(
          workspaceSession.value.state,
        )
        responseKind.value = waiting ? 'warning' : 'error'
        error.value = waiting ? null : 'Workspace Session is unavailable.'
        runtimeMessages.value = waiting ? ['Waiting for Workspace Session.'] : []
        clearFileState()
        lastLoadedStep = null
        return
      }
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
      const responseStep = response.stepId ?? response.step
      if (!sameFlowStepName(responseStep, stepEnum)) {
        responseKind.value = 'error'
        info.value = null
        error.value = 'Step configuration response belongs to another Flow Step.'
        clearFileState()
        return
      }
      const currentRevision = workspaceSession.value.workspaceRevision
      if (
        typeof response.workspaceRevision === 'number' &&
        typeof currentRevision === 'number' &&
        response.workspaceRevision !== currentRevision
      ) {
        responseKind.value = 'error'
        info.value = null
        error.value = 'Step configuration response belongs to another Workspace Revision.'
        clearFileState()
        return
      }
      if (response.status === 'available' && Array.isArray(response.parameters)) {
        const parameters = parameterValues(response.parameters)
        if (parameters === null) {
          responseKind.value = 'error'
          info.value = null
          error.value = 'Step configuration response is invalid.'
          clearFileState()
          return
        }
        stepConfigParameterDescriptions.value = parameterDescriptions(response.parameters)
        const payload = {
          parameters,
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
        responseKind.value = 'warning'
        runtimeMessages.value = [
          response.reason === 'step_configuration_unavailable'
            ? 'This Flow Step has no configurable parameters.'
            : `Step configuration unavailable: ${response.reason}`,
        ]
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
    stepConfigParameterDescriptions.value = {}
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
      stepConfigDraft.value = deepClone(parsed)
      stepConfigBaselineSig.value = stableJsonSig(parsed)
      initialEditorDraftPending = true
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
    if (!isRecord(data.parameters)) return
    const stepId = typeof data.stepId === 'string' ? data.stepId : currentStep.value
    stepConfigPathResolved.value = stepId ? `${stepId} parameters` : 'Step parameters'
    stepConfigRaw.value = JSON.stringify(data.parameters, null, 2)
    stepConfigReadError.value = null
  }

  watch(
    [
      currentStep,
      () => workspaceSession.value.sessionId,
      () => workspaceSession.value.state,
      () => workspaceSession.value.workspaceId,
    ],
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

  const stepConfigParameterCount = computed(() =>
    isRecord(stepConfigDraft.value) ? Object.keys(stepConfigDraft.value).length : 0,
  )

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

  function notifyStepConfigSaveFailure(detail: string): void {
    showToast({
      severity: 'error',
      summary: 'Failed to save parameters',
      detail,
      life: 6000,
    })
  }

  function setStepConfigSaveError(detail: string): void {
    stepConfigSaveError.value = detail
    notifyStepConfigSaveFailure(detail)
  }

  function blockStepConfigSaveWhileFlowRunning(): boolean {
    if (!isMutationLocked.value) return false
    setStepConfigSaveError(FLOW_RUNNING_SAVE_BLOCKED_MESSAGE)
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
      setStepConfigSaveError('No editable Step configuration is available')
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
        setStepConfigSaveError('Step configuration must be valid JSON')
        return false
      }
      if (draftBeforeSave === null) {
        setStepConfigSaveError('Nothing to save')
        return false
      }
      if (!isRecord(draftBeforeSave)) {
        setStepConfigSaveError('Step configuration must be an object')
        return false
      }
      const expectedWorkspaceRevision = workspaceLifecycle.session.value.workspaceRevision
      if (typeof expectedWorkspaceRevision !== 'number') {
        setStepConfigSaveError('Workspace Revision is unavailable')
        return false
      }
      const stepResult = await workspaceLifecycle.runForSession(sessionId, () =>
        updateWorkspaceStepConfigurationApi({
          commandId: crypto.randomUUID(),
          expectedWorkspaceRevision,
          parameters: draftBeforeSave,
          stepId: step,
          workspaceHandle: workspaceLifecycle.session.value.workspaceId,
        }),
      )
      if (
        !canApply() ||
        !stepResult ||
        !('workspaceRevision' in stepResult) ||
        typeof stepResult.workspaceRevision !== 'number'
      )
        return false
      const nextWorkspaceRevision = stepResult.workspaceRevision
      workspaceLifecycle.updateWorkspaceRevision(nextWorkspaceRevision, sessionId)
      workspaceRevision.value = nextWorkspaceRevision
      if (!canApply()) return false
      workspaceLifecycle.invalidate(['step-config', 'step', 'home'], {
        reason: 'step-config-save',
        sessionId,
        step,
      })
      stepConfigRaw.value = JSON.stringify(draftBeforeSave, null, 2)
      stepConfigBaselineSig.value = stableJsonSig(draftBeforeSave)
      return true
    } catch (e) {
      if (!canApply()) return false
      setStepConfigSaveError(e instanceof Error ? e.message : String(e))
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
    stepConfigParameterCount,
    stepConfigParameterDescriptions,
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
