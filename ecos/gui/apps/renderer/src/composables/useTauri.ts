import { getDesktopApi, hasDesktopApi } from '@/platform/desktop'

export function isDesktopRuntime(): boolean {
  return hasDesktopApi()
}

export function requireDesktopRuntime() {
  return getDesktopApi()
}

export function isTauri(): boolean {
  return isDesktopRuntime()
}

/**
 * useTauri composable
 * 提供桌面运行时相关的状态和守卫函数
 */
export function useTauri() {
  const isInTauri = isTauri()
  
  /**
   * 确保在桌面运行时中执行操作
   * 为兼容现有调用方，默认仅返回 false；
   * 传入 `false` 时走严格模式并抛出桥接缺失错误。
   * 
   * @param showAlert 兼容旧接口保留，不再触发任何 UI 副作用
   * @returns 是否存在桌面桥接
   * @throws {Error} 如果不在桌面运行时且 showAlert 为 false
   */
  function ensureTauri(showAlert = true): boolean {
    if (isInTauri) {
      return true
    }

    if (!showAlert) {
      requireDesktopRuntime()
    }

    return false
  }
  
  return {
    /** 是否在 Tauri 环境中 */
    isInTauri,
    /** 确保在 Tauri 环境中执行 */
    ensureTauri,
    /** 检测函数（向后兼容） */
    isTauri,
    /** 获取桌面桥接层（向后兼容过渡期使用） */
    requireDesktopRuntime,
  }
}
