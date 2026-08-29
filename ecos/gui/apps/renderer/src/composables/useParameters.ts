import { ref, reactive, watch, computed, getCurrentScope, onScopeDispose } from 'vue'
import { useWorkspace } from './useWorkspace'
import { useDesktopRuntime } from './useDesktopRuntime'
import { fetchSharedHomeData, convertRemoteToLocalPath } from './useHomeData'
import {
  getWorkspaceRuntimeSnapshotApi,
  writeWorkspaceParametersResourceApi,
} from '@/api/workspaceResources'
import { resolveProjectPathAccess } from '@/utils/projectFs'
import { readWorkspaceParametersFile } from '@/utils/projectFiles'
import { useWorkspaceLifecycle } from './useWorkspaceLifecycle'
import { isFlowExecutionActiveForWorkspace } from './useFlowRunner'
import { refreshConfigApi } from '@/api/flow'
import { CMDEnum, ResponseEnum } from '@/api/type'
import {
  assertScalarNotContainer,
  losslessNumber,
  losslessNumberList,
  isPlainRecord,
} from '@/utils/numbers'

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

function dieSizeFromDieArea(dieArea: unknown): number[] {
  if (dieArea == null) return []
  if (!isPlainRecord(dieArea)) {
    throw new Error(
      'Parameter die_area must be a table, not a scalar; edit the workspace configuration manually',
    )
  }
  const width = dieArea.width
  const height = dieArea.height
  if (width == null && height == null) return []
  return [
    losslessNumber(width ?? 0, 'die_area.width'),
    losslessNumber(height ?? 0, 'die_area.height'),
  ]
}

function normalizeDie(d: unknown, dieArea?: unknown): ParametersData['Die'] {
  if (d == null) {
    const size = dieSizeFromDieArea(dieArea)
    return { Size: size, Area: size.length >= 2 ? size[0]! * size[1]! : 0 }
  }
  if (!isPlainRecord(d)) {
    throw new Error(
      'Parameter die must be a table, not a scalar; edit the workspace configuration manually',
    )
  }
  const size = d.Size ?? d.size
  const area = d.Area ?? d.area
  const listed = losslessNumberList(size, 'Die.Size')
  const fromDieArea = listed.length >= 2 ? listed : dieSizeFromDieArea(dieArea)
  return {
    Size: fromDieArea,
    Area: area != null ? losslessNumber(area, 'Die.Area') : 0,
  }
}

function normalizeCore(c: unknown, dieArea?: unknown): ParametersData['Core'] {
  const dieAreaTable = dieArea == null ? null : isPlainRecord(dieArea) ? dieArea : null
  if (dieArea != null && dieAreaTable == null) {
    throw new Error(
      'Parameter die_area must be a table, not a scalar; edit the workspace configuration manually',
    )
  }
  if (c == null) {
    const utilitization =
      dieAreaTable?.utilitization != null
        ? losslessNumber(dieAreaTable.utilitization, 'die_area.utilitization')
        : 0.4
    const margin =
      dieAreaTable?.margin != null
        ? losslessNumber(dieAreaTable.margin, 'die_area.margin')
        : 2
    return {
      Size: [],
      Area: 0,
      'Bounding box': '',
      Utilitization: utilitization,
      Margin: [margin, margin],
      'Aspect ratio': 1,
    }
  }
  if (!isPlainRecord(c)) {
    throw new Error(
      'Parameter core must be a table, not a scalar; edit the workspace configuration manually',
    )
  }
  const size = c.Size ?? c.size
  const area = c.Area ?? c.area
  const margin = c.Margin ?? c.margin
  const listedMargin = losslessNumberList(margin, 'Core.Margin')
  const dieAreaMargin =
    dieAreaTable?.margin != null
      ? losslessNumber(dieAreaTable.margin, 'die_area.margin')
      : 2
  const m: [number, number] =
    listedMargin.length >= 2
      ? [listedMargin[0]!, listedMargin[1]!]
      : [dieAreaMargin, dieAreaMargin]
  return {
    Size: losslessNumberList(size, 'Core.Size'),
    Area: area != null ? losslessNumber(area, 'Core.Area') : 0,
    'Bounding box': losslessString(
      c['Bounding box'] ?? c.bounding_box ?? '',
      'Bounding box',
    ),
    Utilitization: losslessNumber(
      c.Utilitization ?? c.utilitization ?? dieAreaTable?.utilitization ?? 0.4,
      'Core.Utilitization',
    ),
    Margin: m,
    'Aspect ratio': losslessNumber(
      c['Aspect ratio'] ?? c.aspect_ratio ?? 1,
      'Core.Aspect ratio',
    ),
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (value == null) return []
  if (
    value instanceof Date ||
    typeof value === 'bigint' ||
    (typeof value === 'number' && !Number.isFinite(value)) ||
    !Array.isArray(value)
  ) {
    throw new Error(
      'Parameter sim_program_names must be an array; edit the workspace configuration manually',
    )
  }
  return value
    .map((item) => losslessString(item, 'sim_program_names'))
    .filter((item) => item.length > 0)
}

/**
 * Boolean conversion for GUI-known fields: a TOML date under one would
 * otherwise persist as `true` on the next save.
 */
function losslessBoolean(value: unknown, label: string): boolean {
  if (value instanceof Date || typeof value === 'bigint') {
    throw new Error(
      `Parameter ${label} holds a value the GUI cannot edit losslessly; ` +
        'edit the workspace configuration manually',
    )
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error(
      `Parameter ${label} value ${value} is not a finite number; ` +
        'edit the workspace configuration manually',
    )
  }
  assertScalarNotContainer(value, label)
  return Boolean(value)
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
    record.top_module,
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

/**
 * String conversion for GUI-known fields: a TOML date under one would
 * otherwise be written back as a locale-dependent string on the next save,
 * a bigint or non-finite number would change type (integer -> string), and a
 * table or array would stringify to "[object Object]" or a comma-joined list.
 */
function losslessString(value: unknown, label: string): string {
  if (value instanceof Date) {
    throw new Error(
      `Parameter ${label} holds a TOML date the GUI cannot edit losslessly; ` +
        'edit the workspace configuration manually',
    )
  }
  if (typeof value === 'bigint') {
    throw new Error(
      `Parameter ${label} value ${value} exceeds the safe integer range; ` +
        'edit the workspace configuration manually',
    )
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error(
      `Parameter ${label} value ${value} is not a finite number; ` +
        'edit the workspace configuration manually',
    )
  }
  assertScalarNotContainer(value, label)
  return String(value)
}

/**
 * Normalize a raw parameters record into ParametersData. Accepts both the
 * legacy display-key shape (home/parameters.json) and the canonical flat
 * snake_case shape (home/ecc.toml / workspace.snapshot).
 */
export function parseParametersRecord(raw: Record<string, unknown>): ParametersData {
  return {
    PDK: losslessString(raw.PDK ?? raw.pdk ?? '', 'PDK'),
    Design: losslessString(raw.Design ?? raw.design ?? '', 'Design'),
    design: raw.design != null ? losslessString(raw.design, 'design') : undefined,
    description:
      raw.description != null
        ? losslessString(raw.description, 'description')
        : undefined,
    'Design Tool':
      raw['Design Tool'] != null
        ? losslessString(raw['Design Tool'], 'Design Tool')
        : raw.design_tool != null
          ? losslessString(raw.design_tool, 'design_tool')
          : undefined,
    'Top module': losslessString(raw['Top module'] ?? raw.top_module ?? '', 'Top module'),
    top_module:
      raw.top_module != null ? losslessString(raw.top_module, 'top_module') : undefined,
    Die: normalizeDie(raw.Die ?? raw.die, raw['Die Area'] ?? raw.die_area),
    Core: normalizeCore(raw.Core ?? raw.core, raw['Die Area'] ?? raw.die_area),
    'Max fanout': losslessNumber(raw['Max fanout'] ?? raw.max_fanout ?? 20, 'Max fanout'),
    'Target density': losslessNumber(
      raw['Target density'] ?? raw.target_density ?? 0.3,
      'Target density',
    ),
    'Target overflow': losslessNumber(
      raw['Target overflow'] ?? raw.target_overflow ?? 0.1,
      'Target overflow',
    ),
    'Global right padding': losslessNumber(
      raw['Global right padding'] ?? raw.global_right_padding ?? 0,
      'Global right padding',
    ),
    'Cell padding x': losslessNumber(
      raw['Cell padding x'] ?? raw.cell_padding_x ?? 600,
      'Cell padding x',
    ),
    'Routability opt flag': losslessNumber(
      raw['Routability opt flag'] ?? raw.routability_opt_flag ?? 1,
      'Routability opt flag',
    ),
    Clock: losslessString(raw.Clock ?? raw.clock ?? '', 'Clock'),
    clock: raw.clock != null ? losslessString(raw.clock, 'clock') : undefined,
    'Frequency max [MHz]': losslessNumber(
      raw['Frequency max [MHz]'] ?? raw.frequency_max ?? 100,
      'Frequency max [MHz]',
    ),
    frequency_max:
      raw.frequency_max != null
        ? losslessNumber(raw.frequency_max, 'frequency_max')
        : undefined,
    'Bottom layer': losslessString(
      raw['Bottom layer'] ?? raw.bottom_layer ?? FIXED_BOTTOM_LAYER,
      'Bottom layer',
    ),
    'Top layer': losslessString(
      raw['Top layer'] ?? raw.top_layer ?? FIXED_TOP_LAYER,
      'Top layer',
    ),
    'PDK Root':
      raw['PDK Root'] != null
        ? losslessString(raw['PDK Root'], 'PDK Root')
        : raw.pdk_root != null
          ? losslessString(raw.pdk_root, 'pdk_root')
          : undefined,
    cpu_filelist:
      raw.cpu_filelist != null
        ? losslessString(raw.cpu_filelist, 'cpu_filelist')
        : undefined,
    soc_filelist:
      raw.soc_filelist != null
        ? losslessString(raw.soc_filelist, 'soc_filelist')
        : undefined,
    soc_variant:
      raw.soc_variant != null
        ? losslessString(raw.soc_variant, 'soc_variant')
        : undefined,
    soc_harness_id:
      raw.soc_harness_id != null
        ? losslessString(raw.soc_harness_id, 'soc_harness_id')
        : undefined,
    soc_wrapper_id:
      raw.soc_wrapper_id != null
        ? losslessString(raw.soc_wrapper_id, 'soc_wrapper_id')
        : undefined,
    soc_wrapper_contract:
      raw.soc_wrapper_contract != null
        ? losslessString(raw.soc_wrapper_contract, 'soc_wrapper_contract')
        : undefined,
    frontend_core_id:
      raw.frontend_core_id != null
        ? losslessString(raw.frontend_core_id, 'frontend_core_id')
        : undefined,
    core_id: raw.core_id != null ? losslessString(raw.core_id, 'core_id') : undefined,
    cpu_wrapper_id:
      raw.cpu_wrapper_id != null
        ? losslessString(raw.cpu_wrapper_id, 'cpu_wrapper_id')
        : undefined,
    cpu_wrapper_contract:
      raw.cpu_wrapper_contract != null
        ? losslessString(raw.cpu_wrapper_contract, 'cpu_wrapper_contract')
        : undefined,
    cpu_socket_contract:
      raw.cpu_socket_contract != null
        ? losslessString(raw.cpu_socket_contract, 'cpu_socket_contract')
        : undefined,
    cpu_wrapper_top:
      raw.cpu_wrapper_top != null
        ? losslessString(raw.cpu_wrapper_top, 'cpu_wrapper_top')
        : undefined,
    toolchain_id:
      raw.toolchain_id != null
        ? losslessString(raw.toolchain_id, 'toolchain_id')
        : undefined,
    test_suite_id:
      raw.test_suite_id != null
        ? losslessString(raw.test_suite_id, 'test_suite_id')
        : undefined,
    input_filelist:
      raw.input_filelist != null
        ? losslessString(raw.input_filelist, 'input_filelist')
        : undefined,
    sim_program_names: normalizeStringArray(raw.sim_program_names),
    sim_all_tests: losslessBoolean(raw.sim_all_tests, 'sim_all_tests'),
  }
}

export function parseParametersData(fileContent: string): ParametersData {
  return parseParametersRecord(JSON.parse(fileContent) as Record<string, unknown>)
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

  /**
   * resolveProjectPathAccess without the failure mode: a stale or
   * out-of-scope metadata pointer (e.g. home.json still naming a missing
   * parameters.json) must not gate the format-aware read — the main-process
   * helper locates and authorizes the actual config itself.
   */
  async function resolveParametersPathOrNull(
    sessionId: string,
    path: string,
  ): Promise<string | null | undefined> {
    try {
      return await workspaceLifecycle.runForSession(sessionId, () =>
        resolveProjectPathAccess(path),
      )
    } catch {
      return null
    }
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
          applyParametersData(
            parseParametersRecord(snapshot.parameters as Record<string, unknown>),
          )
          return true
        }
      }

      // Do not fall back to NFS while a GUI-originated flow is running. A
      // missing snapshot keeps the last stable parameters until the next ECC
      // event rather than adding foreground file I/O to the render path.
      if (keepLastParametersDuringFlowReload()) return true

      const knownPath = resolvedParametersPath || fallbackParametersPath(projectPath)
      const resolvedPath = await resolveParametersPathOrNull(sessionId, knownPath)
      if (resolvedPath === undefined && !workspaceLifecycle.isCurrentSession(sessionId))
        return true

      const parametersRecord = await workspaceLifecycle.runForSession(sessionId, () =>
        readWorkspaceParametersFile(projectPath),
      )
      if (
        parametersRecord === undefined &&
        !workspaceLifecycle.isCurrentSession(sessionId)
      )
        return true
      if (parametersRecord === undefined) return true
      if (loadResourceToken !== parametersResourceToken) return true

      // The format-aware read locates the actual config (home/ecc.toml
      // preferred), so a stale legacy pointer never gates the reload.
      resolvedParametersPath = resolvedPath ?? (parametersRecord ? knownPath : '')
      if (parametersRecord) {
        applyParametersData(parseParametersRecord(parametersRecord))
      } else {
        if (keepLastParametersDuringFlowReload()) return true
        resetParametersState()
      }
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
          const resolvedPath = await resolveParametersPathOrNull(
            sessionId,
            parametersPath,
          )
          if (
            resolvedPath === undefined &&
            !workspaceLifecycle.isCurrentSession(sessionId)
          ) {
            return
          }
          if (loadResourceToken !== parametersResourceToken) return
          resolvedParametersPath = resolvedPath ?? parametersPath
          applyParametersData(
            parseParametersRecord(snapshot.parameters as Record<string, unknown>),
          )
          return
        }
      }
      const resolvedPath = await resolveParametersPathOrNull(sessionId, parametersPath)
      if (resolvedPath === undefined && !workspaceLifecycle.isCurrentSession(sessionId))
        return
      console.log('Loading parameters from:', resolvedPath ?? parametersPath)

      const parametersRecord = await workspaceLifecycle.runForSession(sessionId, () =>
        readWorkspaceParametersFile(projectPath),
      )
      if (
        parametersRecord === undefined &&
        !workspaceLifecycle.isCurrentSession(sessionId)
      )
        return
      if (parametersRecord === undefined) return

      if (loadResourceToken !== parametersResourceToken) return
      // The main-process helper locates the actual config (home/ecc.toml
      // preferred, legacy parameters.json fallback), so a TOML-only
      // workspace loads even when the legacy fallback path did not resolve.
      resolvedParametersPath = resolvedPath ?? (parametersRecord ? parametersPath : '')

      if (parametersRecord) {
        applyParametersData(parseParametersRecord(parametersRecord))
      } else {
        if (keepLastParametersDuringFlowReload() || originalConfig) return
        resetParametersState()
      }
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
        console.log('Saving parameters for workspace:', saveProjectPath)

        await writeWorkspaceParametersResourceApi(
          parametersData as unknown as Record<string, unknown>,
          saveProjectPath,
        )
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
