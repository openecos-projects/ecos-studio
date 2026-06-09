import { ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { CMDEnum, InfoEnum, ResponseEnum, StepEnum } from '@/api/type'
import { syncConfigApi } from '@/api/flow'
import { resolveWorkspaceStepInfoApi } from '@/api/workspaceResources'
import { convertRemoteToLocalPath } from '@/composables/useHomeData'
import { readProjectTextFile, writeProjectTextFile } from '@/utils/projectFiles'
import { resolveProjectPathAccess } from '@/utils/projectFs'
import { useDesktopRuntime } from '@/composables/useDesktopRuntime'
import { useWorkspace } from '@/composables/useWorkspace'
import { useWorkspaceLifecycle } from '@/composables/useWorkspaceLifecycle'
import { isFlowExecutionActiveForWorkspace } from './useFlowRunner'

const stepEnumValues = Object.values(StepEnum)
const FLOW_RUNNING_SAVE_BLOCKED_MESSAGE =
  'Flow is running. Configuration is read-only until the current run finishes.'

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

function pickStepConfigPathFromInfo(data: Record<string, unknown>): string | undefined {
  const v = data.config
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function firstResponseMessage(response: { message?: string[] } | undefined, fallback: string): string {
  return response?.message?.[0] || fallback
}

export function useStepConfigInfo() {
  const route = useRoute()
  const { isDesktopRuntimeAvailable } = useDesktopRuntime()
  const { currentProject } = useWorkspace()
  const workspaceLifecycle = useWorkspaceLifecycle()
  const { resourceVersions } = workspaceLifecycle

  /** Must be true before first watch; otherwise the UI can hit the "has data" branch with nothing rendered. */
  const loading = ref(true)
  const error = ref<string | null>(null)
  const info = ref<Record<string, unknown> | null>(null)
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
  const isMutationLocked = computed(() => isFlowExecutionActiveForWorkspace(currentProject.value?.path))
  let activeRefetchToken: symbol | null = null
  let lastLoadedStep: StepEnum | null = null

  const currentStep = computed(() => {
    const pathParts = route.path.split('/')
    const segment = pathParts[pathParts.length - 1] || ''
    return getStepEnumFromPath(segment)
  })

  const hasFlowStep = computed(() => currentStep.value !== undefined)

  async function refetch(): Promise<void> {
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
      runtimeMessages.value = []
      responseKind.value = 'idle'
      clearFileState()
      lastLoadedStep = null
      loading.value = false
      return
    }

    loading.value = true
    error.value = null
    runtimeMessages.value = []
    if (lastLoadedStep !== stepEnum) {
      clearFileState()
    }

    try {
      const response = await workspaceLifecycle.runForSession(
        sessionId,
        () => resolveWorkspaceStepInfoApi({
          step: stepEnum,
          id: InfoEnum.config,
        }),
      )
      if (!canApply() || !response) return
      runtimeMessages.value = response.message ?? []

      const payload = response.info

      if (response.response === 'available') {
        responseKind.value = 'success'
        info.value = payload ?? {}
        await loadStepConfigFileFromInfo(info.value, sessionId, refetchToken)
        if (canApply()) {
          lastLoadedStep = stepEnum
        }
        return
      }

      if (response.response === 'missing') {
        info.value = payload
        const configPath = payload ? pickStepConfigPathFromInfo(payload) : undefined
        if (payload && configPath) {
          responseKind.value = 'warning'
          await loadStepConfigFileFromInfo(payload, sessionId, refetchToken)
          if (canApply()) {
            lastLoadedStep = stepEnum
          }
          return
        }
        responseKind.value = 'idle'
        clearFileState()
        lastLoadedStep = stepEnum
        return
      }

      responseKind.value = 'error'
      info.value = null
      error.value = (response.message && response.message[0]) || 'Failed to load step configuration'
      clearFileState()
    } catch (e) {
      if (!canApply()) return
      responseKind.value = 'error'
      info.value = null
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      if (canApply()) {
        loading.value = false
      }
    }
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
      stepConfigTextDraft.value = ''
      stepConfigTextBaseline.value = ''
    } catch {
      stepConfigDraft.value = null
      stepConfigBaselineSig.value = ''
    }
  }

  async function loadStepConfigFileFromInfo(
    data: Record<string, unknown>,
    sessionId: string,
    refetchToken: symbol,
  ) {
    const isCurrent = () => workspaceLifecycle.isCurrentSession(sessionId)
    const isLatestRefetch = () => activeRefetchToken === refetchToken
    const canApply = () => isCurrent() && isLatestRefetch()
    const rawPath = pickStepConfigPathFromInfo(data)
    if (!rawPath) {
      return
    }

    const localPath = await workspaceLifecycle.runForSession(sessionId, () => {
      const projectPath = currentProject.value?.path ?? ''
      return projectPath ? convertRemoteToLocalPath(rawPath, projectPath) : rawPath
    })
    if (!canApply() || !localPath) return
    stepConfigPathResolved.value = localPath

    if (!isDesktopRuntimeAvailable) {
      stepConfigReadError.value =
        'Reading local config requires the ECOS Studio desktop runtime. Browser mode cannot access project files.'
      return
    }

    try {
      const resolvedPath = await workspaceLifecycle.runForSession(
        sessionId,
        () => resolveProjectPathAccess(localPath),
      )
      if (!canApply()) return
      if (!resolvedPath) {
        stepConfigRaw.value = null
        stepConfigReadError.value = `No file-system access to ${localPath}`
        return
      }
      const fileContent = await workspaceLifecycle.runForSession(
        sessionId,
        () => readProjectTextFile(resolvedPath),
      )
      if (!canApply() || fileContent === undefined) return
      stepConfigRaw.value = fileContent
      stepConfigReadError.value = null
    } catch (e) {
      if (!canApply()) return
      stepConfigRaw.value = null
      stepConfigReadError.value = e instanceof Error ? e.message : String(e)
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
      resourceVersions.value['step-config'],
      resourceVersions.value.all,
    ],
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
    const path = stepConfigPathResolved.value
    const sessionId = workspaceLifecycle.currentSessionId.value
    const step = currentStep.value
    const saveToken = Symbol('step-config-save')
    const isCurrentSave = () => activeStepConfigSave.value === saveToken
    const canApply = () => workspaceLifecycle.isCurrentSession(sessionId) && isCurrentSave()
    const setSavingForToken = (value: boolean) => {
      if (activeStepConfigSave.value === saveToken) {
        isSavingStepConfig.value = value
        if (!value) activeStepConfigSave.value = null
      }
    }
    if (!path) {
      stepConfigSaveError.value = 'No configuration file path resolved'
      return false
    }
    if (!isDesktopRuntimeAvailable) {
      stepConfigSaveError.value = 'Saving requires the ECOS Studio desktop runtime'
      return false
    }
    if (blockStepConfigSaveWhileFlowRunning()) {
      return false
    }
    const rawBeforeSave = stepConfigRaw.value
    const textDraftBeforeSave = stepConfigTextDraft.value
    const draftBeforeSave = stepConfigDraft.value === null ? null : deepClone(stepConfigDraft.value)
    activeStepConfigSave.value = saveToken
    isSavingStepConfig.value = true
    try {
      const resolvedPath = await workspaceLifecycle.runForSession(
        sessionId,
        () => resolveProjectPathAccess(path),
      )
      if (!canApply()) return false
      if (!resolvedPath) {
        stepConfigSaveError.value = `No file-system access to ${path}`
        return false
      }
      if (blockStepConfigSaveWhileFlowRunning()) {
        return false
      }

      const syncWorkspaceConfig = async (): Promise<boolean> => {
        const projectPath = currentProject.value?.path
        if (!projectPath) {
          stepConfigSaveError.value = 'No workspace is open'
          return false
        }
        const syncResult = await workspaceLifecycle.runForSession(
          sessionId,
          () => syncConfigApi({
            cmd: CMDEnum.sync_config,
            data: {
              config_path: resolvedPath,
              directory: projectPath,
            },
          }),
        )
        if (!canApply()) return false

        workspaceLifecycle.invalidate('step-config', {
          reason: 'step-config-save',
          sessionId,
          step,
        })

        if (syncResult?.data?.parameters_changed === true) {
          workspaceLifecycle.invalidate(['parameters', 'home'], {
            reason: 'step-config-sync',
            sessionId,
            step,
          })
        }

        if (syncResult?.response !== ResponseEnum.success) {
          stepConfigSaveError.value = firstResponseMessage(syncResult, 'Sync workspace config failed')
          return false
        }

        return true
      }

      let text: string
      if (!rawLooksValidJson(rawBeforeSave ?? '')) {
        text = textDraftBeforeSave
        const writeResult = await workspaceLifecycle.runForSession(
          sessionId,
          async () => {
            await writeProjectTextFile(resolvedPath, text)
            return true
          },
        )
        if (!canApply() || writeResult !== true) return false
        stepConfigRaw.value = text
        stepConfigTextBaseline.value = text
        return await syncWorkspaceConfig()
      }
      if (draftBeforeSave === null) {
        stepConfigSaveError.value = 'Nothing to save'
        return false
      }
      text = JSON.stringify(draftBeforeSave, null, 4)
      const writeResult = await workspaceLifecycle.runForSession(
        sessionId,
        async () => {
          await writeProjectTextFile(resolvedPath, text)
          return true
        },
      )
      if (!canApply() || writeResult !== true) return false
      stepConfigRaw.value = text
      stepConfigBaselineSig.value = stableJsonSig(draftBeforeSave)
      return await syncWorkspaceConfig()
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
    saveStepConfig,
    resetStepConfig,
    reloadStepConfigFiles,
  }
}
