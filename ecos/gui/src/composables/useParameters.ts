import { ref, reactive, watch, onMounted, computed } from 'vue'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { useWorkspace } from './useWorkspace'
import { useTauri } from './useTauri'
import { fetchSharedHomeData, convertRemoteToLocalPath } from './useHomeData'

// ============ 类型定义 ============

/** parameters.json 中的 Track 数据结构 */
export interface ParameterTrack {
  layer: string
  'x start': number
  'x step': number
  'y start': number
  'y step': number
}

/** parameters.json 中的 PDN IO 数据结构 */
export interface ParameterPdnIO {
  'net name': string
  direction: string
  'is power': boolean
}

/** parameters.json 中的 Global Connect 数据结构 */
export interface ParameterGlobalConnect {
  'net name': string
  'instance pin name': string
  'is power': boolean
}

/** parameters.json 中的 PDN Stripe 数据结构 */
export interface ParameterStripe {
  layer: string
  'power net': string
  'ground net': string
  width: number
  pitch: number
  offset: number
}

/** parameters.json 中的 Connect Layers 数据结构 */
export interface ParameterConnectLayers {
  layers: string[]
}

/** parameters.json 完整数据结构 */
export interface ParametersData {
  PDK: string
  Design: string
  'Top module': string
  Die: {
    Size: number[]
    'Bounding box': string
  }
  Core: {
    Size: number[]
    'Bounding box': string
    Utilitization: number
    Margin: [number, number]
    'Aspect ratio': number
  }
  'Max fanout': number
  'Target density': number
  'Target overflow': number
  Clock: string
  'Frequency max [MHz]': number
  'Bottom layer': string
  'Top layer': string
  Floorplan: {
    'Tap distance': number
    'Auto place pin': {
      layer: string
      width: number
      height: number
      sides: string[]
    }
    Tracks: ParameterTrack[]
  }
  PDN: {
    IO: ParameterPdnIO[]
    'Global connect': ParameterGlobalConnect[]
    grid?: {
      layer: string
      'power net': string
      'power ground'?: string
      'ground net'?: string
      width: number
      offset: number
    }
    Grid?: {
      layer: string
      'power net': string
      'ground net': string
      width: number
      offset: number
    }
    Stripe: ParameterStripe[]
    'Connect layers': ParameterConnectLayers[]
  }
}

/** 前端使用的配置数据结构（驼峰命名） */
export interface ConfigData {
  pdk: string
  design: string
  topModule: string
  die: { boundingBox: string, Size: number[] }
  core: {
    boundingBox: string
    utilization: number
    margin: [number, number]
    aspectRatio: number
    Size: number[]
  }
  maxFanout: number
  targetDensity: number
  targetOverflow: number
  clock: string
  frequencyMax: number
  bottomLayer: string
  topLayer: string
  floorplan: {
    tapDistance: number
    autoPlacePin: { layer: string; width: number; height: number }
    tracks: { layer: string; xStart: number; xStep: number; yStart: number; yStep: number }[]
  }
  pdn: {
    io: { netName: string; direction: string; isPower: boolean }[]
    globalConnect: { netName: string; instancePinName: string; isPower: boolean }[]
    grid: { layer: string; powerNet: string; groundNet: string; width: number; offset: number }
    stripe: { layer: string; powerNet: string; groundNet: string; width: number; pitch: number; offset: number }[]
    connectLayers: { layers: string[] }[]
  }
}

// ============ 工具函数 ============

/** 获取默认配置 */
function getDefaultConfig(): ConfigData {
  return {
    pdk: '',
    design: '',
    topModule: '',
    die: { boundingBox: '', Size: [] },
    core: {
      boundingBox: '',
      utilization: 0.4,
      margin: [10, 10],
      aspectRatio: 1,
      Size: []
    },
    maxFanout: 20,
    targetDensity: 0.3,
    targetOverflow: 0.1,
    clock: '',
    frequencyMax: 100,
    bottomLayer: 'MET1',
    topLayer: 'MET5',
    floorplan: {
      tapDistance: 58,
      autoPlacePin: { layer: 'MET3', width: 300, height: 600 },
      tracks: []
    },
    pdn: {
      io: [],
      globalConnect: [],
      grid: { layer: 'MET1', powerNet: 'VDD', groundNet: 'VSS', width: 0.16, offset: 0 },
      stripe: [],
      connectLayers: []
    }
  }
}

/** 将 parameters.json 数据转换为前端配置格式 */
function transformParametersToConfig(data: ParametersData): ConfigData {
  // 处理 grid 字段（兼容两种命名方式，PDN 可能不存在）
  const gridData = data.PDN?.grid || data.PDN?.Grid
  // 兼容不同命名：'ground net' 和 'power ground'
  const groundNet = gridData?.['ground net'] || (gridData as { 'power ground'?: string })?.['power ground'] || 'VSS'

  return {
    pdk: data.PDK || '',
    design: data.Design || '',
    topModule: data['Top module'] || '',
    die: { boundingBox: data.Die?.['Bounding box'] || '', Size: data.Die?.Size || [] },
    core: {
      boundingBox: data.Core?.['Bounding box'] || '',
      utilization: data.Core?.Utilitization || 0.4,
      margin: data.Core?.Margin || [10, 10],
      aspectRatio: data.Core?.['Aspect ratio'] || 1,
      Size: data.Core?.Size || []
    },
    maxFanout: data['Max fanout'] || 20,
    targetDensity: data['Target density'] || 0.3,
    targetOverflow: data['Target overflow'] || 0.1,
    clock: data.Clock || '',
    frequencyMax: data['Frequency max [MHz]'] || 100,
    bottomLayer: data['Bottom layer'] || 'MET1',
    topLayer: data['Top layer'] || 'MET5',
    floorplan: {
      tapDistance: data.Floorplan?.['Tap distance'] || 58,
      autoPlacePin: {
        layer: data.Floorplan?.['Auto place pin']?.layer || 'MET3',
        width: data.Floorplan?.['Auto place pin']?.width || 300,
        height: data.Floorplan?.['Auto place pin']?.height || 600
      },
      tracks: (data.Floorplan?.Tracks || []).map(t => ({
        layer: t.layer,
        xStart: t['x start'],
        xStep: t['x step'],
        yStart: t['y start'],
        yStep: t['y step']
      }))
    },
    pdn: {
      io: (data.PDN?.IO || []).map(io => ({
        netName: io['net name'],
        direction: io.direction,
        isPower: io['is power']
      })),
      globalConnect: (data.PDN?.['Global connect'] || []).map(gc => ({
        netName: gc['net name'],
        instancePinName: gc['instance pin name'],
        isPower: gc['is power']
      })),
      grid: {
        layer: gridData?.layer || 'MET1',
        powerNet: gridData?.['power net'] || 'VDD',
        groundNet: groundNet,
        width: gridData?.width || 0.16,
        offset: gridData?.offset || 0
      },
      stripe: (data.PDN?.Stripe || []).map(s => ({
        layer: s.layer,
        powerNet: s['power net'],
        groundNet: s['ground net'],
        width: s.width,
        pitch: s.pitch,
        offset: s.offset
      })),
      connectLayers: (data.PDN?.['Connect layers'] || []).map(cl => ({
        layers: cl.layers
      }))
    }
  }
}

/** 将前端配置格式转换回 parameters.json 数据 */
function transformConfigToParameters(config: ConfigData): ParametersData {
  return {
    PDK: config.pdk,
    Design: config.design,
    'Top module': config.topModule,
    Die: {
      Size: [],
      'Bounding box': config.die.boundingBox
    },
    Core: {
      Size: [],
      'Bounding box': config.core.boundingBox,
      Utilitization: config.core.utilization,
      Margin: config.core.margin,
      'Aspect ratio': config.core.aspectRatio
    },
    'Max fanout': config.maxFanout,
    'Target density': config.targetDensity,
    'Target overflow': config.targetOverflow,
    Clock: config.clock,
    'Frequency max [MHz]': config.frequencyMax,
    'Bottom layer': config.bottomLayer,
    'Top layer': config.topLayer,
    Floorplan: {
      'Tap distance': config.floorplan.tapDistance,
      'Auto place pin': {
        layer: config.floorplan.autoPlacePin.layer,
        width: config.floorplan.autoPlacePin.width,
        height: config.floorplan.autoPlacePin.height,
        sides: []
      },
      Tracks: config.floorplan.tracks.map(t => ({
        layer: t.layer,
        'x start': t.xStart,
        'x step': t.xStep,
        'y start': t.yStart,
        'y step': t.yStep
      }))
    },
    PDN: {
      IO: config.pdn.io.map(io => ({
        'net name': io.netName,
        direction: io.direction,
        'is power': io.isPower
      })),
      'Global connect': config.pdn.globalConnect.map(gc => ({
        'net name': gc.netName,
        'instance pin name': gc.instancePinName,
        'is power': gc.isPower
      })),
      grid: {
        layer: config.pdn.grid.layer,
        'power net': config.pdn.grid.powerNet,
        'ground net': config.pdn.grid.groundNet,
        width: config.pdn.grid.width,
        offset: config.pdn.grid.offset
      },
      Stripe: config.pdn.stripe.map(s => ({
        layer: s.layer,
        'power net': s.powerNet,
        'ground net': s.groundNet,
        width: s.width,
        pitch: s.pitch,
        offset: s.offset
      })),
      'Connect layers': config.pdn.connectLayers.map(cl => ({
        layers: cl.layers
      }))
    }
  }
}

// ============ Composable ============

/**
 * 参数配置管理 Hook
 * 负责从 parameters.json 加载配置参数并管理状态
 */
export function useParameters() {
  const { isInTauri } = useTauri()
  const { currentProject } = useWorkspace()

  // 配置数据
  const config = reactive<ConfigData>(getDefaultConfig())
  const isLoading = ref(false)
  const isSaving = ref(false)
  const error = ref<string | null>(null)
  const hasChanges = ref(false)

  // 原始数据（用于检测变更）
  let originalConfig: string = ''

  // 动态解析出的 parameters 文件本地路径（由 loadParameters 设置）
  let resolvedParametersPath: string = ''

  /**
   * 请求文件系统访问权限
   */
  async function requestPermission(path: string): Promise<boolean> {
    try {
      await invoke('request_project_permission', { path })
      return true
    } catch (permError) {
      console.warn('Failed to request file access permission:', permError)
      return false
    }
  }

  /**
   * 将远程路径转换为本地项目路径
   */
  function convertToLocalPath(remotePath: string): string {
    const projectPath = currentProject.value?.path
    return projectPath ? convertRemoteToLocalPath(remotePath, projectPath) : remotePath
  }

  /**
   * 从 home.json 动态获取 parameters 文件路径并加载配置参数
   * 通过共享缓存获取 home.json 数据（不重复调用 API）
   */
  async function loadParameters(): Promise<void> {
    if (!isInTauri || !currentProject.value?.path) {
      console.warn('Cannot load parameters: not in Tauri environment or no project is open')
      Object.assign(config, getDefaultConfig())
      return
    }

    isLoading.value = true
    error.value = null

    try {
      const projectPath = currentProject.value.path
      await requestPermission(projectPath)

      // 通过共享缓存获取 home.json 数据（去重，不会重复请求）
      const homeData = await fetchSharedHomeData(projectPath, isInTauri)
      if (!homeData) {
        console.warn('Failed to get home data')
        Object.assign(config, getDefaultConfig())
        return
      }

      if (!homeData.parameters) {
        console.warn('No parameters field found in home.json')
        Object.assign(config, getDefaultConfig())
        return
      }

      const parametersPath = convertToLocalPath(homeData.parameters)
      console.log('Loading parameters from:', parametersPath)

      // 读取 parameters 文件
      const fileContent = await readTextFile(parametersPath)
      const parametersData: ParametersData = JSON.parse(fileContent)

      console.log('Loaded parameters data:', parametersData)

      // 缓存解析后的本地路径，供 saveParameters 使用
      resolvedParametersPath = parametersPath

      // 转换数据格式并更新 config
      const transformedConfig = transformParametersToConfig(parametersData)
      Object.assign(config, transformedConfig)
      console.log('Loaded config:', config)
      // 保存原始数据用于变更检测
      originalConfig = JSON.stringify(config)
      hasChanges.value = false

      console.log('Parameters loaded:', config)

    } catch (err) {
      console.error('Failed to load parameters:', err)
      error.value = err instanceof Error ? err.message : String(err)
      // 加载失败时使用默认配置
      Object.assign(config, getDefaultConfig())
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 保存配置到 parameters 文件
   * 使用 loadParameters 解析得到的动态路径
   */
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
      const projectPath = currentProject.value.path
      await requestPermission(projectPath)

      console.log('Saving parameters to:', resolvedParametersPath)

      // 转换为 parameters.json 格式
      const parametersData = transformConfigToParameters(config)
      const fileContent = JSON.stringify(parametersData, null, 4)

      await writeTextFile(resolvedParametersPath, fileContent)

      // 更新原始数据
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

  /**
   * 重置配置到上次保存的状态
   */
  function resetParameters(): void {
    if (originalConfig) {
      Object.assign(config, JSON.parse(originalConfig))
      hasChanges.value = false
    }
  }

  /**
   * 重新加载配置
   */
  async function refreshParameters(): Promise<void> {
    await loadParameters()
  }

  // 监听配置变化
  watch(
    config,
    () => {
      hasChanges.value = JSON.stringify(config) !== originalConfig
    },
    { deep: true }
  )

  // 监听当前项目变化，自动重新加载
  watch(
    () => currentProject.value?.path,
    async (newPath) => {
      if (newPath) {
        await loadParameters()
      } else {
        Object.assign(config, getDefaultConfig())
        originalConfig = ''
        hasChanges.value = false
      }
    },
    { immediate: true }
  )

  // 组件挂载时也尝试加载
  onMounted(async () => {
    if (currentProject.value?.path) {
      await loadParameters()
    }
  })

  // ============ 动态选项计算 ============

  /** 从 Tracks 中提取所有 layer 选项 */
  const layerOptions = computed(() => {
    const layers = new Set<string>()
    // 从 tracks 中提取
    config.floorplan.tracks.forEach(t => layers.add(t.layer))
    // 从 stripe 中提取
    config.pdn.stripe.forEach(s => layers.add(s.layer))
    // 从 connectLayers 中提取
    config.pdn.connectLayers.forEach(cl => cl.layers.forEach(l => layers.add(l)))
    // 添加当前使用的 layer
    if (config.bottomLayer) layers.add(config.bottomLayer)
    if (config.topLayer) layers.add(config.topLayer)
    if (config.floorplan.autoPlacePin.layer) layers.add(config.floorplan.autoPlacePin.layer)
    if (config.pdn.grid.layer) layers.add(config.pdn.grid.layer)

    // 定义排序优先级（MET 层按数字排序，其他放后面）
    const sortOrder = (layer: string): number => {
      const metMatch = layer.match(/^MET(\d+)$/i)
      if (metMatch) return parseInt(metMatch[1])
      if (layer.toLowerCase() === 'li1') return 0
      return 100 + layer.charCodeAt(0) // 其他 layer 按字母排序放后面
    }

    return Array.from(layers)
      .sort((a, b) => sortOrder(a) - sortOrder(b))
      .map(layer => ({ label: layer, value: layer }))
  })

  /** 从 PDN.IO 中提取所有 direction 选项 */
  const directionOptions = computed(() => {
    const directions = new Set<string>()
    config.pdn.io.forEach(io => {
      if (io.direction) directions.add(io.direction)
    })
    // 确保至少有基本选项
    directions.add('INOUT')
    directions.add('INPUT')
    directions.add('OUTPUT')

    return Array.from(directions).map(dir => ({ label: dir, value: dir }))
  })

  /** layer 列表（用于范围判断） */
  const layersList = computed(() => {
    return layerOptions.value.map(opt => opt.value)
  })

  /** 获取默认 Track 数据 */
  const getDefaultTrack = () => {
    const defaultLayer = layersList.value[0] || 'MET1'
    return { layer: defaultLayer, xStart: 0, xStep: 200, yStart: 0, yStep: 200 }
  }

  /** 获取默认 PDN IO 数据 */
  const getDefaultPdnIO = () => {
    return { netName: '', direction: 'INOUT', isPower: true }
  }

  /** 获取默认 Global Connect 数据 */
  const getDefaultGlobalConnect = () => {
    return { netName: '', instancePinName: '', isPower: true }
  }

  /** 获取默认 Stripe 数据 */
  const getDefaultStripe = () => {
    const defaultLayer = layersList.value[0] || 'MET1'
    return { layer: defaultLayer, powerNet: 'VDD', groundNet: 'VSS', width: 1, pitch: 16, offset: 0.5 }
  }

  /** 获取默认 Connect Layers 数据 */
  const getDefaultConnectLayers = () => {
    const layers = layersList.value
    const layer1 = layers[0] || 'MET1'
    const layer2 = layers[1] || 'MET2'
    return { layers: [layer1, layer2] }
  }

  return {
    // 状态
    config,
    isLoading,
    isSaving,
    error,
    hasChanges,

    // 动态选项
    layerOptions,
    directionOptions,
    layersList,

    // 默认值工厂函数
    getDefaultTrack,
    getDefaultPdnIO,
    getDefaultGlobalConnect,
    getDefaultStripe,
    getDefaultConnectLayers,

    // 方法
    loadParameters,
    saveParameters,
    resetParameters,
    refreshParameters
  }
}
