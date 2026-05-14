import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { useTauri } from './useTauri'
import { useWorkspace } from './useWorkspace'
import { CMDEnum, StateEnum, StepEnum } from '@/api/type'
import { runStepApi, rtl2gdsApi, type RunStepResponse } from '@/api/flow'

// ============ 模块级运行标志（run_step / rtl2gds 共用）============

/** 任意流程命令执行中为 true，供 Home flow log 等订阅，避免多实例 composable 状态不一致 */
export const flowExecutionActive = ref(false)

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
 * SSE 通知由 useWorkspace 管理（workspace 级别长连接），
 * 本 Hook 只负责调用 API 并等待结果。
 */
export function useFlowRunner() {
  const { ensureTauri } = useTauri()
  const { ensureApiReady, showToast, triggerStepRefresh } = useWorkspace()
  const route = useRoute()

  // 状态（与 flowExecutionActive 同一引用）
  const isRunning = flowExecutionActive
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

  /**
   * 运行当前步骤
   */
  async function runFlow(): Promise<RunStepResponse | null> {
    // 从动态路由参数获取当前步骤
    const step = getCurrentStep()

    if (!step) {
      console.warn('Unable to get current step')
      return null
    }

    // 检查是否在 Tauri 环境中
    if (!ensureTauri()) {
      console.warn('Not running in Tauri environment, cannot execute Python script')
      showDesktopRequiredToast()
      return { step: step as StepEnum, state: StateEnum.Invalid }
    }

    if (!(await ensureApiReady())) {
      return { step: step as StepEnum, state: StateEnum.Invalid }
    }

    if (isRunning.value) {
      return { step: step as StepEnum, state: StateEnum.Ongoing }
    }

    clearTransientInteractionLocks()
    isRunning.value = true
    state.value = StateEnum.Ongoing
    error.value = null
    try {
      console.log('handleRunFlow', step)

      const result = await runStepApi({
        cmd: CMDEnum.run_step,
        data: {
          step: step as StepEnum,
          rerun: false
        }
      })
      console.log('run step result', result)

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

      triggerStepRefresh()
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
      isRunning.value = false
    }
    return null
  }

  /**
   * 运行所有步骤
   * 
   * 调用 rtl2gds API（同步等待后端执行完成）。
   * 执行过程中，后端通过 notify_service 发送 step_complete 等通知，
   * 前端通过 useWorkspace 中已建立的 SSE 连接实时接收。
   */
  async function runAllFlow(): Promise<any | null> {
    // 检查是否在 Tauri 环境中
    if (!ensureTauri()) {
      console.warn('Not running in Tauri environment, cannot execute Python script')
      showDesktopRequiredToast()
      return null
    }

    if (!(await ensureApiReady())) {
      return null
    }

    if (isRunning.value) {
      return null
    }

    clearTransientInteractionLocks()
    isRunning.value = true
    state.value = StateEnum.Ongoing
    error.value = null

    try {
      console.log('Starting rtl2gds flow...')

      const result = await rtl2gdsApi({
        cmd: CMDEnum.rtl2gds,
        data: {
          rerun: false
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

      triggerStepRefresh()
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
      isRunning.value = false
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
