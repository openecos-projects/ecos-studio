import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { useTauri } from './useTauri'
import { useWorkspace } from './useWorkspace'
import { CMDEnum, StateEnum, StepEnum } from '@/api/type'
import { runStepApi, rtl2gdsApi, type RunStepResponse } from '@/api/flow'

// ============ Composable ============

/**
 * 流程运行器 Hook
 * 负责处理流程的运行、停止、重置等操作
 * 
 * SSE 通知由 useWorkspace 管理（workspace 级别长连接），
 * 本 Hook 只负责调用 API 并等待结果。
 */
export function useFlowRunner() {
  const { isInTauri, ensureTauri } = useTauri()
  const { showToast } = useWorkspace()
  const route = useRoute()

  // 状态
  const isRunning = ref(false)
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
    if (!isInTauri) {
      console.warn('Not running in Tauri environment, cannot execute Python script')
      ensureTauri(true) // 显示警告弹窗
      return { step: step as StepEnum, state: StateEnum.Invalid }
    }

    if (isRunning.value) {
      return { step: step as StepEnum, state: StateEnum.Ongoing }
    }

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
    if (!isInTauri) {
      console.warn('Not running in Tauri environment, cannot execute Python script')
      ensureTauri(true) // 显示警告弹窗
      return null
    }

    if (isRunning.value) {
      return null
    }

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
