import { ref, computed, watch, onMounted } from 'vue'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { useWorkspace } from './useWorkspace'
import { useTauri } from './useTauri'
import { fetchSharedHomeData, convertRemoteToLocalPath } from './useHomeData'
import { STEP_METADATA, getStepMetadata } from '@/api/type'
import type { ECCResponse } from '@/api/sse'

// ============ 类型定义 ============

/** flow.json 中的步骤数据结构 */
export interface FlowStep {
  name: string
  tool: string
  state: string
  runtime: string
  'peak memory (mb)': number
  info: Record<string, any>
}

/** flow.json 数据结构 */
export interface FlowData {
  steps: FlowStep[]
}

/** 流程阶段配置 */
export interface FlowStage {
  label: string
  path: string
  icon: string
  group: 'setup' | 'run'
  state: string
  runtime: string
  'peak memory (mb)': number
}

// ============ 常量配置 ============

/** 固定的设置页面步骤 - 从 STEP_METADATA 动态生成 */
const FIXED_SETUP_STAGES: FlowStage[] = Object.entries(STEP_METADATA)
  .filter(([_, meta]) => meta.group === 'setup' && meta.showInSidebar)
  .map(([_, meta]) => ({
    label: meta.label,
    path: meta.path,
    icon: meta.icon,
    group: 'setup' as const,
    state: 'pending',
    runtime: '',
    'peak memory (mb)': 0,
  }))

// ============ Composable ============

/**
 * 流程阶段管理 Hook
 * 负责从 flow.json 加载流程步骤并管理状态
 */
export function useFlowStages() {
  const { isInTauri } = useTauri()
  const { currentProject } = useWorkspace()

  // 动态加载的流程步骤
  const dynamicFlowStages = ref<FlowStage[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // 合并后的完整流程步骤
  const flowStages = computed<FlowStage[]>(() => {
    return [...FIXED_SETUP_STAGES, ...dynamicFlowStages.value]
  })

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
   * 将 flow.json 数据转换为 FlowStage 格式
   * 完全基于 flow.json 中的步骤动态生成，使用 STEP_METADATA 获取显示配置
   */
  function transformFlowData(flowData: FlowData): FlowStage[] {
    const stages: FlowStage[] = []
    console.log('flowData.steps:', flowData.steps)
    for (const step of flowData.steps) {
      const metadata = getStepMetadata(step.name)

      // 如果有元数据配置则使用，否则使用默认配置
      // 所有 flow.json 中的步骤都会显示
      stages.push({
        label: metadata?.label ?? step.name,
        path: metadata?.path ?? step.name,
        icon: metadata?.icon ?? 'ri-checkbox-blank-circle-line',
        group: 'run',
        state: step.state,
        runtime: step.runtime || '',
        'peak memory (mb)': step['peak memory (mb)'] || 0,
      })

    }

    return stages
  }

  /**
   * 将远程路径转换为本地项目路径
   */
  function convertToLocalPath(remotePath: string): string {
    const projectPath = currentProject.value?.path
    return projectPath ? convertRemoteToLocalPath(remotePath, projectPath) : remotePath
  }

  /**
   * 从指定的 flow.json 路径加载流程步骤
   */
  async function loadFlowStagesFromPath(flowJsonPath: string): Promise<void> {
    if (!isInTauri || !flowJsonPath) {
      console.warn('Cannot load flow.json: not in Tauri environment or path is empty')
      return
    }

    isLoading.value = true
    error.value = null

    try {
      const localPath = convertToLocalPath(flowJsonPath)
      console.log('Loading flow.json from path:', localPath)

      const projectPath = currentProject.value?.path
      if (projectPath) {
        await requestPermission(projectPath)
      }

      const fileContent = await readTextFile(localPath)
      const flowData: FlowData = JSON.parse(fileContent)

      console.log('Loaded flow data from path:', flowData)

      dynamicFlowStages.value = transformFlowData(flowData)
      console.log('Flow stages loaded from path:', dynamicFlowStages.value)
    } catch (err) {
      console.error('Failed to load flow.json from path:', flowJsonPath, err)
      error.value = err instanceof Error ? err.message : String(err)
      dynamicFlowStages.value = []
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 从 home.json 路径间接加载 flow stages
   * 用于 SSE subflow 通知中的 home_page 路径
   */
  async function loadFlowStagesFromHomePath(homePath: string): Promise<void> {
    if (!isInTauri || !homePath) return

    try {
      const localHomePath = convertToLocalPath(homePath)
      const projectPath = currentProject.value?.path
      if (projectPath) await requestPermission(projectPath)

      const homeContent = await readTextFile(localHomePath)
      const homeData = JSON.parse(homeContent)
      const flowPath = homeData.flow
      if (flowPath) {
        await loadFlowStagesFromPath(flowPath)
      }
    } catch (err) {
      console.error('Failed to load flow stages from home path:', homePath, err)
    }
  }

  /**
   * 从 flow.json 加载流程步骤
   * 通过共享缓存获取 home.json 数据（不重复调用 API），从中提取 flow 路径
   */
  async function loadFlowStages(): Promise<void> {
    if (!isInTauri || !currentProject.value?.path) {
      console.warn('Cannot load flow.json: not in Tauri environment or no project is open')
      dynamicFlowStages.value = []
      return
    }

    isLoading.value = true
    error.value = null

    try {
      const projectPath = currentProject.value.path

      // 通过共享缓存获取 home.json 数据（去重，不会重复请求）
      const homeData = await fetchSharedHomeData(projectPath, isInTauri)
      if (!homeData) {
        console.warn('Failed to get home data')
        dynamicFlowStages.value = []
        return
      }

      const flowJsonPath = homeData.flow
      if (!flowJsonPath) {
        console.warn('No flow path found in home.json')
        dynamicFlowStages.value = []
        return
      }

      console.log('Got flow.json path from home.json:', flowJsonPath)

      // 读取 flow.json
      await requestPermission(projectPath)
      const localFlowPath = convertToLocalPath(flowJsonPath)
      const flowContent = await readTextFile(localFlowPath)
      const flowData: FlowData = JSON.parse(flowContent)

      console.log('Loaded flow data:', flowData)

      dynamicFlowStages.value = transformFlowData(flowData)
      console.log('Flow stages loaded:', dynamicFlowStages.value)

    } catch (err) {
      console.error('Failed to load flow stages:', err)
      error.value = err instanceof Error ? err.message : String(err)
      dynamicFlowStages.value = []
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 乐观更新：将第一个非 Success 的 run 步骤设为 Ongoing
   * 在用户点击 Run RTL2GDS 时调用，立即反映运行状态
   */
  function setFirstRunStepOngoing(): void {
    const idx = dynamicFlowStages.value.findIndex(
      s => s.state !== 'Success'
    )
    if (idx !== -1) {
      dynamicFlowStages.value[idx] = {
        ...dynamicFlowStages.value[idx],
        state: 'Ongoing'
      }
    }
  }


  /**
   * 重新加载流程步骤
   */
  async function refreshFlowStages(): Promise<void> {
    await loadFlowStages()
  }

  /**
   * 清空流程步骤
   */
  function clearFlowStages(): void {
    dynamicFlowStages.value = []
    error.value = null
  }

  // 监听当前项目变化，自动重新加载
  watch(
    () => currentProject.value?.path,
    async (newPath) => {
      if (newPath) {
        await loadFlowStages()
      } else {
        clearFlowStages()
      }
    },
    { immediate: true }
  )

  // 监听 SSE 通知，当收到 step/subflow 通知时自动刷新流程步骤
  const { sseMessages } = useWorkspace()

  watch(
    () => sseMessages.value.length,
    async (newLen, oldLen) => {
      if (newLen <= (oldLen ?? 0)) return

      const latest: ECCResponse = sseMessages.value[newLen - 1]
      if (!latest || latest.cmd !== 'notify') return

      const notifyId = latest.data?.id as string | undefined
      const info = latest.data?.info as Record<string, unknown> | undefined

      if (notifyId === 'step') {
        const stepName = latest.data?.step as string | undefined
        const stepPath = info?.step_path as string | undefined

        console.log('Received SSE step notification, step:', stepName, 'path:', stepPath)
        console.log('latest:', latest)

        // 乐观更新：先将对应步骤状态设为 Success，避免等待文件读取的延迟
        if (stepName) {
          const stepNameLower = stepName.toLowerCase()
          const idx = dynamicFlowStages.value.findIndex(s => s.path.toLowerCase() === stepNameLower)
          if (idx !== -1) {
            dynamicFlowStages.value[idx] = {
              ...dynamicFlowStages.value[idx],
              state: 'Success'
            }
          }
        }

        if (stepPath) {
          await loadFlowStagesFromPath(stepPath)
        } else {
          await refreshFlowStages()
        }
      } else if (notifyId === 'subflow') {
        const homePage = info?.home_page as string | undefined
        if (homePage) {
          await loadFlowStagesFromHomePath(homePage)
        }
      }
    }
  )

  // 组件挂载时也尝试加载
  onMounted(async () => {
    if (currentProject.value?.path) {
      await loadFlowStages()
    }
  })

  return {
    // 状态
    flowStages,
    dynamicFlowStages,
    isLoading,
    error,

    // 方法
    loadFlowStages,
    loadFlowStagesFromPath,
    refreshFlowStages,
    clearFlowStages,  
    setFirstRunStepOngoing
  }
}
