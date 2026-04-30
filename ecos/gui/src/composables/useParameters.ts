import { ref, reactive, watch, computed } from 'vue'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { useWorkspace } from './useWorkspace'
import { useTauri } from './useTauri'
import { fetchSharedHomeData, convertRemoteToLocalPath } from './useHomeData'
import { resolveProjectPathAccess } from '@/utils/projectFs'

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
  const { isInTauri } = useTauri()
  const { currentProject, sseMessages, stepRefreshCounter } = useWorkspace()

  const config = reactive<ConfigData>(getDefaultConfig())
  const isLoading = ref(false)
  const isSaving = ref(false)
  const error = ref<string | null>(null)
  const hasChanges = ref(false)

  let originalConfig: string = ''
  let resolvedParametersPath: string = ''

  function resetParametersState(): void {
    Object.assign(config, getDefaultConfig())
    originalConfig = ''
    resolvedParametersPath = ''
    hasChanges.value = false
  }

  function convertToLocalPath(remotePath: string): string {
    const projectPath = currentProject.value?.path
    return projectPath ? convertRemoteToLocalPath(remotePath, projectPath) : remotePath
  }

  async function loadParameters(): Promise<void> {
    if (!isInTauri || !currentProject.value?.path) {
      console.warn('Cannot load parameters: not in Tauri environment or no project is open')
      resetParametersState()
      return
    }

    isLoading.value = true
    error.value = null
    resolvedParametersPath = ''

    try {
      const projectPath = currentProject.value.path

      const homeData = await fetchSharedHomeData(projectPath, isInTauri)
      if (!homeData) {
        console.warn('Failed to get home data')
        resetParametersState()
        return
      }

      if (!homeData.parameters) {
        console.warn('No parameters field found in home.json')
        resetParametersState()
        return
      }

      const parametersPath = convertToLocalPath(homeData.parameters)
      const resolvedPath = await resolveProjectPathAccess(parametersPath)
      console.log('Loading parameters from:', resolvedPath ?? parametersPath)
      if (!resolvedPath) {
        resetParametersState()
        return
      }

      const fileContent = await readTextFile(resolvedPath)
      const parametersData = parseParametersData(fileContent)

      console.log('Loaded parameters data:', parametersData)

      resolvedParametersPath = resolvedPath

      const transformedConfig = transformParametersToConfig(parametersData)
      Object.assign(config, transformedConfig)
      console.log('Loaded config:', config)
      originalConfig = JSON.stringify(config)
      hasChanges.value = false

      console.log('Parameters loaded:', config)
    } catch (err) {
      console.error('Failed to load parameters:', err)
      error.value = err instanceof Error ? err.message : String(err)
      resetParametersState()
    } finally {
      isLoading.value = false
    }
  }

  async function saveParameters(): Promise<boolean> {
    if (!isInTauri || !currentProject.value?.path) {
      console.warn('Cannot save parameters: not in Tauri environment or no project is open')
      return false
    }

    if (!resolvedParametersPath) {
      console.warn('Parameters file path is not resolved. Call loadParameters first.')
      return false
    }

    isSaving.value = true
    error.value = null

    try {
      console.log('Saving parameters to:', resolvedParametersPath)
      const resolvedPath = await resolveProjectPathAccess(resolvedParametersPath)
      if (!resolvedPath) {
        return false
      }

      const parametersData = transformConfigToParameters(config)
      const fileContent = JSON.stringify(parametersData, null, 4)

      await writeTextFile(resolvedPath, fileContent)

      originalConfig = JSON.stringify(config)
      hasChanges.value = false

      console.log('Parameters saved successfully')
      return true
    } catch (err) {
      console.error('Failed to save parameters:', err)
      error.value = err instanceof Error ? err.message : String(err)
      return false
    } finally {
      isSaving.value = false
    }
  }

  function resetParameters(): void {
    if (originalConfig) {
      Object.assign(config, JSON.parse(originalConfig))
      hasChanges.value = false
    }
  }

  async function refreshParameters(): Promise<void> {
    await loadParameters()
  }

  async function reloadParametersIfClean(): Promise<void> {
    if (hasChanges.value) {
      console.warn('Skip automatic parameters reload because there are unsaved changes')
      return
    }
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
      if (newPath) {
        await loadParameters()
      } else {
        resetParametersState()
      }
    },
    { immediate: true }
  )

  watch(
    () => sseMessages.value.length,
    async (newLen, oldLen) => {
      if (newLen <= (oldLen ?? 0)) return

      const latest = sseMessages.value[newLen - 1]
      if (!latest || latest.cmd !== 'notify') return

      const info = latest.data?.info as Record<string, unknown> | undefined
      if (!info?.home_page) return

      await reloadParametersIfClean()
    }
  )

  watch(stepRefreshCounter, async () => {
    await reloadParametersIfClean()
  })

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
    layerOptions,
    layersList,
    isLayerInRange,
    loadParameters,
    saveParameters,
    resetParameters,
    refreshParameters
  }
}
