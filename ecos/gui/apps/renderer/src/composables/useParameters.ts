import { ref, reactive, watch, computed, getCurrentScope, onScopeDispose } from 'vue'
import { useWorkspace } from './useWorkspace'
import { getWorkspaceRuntimeSnapshotApi } from '@/api/workspaceResources'
import { resolveProjectPathAccess } from '@/utils/projectFs'
import { readProjectTextFile, writeProjectTextFile } from '@/utils/projectFiles'
import { useWorkspaceLifecycle } from './useWorkspaceLifecycle'
import { isFlowExecutionActiveForWorkspace } from './useFlowRunner'
import { refreshConfigApi } from '@/api/flow'
import { CMDEnum, ResponseEnum } from '@/api/type'
import { updateManagedWorkspaceConfiguration } from './workspaceConfigurationUpdate'

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

type ParameterRecord = Record<string, unknown>

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
  const size = o.Size ?? o.size
  const arr = Array.isArray(size) ? size.map(Number) : []
  return {
    Size: arr,
    Area: Number(o.Area ?? o.area ?? 0),
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
  const size = o.Size ?? o.size
  const arr = Array.isArray(size) ? size.map(Number) : []
  const margin = o.Margin ?? o.margin
  let m: [number, number] = [2, 2]
  if (Array.isArray(margin) && margin.length >= 2) {
    m = [Number(margin[0]), Number(margin[1])]
  }
  return {
    Size: arr,
    Area: Number(o.Area ?? o.area ?? 0),
    'Bounding box': String(o['Bounding box'] ?? o.bounding_box ?? ''),
    Utilitization: Number(o.Utilitization ?? o.utilitization ?? 0.4),
    Margin: m,
    'Aspect ratio': Number(o['Aspect ratio'] ?? o.aspect_ratio ?? 1),
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

function normalizeParametersData(raw: ParameterRecord | ParametersData): ParametersData {
  const record = raw as ParameterRecord
  const dreamplace =
    record.dreamplace &&
    typeof record.dreamplace === 'object' &&
    !Array.isArray(record.dreamplace)
      ? (record.dreamplace as ParameterRecord)
      : {}

  return {
    PDK: String(record.PDK ?? record.pdk ?? ''),
    Design: String(record.Design ?? record.design ?? ''),
    design: record.design != null ? String(record.design) : undefined,
    description: record.description != null ? String(record.description) : undefined,
    'Design Tool':
      record['Design Tool'] != null ? String(record['Design Tool']) : undefined,
    'Top module': String(record['Top module'] ?? record.top_module ?? ''),
    top_module: record.top_module != null ? String(record.top_module) : undefined,
    Die: normalizeDie(record.Die ?? record.die),
    Core: normalizeCore(record.Core ?? record.core),
    'Max fanout': Number(record['Max fanout'] ?? record.max_fanout ?? 20),
    'Target density': Number(
      dreamplace.target_density ??
        record['Target density'] ??
        record.target_density ??
        0.3,
    ),
    'Target overflow': Number(
      dreamplace.stop_overflow ??
        dreamplace.target_overflow ??
        record['Target overflow'] ??
        record.target_overflow ??
        0.1,
    ),
    'Global right padding': Number(
      record['Global right padding'] ?? record.global_right_padding ?? 0,
    ),
    'Cell padding x': Number(
      dreamplace.cell_padding_x ??
        record['Cell padding x'] ??
        record.cell_padding_x ??
        600,
    ),
    'Routability opt flag': Number(
      dreamplace.routability_opt_flag ??
        record['Routability opt flag'] ??
        record.routability_opt_flag ??
        1,
    ),
    Clock: String(record.Clock ?? record.clock ?? ''),
    clock: record.clock != null ? String(record.clock) : undefined,
    'Frequency max [MHz]': Number(
      record['Frequency max [MHz]'] ?? record.frequency_max ?? 100,
    ),
    frequency_max:
      record.frequency_max != null ? Number(record.frequency_max) : undefined,
    'Bottom layer': String(
      record['Bottom layer'] ?? record.bottom_layer ?? FIXED_BOTTOM_LAYER,
    ),
    'Top layer': String(record['Top layer'] ?? record.top_layer ?? FIXED_TOP_LAYER),
    'PDK Root':
      record['PDK Root'] != null || record.pdk_root != null
        ? String(record['PDK Root'] ?? record.pdk_root)
        : undefined,
    cpu_filelist: record.cpu_filelist != null ? String(record.cpu_filelist) : undefined,
    soc_filelist: record.soc_filelist != null ? String(record.soc_filelist) : undefined,
    soc_variant: record.soc_variant != null ? String(record.soc_variant) : undefined,
    soc_harness_id:
      record.soc_harness_id != null ? String(record.soc_harness_id) : undefined,
    soc_wrapper_id:
      record.soc_wrapper_id != null ? String(record.soc_wrapper_id) : undefined,
    soc_wrapper_contract:
      record.soc_wrapper_contract != null
        ? String(record.soc_wrapper_contract)
        : undefined,
    frontend_core_id:
      record.frontend_core_id != null ? String(record.frontend_core_id) : undefined,
    core_id: record.core_id != null ? String(record.core_id) : undefined,
    cpu_wrapper_id:
      record.cpu_wrapper_id != null ? String(record.cpu_wrapper_id) : undefined,
    cpu_wrapper_contract:
      record.cpu_wrapper_contract != null
        ? String(record.cpu_wrapper_contract)
        : undefined,
    cpu_socket_contract:
      record.cpu_socket_contract != null ? String(record.cpu_socket_contract) : undefined,
    cpu_wrapper_top:
      record.cpu_wrapper_top != null ? String(record.cpu_wrapper_top) : undefined,
    toolchain_id: record.toolchain_id != null ? String(record.toolchain_id) : undefined,
    test_suite_id:
      record.test_suite_id != null ? String(record.test_suite_id) : undefined,
    input_filelist:
      record.input_filelist != null ? String(record.input_filelist) : undefined,
    sim_program_names: normalizeStringArray(record.sim_program_names),
    sim_all_tests: Boolean(record.sim_all_tests),
  }
}

export function parseParametersData(fileContent: string): ParametersData {
  const raw = JSON.parse(fileContent) as ParameterRecord
  return normalizeParametersData(raw)
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
  const {
    currentProject,
    resourceVersions,
    invalidateWorkspaceResources,
    workspaceSession,
  } = useWorkspace()
  const workspaceLifecycle = useWorkspaceLifecycle()

  const config = reactive<ConfigData>(getDefaultConfig())
  const isLoading = ref(false)
  const isLoaded = ref(false)
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
    isLoading.value = false
    isLoaded.value = false
    hasChanges.value = false
    isSaving.value = false
    savingSessionId = null
    activeSaveRequestId = 0
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

  function applyParametersData(
    parametersData: ParameterRecord | ParametersData,
  ): boolean {
    const normalizedParameters = normalizeParametersData(parametersData)
    console.log('Loaded parameters data:', normalizedParameters)

    const transformedConfig = transformParametersToConfig(normalizedParameters)
    const nextConfigSnapshot = JSON.stringify(transformedConfig)
    if (nextConfigSnapshot === originalConfig) {
      isLoaded.value = parametersHaveChipIdentity(normalizedParameters)
      hasChanges.value = false
      return true
    }

    if (
      !parametersHaveChipIdentity(normalizedParameters) &&
      originalConfig &&
      parametersHaveChipIdentity(JSON.parse(originalConfig) as ConfigData)
    ) {
      console.warn('Ignoring empty parameters payload to keep last chip identity')
      return false
    }

    Object.assign(config, transformedConfig)
    isLoaded.value = parametersHaveChipIdentity(normalizedParameters)
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
      const isBackendWorkspace =
        currentProject.value?.designTool === 'backend' ||
        (currentProject.value?.designTool !== 'frontend' && Boolean(workspaceHandle))
      if (isBackendWorkspace) {
        if (!workspaceHandle) throw new Error('ECC Workspace session is unavailable.')
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
          applyParametersData(snapshot.parameters)
          return true
        }
        if (!keepLastParametersDuringFlowReload()) {
          throw new Error('ECC Workspace Parameters are unavailable.')
        }
        return true
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
    if (!currentProject.value?.path) {
      console.warn('Cannot load parameters: no project is open')
      resetParametersState()
      return
    }
    if (originalConfig && (await reloadParametersFromKnownPathIfRunning())) return

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
      const parametersPath = fallbackParametersPath(projectPath)
      const workspaceHandle = workspaceSession?.value?.workspaceId ?? ''
      const isBackendWorkspace =
        currentProject.value?.designTool === 'backend' ||
        (currentProject.value?.designTool !== 'frontend' && Boolean(workspaceHandle))
      if (isBackendWorkspace) {
        if (!workspaceHandle) throw new Error('ECC Workspace session is unavailable.')
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
          if (loadResourceToken !== parametersResourceToken) return
          resolvedParametersPath = parametersPath
          applyParametersData(snapshot.parameters)
          return
        }
        throw new Error('ECC Workspace Parameters are unavailable.')
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
    if (!currentProject.value?.path) {
      console.warn('Cannot save parameters: no project is open')
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
      const isBackendWorkspace = currentProject.value.designTool === 'backend'
      let updatedWorkspaceRevision: number | undefined
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
        if (isBackendWorkspace) {
          const workspaceHandle = workspaceLifecycle.session.value.workspaceId
          const expectedWorkspaceRevision =
            workspaceLifecycle.session.value.workspaceRevision
          if (!workspaceHandle || !Number.isInteger(expectedWorkspaceRevision)) {
            throw new Error('The current Workspace revision is unavailable.')
          }
          updatedWorkspaceRevision = await updateManagedWorkspaceConfiguration({
            config,
            original: JSON.parse(originalConfig) as ConfigData,
            workspaceHandle,
            workspaceRevision: expectedWorkspaceRevision!,
          })
        } else {
          console.log('Saving parameters to:', saveParametersPath)
          const resolvedPath = await resolveProjectPathAccess(saveParametersPath)
          if (!resolvedPath) return
          await writeProjectTextFile(resolvedPath, fileContent)
        }
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

      if (isBackendWorkspace && updatedWorkspaceRevision !== undefined) {
        workspaceLifecycle.updateWorkspaceRevision(
          updatedWorkspaceRevision,
          saveSessionId,
        )
        invalidateWorkspaceResources(['parameters', 'home', 'step-config', 'flow'], {
          sessionId: saveSessionId,
        })
        console.log('Workspace configuration updated successfully')
        return true
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
    () => workspaceLifecycle.currentSessionId.value,
    (sessionId, previousSessionId) => {
      if (sessionId === previousSessionId) return
      advanceParametersResourceToken()
      isLoading.value = false
    },
    { flush: 'sync' },
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
    isLoaded,
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
