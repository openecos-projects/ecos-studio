import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useDesktopRuntime } from './useDesktopRuntime'
import { useWorkspace } from './useWorkspace'
import { StateEnum, StepEnum } from '@/api/type'
import {
  startFlowOperationApi,
  startStepOperationApi,
  type RunStepResponse,
} from '@/api/flow'
import { markHomeRunArtifactResetAwaitingBackendStart } from './homeRunArtifacts'
import {
  clearFlowExecutionActiveForWorkspace,
  flowExecutionActive,
  isFlowExecutionActiveForWorkspace,
  markFlowExecutionActiveForWorkspace,
  resetFlowExecutionState,
} from './flowExecutionState'

// ============ 模块级运行标志（run_step / rtl2gds 共用）============

/** 任意流程命令执行中为 true，供 Home flow log 等订阅，避免多实例 composable 状态不一致 */
export interface FlowRunOptions {
  rerun?: boolean
  resetDependents?: boolean
}

export {
  clearFlowExecutionActiveForWorkspace,
  flowExecutionActive,
  markFlowExecutionActiveForWorkspace,
  isFlowExecutionActiveForWorkspace,
  resetFlowExecutionState,
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
 * 本 Hook 只负责调用 ECC RPC runtime command 并等待结果。
 */
export function useFlowRunner() {
  const { ensureDesktopRuntime } = useDesktopRuntime()
  const {
    currentProject,
    ensureApiReady,
    showToast,
    invalidateWorkspaceResources,
    waitForRuntimeOperation,
    workspaceSession,
  } = useWorkspace()
  const route = useRoute()

  // 状态：当前 workspace 的运行态。flowExecutionActive 仍保留为全局兼容信号。
  const isRunning = computed(() =>
    isFlowExecutionActiveForWorkspace(currentProject.value?.path),
  )
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
      life: 15000,
    })
  }

  function getCurrentWorkspacePath(): string | null {
    const path = currentProject.value?.path
    if (!path) return null
    const normalized = path.trim().replace(/\\/g, '/')
    return normalized.length > 1 && normalized.endsWith('/')
      ? normalized.slice(0, -1)
      : normalized
  }

  function getCurrentWorkspaceHandle(): string | null {
    return workspaceSession.value.workspaceId || null
  }

  function observeRuntimeOperation(operationId: string, directory: string): void {
    void waitForRuntimeOperation(operationId)
      .then(() => {
        // The main-process operation tracker is authoritative when renderer IPC
        // delivery was delayed or replayed. Reconcile resource-backed panels
        // before releasing the shared run lock.
        invalidateWorkspaceResources('all')
      })
      .catch((reason: unknown) => {
        error.value = reason instanceof Error ? reason.message : String(reason)
        state.value = StateEnum.Imcomplete
      })
      .finally(() => {
        // The main-process tracker resolves even when the renderer missed its
        // terminal IPC event, so this lock cannot outlive the operation.
        clearFlowExecutionActiveForWorkspace(directory)
      })
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
      console.warn(
        'Not running in desktop runtime environment, cannot execute ECC RPC flow command',
      )
      showDesktopRequiredToast()
      return { step: step as StepEnum, state: StateEnum.Invalid }
    }

    if (!(await ensureApiReady())) {
      return { step: step as StepEnum, state: StateEnum.Invalid }
    }

    const directory = getCurrentWorkspacePath()
    const workspaceHandle = getCurrentWorkspaceHandle()
    if (!directory || !workspaceHandle) {
      showToast({
        severity: 'error',
        summary: 'No Workspace Open',
        detail: 'Open a workspace before running a flow step.',
        life: 15000,
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
      const operation = await startStepOperationApi({
        idempotencyKey: crypto.randomUUID(),
        rerun: Boolean(options.rerun),
        resetDependents: Boolean(options.resetDependents),
        step,
        workspaceHandle,
      })
      observeRuntimeOperation(operation.operationId, directory)
      lastRunResult.value = { step: step as StepEnum, state: StateEnum.Ongoing }
      showToast({
        severity: 'info',
        summary: 'Step Started',
        detail: `${step} is running`,
        life: 15000,
      })
      void operation
      return lastRunResult.value
    } catch (err) {
      console.error('Single-step run failed:', err)
      clearFlowExecutionActiveForWorkspace(directory)
      showToast({
        severity: 'error',
        summary: 'Step Error',
        detail: err instanceof Error ? err.message : String(err),
        life: 15000,
      })
    } finally {
      clearTransientInteractionLocks()
    }
    return null
  }

  /**
   * 运行所有步骤
   *
   * 调用 rtl2gds runtime command（同步等待 ECC RPC 执行完成）。
   * 执行过程中，Electron runtime 转发 lifecycle events，
   * 前端通过 useWorkspace 中已建立的 runtime event 连接实时接收。
   */
  async function runAllFlow(options: FlowRunOptions = {}): Promise<any | null> {
    // 检查是否在 desktop runtime 环境中
    if (!ensureDesktopRuntime()) {
      console.warn(
        'Not running in desktop runtime environment, cannot execute ECC RPC flow command',
      )
      showDesktopRequiredToast()
      return null
    }

    if (!(await ensureApiReady())) {
      return null
    }

    const directory = getCurrentWorkspacePath()
    const workspaceHandle = getCurrentWorkspaceHandle()
    if (!directory || !workspaceHandle) {
      showToast({
        severity: 'error',
        summary: 'No Workspace Open',
        detail: 'Open a workspace before running the flow.',
        life: 15000,
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
      const operation = await startFlowOperationApi({
        idempotencyKey: crypto.randomUUID(),
        rerun: Boolean(options.rerun),
        workspaceHandle,
      })
      observeRuntimeOperation(operation.operationId, directory)
      showToast({
        severity: 'info',
        summary: 'RTL2GDS Started',
        detail: 'Flow is running in ECC.',
        life: 15000,
      })
      return operation
    } catch (err) {
      console.error('Run-all flow failed:', err)
      clearFlowExecutionActiveForWorkspace(directory)
      error.value = err instanceof Error ? err.message : String(err)
      state.value = StateEnum.Imcomplete
      showToast({
        severity: 'error',
        summary: 'RTL2GDS Error',
        detail: error.value ?? 'Unknown error',
        life: 15000,
      })
    } finally {
      clearTransientInteractionLocks()
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
    runAllFlow,
  }
}
