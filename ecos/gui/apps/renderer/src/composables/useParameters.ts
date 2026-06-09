import { ref, reactive, watch, computed, getCurrentScope, onScopeDispose } from 'vue'
import { useWorkspace } from './useWorkspace'
import { useDesktopRuntime } from './useDesktopRuntime'
import { fetchSharedHomeData, convertRemoteToLocalPath } from './useHomeData'
import { resolveProjectPathAccess } from '@/utils/projectFs'
import { readProjectTextFile, writeProjectTextFile } from '@/utils/projectFiles'
import { useWorkspaceLifecycle } from './useWorkspaceLifecycle'
import { isFlowExecutionActiveForWorkspace } from './useFlowRunner'
import { refreshConfigApi } from '@/api/flow'
import { CMDEnum, ResponseEnum } from '@/api/type'

// ============ 类型定义 ============
// 与 ecc/chipcompiler/data/parameter.py 中 ICS55_PARAMETERS_TEMPLATE 及 workspace 写入的 PDK Root 对齐

/** parameters.json 磁盘结构（ICS55 扁平模板 + 可选 PDK Root） */
export interface ParametersData {
  PDK: string
  Design: string
  'Top module': string
  Die: {
    Size: number[]
    Area?: number
  }
  Core: {
    Size: number[]
    Area?: number
    'Bounding box': string
    Utilitization: number
    Margin: [number, number]
    'Aspect ratio': number
  }
  'Max fanout': number
  'Target density': number
  'Target overflow': number
  'Global right padding': number
  'Cell padding x': number
  'Routability opt flag': number
  Clock: string
  'Frequency max [MHz]': number
  'Bottom layer': string
  'Top layer': string
  'PDK Root'?: string
}

/** 前端编辑用（驼峰） */
export interface ConfigData {
  pdk: string
  pdkRoot: string
  design: string
  topModule: string
  die: { Size: number[]; area: number }
  core: {
    Size: number[]
    area: number
    boundingBox: string
    utilization: number
    margin: [number, number]
    aspectRatio: number
  }
  maxFanout: number
  targetDensity: number
  targetOverflow: number
  globalRightPadding: number
  cellPaddingX: number
  routabilityOptFlag: boolean
  clock: string
  frequencyMax: number
  bottomLayer: string
  topLayer: string
}

// ============ 工具函数 ============

/** 用于 Bottom/Top 金属层下拉的常见顺序（与 PDK 文档一致即可） */
const ROUTING_LAYER_ORDER = ['LI1', 'MET1', 'MET2', 'MET3', 'MET4', 'MET5', 'MET6', 'MET7', 'MET8']
const FLOW_RUNNING_SAVE_BLOCKED_MESSAGE =
  'Flow is running. Configuration is read-only until the current run finishes.'
const RUNNING_FLOW_PARAMETERS_POLL_MS = 1600

function getDefaultConfig(): ConfigData {
  return {
    pdk: '',
    pdkRoot: '',
    design: '',
    topModule: '',
    die: { Size: [], area: 0 },
    core: {
      Size: [],
      area: 0,
      boundingBox: '',
      utilization: 0.4,
      margin: [2, 2],
      aspectRatio: 1
    },
    maxFanout: 20,
    targetDensity: 0.3,
    targetOverflow: 0.1,
    globalRightPadding: 0,
    cellPaddingX: 600,
    routabilityOptFlag: true,
    clock: '',
    frequencyMax: 100,
    bottomLayer: 'MET2',
    topLayer: 'MET5'
  }
}

function firstResponseMessage(response: { message?: string[] } | undefined, fallback: string): string {
  return response?.message?.[0] || fallback
}

function normalizeDie(d: unknown): ParametersData['Die'] {
  if (!d || typeof d !== 'object') return { Size: [], Area: 0 }
  const o = d as Record<string, unknown>
  const size = o.Size
  const arr = Array.isArray(size) ? size.map(Number) : []
  return {
    Size: arr,
    Area: o.Area != null ? Number(o.Area) : 0
  }
}

function normalizeCore(c: unknown): ParametersData['Core'] {
  if (!c || typeof c !== 'object') {
    return {
      Size: [],
      Area: 0,
      'Bounding box': '',
      Utilitization: 0.4,
      Margin: [2, 2],
      'Aspect ratio': 1
    }
  }
  const o = c as Record<string, unknown>
  const size = o.Size
  const arr = Array.isArray(size) ? size.map(Number) : []
  const margin = o.Margin
  let m: [number, number] = [2, 2]
  if (Array.isArray(margin) && margin.length >= 2) {
    m = [Number(margin[0]), Number(margin[1])]
  }
  return {
    Size: arr,
    Area: o.Area != null ? Number(o.Area) : 0,
    'Bounding box': String(o['Bounding box'] ?? ''),
    Utilitization: Number(o.Utilitization ?? 0.4),
    Margin: m,
    'Aspect ratio': Number(o['Aspect ratio'] ?? 1)
  }
}

export function parseParametersData(fileContent: string): ParametersData {
  const raw = JSON.parse(fileContent) as Record<string, unknown>
  return {
    PDK: String(raw.PDK ?? ''),
    Design: String(raw.Design ?? ''),
    'Top module': String(raw['Top module'] ?? ''),
    Die: normalizeDie(raw.Die),
    Core: normalizeCore(raw.Core),
    'Max fanout': Number(raw['Max fanout'] ?? 20),
    'Target density': Number(raw['Target density'] ?? 0.3),
    'Target overflow': Number(raw['Target overflow'] ?? 0.1),
    'Global right padding': Number(raw['Global right padding'] ?? 0),
    'Cell padding x': Number(raw['Cell padding x'] ?? 600),
    'Routability opt flag': Number(raw['Routability opt flag'] ?? 1),
    Clock: String(raw.Clock ?? ''),
    'Frequency max [MHz]': Number(raw['Frequency max [MHz]'] ?? 100),
    'Bottom layer': String(raw['Bottom layer'] ?? 'MET2'),
    'Top layer': String(raw['Top layer'] ?? 'MET5'),
    'PDK Root': raw['PDK Root'] != null ? String(raw['PDK Root']) : undefined
  }
}

export function transformParametersToConfig(data: ParametersData): ConfigData {
  return {
    pdk: data.PDK || '',
    pdkRoot: data['PDK Root'] ?? '',
    design: data.Design || '',
    topModule: data['Top module'] || '',
    die: {
      Size: data.Die?.Size?.length ? [...data.Die.Size] : [],
      area: data.Die?.Area ?? 0
    },
    core: {
      Size: data.Core?.Size?.length ? [...data.Core.Size] : [],
      area: data.Core?.Area ?? 0,
      boundingBox: data.Core?.['Bounding box'] || '',
      utilization: data.Core?.Utilitization ?? 0.4,
      margin: data.Core?.Margin ?? [2, 2],
      aspectRatio: data.Core?.['Aspect ratio'] ?? 1
    },
    maxFanout: data['Max fanout'] ?? 20,
    targetDensity: data['Target density'] ?? 0.3,
    targetOverflow: data['Target overflow'] ?? 0.1,
    globalRightPadding: data['Global right padding'] ?? 0,
    cellPaddingX: data['Cell padding x'] ?? 600,
    routabilityOptFlag: !!data['Routability opt flag'],
    clock: data.Clock || '',
    frequencyMax: data['Frequency max [MHz]'] ?? 100,
    bottomLayer: data['Bottom layer'] || 'MET2',
    topLayer: data['Top layer'] || 'MET5'
  }
}

export function transformConfigToParameters(config: ConfigData): ParametersData {
  const out: ParametersData = {
    PDK: config.pdk,
    Design: config.design,
    'Top module': config.topModule,
    Die: {
      Size: [...(config.die.Size || [])],
      Area: config.die.area
    },
    Core: {
      Size: [...(config.core.Size || [])],
      Area: config.core.area,
      'Bounding box': config.core.boundingBox,
      Utilitization: config.core.utilization,
      Margin: [...config.core.margin] as [number, number],
      'Aspect ratio': config.core.aspectRatio
    },
    'Max fanout': config.maxFanout,
    'Target density': config.targetDensity,
    'Target overflow': config.targetOverflow,
    'Global right padding': config.globalRightPadding,
    'Cell padding x': config.cellPaddingX,
    'Routability opt flag': config.routabilityOptFlag ? 1 : 0,
    Clock: config.clock,
    'Frequency max [MHz]': config.frequencyMax,
    'Bottom layer': config.bottomLayer,
    'Top layer': config.topLayer
  }
  out['PDK Root'] = config.pdkRoot ?? ''
  return out
}

// ============ Composable ============

/**
 * 参数配置管理 Hook
 * 负责从 parameters.json 加载配置参数并管理状态
 */
export function useParameters() {
  const { isDesktopRuntimeAvailable } = useDesktopRuntime()
  const { currentProject, resourceVersions, invalidateWorkspaceResources } = useWorkspace()
  const workspaceLifecycle = useWorkspaceLifecycle()

  const config = reactive<ConfigData>(getDefaultConfig())
  const isLoading = ref(false)
  const isSaving = ref(false)
  const error = ref<string | null>(null)
  const hasChanges = ref(false)
  const isMutationLocked = computed(() => isFlowExecutionActiveForWorkspace(currentProject.value?.path))

  let originalConfig: string = ''
  let resolvedParametersPath: string = ''
  let savingSessionId: string | null = null
  let saveRequestSequence = 0
  let activeSaveRequestId = 0
  let parametersResourceToken = 0
  let saveWriteQueue: Promise<void> = Promise.resolve()
  let runningFlowParametersPollTimer: ReturnType<typeof setInterval> | null = null
  let runningFlowParametersPollInFlight = false

  function fallbackParametersPath(projectPath: string): string {
    return `${projectPath}/home/parameters.json`
  }

  function advanceParametersResourceToken(): number {
    parametersResourceToken += 1
    isSaving.value = false
    savingSessionId = null
    activeSaveRequestId = 0
    return parametersResourceToken
  }

  function resetParametersState(): void {
    advanceParametersResourceToken()
    Object.assign(config, getDefaultConfig())
    originalConfig = ''
    resolvedParametersPath = ''
    hasChanges.value = false
    isSaving.value = false
    savingSessionId = null
    activeSaveRequestId = 0
  }

  function convertToLocalPath(remotePath: string): string {
    const projectPath = currentProject.value?.path
    return projectPath ? convertRemoteToLocalPath(remotePath, projectPath) : remotePath
  }

  function keepLastParametersDuringFlowReload(): boolean {
    if (!currentProject.value?.path) return false
    return Boolean(originalConfig) && isFlowExecutionActiveForWorkspace(currentProject.value.path)
  }

  function isSaveContextCurrent(options: {
    sessionId: string
    requestId: number
    resourceToken: number
    parametersPath: string
    projectPath: string
  }): boolean {
    return (
      workspaceLifecycle.isCurrentSession(options.sessionId)
      && activeSaveRequestId === options.requestId
      && parametersResourceToken === options.resourceToken
      && resolvedParametersPath === options.parametersPath
      && currentProject.value?.path === options.projectPath
    )
  }

  function blockSaveWhileFlowRunning(projectPath = currentProject.value?.path): boolean {
    if (!isFlowExecutionActiveForWorkspace(projectPath)) return false
    error.value = FLOW_RUNNING_SAVE_BLOCKED_MESSAGE
    return true
  }

  function applyParametersFileContent(fileContent: string): void {
    const parametersData = parseParametersData(fileContent)

    console.log('Loaded parameters data:', parametersData)

    const transformedConfig = transformParametersToConfig(parametersData)
    const nextConfigSnapshot = JSON.stringify(transformedConfig)
    if (nextConfigSnapshot === originalConfig) {
      hasChanges.value = false
      return
    }

    Object.assign(config, transformedConfig)
    console.log('Loaded config:', config)
    originalConfig = JSON.stringify(config)
    hasChanges.value = false

    console.log('Parameters loaded:', config)
  }

  async function reloadParametersFromKnownPathIfRunning(): Promise<boolean> {
    const projectPath = currentProject.value?.path
    if (!projectPath || !isFlowExecutionActiveForWorkspace(projectPath)) return false

    const sessionId = workspaceLifecycle.currentSessionId.value
    const knownPath = resolvedParametersPath || fallbackParametersPath(projectPath)
    isLoading.value = true
    error.value = null
    const loadResourceToken = advanceParametersResourceToken()

    try {
      const resolvedPath = await workspaceLifecycle.runForSession(
        sessionId,
        () => resolveProjectPathAccess(knownPath),
      )
      if (resolvedPath === undefined && !workspaceLifecycle.isCurrentSession(sessionId)) return true
      if (!resolvedPath) {
        if (keepLastParametersDuringFlowReload()) return true
        resetParametersState()
        return true
      }

      const fileContent = await workspaceLifecycle.runForSession(
        sessionId,
        () => readProjectTextFile(resolvedPath),
      )
      if (fileContent === undefined && !workspaceLifecycle.isCurrentSession(sessionId)) return true
      if (fileContent === undefined) return true
      if (loadResourceToken !== parametersResourceToken) return true

      resolvedParametersPath = resolvedPath
      applyParametersFileContent(fileContent)
      return true
    } catch (err) {
      if (!workspaceLifecycle.isCurrentSession(sessionId)) return true
      console.error('Failed to reload running flow parameters:', err)
      if (!keepLastParametersDuringFlowReload()) {
        error.value = err instanceof Error ? err.message : String(err)
        resetParametersState()
      }
      return true
    } finally {
      if (workspaceLifecycle.isCurrentSession(sessionId)) {
        isLoading.value = false
      }
    }
  }

  function stopRunningFlowParametersPoll(): void {
    if (runningFlowParametersPollTimer == null) return
    clearInterval(runningFlowParametersPollTimer)
    runningFlowParametersPollTimer = null
    runningFlowParametersPollInFlight = false
  }

  function startRunningFlowParametersPoll(): void {
    if (runningFlowParametersPollTimer != null) return
    runningFlowParametersPollTimer = setInterval(() => {
      if (runningFlowParametersPollInFlight || hasChanges.value) return
      runningFlowParametersPollInFlight = true
      void reloadParametersFromKnownPathIfRunning().finally(() => {
        runningFlowParametersPollInFlight = false
      })
    }, RUNNING_FLOW_PARAMETERS_POLL_MS)
  }

  async function loadParameters(): Promise<void> {
    if (!isDesktopRuntimeAvailable || !currentProject.value?.path) {
      console.warn('Cannot load parameters: desktop bridge unavailable or no project is open')
      resetParametersState()
      return
    }

    const sessionId = workspaceLifecycle.currentSessionId.value
    if (savingSessionId && savingSessionId !== sessionId) {
      isSaving.value = false
      savingSessionId = null
    }
    isLoading.value = true
    error.value = null
    resolvedParametersPath = ''
    const loadResourceToken = advanceParametersResourceToken()

    try {
      const projectPath = currentProject.value.path
      const homeData = await workspaceLifecycle.runForSession(
        sessionId,
        () => fetchSharedHomeData(projectPath, isDesktopRuntimeAvailable),
      )
      if (homeData === undefined && !workspaceLifecycle.isCurrentSession(sessionId)) return
      if (!homeData) {
        console.warn('Failed to get home data')
        if (keepLastParametersDuringFlowReload()) return
        resetParametersState()
        return
      }

      if (!homeData.parameters) {
        console.warn('No parameters field found in home.json')
        if (keepLastParametersDuringFlowReload()) return
        resetParametersState()
        return
      }

      const parametersPath = convertToLocalPath(homeData.parameters)
      const resolvedPath = await workspaceLifecycle.runForSession(
        sessionId,
        () => resolveProjectPathAccess(parametersPath),
      )
      if (resolvedPath === undefined && !workspaceLifecycle.isCurrentSession(sessionId)) return
      console.log('Loading parameters from:', resolvedPath ?? parametersPath)
      if (!resolvedPath) {
        if (keepLastParametersDuringFlowReload()) return
        resetParametersState()
        return
      }

      const fileContent = await workspaceLifecycle.runForSession(
        sessionId,
        () => readProjectTextFile(resolvedPath),
      )
      if (fileContent === undefined && !workspaceLifecycle.isCurrentSession(sessionId)) return
      if (fileContent === undefined) return

      if (loadResourceToken !== parametersResourceToken) return
      resolvedParametersPath = resolvedPath

      applyParametersFileContent(fileContent)
    } catch (err) {
      if (!workspaceLifecycle.isCurrentSession(sessionId)) return
      console.error('Failed to load parameters:', err)
      error.value = err instanceof Error ? err.message : String(err)
      resetParametersState()
    } finally {
      if (workspaceLifecycle.isCurrentSession(sessionId)) {
        isLoading.value = false
      }
    }
  }

  async function saveParameters(): Promise<boolean> {
    if (!isDesktopRuntimeAvailable || !currentProject.value?.path) {
      console.warn('Cannot save parameters: desktop bridge unavailable or no project is open')
      return false
    }

    if (!resolvedParametersPath) {
      console.warn('Parameters file path is not resolved. Call loadParameters first.')
      return false
    }

    if (blockSaveWhileFlowRunning()) {
      return false
    }

    isSaving.value = true
    error.value = null
    const saveSessionId = workspaceLifecycle.currentSessionId.value
    const saveRequestId = ++saveRequestSequence
    const saveResourceToken = parametersResourceToken
    const saveParametersPath = resolvedParametersPath
    const saveProjectPath = currentProject.value.path
    activeSaveRequestId = saveRequestId
    savingSessionId = saveSessionId

    try {
      const savedConfigSnapshot = JSON.stringify(config)
      const parametersData = transformConfigToParameters(config)
      const fileContent = JSON.stringify(parametersData, null, 4)
      let writeSucceeded = false

      const writeTask = saveWriteQueue.then(async () => {
        if (!isSaveContextCurrent({
          sessionId: saveSessionId,
          requestId: saveRequestId,
          resourceToken: saveResourceToken,
          parametersPath: saveParametersPath,
          projectPath: saveProjectPath,
        })) {
          return
        }
        if (blockSaveWhileFlowRunning(saveProjectPath)) {
          return
        }
        console.log('Saving parameters to:', saveParametersPath)
        const resolvedPath = await resolveProjectPathAccess(saveParametersPath)
        if (!resolvedPath) {
          return
        }

        await writeProjectTextFile(resolvedPath, fileContent)
        writeSucceeded = true
      })
      saveWriteQueue = writeTask.catch(() => {})
      await writeTask
      if (!writeSucceeded) {
        return false
      }
      if (!isSaveContextCurrent({
        sessionId: saveSessionId,
        requestId: saveRequestId,
        resourceToken: saveResourceToken,
        parametersPath: saveParametersPath,
        projectPath: saveProjectPath,
      })) {
        return true
      }

      if (JSON.stringify(config) === savedConfigSnapshot) {
        originalConfig = savedConfigSnapshot
        hasChanges.value = false
      } else {
        hasChanges.value = true
      }

      const refreshResult = await workspaceLifecycle.runForSession(
        saveSessionId,
        () => refreshConfigApi({
          cmd: CMDEnum.refresh_config,
          data: {
            directory: saveProjectPath,
          },
        }),
      )
      if (!isSaveContextCurrent({
        sessionId: saveSessionId,
        requestId: saveRequestId,
        resourceToken: saveResourceToken,
        parametersPath: saveParametersPath,
        projectPath: saveProjectPath,
      })) {
        return refreshResult?.response === ResponseEnum.success
      }

      invalidateWorkspaceResources(['parameters', 'home', 'step-config', 'flow'], { sessionId: saveSessionId })

      if (refreshResult?.response !== ResponseEnum.success) {
        error.value = firstResponseMessage(refreshResult, 'Refresh workspace config failed')
        return false
      }

      console.log('Parameters saved successfully')
      return true
    } catch (err) {
      if (!isSaveContextCurrent({
        sessionId: saveSessionId,
        requestId: saveRequestId,
        resourceToken: saveResourceToken,
        parametersPath: saveParametersPath,
        projectPath: saveProjectPath,
      })) {
        return false
      }
      console.error('Failed to save parameters:', err)
      error.value = err instanceof Error ? err.message : String(err)
      return false
    } finally {
      if (isSaveContextCurrent({
        sessionId: saveSessionId,
        requestId: saveRequestId,
        resourceToken: saveResourceToken,
        parametersPath: saveParametersPath,
        projectPath: saveProjectPath,
      })) {
        isSaving.value = false
        if (savingSessionId === saveSessionId) {
          savingSessionId = null
        }
        activeSaveRequestId = 0
      }
    }
  }

  function resetParameters(): void {
    if (originalConfig) {
      Object.assign(config, JSON.parse(originalConfig))
      hasChanges.value = false
    }
  }

  async function refreshParameters(): Promise<void> {
    if (await reloadParametersFromKnownPathIfRunning()) return
    await loadParameters()
  }

  async function reloadParametersIfClean(): Promise<void> {
    if (hasChanges.value) {
      console.warn('Skip automatic parameters reload because there are unsaved changes')
      return
    }
    if (await reloadParametersFromKnownPathIfRunning()) return
    await loadParameters()
  }

  watch(
    config,
    () => {
      hasChanges.value = JSON.stringify(config) !== originalConfig
    },
    { deep: true }
  )

  watch(
    () => currentProject.value?.path,
    async (newPath) => {
      isSaving.value = false
      stopRunningFlowParametersPoll()
      if (newPath) {
        await loadParameters()
      } else {
        resetParametersState()
      }
    },
    { immediate: true }
  )

  watch(
    () => [
      resourceVersions.value.parameters,
      resourceVersions.value.home,
      resourceVersions.value.all,
    ],
    async () => {
      await reloadParametersIfClean()
    },
  )

  if (getCurrentScope()) {
    const stopFlowExecutionWatch = watch(
      () => isFlowExecutionActiveForWorkspace(currentProject.value?.path),
      (active) => {
        if (active) {
          startRunningFlowParametersPoll()
        } else {
          stopRunningFlowParametersPoll()
        }
      },
      { immediate: true },
    )

    onScopeDispose(() => {
      stopFlowExecutionWatch()
      stopRunningFlowParametersPoll()
    })
  }

  const layerOptions = computed(() => {
    return ROUTING_LAYER_ORDER.map(layer => ({ label: layer, value: layer }))
  })

  const layersList = computed(() => {
    const opts = layerOptions.value.map(o => o.value)
    const lo = opts.indexOf(config.bottomLayer)
    const hi = opts.indexOf(config.topLayer)
    if (lo === -1 || hi === -1) return opts
    const a = Math.min(lo, hi)
    const b = Math.max(lo, hi)
    return opts.slice(a, b + 1)
  })

  const isLayerInRange = (layer: string): boolean => {
    const layers = layersList.value
    const bottomIndex = layers.indexOf(config.bottomLayer)
    const topIndex = layers.indexOf(config.topLayer)
    const currentIndex = layers.indexOf(layer)
    return currentIndex >= bottomIndex && currentIndex <= topIndex
  }

  return {
    config,
    isLoading,
    isSaving,
    error,
    hasChanges,
    isMutationLocked,
    layerOptions,
    layersList,
    isLayerInRange,
    loadParameters,
    saveParameters,
    resetParameters,
    refreshParameters
  }
}
