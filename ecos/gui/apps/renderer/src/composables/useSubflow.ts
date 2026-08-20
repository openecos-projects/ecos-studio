import { ref, computed, onScopeDispose, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useDesktopRuntime } from './useDesktopRuntime'
import { useWorkspace } from './useWorkspace'
import { convertRemoteToLocalPath } from './useHomeData'
import { readProjectTextFile } from '@/utils/projectFiles'
import { resolveProjectPathAccess } from '@/utils/projectFs'
import { FrontendStepEnum, InfoEnum, StepEnum, getStepMetadata } from '@/api/type'
import { resolveWorkspaceStepInfoApi } from '@/api/workspaceResources'
import { useWorkspaceLifecycle } from './useWorkspaceLifecycle'
import {
  normalizeWorkspaceProjectPath,
  onWorkspaceRerunPrepared,
} from './homeRunArtifacts'
import { registerRuntimeStepRenderTask } from './runtimeStepRenderSync'

// ============ 类型定义 ============

/** 子流程步骤状态 */
export type SubflowStatus = 'pending' | 'running' | 'completed' | 'failed'

/** 子流程步骤（UI 显示格式） */
export interface SubflowStepItem {
  id: string
  name: string
  description: string
  status: SubflowStatus
  duration?: string
  peakMemory?: number
}

/** 子流程原始数据（从 JSON 文件读取） */
export interface SubflowRawStep {
  name: string
  state: string
  runtime: string
  'peak memory (mb)': number
  info: Record<string, any>
}

/** 子流程数据结构 */
export interface SubflowData {
  path: string
  steps: SubflowRawStep[]
}

/** 整体状态类型 */
export type OverallStatus = 'pending' | 'running' | 'completed' | 'failed'

// ============ 工具函数 ============

/** 从 StepEnum 获取所有值 */
type WorkspaceFlowStep = StepEnum | FrontendStepEnum

const workspaceFlowStepValues: WorkspaceFlowStep[] = [
  ...Object.values(StepEnum),
  ...Object.values(FrontendStepEnum),
]

/**
 * 根据路由路径查找对应的 StepEnum（忽略大小写）
 */
function getStepEnumFromPath(path: string): WorkspaceFlowStep | undefined {
  return workspaceFlowStepValues.find((step) => step.toLowerCase() === path.toLowerCase())
}

/**
 * 根据 StepEnum 生成显示名称
 */
function getStepDisplayName(stepEnum: WorkspaceFlowStep): string {
  const label = getStepMetadata(stepEnum)?.label ?? stepEnum
  return `Run ${label}`
}

/**
 * 状态映射：将后端状态转换为前端状态
 */
function mapState(state: string): SubflowStatus {
  switch (state.toLowerCase()) {
    case 'success':
      return 'completed'
    case 'ongoing':
    case 'running':
      return 'running'
    case 'incomplete':
    case 'failed':
    case 'invalid':
      return 'failed'
    case 'unstart':
    case 'pending':
    default:
      return 'pending'
  }
}

/**
 * 将子流程原始数据转换为 UI 显示格式
 */
function convertSubflowToSteps(subflow: SubflowData): SubflowStepItem[] {
  return subflow.steps.map((step, index) => ({
    id: `step-${index}`,
    name: step.name,
    description: `Peak Memory: ${step['peak memory (mb)']} MB`,
    status: mapState(step.state),
    duration: step.runtime || undefined,
    peakMemory: step['peak memory (mb)'],
  }))
}

/**
 * 解析时间字符串，返回秒数
 */
function parseTimeString(timeStr: string): number {
  // 支持多种时间格式：如 "2.3s", "45.8s", "1m 23s", "0:0:5" 等
  const match = timeStr.match(/(\d+\.?\d*)s?/)
  return match ? parseFloat(match[1]) : 0
}

// ============ Composable ============

/**
 * 子流程管理 Hook
 * 负责获取和管理当前步骤的子流程信息
 */
export function useSubflow() {
  const { isDesktopRuntimeAvailable } = useDesktopRuntime()
  const { currentProject, resourceVersions, runtimeEvents } = useWorkspace()
  const workspaceLifecycle = useWorkspaceLifecycle()
  const route = useRoute()

  // 状态
  const subflowSteps = ref<SubflowStepItem[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const currentStepTitle = ref('Run Flow')
  const currentStepEngine = ref('ECC Engine')
  let runtimeUpdateRevision = 0
  let stepExecutionActive = false

  function sameStepName(left: string, right: string): boolean {
    return left.trim().toLowerCase() === right.trim().toLowerCase()
  }

  function resetSubflowForRerun(startImmediately: boolean): void {
    if (subflowSteps.value.length === 0) return
    subflowSteps.value = subflowSteps.value.map((step, index) => ({
      ...step,
      description: 'Peak Memory: 0 MB',
      duration: undefined,
      peakMemory: undefined,
      status: startImmediately && index === 0 ? 'running' : 'pending',
    }))
  }

  function updateSubflowStage(
    name: string,
    state: string,
    runtime: string,
    peakMemory: number | undefined,
  ): void {
    const index = subflowSteps.value.findIndex((step) => sameStepName(step.name, name))
    if (index < 0) {
      subflowSteps.value = [
        ...subflowSteps.value,
        {
          id: `step-${subflowSteps.value.length}`,
          name,
          description: `Peak Memory: ${peakMemory ?? 0} MB`,
          status: mapState(state),
          duration: runtime || undefined,
          peakMemory,
        },
      ]
      return
    }
    const next = [...subflowSteps.value]
    const current = next[index]!
    next[index] = {
      ...current,
      description: `Peak Memory: ${peakMemory ?? 0} MB`,
      duration: runtime || undefined,
      peakMemory,
      status: mapState(state),
    }
    subflowSteps.value = next
  }

  function advanceRunningSubflowStage(): void {
    if (!stepExecutionActive) return
    if (subflowSteps.value.some((step) => step.status === 'running')) return
    const nextPendingIndex = subflowSteps.value.findIndex(
      (step) => step.status === 'pending',
    )
    if (nextPendingIndex < 0) return
    subflowSteps.value = subflowSteps.value.map((step, index) =>
      index === nextPendingIndex ? { ...step, status: 'running' } : step,
    )
  }

  // ============ 计算属性 ============

  /** 已完成的步骤数 */
  const completedSteps = computed(() => {
    return subflowSteps.value.filter((s) => s.status === 'completed').length
  })

  /** 进度百分比 */
  const progressPercent = computed(() => {
    if (subflowSteps.value.length === 0) return 0
    return (completedSteps.value / subflowSteps.value.length) * 100
  })

  /** 总耗时 */
  const totalTime = computed(() => {
    if (subflowSteps.value.length === 0) return '--'

    const times = subflowSteps.value
      .filter((s) => s.duration)
      .map((s) => parseTimeString(s.duration!))

    const total = times.reduce((a, b) => a + b, 0)
    return total > 0 ? `${total.toFixed(1)}s` : '--'
  })

  /** 整体状态 */
  const overallStatus = computed<OverallStatus>(() => {
    if (subflowSteps.value.length === 0) return 'pending'
    if (subflowSteps.value.some((s) => s.status === 'running')) return 'running'
    if (subflowSteps.value.every((s) => s.status === 'completed')) return 'completed'
    if (subflowSteps.value.some((s) => s.status === 'failed')) return 'failed'
    return 'pending'
  })

  /** 总步骤数 */
  const totalSteps = computed(() => subflowSteps.value.length)

  // ============ 方法 ============

  /**
   * 获取子流程信息
   */
  async function fetchSubflowInfo(stepEnum: WorkspaceFlowStep): Promise<void> {
    const sessionId = workspaceLifecycle.currentSessionId.value
    const expectedRuntimeRevision = runtimeUpdateRevision
    const isCurrent = () => workspaceLifecycle.isCurrentSession(sessionId)
    isLoading.value = true
    error.value = null

    try {
      const response = await workspaceLifecycle.runForSession(sessionId, () =>
        resolveWorkspaceStepInfoApi({
          step: stepEnum,
          id: InfoEnum.subflow,
        }),
      )
      if (!isCurrent() || !response) return

      console.log('workspace subflow response:', response)

      if (response.response === 'error') {
        console.warn('workspace subflow resolver failed:', response.message)
        if (subflowSteps.value.length === 0) {
          error.value = response.message[0] || 'Failed to resolve subflow path'
        }
        return
      }

      if (response.response === 'missing') {
        console.warn('Subflow path is missing:', response.message)
        // Rerun removes artifacts before the first runtime event. Keep the
        // already-rendered skeleton until ECC republishes the reset subflow.
        if (subflowSteps.value.length === 0) subflowSteps.value = []
        return
      }

      const subflowPath =
        typeof response.info?.path === 'string' ? response.info.path : ''
      if (!subflowPath) {
        console.warn('No subflow path in response')
        return
      }

      // 2. 使用桌面桥接读取 JSON 文件
      if (!isDesktopRuntimeAvailable) {
        console.warn('Desktop bridge unavailable, cannot read local file')
        return
      }

      const projectPath = currentProject.value?.path
      const localPath = projectPath
        ? convertRemoteToLocalPath(subflowPath, projectPath)
        : subflowPath
      const resolvedPath = await workspaceLifecycle.runForSession(sessionId, () =>
        resolveProjectPathAccess(localPath),
      )
      if (!isCurrent()) return
      if (!resolvedPath) {
        return
      }
      const fileContent = await workspaceLifecycle.runForSession(sessionId, () =>
        readProjectTextFile(resolvedPath),
      )
      if (!isCurrent() || fileContent === undefined) return
      const subflowData: SubflowData = JSON.parse(fileContent)

      console.log('subflow data:', subflowData)

      // 3. 转换数据格式并更新步骤
      if (expectedRuntimeRevision === runtimeUpdateRevision) {
        subflowSteps.value = convertSubflowToSteps(subflowData)
      }
    } catch (err) {
      if (!isCurrent()) return
      console.error('Failed to fetch subflow info:', err)
      if (subflowSteps.value.length === 0) {
        error.value = err instanceof Error ? err.message : String(err)
      }
    } finally {
      if (isCurrent()) {
        isLoading.value = false
      }
    }
  }

  /**
   * 从指定路径直接加载子流程数据
   * 用于 runtime event 推送的 subflow_path
   */
  async function loadSubflowFromPath(subflowPath: string): Promise<void> {
    if (!isDesktopRuntimeAvailable || !subflowPath) {
      console.warn('Cannot load subflow: desktop bridge unavailable or path is empty')
      return
    }

    const sessionId = workspaceLifecycle.currentSessionId.value
    const expectedRuntimeRevision = runtimeUpdateRevision
    const isCurrent = () => workspaceLifecycle.isCurrentSession(sessionId)
    try {
      const localPath = currentProject.value?.path
        ? convertRemoteToLocalPath(subflowPath, currentProject.value.path)
        : subflowPath

      console.log('Loading subflow from runtime event path:', localPath)
      const resolvedPath = await workspaceLifecycle.runForSession(sessionId, () =>
        resolveProjectPathAccess(localPath),
      )
      if (!isCurrent()) return
      if (!resolvedPath) return

      const fileContent = await workspaceLifecycle.runForSession(sessionId, () =>
        readProjectTextFile(resolvedPath),
      )
      if (!isCurrent() || fileContent === undefined) return
      const subflowData: SubflowData = JSON.parse(fileContent)

      console.log('Subflow data from runtime event path:', subflowData)

      if (expectedRuntimeRevision === runtimeUpdateRevision) {
        subflowSteps.value = convertSubflowToSteps(subflowData)
      }
    } catch (err) {
      if (!isCurrent()) return
      console.error('Failed to load subflow from path:', subflowPath, err)
    }
  }

  /**
   * 获取当前路由对应的 step 名称
   */
  function getCurrentRouteStep(): WorkspaceFlowStep | undefined {
    const pathParts = route.path.split('/')
    const currentPath = pathParts[pathParts.length - 1] || ''
    const stepEnum = getStepEnumFromPath(currentPath)
    return stepEnum
  }

  /**
   * 刷新当前路由对应的子流程数据
   */
  async function refreshCurrentSubflow(): Promise<void> {
    const stepEnum = getCurrentRouteStep()
    if (stepEnum) {
      updateCurrentStep(stepEnum)
      await fetchSubflowInfo(stepEnum)
    } else {
      clearSubflow()
    }
  }

  /**
   * 清空子流程数据
   */
  function clearSubflow(): void {
    subflowSteps.value = []
    error.value = null
    currentStepTitle.value = 'Run Flow'
    currentStepEngine.value = 'ECC Engine'
  }

  /**
   * 更新当前步骤信息
   */
  function updateCurrentStep(stepEnum: WorkspaceFlowStep): void {
    currentStepTitle.value = getStepDisplayName(stepEnum)
    currentStepEngine.value = 'ECC Engine'
  }

  // 监听路由变化
  watch(
    () => route.path,
    async (newPath) => {
      const pathParts = newPath.split('/')
      const currentPath = pathParts[pathParts.length - 1] || ''
      console.log('Current path:', currentPath)

      // 检查当前路由是否是步骤页面
      const stepEnum = getStepEnumFromPath(currentPath)
      if (stepEnum) {
        updateCurrentStep(stepEnum)
        console.log('Fetching subflow for:', stepEnum)
        await fetchSubflowInfo(stepEnum)
      } else {
        clearSubflow()
      }
    },
    { immediate: true },
  )

  // Coalesce a workspace switch and its resource invalidation into one refresh.
  watch(
    [
      () => currentProject.value?.path,
      () => resourceVersions.value.step,
      () => resourceVersions.value.all,
    ],
    async ([nextPath], [previousPath]) => {
      if (!nextPath && nextPath !== previousPath) return
      await refreshCurrentSubflow()
    },
  )

  const unregisterWorkspaceRerunPrepared = onWorkspaceRerunPrepared((event) => {
    const projectPath = currentProject.value?.path
    const currentStep = getCurrentRouteStep()
    if (
      !projectPath ||
      !currentStep ||
      normalizeWorkspaceProjectPath(event.projectPath) !==
        normalizeWorkspaceProjectPath(projectPath)
    ) {
      return
    }
    const affectedStepNames = new Set(
      event.affectedSteps.map((step) => step.trim().toLowerCase()).filter(Boolean),
    )
    if (affectedStepNames.size > 0 && !affectedStepNames.has(currentStep.toLowerCase())) {
      return
    }
    error.value = null
    resetSubflowForRerun(event.scope === 'step')
    isLoading.value = false
  })

  const existingRuntimeEvents = new WeakSet<object>()
  const handledRuntimeEvents = new WeakSet<object>()
  for (const event of runtimeEvents.value) {
    if (event && typeof event === 'object') existingRuntimeEvents.add(event)
  }

  const stopWatchingRuntimeEvents = watch(
    runtimeEvents,
    (events) => {
      const currentStep = getCurrentRouteStep()
      if (!currentStep) return
      for (const event of events) {
        if (
          !event ||
          typeof event !== 'object' ||
          existingRuntimeEvents.has(event) ||
          handledRuntimeEvents.has(event)
        ) {
          continue
        }
        handledRuntimeEvents.add(event)
        const data = (event as { data?: unknown }).data
        if (!data || typeof data !== 'object') continue
        const payload = data as Record<string, unknown>
        if (!sameStepName(String(payload.step ?? ''), currentStep)) continue

        const protocolType =
          typeof payload.runtimeProtocolType === 'string'
            ? payload.runtimeProtocolType
            : ''
        const legacyType = typeof payload.type === 'string' ? payload.type : ''
        if (
          protocolType === 'step.started' ||
          (!protocolType && legacyType === 'step_start')
        ) {
          stepExecutionActive = true
          runtimeUpdateRevision += 1
          resetSubflowForRerun(true)
          continue
        }
        if (
          protocolType === 'step.completed' ||
          (!protocolType && legacyType === 'step_complete')
        ) {
          stepExecutionActive = false
          continue
        }
        if (protocolType !== 'subflow.stage') continue

        const subflowStep =
          typeof payload.subflowStep === 'string' ? payload.subflowStep : ''
        if (!subflowStep) continue
        runtimeUpdateRevision += 1
        updateSubflowStage(
          subflowStep,
          typeof payload.state === 'string' ? payload.state : 'Unstart',
          typeof payload.subflowRuntime === 'string' ? payload.subflowRuntime : '',
          typeof payload.subflowPeakMemory === 'number'
            ? payload.subflowPeakMemory
            : undefined,
        )
        const subflowState =
          typeof payload.state === 'string' ? payload.state.trim().toLowerCase() : ''
        if (['incomplete', 'invalid', 'failed'].includes(subflowState)) {
          stepExecutionActive = false
        } else {
          advanceRunningSubflowStage()
        }
      }
    },
    { deep: true, flush: 'sync' },
  )

  const unregisterStepRenderTask = registerRuntimeStepRenderTask(async (commit) => {
    const currentStep = getCurrentRouteStep()
    if (!currentStep || commit.step.trim().toLowerCase() !== currentStep.toLowerCase()) {
      return
    }
    await refreshCurrentSubflow()
  })

  onScopeDispose(() => {
    unregisterWorkspaceRerunPrepared()
    unregisterStepRenderTask()
    stopWatchingRuntimeEvents()
  })

  return {
    // 状态
    subflowSteps,
    isLoading,
    error,
    currentStepTitle,
    currentStepEngine,

    // 计算属性
    completedSteps,
    progressPercent,
    totalTime,
    overallStatus,
    totalSteps,

    // 方法
    fetchSubflowInfo,
    refreshCurrentSubflow,
    loadSubflowFromPath,
    clearSubflow,
    updateCurrentStep,
  }
}
