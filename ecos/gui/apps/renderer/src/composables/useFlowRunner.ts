import { computed, ref, shallowReactive } from 'vue'
import { useRoute } from 'vue-router'
import { useDesktopRuntime } from './useDesktopRuntime'
import { useWorkspace } from './useWorkspace'
import { CMDEnum, StateEnum, StepEnum } from '@/api/type'
import { runStepApi, rtl2gdsApi, type RunStepResponse } from '@/api/flow'
import type { WorkspaceInvalidationScope } from './useWorkspaceLifecycle'
import {
  clearHomeRunArtifactResetAwaitingBackendStart,
  markHomeRunArtifactResetAwaitingBackendStart,
} from './homeRunArtifacts'

// ============ 模块级运行标志（run_step / rtl2gds 共用）============

/** 任意流程命令执行中为 true，供 Home flow log 等订阅，避免多实例 composable 状态不一致 */
export const flowExecutionActive = ref(false)
const activeFlowWorkspaces = shallowReactive(new Set<string>())
const RUN_STEP_FALLBACK_SCOPES: WorkspaceInvalidationScope[] = ['home', 'parameters']

export interface FlowRunOptions {
  rerun?: boolean
}

function normalizeWorkspacePath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/')
  return normalized.length > 1 && normalized.endsWith('/')
    ? normalized.slice(0, -1)
    : normalized
}

function refreshGlobalFlowExecutionActive() {
  flowExecutionActive.value = activeFlowWorkspaces.size > 0
}

export function markFlowExecutionActiveForWorkspace(path: string): void {
  const workspacePath = normalizeWorkspacePath(path)
  if (!workspacePath) return
  activeFlowWorkspaces.add(workspacePath)
  refreshGlobalFlowExecutionActive()
}

export function clearFlowExecutionActiveForWorkspace(path: string): void {
  const workspacePath = normalizeWorkspacePath(path)
  if (!workspacePath) return
  activeFlowWorkspaces.delete(workspacePath)
  refreshGlobalFlowExecutionActive()
}

export function isFlowExecutionActiveForWorkspace(path: string | undefined | null): boolean {
  return Boolean(path && activeFlowWorkspaces.has(normalizeWorkspacePath(path)))
}

/**
 * Flow execution should not inherit transient global interaction locks.
 * These classes are used only while the user is actively resizing panes/windows;
 * if one remains on <body>, the whole UI can become unclickable.
 */
function clearTransientInteractionLocks() {
  if (typeof document === 'undefined') return
  document.body.classList.remove(
    'splitter-resizing',
    'splitter-resizing-vertical',
    'window-resizing',
  )
}

// ============ Composable ============

/**
 * 流程运行器 Hook
 * 负责处理流程的运行、停止、重置等操作
 * 
 * Runtime lifecycle events 由 useWorkspace 管理（workspace 级别订阅），
 * 本 Hook 只负责调用 CLI-backed runtime command 并等待结果。
 */
export function useFlowRunner() {
  const { ensureDesktopRuntime } = useDesktopRuntime()
  const {
    currentProject,
    ensureApiReady,
    showToast,
    invalidateWorkspaceResources,
    resourceVersions,
    workspaceSession,
  } = useWorkspace()
  const route = useRoute()

  // 状态：当前 workspace 的运行态。flowExecutionActive 仍保留为全局兼容信号。
  const isRunning = computed(() => isFlowExecutionActiveForWorkspace(currentProject.value?.path))
  const state = ref<StateEnum>(StateEnum.Invalid)
  const error = ref<string | null>(null)
  const lastRunResult = ref<RunStepResponse | null>(null)

  /**
   * 获取当前步骤（从动态路由参数获取）
   */
  function getCurrentStep(): string | undefined {
    // 动态路由参数 :step
    const stepParam = route.params.step as string
    if (stepParam) {
      return stepParam
    }
  }

  function showDesktopRequiredToast() {
    showToast({
      severity: 'warn',
      summary: 'Desktop App Required',
      detail: 'Flow execution is only available in the desktop app.',
      life: 5000,
    })
  }

  function getCurrentWorkspacePath(): string | null {
    const path = currentProject.value?.path
    return path ? normalizeWorkspacePath(path) : null
  }

  /**
   * 运行当前步骤
   */
  async function runFlow(options: FlowRunOptions = {}): Promise<RunStepResponse | null> {
    // 从动态路由参数获取当前步骤
    const step = getCurrentStep()

    if (!step) {
      console.warn('Unable to get current step')
      return null
    }

    // 检查是否在 desktop runtime 环境中
    if (!ensureDesktopRuntime()) {
      console.warn('Not running in desktop runtime environment, cannot execute ECC CLI flow command')
      showDesktopRequiredToast()
      return { step: step as StepEnum, state: StateEnum.Invalid }
    }

    if (!(await ensureApiReady())) {
      return { step: step as StepEnum, state: StateEnum.Invalid }
    }

    const directory = getCurrentWorkspacePath()
    if (!directory) {
      showToast({
        severity: 'error',
        summary: 'No Workspace Open',
        detail: 'Open a workspace before running a flow step.',
        life: 5000,
      })
      return { step: step as StepEnum, state: StateEnum.Invalid }
    }

    if (isRunning.value) {
      return { step: step as StepEnum, state: StateEnum.Ongoing }
    }

    clearTransientInteractionLocks()
    markFlowExecutionActiveForWorkspace(directory)
    state.value = StateEnum.Ongoing
    error.value = null
    try {
      console.log('handleRunFlow', step)
      const versionsBeforeRunStep = { ...resourceVersions.value }
      const runSessionId = workspaceSession.value.sessionId

      const result = await runStepApi({
        cmd: CMDEnum.run_step,
        data: {
          directory,
          step: step as StepEnum,
          rerun: Boolean(options.rerun)
        }
      })
      console.log('run step result', result)

      const homeAndParametersAlreadyInvalidated = RUN_STEP_FALLBACK_SCOPES.every(
        (key) => resourceVersions.value[key] !== versionsBeforeRunStep[key],
      )
      if (!homeAndParametersAlreadyInvalidated) {
        invalidateWorkspaceResources(RUN_STEP_FALLBACK_SCOPES, { sessionId: runSessionId })
      }

      if (result.data?.state === StateEnum.Success) {
        showToast({
          severity: 'success',
          summary: 'Step Completed',
          detail: `${step} finished successfully`,
          life: 4000
        })
      } else {
        showToast({
          severity: 'error',
          summary: 'Step Failed',
          detail: `${step} did not complete successfully`,
          life: 6000
        })
      }

      return result.data
    } catch (err) {
      console.error('Single-step run failed:', err)
      showToast({
        severity: 'error',
        summary: 'Step Error',
        detail: err instanceof Error ? err.message : String(err),
        life: 6000
      })
    } finally {
      clearTransientInteractionLocks()
      clearFlowExecutionActiveForWorkspace(directory)
    }
    return null
  }

  /**
   * 运行所有步骤
   * 
   * 调用 rtl2gds runtime command（同步等待 CLI 执行完成）。
   * 执行过程中，Electron runtime 转发 CLI lifecycle events，
   * 前端通过 useWorkspace 中已建立的 runtime event 连接实时接收。
   */
  async function runAllFlow(options: FlowRunOptions = {}): Promise<any | null> {
    // 检查是否在 desktop runtime 环境中
    if (!ensureDesktopRuntime()) {
      console.warn('Not running in desktop runtime environment, cannot execute ECC CLI flow command')
      showDesktopRequiredToast()
      return null
    }

    if (!(await ensureApiReady())) {
      return null
    }

    const directory = getCurrentWorkspacePath()
    if (!directory) {
      showToast({
        severity: 'error',
        summary: 'No Workspace Open',
        detail: 'Open a workspace before running the flow.',
        life: 5000,
      })
      return null
    }

    if (isRunning.value) {
      return null
    }

    clearTransientInteractionLocks()
    if (options.rerun) {
      markHomeRunArtifactResetAwaitingBackendStart(directory)
    }
    markFlowExecutionActiveForWorkspace(directory)
    state.value = StateEnum.Ongoing
    error.value = null

    try {
      console.log('Starting rtl2gds flow...')

      const result = await rtl2gdsApi({
        cmd: CMDEnum.rtl2gds,
        data: {
          directory,
          rerun: Boolean(options.rerun)
        }
      })
      console.log('rtl2gds result:', result)

      if (result.response === 'success') {
        state.value = StateEnum.Success
        showToast({
          severity: 'success',
          summary: 'RTL2GDS Completed',
          detail: 'All flow steps finished successfully',
          life: 5000
        })
      } else {
        state.value = StateEnum.Imcomplete
        error.value = result.message?.[0] || 'rtl2gds failed'
        showToast({
          severity: 'error',
          summary: 'RTL2GDS Failed',
          detail: error.value ?? 'Unknown error',
          life: 8000
        })
      }

      return result.data
    } catch (err) {
      console.error('Run-all flow failed:', err)
      error.value = err instanceof Error ? err.message : String(err)
      state.value = StateEnum.Imcomplete
      showToast({
        severity: 'error',
        summary: 'RTL2GDS Error',
        detail: error.value ?? 'Unknown error',
        life: 8000
      })
    } finally {
      clearTransientInteractionLocks()
      clearHomeRunArtifactResetAwaitingBackendStart(directory)
      clearFlowExecutionActiveForWorkspace(directory)
    }
    return null
  }

  return {
    // 状态
    isRunning,
    state,
    error,
    lastRunResult,

    // 方法
    runFlow,
    runAllFlow
  }
}
