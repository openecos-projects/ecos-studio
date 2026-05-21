import { ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { getInfoApi } from '@/api/flow'
import { CMDEnum, InfoEnum, ResponseEnum, StepEnum } from '@/api/type'
import { convertRemoteToLocalPath } from '@/composables/useHomeData'
import { readProjectTextFile, writeProjectTextFile } from '@/utils/projectFiles'
import { resolveProjectPathAccess } from '@/utils/projectFs'
import { useTauri } from '@/composables/useTauri'
import { useWorkspace } from '@/composables/useWorkspace'

const stepEnumValues = Object.values(StepEnum)

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

/** Extract `info` from get_info response. */
function extractInfoPayload(response: unknown): Record<string, unknown> | null {
  const r = response as Record<string, unknown> | null
  if (!r || typeof r !== 'object') return null

  const inner = r.data
  const data =
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? (inner as Record<string, unknown>)
      : null

  const infoRaw = data?.info ?? r.info
  if (infoRaw && typeof infoRaw === 'object' && !Array.isArray(infoRaw)) {
    return infoRaw as Record<string, unknown>
  }
  return null
}

/** Resolved step config file path from `get_info` -> `data.info.config`. */
function pickStepConfigPathFromInfo(data: Record<string, unknown>): string | undefined {
  const v = data.config
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

/**
 * Fetch get_info/config and read `info.config` from disk as the step configuration file.
 */
export function useStepConfigInfo() {
  const route = useRoute()
  const { isInTauri } = useTauri()
  const { currentProject } = useWorkspace()

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
  const stepConfigSaveError = ref<string | null>(null)

  const currentStep = computed(() => {
    const pathParts = route.path.split('/')
    const segment = pathParts[pathParts.length - 1] || ''
    return getStepEnumFromPath(segment)
  })

  const hasFlowStep = computed(() => currentStep.value !== undefined)

  async function refetch(): Promise<void> {
    const stepEnum = currentStep.value
    if (!stepEnum) {
      info.value = null
      error.value = null
      runtimeMessages.value = []
      responseKind.value = 'idle'
      clearFileState()
      loading.value = false
      return
    }

    loading.value = true
    error.value = null
    runtimeMessages.value = []
    clearFileState()

    try {
      const response = await getInfoApi({
        cmd: CMDEnum.get_info,
        data: {
          step: stepEnum,
          id: InfoEnum.config,
        },
      })
      runtimeMessages.value = response.message ?? []

      const payload = extractInfoPayload(response)

      if (response.response === ResponseEnum.success) {
        responseKind.value = 'success'
        info.value = payload ?? {}
        await loadStepConfigFileFromInfo(info.value)
        return
      }

      if (response.response === ResponseEnum.warning) {
        responseKind.value = 'warning'
        info.value = payload
        if (payload && pickStepConfigPathFromInfo(payload)) {
          await loadStepConfigFileFromInfo(payload)
        }
        return
      }

      responseKind.value = response.response === ResponseEnum.failed ? 'failed' : 'error'
      info.value = null
      error.value = (response.message && response.message[0]) || 'Failed to load step configuration'
    } catch (e) {
      responseKind.value = 'error'
      info.value = null
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
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

  async function loadStepConfigFileFromInfo(data: Record<string, unknown>) {
    const rawPath = pickStepConfigPathFromInfo(data)
    if (!rawPath) {
      return
    }

    const projectPath = currentProject.value?.path ?? ''
    const localPath = projectPath ? convertRemoteToLocalPath(rawPath, projectPath) : rawPath
    stepConfigPathResolved.value = localPath

    if (!isInTauri) {
      stepConfigReadError.value =
        'Reading local config requires the ECOS Studio desktop runtime. Browser mode cannot access project files.'
      return
    }

    try {
      const resolvedPath = await resolveProjectPathAccess(localPath)
      if (!resolvedPath) {
        stepConfigRaw.value = null
        stepConfigReadError.value = `No file-system access to ${localPath}`
        return
      }
      stepConfigRaw.value = await readProjectTextFile(resolvedPath)
      stepConfigReadError.value = null
    } catch (e) {
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

  async function saveStepConfig(): Promise<boolean> {
    stepConfigSaveError.value = null
    const path = stepConfigPathResolved.value
    if (!path) {
      stepConfigSaveError.value = 'No configuration file path resolved'
      return false
    }
    if (!isInTauri) {
      stepConfigSaveError.value = 'Saving requires the ECOS Studio desktop runtime'
      return false
    }
    isSavingStepConfig.value = true
    try {
      const resolvedPath = await resolveProjectPathAccess(path)
      if (!resolvedPath) {
        stepConfigSaveError.value = `No file-system access to ${path}`
        return false
      }
      let text: string
      if (!rawLooksValidJson(stepConfigRaw.value ?? '')) {
        text = stepConfigTextDraft.value
        await writeProjectTextFile(resolvedPath, text)
        stepConfigRaw.value = text
        stepConfigTextBaseline.value = text
        return true
      }
      if (stepConfigDraft.value === null) {
        stepConfigSaveError.value = 'Nothing to save'
        return false
      }
      text = JSON.stringify(stepConfigDraft.value, null, 4)
      await writeProjectTextFile(resolvedPath, text)
      stepConfigRaw.value = text
      stepConfigBaselineSig.value = stableJsonSig(stepConfigDraft.value)
      return true
    } catch (e) {
      stepConfigSaveError.value = e instanceof Error ? e.message : String(e)
      return false
    } finally {
      isSavingStepConfig.value = false
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
    saveStepConfig,
    resetStepConfig,
    reloadStepConfigFiles,
  }
}
