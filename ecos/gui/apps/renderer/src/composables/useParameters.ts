import { ref, reactive, watch, computed, getCurrentScope, onScopeDispose } from 'vue'
import { useWorkspace } from './useWorkspace'
import { useDesktopRuntime } from './useDesktopRuntime'
import { fetchSharedHomeData, convertRemoteToLocalPath } from './useHomeData'
import { getWorkspaceRuntimeSnapshotApi } from '@/api/workspaceResources'
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
  design?: string
  description?: string
  'Design Tool'?: string
  'Top module': string
  top_module?: string
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
  clock?: string
  'Frequency max [MHz]': number
  frequency_max?: number
  'Bottom layer': string
  'Top layer': string
  'PDK Root'?: string
  cpu_filelist?: string
  soc_filelist?: string
  soc_variant?: string
  soc_harness_id?: string
  soc_wrapper_id?: string
  soc_wrapper_contract?: string
  frontend_core_id?: string
  core_id?: string
  cpu_wrapper_id?: string
  cpu_wrapper_contract?: string
  cpu_socket_contract?: string
  cpu_wrapper_top?: string
  toolchain_id?: string
  test_suite_id?: string
  input_filelist?: string
  sim_program_names?: string[]
  sim_all_tests?: boolean
}

/** 前端编辑用（驼峰） */
export interface FrontendConfigData {
  coreId: string
  cpuWrapperId: string
  cpuWrapperContract: string
  cpuSocketContract: string
  cpuWrapperTop: string
  socHarnessId: string
  socWrapperId: string
  socWrapperContract: string
  socVariant: string
  toolchainId: string
  testSuiteId: string
  cpuFilelist: string
  socFilelist: string
  inputFilelist: string
  simProgramNames: string[]
  simAllTests: boolean
}

export interface ConfigData {
  designTool: string
  description: string
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
  frontend: FrontendConfigData
}

// ============ 工具函数 ============

/** ICS55 routing is pinned to the MET2 through MET5 route window. */
const FIXED_BOTTOM_LAYER = 'MET2'
const FIXED_TOP_LAYER = 'MET5'
const ROUTING_LAYER_ORDER = [FIXED_BOTTOM_LAYER, 'MET3', 'MET4', FIXED_TOP_LAYER]
const FLOW_RUNNING_SAVE_BLOCKED_MESSAGE =
  'Flow is running. Configuration is read-only until the current run finishes.'

function getDefaultConfig(): ConfigData {
  return {
    designTool: 'backend',
    description: '',
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
      aspectRatio: 1,
    },
    maxFanout: 20,
    targetDensity: 0.3,
    targetOverflow: 0.1,
    globalRightPadding: 0,
    cellPaddingX: 600,
    routabilityOptFlag: true,
    clock: '',
    frequencyMax: 100,
    bottomLayer: FIXED_BOTTOM_LAYER,
    topLayer: FIXED_TOP_LAYER,
    frontend: {
      coreId: '',
      cpuWrapperId: '',
      cpuWrapperContract: '',
      cpuSocketContract: '',
      cpuWrapperTop: '',
      socHarnessId: '',
      socWrapperId: '',
      socWrapperContract: '',
      socVariant: '',
      toolchainId: '',
      testSuiteId: '',
      cpuFilelist: '',
      socFilelist: '',
      inputFilelist: '',
      simProgramNames: [],
      simAllTests: false,
    },
  }
}

function firstResponseMessage(
  response: { message?: string[] } | undefined,
  fallback: string,
): string {
  return response?.message?.[0] || fallback
}

function normalizeDie(d: unknown): ParametersData['Die'] {
  if (!d || typeof d !== 'object') return { Size: [], Area: 0 }
  const o = d as Record<string, unknown>
  const size = o.Size
  const arr = Array.isArray(size) ? size.map(Number) : []
  return {
    Size: arr,
    Area: o.Area != null ? Number(o.Area) : 0,
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
      'Aspect ratio': 1,
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
    'Aspect ratio': Number(o['Aspect ratio'] ?? 1),
  }
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item)).filter((item) => item.length > 0)
    : []
}

export function parametersHaveChipIdentity(
  data: Partial<ParametersData> | Record<string, unknown> | null | undefined,
): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  const record = data as Record<string, unknown>
  const identityValues = [
    record.PDK,
    record.pdk,
    record.Design,
    record.design,
    record['Top module'],
    record.topModule,
    record.Clock,
    record.clock,
  ]
  if (identityValues.some((value) => String(value ?? '').trim())) return true
  const die = record.Die ?? record.die
  if (!die || typeof die !== 'object' || Array.isArray(die)) return false
  const area = Number(
    (die as { Area?: unknown; area?: unknown }).Area ??
      (die as { area?: unknown }).area ??
      0,
  )
  return Number.isFinite(area) && area > 0
}

export function parseParametersData(fileContent: string): ParametersData {
  const raw = JSON.parse(fileContent) as Record<string, unknown>
  return {
    PDK: String(raw.PDK ?? ''),
    Design: String(raw.Design ?? raw.design ?? ''),
    design: raw.design != null ? String(raw.design) : undefined,
    description: raw.description != null ? String(raw.description) : undefined,
    'Design Tool': raw['Design Tool'] != null ? String(raw['Design Tool']) : undefined,
    'Top module': String(raw['Top module'] ?? raw.top_module ?? ''),
    top_module: raw.top_module != null ? String(raw.top_module) : undefined,
    Die: normalizeDie(raw.Die),
    Core: normalizeCore(raw.Core),
    'Max fanout': Number(raw['Max fanout'] ?? 20),
    'Target density': Number(raw['Target density'] ?? 0.3),
    'Target overflow': Number(raw['Target overflow'] ?? 0.1),
    'Global right padding': Number(raw['Global right padding'] ?? 0),
    'Cell padding x': Number(raw['Cell padding x'] ?? 600),
    'Routability opt flag': Number(raw['Routability opt flag'] ?? 1),
    Clock: String(raw.Clock ?? raw.clock ?? ''),
    clock: raw.clock != null ? String(raw.clock) : undefined,
    'Frequency max [MHz]': Number(raw['Frequency max [MHz]'] ?? raw.frequency_max ?? 100),
    frequency_max: raw.frequency_max != null ? Number(raw.frequency_max) : undefined,
    'Bottom layer': String(raw['Bottom layer'] ?? FIXED_BOTTOM_LAYER),
    'Top layer': String(raw['Top layer'] ?? FIXED_TOP_LAYER),
    'PDK Root': raw['PDK Root'] != null ? String(raw['PDK Root']) : undefined,
    cpu_filelist: raw.cpu_filelist != null ? String(raw.cpu_filelist) : undefined,
    soc_filelist: raw.soc_filelist != null ? String(raw.soc_filelist) : undefined,
    soc_variant: raw.soc_variant != null ? String(raw.soc_variant) : undefined,
    soc_harness_id: raw.soc_harness_id != null ? String(raw.soc_harness_id) : undefined,
    soc_wrapper_id: raw.soc_wrapper_id != null ? String(raw.soc_wrapper_id) : undefined,
    soc_wrapper_contract:
      raw.soc_wrapper_contract != null ? String(raw.soc_wrapper_contract) : undefined,
    frontend_core_id:
      raw.frontend_core_id != null ? String(raw.frontend_core_id) : undefined,
    core_id: raw.core_id != null ? String(raw.core_id) : undefined,
    cpu_wrapper_id: raw.cpu_wrapper_id != null ? String(raw.cpu_wrapper_id) : undefined,
    cpu_wrapper_contract:
      raw.cpu_wrapper_contract != null ? String(raw.cpu_wrapper_contract) : undefined,
    cpu_socket_contract:
      raw.cpu_socket_contract != null ? String(raw.cpu_socket_contract) : undefined,
    cpu_wrapper_top:
      raw.cpu_wrapper_top != null ? String(raw.cpu_wrapper_top) : undefined,
    toolchain_id: raw.toolchain_id != null ? String(raw.toolchain_id) : undefined,
    test_suite_id: raw.test_suite_id != null ? String(raw.test_suite_id) : undefined,
    input_filelist: raw.input_filelist != null ? String(raw.input_filelist) : undefined,
    sim_program_names: normalizeStringArray(raw.sim_program_names),
    sim_all_tests: Boolean(raw.sim_all_tests),
  }
}

export function transformParametersToConfig(data: ParametersData): ConfigData {
  return {
    designTool: data['Design Tool'] || 'backend',
    description: data.description || '',
    pdk: data.PDK || '',
    pdkRoot: data['PDK Root'] ?? '',
    design: data.Design || '',
    topModule: data['Top module'] || '',
    die: {
      Size: data.Die?.Size?.length ? [...data.Die.Size] : [],
      area: data.Die?.Area ?? 0,
    },
    core: {
      Size: data.Core?.Size?.length ? [...data.Core.Size] : [],
      area: data.Core?.Area ?? 0,
      boundingBox: data.Core?.['Bounding box'] || '',
      utilization: data.Core?.Utilitization ?? 0.4,
      margin: data.Core?.Margin ?? [2, 2],
      aspectRatio: data.Core?.['Aspect ratio'] ?? 1,
    },
    maxFanout: data['Max fanout'] ?? 20,
    targetDensity: data['Target density'] ?? 0.3,
    targetOverflow: data['Target overflow'] ?? 0.1,
    globalRightPadding: data['Global right padding'] ?? 0,
    cellPaddingX: data['Cell padding x'] ?? 600,
    routabilityOptFlag: !!data['Routability opt flag'],
    clock: data.Clock || '',
    frequencyMax: data['Frequency max [MHz]'] ?? 100,
    bottomLayer: FIXED_BOTTOM_LAYER,
    topLayer: FIXED_TOP_LAYER,
    frontend: {
      coreId: data.frontend_core_id || data.core_id || '',
      cpuWrapperId: data.cpu_wrapper_id || data.frontend_core_id || data.core_id || '',
      cpuWrapperContract: data.cpu_wrapper_contract || '',
      cpuSocketContract: data.cpu_socket_contract || '',
      cpuWrapperTop: data.cpu_wrapper_top || '',
      socHarnessId: data.soc_harness_id || '',
      socWrapperId: data.soc_wrapper_id || data.soc_harness_id || '',
      socWrapperContract: data.soc_wrapper_contract || '',
      socVariant: data.soc_variant || '',
      toolchainId: data.toolchain_id || '',
      testSuiteId: data.test_suite_id || '',
      cpuFilelist: data.cpu_filelist || '',
      socFilelist: data.soc_filelist || '',
      inputFilelist: data.input_filelist || '',
      simProgramNames: [...(data.sim_program_names || [])],
      simAllTests: Boolean(data.sim_all_tests),
    },
  }
}

export function transformConfigToParameters(config: ConfigData): ParametersData {
  const out: ParametersData = {
    PDK: config.pdk,
    Design: config.design,
    'Top module': config.topModule,
    Die: {
      Size: [...(config.die.Size || [])],
      Area: config.die.area,
    },
    Core: {
      Size: [...(config.core.Size || [])],
      Area: config.core.area,
      'Bounding box': config.core.boundingBox,
      Utilitization: config.core.utilization,
      Margin: [...config.core.margin] as [number, number],
      'Aspect ratio': config.core.aspectRatio,
    },
    'Max fanout': config.maxFanout,
    'Target density': config.targetDensity,
    'Target overflow': config.targetOverflow,
    'Global right padding': config.globalRightPadding,
    'Cell padding x': config.cellPaddingX,
    'Routability opt flag': config.routabilityOptFlag ? 1 : 0,
    Clock: config.clock,
    'Frequency max [MHz]': config.frequencyMax,
    'Bottom layer': FIXED_BOTTOM_LAYER,
    'Top layer': FIXED_TOP_LAYER,
  }
  out['PDK Root'] = config.pdkRoot ?? ''
  out['Design Tool'] = config.designTool
  out.description = config.description
  if (config.designTool === 'frontend') {
    out.design = config.design
    out.top_module = config.topModule
    out.clock = config.clock
    out.frequency_max = config.frequencyMax
    out.frontend_core_id = config.frontend.coreId
    out.core_id = config.frontend.coreId
    out.cpu_wrapper_id = config.frontend.cpuWrapperId
    out.cpu_wrapper_contract = config.frontend.cpuWrapperContract
    out.cpu_socket_contract = config.frontend.cpuSocketContract
    out.cpu_wrapper_top = config.frontend.cpuWrapperTop
    out.soc_harness_id = config.frontend.socHarnessId
    out.soc_wrapper_id = config.frontend.socWrapperId
    out.soc_wrapper_contract = config.frontend.socWrapperContract
    out.soc_variant = config.frontend.socVariant
    out.toolchain_id = config.frontend.toolchainId
    out.test_suite_id = config.frontend.testSuiteId
    out.cpu_filelist = config.frontend.cpuFilelist
    out.soc_filelist = config.frontend.socFilelist
    out.input_filelist = config.frontend.inputFilelist
    out.sim_program_names = [...config.frontend.simProgramNames]
    out.sim_all_tests = config.frontend.simAllTests
  }
  return out
}

// ============ Composable ============

/**
 * 参数配置管理 Hook
 * 负责从 parameters.json 加载配置参数并管理状态
 */
export function useParameters() {
  const { isDesktopRuntimeAvailable } = useDesktopRuntime()
  const {
    currentProject,
    resourceVersions,
    invalidateWorkspaceResources,
    workspaceSession,
  } = useWorkspace()
  const workspaceLifecycle = useWorkspaceLifecycle()

  const config = reactive<ConfigData>(getDefaultConfig())
  const isLoading = ref(false)
  const isSaving = ref(false)
  const error = ref<string | null>(null)
  const hasChanges = ref(false)
  const isMutationLocked = computed(() =>
    isFlowExecutionActiveForWorkspace(currentProject.value?.path),
  )

  let originalConfig: string = ''
  let resolvedParametersPath: string = ''
  let savingSessionId: string | null = null
  let saveRequestSequence = 0
  let activeSaveRequestId = 0
  let parametersResourceToken = 0
  let saveWriteQueue: Promise<void> = Promise.resolve()

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
    return (
      Boolean(originalConfig) &&
      isFlowExecutionActiveForWorkspace(currentProject.value.path)
    )
  }

  function isSaveContextCurrent(options: {
    sessionId: string
    requestId: number
    resourceToken: number
    parametersPath: string
    projectPath: string
  }): boolean {
    return (
      workspaceLifecycle.isCurrentSession(options.sessionId) &&
      activeSaveRequestId === options.requestId &&
      parametersResourceToken === options.resourceToken &&
      resolvedParametersPath === options.parametersPath &&
      currentProject.value?.path === options.projectPath
    )
  }

  function blockSaveWhileFlowRunning(projectPath = currentProject.value?.path): boolean {
    if (!isFlowExecutionActiveForWorkspace(projectPath)) return false
    error.value = FLOW_RUNNING_SAVE_BLOCKED_MESSAGE
    return true
  }

  function applyParametersFileContent(fileContent: string): void {
    applyParametersData(parseParametersData(fileContent))
  }

  function isParametersRecord(
    value: unknown,
  ): value is ParametersData & Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  }

  function applyParametersData(parametersData: ParametersData): boolean {
    console.log('Loaded parameters data:', parametersData)

    const transformedConfig = transformParametersToConfig(parametersData)
    const nextConfigSnapshot = JSON.stringify(transformedConfig)
    if (nextConfigSnapshot === originalConfig) {
      hasChanges.value = false
      return true
    }

    if (
      !parametersHaveChipIdentity(parametersData) &&
      originalConfig &&
      parametersHaveChipIdentity(JSON.parse(originalConfig) as ConfigData)
    ) {
      console.warn('Ignoring empty parameters payload to keep last chip identity')
      return false
    }

    Object.assign(config, transformedConfig)
    console.log('Loaded config:', config)
    originalConfig = JSON.stringify(config)
    hasChanges.value = false

    console.log('Parameters loaded:', config)
    return true
  }

  async function reloadParametersFromKnownPathIfRunning(): Promise<boolean> {
    const projectPath = currentProject.value?.path
    if (!projectPath || !isFlowExecutionActiveForWorkspace(projectPath)) return false

    const sessionId = workspaceLifecycle.currentSessionId.value
    isLoading.value = true
    error.value = null
    const loadResourceToken = advanceParametersResourceToken()

    try {
      const workspaceHandle = workspaceSession?.value?.workspaceId ?? ''
      if (workspaceHandle && currentProject.value?.designTool !== 'frontend') {
        const snapshot = await workspaceLifecycle.runForSession(sessionId, () =>
          getWorkspaceRuntimeSnapshotApi(workspaceHandle),
        )
        if (snapshot === undefined && !workspaceLifecycle.isCurrentSession(sessionId)) {
          return true
        }
        if (
          snapshot &&
          isParametersRecord(snapshot.parameters) &&
          parametersHaveChipIdentity(snapshot.parameters) &&
          loadResourceToken === parametersResourceToken
        ) {
          applyParametersData(snapshot.parameters as unknown as ParametersData)
          return true
        }
      }

      // Do not fall back to NFS while a GUI-originated flow is running. A
      // missing snapshot keeps the last stable parameters until the next ECC
      // event rather than adding foreground file I/O to the render path.
      if (keepLastParametersDuringFlowReload()) return true

      const knownPath = resolvedParametersPath || fallbackParametersPath(projectPath)
      const resolvedPath = await workspaceLifecycle.runForSession(sessionId, () =>
        resolveProjectPathAccess(knownPath),
      )
      if (resolvedPath === undefined && !workspaceLifecycle.isCurrentSession(sessionId))
        return true
      if (!resolvedPath) {
        if (keepLastParametersDuringFlowReload()) return true
        resetParametersState()
        return true
      }

      const fileContent = await workspaceLifecycle.runForSession(sessionId, () =>
        readProjectTextFile(resolvedPath),
      )
      if (fileContent === undefined && !workspaceLifecycle.isCurrentSession(sessionId))
        return true
      if (fileContent === undefined) return true
      if (loadResourceToken !== parametersResourceToken) return true

      resolvedParametersPath = resolvedPath
      applyParametersFileContent(fileContent)
      return true
    } catch (err) {
      if (!workspaceLifecycle.isCurrentSession(sessionId)) return true
      console.error('Failed to reload running flow parameters:', err)
      if (!keepLastParametersDuringFlowReload() && !originalConfig) {
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
    // Compatibility hook: GUI runtime updates are event driven.
  }

  function startRunningFlowParametersPoll(): void {
    // GUI-originated flow changes arrive as runtime snapshots/events. Keeping a
    // timer here would turn NFS latency into periodic renderer work.
  }

  async function loadParameters(): Promise<void> {
    if (!isDesktopRuntimeAvailable || !currentProject.value?.path) {
      console.warn(
        'Cannot load parameters: desktop bridge unavailable or no project is open',
      )
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
      const homeData = await workspaceLifecycle.runForSession(sessionId, () =>
        fetchSharedHomeData(
          projectPath,
          isDesktopRuntimeAvailable,
          workspaceSession?.value?.workspaceId ?? '',
          currentProject.value?.designTool ?? 'backend',
        ),
      )
      if (homeData === undefined && !workspaceLifecycle.isCurrentSession(sessionId))
        return
      if (!homeData) {
        console.warn('Failed to get home data')
        if (keepLastParametersDuringFlowReload()) return
      }

      if (!homeData?.parameters && keepLastParametersDuringFlowReload()) {
        console.warn('No parameters field found in home.json')
        return
      }

      const parametersPath = homeData?.parameters
        ? convertToLocalPath(homeData.parameters)
        : fallbackParametersPath(projectPath)
      if (!homeData?.parameters) {
        console.warn(
          'No parameters field found in home.json; falling back to',
          parametersPath,
        )
      }
      const workspaceHandle = workspaceSession?.value?.workspaceId ?? ''
      if (workspaceHandle && currentProject.value?.designTool !== 'frontend') {
        const snapshot = await workspaceLifecycle.runForSession(sessionId, () =>
          getWorkspaceRuntimeSnapshotApi(workspaceHandle),
        )
        if (snapshot === undefined && !workspaceLifecycle.isCurrentSession(sessionId)) {
          return
        }
        if (
          snapshot &&
          isParametersRecord(snapshot.parameters) &&
          parametersHaveChipIdentity(snapshot.parameters)
        ) {
          const resolvedPath = await workspaceLifecycle.runForSession(sessionId, () =>
            resolveProjectPathAccess(parametersPath),
          )
          if (
            resolvedPath === undefined &&
            !workspaceLifecycle.isCurrentSession(sessionId)
          ) {
            return
          }
          if (loadResourceToken !== parametersResourceToken) return
          resolvedParametersPath = resolvedPath ?? parametersPath
          applyParametersData(snapshot.parameters as unknown as ParametersData)
          return
        }
      }
      const resolvedPath = await workspaceLifecycle.runForSession(sessionId, () =>
        resolveProjectPathAccess(parametersPath),
      )
      if (resolvedPath === undefined && !workspaceLifecycle.isCurrentSession(sessionId))
        return
      console.log('Loading parameters from:', resolvedPath ?? parametersPath)
      if (!resolvedPath) {
        if (keepLastParametersDuringFlowReload() || originalConfig) return
        resetParametersState()
        return
      }

      const fileContent = await workspaceLifecycle.runForSession(sessionId, () =>
        readProjectTextFile(resolvedPath),
      )
      if (fileContent === undefined && !workspaceLifecycle.isCurrentSession(sessionId))
        return
      if (fileContent === undefined) return

      if (loadResourceToken !== parametersResourceToken) return
      resolvedParametersPath = resolvedPath

      applyParametersFileContent(fileContent)
    } catch (err) {
      if (!workspaceLifecycle.isCurrentSession(sessionId)) return
      console.error('Failed to load parameters:', err)
      error.value = err instanceof Error ? err.message : String(err)
      if (!originalConfig) {
        resetParametersState()
      }
    } finally {
      if (workspaceLifecycle.isCurrentSession(sessionId)) {
        isLoading.value = false
      }
    }
  }

  async function saveParameters(): Promise<boolean> {
    if (!isDesktopRuntimeAvailable || !currentProject.value?.path) {
      console.warn(
        'Cannot save parameters: desktop bridge unavailable or no project is open',
      )
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
        if (
          !isSaveContextCurrent({
            sessionId: saveSessionId,
            requestId: saveRequestId,
            resourceToken: saveResourceToken,
            parametersPath: saveParametersPath,
            projectPath: saveProjectPath,
          })
        ) {
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
      if (
        !isSaveContextCurrent({
          sessionId: saveSessionId,
          requestId: saveRequestId,
          resourceToken: saveResourceToken,
          parametersPath: saveParametersPath,
          projectPath: saveProjectPath,
        })
      ) {
        return true
      }

      if (JSON.stringify(config) === savedConfigSnapshot) {
        originalConfig = savedConfigSnapshot
        hasChanges.value = false
      } else {
        hasChanges.value = true
      }

      const refreshResult = await workspaceLifecycle.runForSession(saveSessionId, () =>
        refreshConfigApi({
          cmd: CMDEnum.refresh_config,
          data: {
            ...(currentProject.value?.designTool === 'frontend'
              ? { designTool: 'frontend' as const }
              : {}),
            directory: saveProjectPath,
            workspaceHandle: workspaceLifecycle.session.value.workspaceId,
          },
        }),
      )
      if (
        !isSaveContextCurrent({
          sessionId: saveSessionId,
          requestId: saveRequestId,
          resourceToken: saveResourceToken,
          parametersPath: saveParametersPath,
          projectPath: saveProjectPath,
        })
      ) {
        return refreshResult?.response === ResponseEnum.success
      }

      invalidateWorkspaceResources(['parameters', 'home', 'step-config', 'flow'], {
        sessionId: saveSessionId,
      })

      if (refreshResult?.response !== ResponseEnum.success) {
        error.value = firstResponseMessage(
          refreshResult,
          'Refresh workspace config failed',
        )
        return false
      }

      console.log('Parameters saved successfully')
      return true
    } catch (err) {
      if (
        !isSaveContextCurrent({
          sessionId: saveSessionId,
          requestId: saveRequestId,
          resourceToken: saveResourceToken,
          parametersPath: saveParametersPath,
          projectPath: saveProjectPath,
        })
      ) {
        return false
      }
      console.error('Failed to save parameters:', err)
      error.value = err instanceof Error ? err.message : String(err)
      return false
    } finally {
      if (
        isSaveContextCurrent({
          sessionId: saveSessionId,
          requestId: saveRequestId,
          resourceToken: saveResourceToken,
          parametersPath: saveParametersPath,
          projectPath: saveProjectPath,
        })
      ) {
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
    { deep: true },
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
    { immediate: true },
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
    return ROUTING_LAYER_ORDER.map((layer) => ({ label: layer, value: layer }))
  })

  const layersList = computed(() => {
    return layerOptions.value.map((o) => o.value)
  })

  const isLayerInRange = (layer: string): boolean => {
    return layersList.value.includes(layer)
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
    refreshParameters,
  }
}
