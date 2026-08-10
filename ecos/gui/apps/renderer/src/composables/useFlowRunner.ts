import { computed, ref, shallowReactive } from 'vue'
import { useRoute } from 'vue-router'
import { useDesktopRuntime } from './useDesktopRuntime'
import { useWorkspace } from './useWorkspace'
import { CMDEnum, StateEnum, StepEnum } from '@/api/type'
import { cancelFlowApi, runStepApi, rtl2gdsApi, type RunStepResponse } from '@/api/flow'
import type { EccFlowCancelResult } from '@ecos-studio/shared'
import type { WorkspaceInvalidationScope } from './useWorkspaceLifecycle'
import {
  clearHomeRunArtifactResetAwaitingBackendStart,
  markHomeRunArtifactResetAwaitingBackendStart,
} from './homeRunArtifacts'

// ============ 模块级运行标志（run_step / rtl2gds 共用）============

/** 任意流程命令执行中为 true，供 Home flow log 等订阅，避免多实例 composable 状态不一致 */
export const flowExecutionActive = ref(false)
const activeFlowWorkspaces = shallowReactive(new Set<string>())
const cancellingFlowWorkspaces = shallowReactive(new Set<string>())
// A completed step can change every data source rendered on the Home left panel:
// flow state, QoR/checklist assets, configuration-derived values, and step metrics.
const FLOW_COMPLETION_FALLBACK_SCOPES: WorkspaceInvalidationScope[] = ['all']

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

function markFlowCancellationRequestedForWorkspace(path: string): void {
  const workspacePath = normalizeWorkspacePath(path)
  if (workspacePath) cancellingFlowWorkspaces.add(workspacePath)
}

function clearFlowCancellationRequestedForWorkspace(path: string): void {
  const workspacePath = normalizeWorkspacePath(path)
  if (workspacePath) cancellingFlowWorkspaces.delete(workspacePath)
}

export function isFlowCancellationRequestedForWorkspace(
  path: string | undefined | null,
): boolean {
  return Boolean(path && cancellingFlowWorkspaces.has(normalizeWorkspacePath(path)))
}

export function isFlowExecutionActiveForWorkspace(
  path: string | undefined | null,
): boolean {
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
 * 本 Hook 只负责调用 ECC RPC runtime command 并等待结果。
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
  const isRunning = computed(() =>
    isFlowExecutionActiveForWorkspace(currentProject.value?.path),
  )
  const isCancelling = computed(() =>
    isFlowCancellationRequestedForWorkspace(currentProject.value?.path),
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
      life: 5000,
    })
  }

  function getCurrentWorkspacePath(): string | null {
    const path = currentProject.value?.path
    return path ? normalizeWorkspacePath(path) : null
  }

  function getCurrentWorkspaceHandle(): string | null {
    return workspaceSession.value.workspaceId || null
  }

  async function cancelFlow(): Promise<EccFlowCancelResult> {
    const directory = getCurrentWorkspacePath()
    const workspaceHandle = getCurrentWorkspaceHandle()
    if (!directory || !workspaceHandle || !isRunning.value) {
      return { accepted: false }
    }

    markFlowCancellationRequestedForWorkspace(directory)
    try {
      const result = await cancelFlowApi(workspaceHandle)
      if (!result.accepted) {
        clearFlowCancellationRequestedForWorkspace(directory)
      }
      return result
    } catch (error) {
      clearFlowCancellationRequestedForWorkspace(directory)
      throw error
    }
  }

  function isRecoveryFailure(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'flow_state_recovery_failed'
    )
  }

  function showCancellationResult(error: unknown): void {
    invalidateWorkspaceResources(FLOW_COMPLETION_FALLBACK_SCOPES, {
      sessionId: workspaceSession.value.sessionId,
    })
    state.value = StateEnum.Imcomplete
    if (isRecoveryFailure(error)) {
      showToast({
        severity: 'error',
        summary: 'Flow State Recovery Failed',
        detail: 'Flow stopped, but state recovery failed.',
        life: 8000,
      })
      return
    }
    showToast({
      severity: 'info',
      summary: 'Flow Cancelled',
      detail: 'Flow cancelled. Unfinished steps were marked Incomplete.',
      life: 5000,
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
          rerun: Boolean(options.rerun),
          workspaceHandle,
        },
      })
      console.log('run step result', result)

      const allResourcesAlreadyInvalidated = FLOW_COMPLETION_FALLBACK_SCOPES.every(
        (key) => resourceVersions.value[key] !== versionsBeforeRunStep[key],
      )
      if (!allResourcesAlreadyInvalidated) {
        invalidateWorkspaceResources(FLOW_COMPLETION_FALLBACK_SCOPES, {
          sessionId: runSessionId,
        })
      }

      if (result.data?.state === StateEnum.Success) {
        showToast({
          severity: 'success',
          summary: 'Step Completed',
          detail: `${step} finished successfully`,
          life: 4000,
        })
      } else {
        showToast({
          severity: 'error',
          summary: 'Step Failed',
          detail: `${step} did not complete successfully`,
          life: 6000,
        })
      }

      return result.data
    } catch (err) {
      console.error('Single-step run failed:', err)
      if (isFlowCancellationRequestedForWorkspace(directory) || isRecoveryFailure(err)) {
        showCancellationResult(err)
      } else {
        showToast({
          severity: 'error',
          summary: 'Step Error',
          detail: err instanceof Error ? err.message : String(err),
          life: 6000,
        })
      }
    } finally {
      clearTransientInteractionLocks()
      clearFlowExecutionActiveForWorkspace(directory)
      clearFlowCancellationRequestedForWorkspace(directory)
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
      const runSessionId = workspaceSession.value.sessionId

      const result = await rtl2gdsApi({
        cmd: CMDEnum.rtl2gds,
        data: {
          directory,
          rerun: Boolean(options.rerun),
          workspaceHandle,
        },
      })
      console.log('rtl2gds result:', result)

      // The runtime emits a final lifecycle event in normal desktop operation.
      // Keep an RPC-return fallback so Home is still refreshed when that event is
      // delayed or unavailable.
      invalidateWorkspaceResources(FLOW_COMPLETION_FALLBACK_SCOPES, {
        sessionId: runSessionId,
      })

      if (result.response === 'success') {
        state.value = StateEnum.Success
        showToast({
          severity: 'success',
          summary: 'RTL2GDS Completed',
          detail: 'All flow steps finished successfully',
          life: 5000,
        })
      } else {
        state.value = StateEnum.Imcomplete
        error.value = result.message?.[0] || 'rtl2gds failed'
        showToast({
          severity: 'error',
          summary: 'RTL2GDS Failed',
          detail: error.value ?? 'Unknown error',
          life: 8000,
        })
      }

      return result.data
    } catch (err) {
      console.error('Run-all flow failed:', err)
      if (isFlowCancellationRequestedForWorkspace(directory) || isRecoveryFailure(err)) {
        showCancellationResult(err)
      } else {
        error.value = err instanceof Error ? err.message : String(err)
        state.value = StateEnum.Imcomplete
        showToast({
          severity: 'error',
          summary: 'RTL2GDS Error',
          detail: error.value ?? 'Unknown error',
          life: 8000,
        })
      }
    } finally {
      clearTransientInteractionLocks()
      clearHomeRunArtifactResetAwaitingBackendStart(directory)
      clearFlowExecutionActiveForWorkspace(directory)
      clearFlowCancellationRequestedForWorkspace(directory)
    }
    return null
  }

  return {
    // 状态
    isRunning,
    isCancelling,
    state,
    error,
    lastRunResult,

    // 方法
    runFlow,
    runAllFlow,
    cancelFlow,
  }
}
