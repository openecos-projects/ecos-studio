import { ref, computed, getCurrentInstance, onUnmounted, watch } from 'vue'
import { useWorkspace } from './useWorkspace'
import { useDesktopRuntime, isDesktopRuntime } from './useDesktopRuntime'
import { convertRemoteToLocalPath } from './useHomeData'
import { STEP_METADATA, getStepMetadata } from '@/api/type'
import { readProjectTextFile } from '@/utils/projectFiles'
import { resolveProjectPathAccess } from '@/utils/projectFs'
import {
  getWorkspaceRuntimeSnapshotApi,
  readWorkspaceFlowResourceApi,
} from '@/api/workspaceResources'
import { useWorkspaceLifecycle } from './useWorkspaceLifecycle'
import {
  consumePendingHomeRunArtifactReset,
  isHomeRunArtifactResetPending,
  onHomeRunArtifactReset,
} from './homeRunArtifacts'

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
  tool: string
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
    tool: '',
    state: 'pending',
    runtime: '',
    'peak memory (mb)': 0,
  }))

/**
 * 将 flow.json 数据转换为 FlowStage 格式（与侧边栏加载逻辑一致）
 */
function transformFlowData(flowData: FlowData): FlowStage[] {
  const stages: FlowStage[] = []
  console.log('flowData.steps:', flowData.steps)
  for (const step of flowData.steps) {
    const metadata = getStepMetadata(step.name)
    stages.push({
      label: metadata?.label ?? step.name,
      path: metadata?.path ?? step.name,
      icon: metadata?.icon ?? 'ri-checkbox-blank-circle-line',
      group: 'run',
      tool: step.tool,
      state: step.state,
      runtime: step.runtime || '',
      'peak memory (mb)': step['peak memory (mb)'] || 0,
    })
  }
  return stages
}

/**
 * 从工程读取 flow.json，返回全部 run 步骤的 path（用作路由 stepKey）。
 * 读取失败时回退为 STEP_METADATA 中 `group === 'run'` 的全集。
 */
export async function loadFlowRunStepKeysFromProject(
  projectPath: string,
): Promise<string[]> {
  if (!isDesktopRuntime() || !projectPath) {
    return fallbackRunStepKeys()
  }
  try {
    const flowData = (await readWorkspaceFlowResourceApi()) as FlowData | null
    if (!flowData) return fallbackRunStepKeys()
    const stages = transformFlowData(flowData)
    return stages.map((s) => s.path)
  } catch (e) {
    console.warn('[loadFlowRunStepKeysFromProject]', e)
    return fallbackRunStepKeys()
  }
}

function fallbackRunStepKeys(): string[] {
  return Object.values(STEP_METADATA)
    .filter((m) => m.group === 'run')
    .map((m) => m.path)
}

function flowDataHasStartedRun(flowData: FlowData): boolean {
  return flowData.steps.some((step) => {
    const state = (step.state ?? '').trim().toLowerCase()
    return (
      state === 'ongoing' ||
      state === 'running' ||
      state === 'unstart' ||
      state === 'pending'
    )
  })
}

// ============ Composable ============

/**
 * 流程阶段管理 Hook
 * 负责从 flow.json 加载流程步骤并管理状态
 */
export function useFlowStages() {
  const { isDesktopRuntimeAvailable } = useDesktopRuntime()
  const { currentProject, resourceVersions, runtimeEvents, workspaceSession } =
    useWorkspace()
  const workspaceLifecycle = useWorkspaceLifecycle()

  // 动态加载的流程步骤
  const dynamicFlowStages = ref<FlowStage[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  let unwatchFlowJsonFile: (() => void) | null = null
  let unregisterFlowJsonLifecycleCleanup: (() => void) | null = null
  let unregisterHomeRunArtifactReset: (() => void) | null = null
  let pendingRerunFlowStartProjectPath = ''
  let watchSession = 0

  function stageMatchesRuntimeStep(stage: FlowStage, stepName: string): boolean {
    const key = stepName.trim().toLowerCase()
    return (
      stage.label.trim().toLowerCase() === key || stage.path.trim().toLowerCase() === key
    )
  }

  function applyRuntimeStepState(
    stepName: string,
    tool: string,
    state: string,
    isStarted: boolean,
  ): void {
    const matchingIndex = dynamicFlowStages.value.findIndex((stage) =>
      stageMatchesRuntimeStep(stage, stepName),
    )
    const metadata = getStepMetadata(stepName)
    const runtimeStage: FlowStage =
      matchingIndex >= 0
        ? dynamicFlowStages.value[matchingIndex]!
        : {
            'peak memory (mb)': 0,
            group: 'run',
            icon: metadata?.icon ?? 'ri-checkbox-blank-circle-line',
            label: metadata?.label ?? stepName,
            path: metadata?.path ?? stepName,
            runtime: '',
            state,
            tool,
          }

    dynamicFlowStages.value = dynamicFlowStages.value.map((stage, index) => {
      if (index === matchingIndex) {
        return { ...runtimeStage, state, tool: tool || runtimeStage.tool }
      }
      // A flow has one active step. Keep a stale delayed start event from
      // rendering two Ongoing states at the same time.
      return isStarted && stage.state === 'Ongoing'
        ? { ...stage, state: 'Unstart' }
        : stage
    })
    if (matchingIndex < 0) {
      dynamicFlowStages.value = [...dynamicFlowStages.value, { ...runtimeStage, state }]
    }
  }

  // 合并后的完整流程步骤
  const flowStages = computed<FlowStage[]>(() => {
    return [...FIXED_SETUP_STAGES, ...dynamicFlowStages.value]
  })
  const hasOngoingRunStage = computed(() =>
    dynamicFlowStages.value.some(
      (stage) => stage.state === 'Ongoing' || stage.state === 'running',
    ),
  )

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
    if (!isDesktopRuntimeAvailable || !flowJsonPath) {
      console.warn('Cannot load flow.json: desktop bridge unavailable or path is empty')
      return
    }

    const sessionId = workspaceLifecycle.currentSessionId.value
    const isCurrent = () => workspaceLifecycle.isCurrentSession(sessionId)
    isLoading.value = true
    error.value = null

    try {
      const localPath = convertToLocalPath(flowJsonPath)
      const resolvedPath = await workspaceLifecycle.runForSession(sessionId, () =>
        resolveProjectPathAccess(localPath),
      )
      if (!isCurrent()) return
      console.log('Loading flow.json from path:', resolvedPath ?? localPath)
      if (!resolvedPath) return

      const fileContent = await workspaceLifecycle.runForSession(sessionId, () =>
        readProjectTextFile(resolvedPath),
      )
      if (!isCurrent() || fileContent === undefined) return
      const flowData: FlowData = JSON.parse(fileContent)
      if (!shouldApplyFlowData(flowData)) return

      console.log('Loaded flow data from path:', flowData)

      dynamicFlowStages.value = transformFlowData(flowData)
      console.log('Flow stages loaded from path:', dynamicFlowStages.value)
    } catch (err) {
      if (!isCurrent()) return
      console.error('Failed to load flow.json from path:', flowJsonPath, err)
      error.value = err instanceof Error ? err.message : String(err)
      dynamicFlowStages.value = []
    } finally {
      if (isCurrent()) {
        isLoading.value = false
      }
    }
  }

  /**
   * 从 flow.json 加载流程步骤
   * 通过共享缓存获取 home.json 数据（不重复调用 API），从中提取 flow 路径
   */
  async function loadFlowStages(): Promise<void> {
    if (!isDesktopRuntimeAvailable || !currentProject.value?.path) {
      console.warn(
        'Cannot load flow.json: desktop bridge unavailable or no project is open',
      )
      dynamicFlowStages.value = []
      return
    }

    const sessionId = workspaceLifecycle.currentSessionId.value
    const isCurrent = () => workspaceLifecycle.isCurrentSession(sessionId)
    isLoading.value = true
    error.value = null

    try {
      const workspaceHandle = workspaceSession?.value?.workspaceId ?? ''
      const flowData = await workspaceLifecycle.runForSession(sessionId, async () => {
        if (!workspaceHandle) {
          return (await readWorkspaceFlowResourceApi()) as FlowData | null
        }
        const snapshot = await getWorkspaceRuntimeSnapshotApi(workspaceHandle)
        return {
          steps: snapshot.flow.steps.map((step) => ({
            'peak memory (mb)': step.peakMemory,
            info: {},
            name: step.name,
            runtime: step.runtime,
            state: step.state,
            tool: step.tool,
          })),
        } satisfies FlowData
      })
      if (!isCurrent()) return
      if (!flowData) {
        console.warn('Failed to read flow data')
        dynamicFlowStages.value = []
        return
      }
      if (!shouldApplyFlowData(flowData)) return

      console.log('Loaded flow data:', flowData)

      dynamicFlowStages.value = transformFlowData(flowData)
      console.log('Flow stages loaded:', dynamicFlowStages.value)
    } catch (err) {
      if (!isCurrent()) return
      console.error('Failed to load flow stages:', err)
      error.value = err instanceof Error ? err.message : String(err)
      dynamicFlowStages.value = []
    } finally {
      if (isCurrent()) {
        isLoading.value = false
      }
    }
  }

  function cleanupFlowJsonWatch(): void {
    unregisterFlowJsonLifecycleCleanup?.()
    unregisterFlowJsonLifecycleCleanup = null
    unwatchFlowJsonFile?.()
    unwatchFlowJsonFile = null
  }

  function normalizeProjectPath(path: string): string {
    const normalized = path.trim().replace(/\\/g, '/')
    return normalized.length > 1 && normalized.endsWith('/')
      ? normalized.slice(0, -1)
      : normalized
  }

  function resetRunStagesForRerun(): void {
    if (dynamicFlowStages.value.length === 0) return
    dynamicFlowStages.value = dynamicFlowStages.value.map((stage) => ({
      ...stage,
      state: 'Unstart',
      runtime: '',
      'peak memory (mb)': 0,
    }))
  }

  function shouldApplyFlowData(flowData: FlowData): boolean {
    const projectPath = currentProject.value?.path
    if (!projectPath) return true
    const normalizedProjectPath = normalizeProjectPath(projectPath)
    const resetPending =
      pendingRerunFlowStartProjectPath === normalizedProjectPath ||
      isHomeRunArtifactResetPending(projectPath)
    if (!resetPending) return true
    if (!flowDataHasStartedRun(flowData)) return false
    pendingRerunFlowStartProjectPath = ''
    consumePendingHomeRunArtifactReset(projectPath)
    return true
  }

  async function startFlowJsonWatchForCurrentProject(): Promise<void> {
    cleanupFlowJsonWatch()
    // Runtime event invalidation calls loadFlowStages(); no renderer watcher is
    // allowed to poll or watch flow.json on a potentially slow NFS mount.
  }

  /**
   * 乐观更新：将第一个非 Success 的 run 步骤设为 Ongoing
   * 在用户点击 Run RTL2GDS 时调用，立即反映运行状态
   */
  function setFirstRunStepOngoing(): void {
    const idx = dynamicFlowStages.value.findIndex((s) => s.state !== 'Success')
    if (idx !== -1) {
      dynamicFlowStages.value[idx] = {
        ...dynamicFlowStages.value[idx],
        state: 'Ongoing',
      }
    }
  }

  /**
   * 乐观更新：将指定 path 的 run 步骤设为 Ongoing
   * 单步运行 run_step 时调用，与侧栏第一栏状态指示一致
   */
  function setRunStepOngoingByPath(stepPath: string): void {
    if (!stepPath) return
    const key = stepPath.toLowerCase()
    const idx = dynamicFlowStages.value.findIndex((s) => s.path.toLowerCase() === key)
    if (idx !== -1) {
      dynamicFlowStages.value[idx] = {
        ...dynamicFlowStages.value[idx],
        state: 'Ongoing',
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
        await startFlowJsonWatchForCurrentProject()
      } else {
        watchSession++
        cleanupFlowJsonWatch()
        clearFlowStages()
      }
    },
    { immediate: true },
  )

  watch(
    () => resourceVersions.value.all,
    async () => {
      if (!currentProject.value?.path) return
      await refreshFlowStages()
    },
  )

  watch(
    () => runtimeEvents.value[runtimeEvents.value.length - 1],
    (event) => {
      const data = event?.data
      const protocolType =
        typeof data?.runtimeProtocolType === 'string' ? data.runtimeProtocolType : ''
      if (!['step.started', 'step.completed'].includes(protocolType)) return
      const stepName = typeof data?.step === 'string' ? data.step : ''
      if (!stepName) return
      applyRuntimeStepState(
        stepName,
        typeof data?.tool === 'string' ? data.tool : '',
        typeof data?.state === 'string'
          ? data.state
          : protocolType === 'step.started'
            ? 'Ongoing'
            : 'Success',
        protocolType === 'step.started',
      )
    },
  )

  unregisterHomeRunArtifactReset = onHomeRunArtifactReset((projectPath) => {
    const currentProjectPath = currentProject.value?.path
    if (
      !currentProjectPath ||
      normalizeProjectPath(projectPath) !== normalizeProjectPath(currentProjectPath)
    ) {
      return
    }

    pendingRerunFlowStartProjectPath = normalizeProjectPath(currentProjectPath)
    resetRunStagesForRerun()
  })

  if (getCurrentInstance()) {
    onUnmounted(() => {
      watchSession++
      cleanupFlowJsonWatch()
      unregisterHomeRunArtifactReset?.()
      unregisterHomeRunArtifactReset = null
    })
  }

  return {
    // 状态
    flowStages,
    dynamicFlowStages,
    hasOngoingRunStage,
    isLoading,
    error,

    // 方法
    loadFlowStages,
    loadFlowStagesFromPath,
    refreshFlowStages,
    clearFlowStages,
    setFirstRunStepOngoing,
    setRunStepOngoingByPath,
  }
}
