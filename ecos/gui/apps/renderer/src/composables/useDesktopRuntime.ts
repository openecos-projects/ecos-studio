import { getDesktopApi, hasDesktopApi } from '@/platform/desktop'

export function isDesktopRuntime(): boolean {
  return hasDesktopApi()
}

export function requireDesktopRuntime() {
  return getDesktopApi()
}

/**
 * useDesktopRuntime composable
 * 提供桌面运行时相关的状态和守卫函数
 */
export function useDesktopRuntime() {
  const isDesktopRuntimeAvailable = isDesktopRuntime()

  /**
   * 确保在桌面运行时中执行操作
   * @returns 是否存在桌面桥接
   */
  function ensureDesktopRuntime(): boolean {
    return isDesktopRuntimeAvailable
  }

  return {
    /** 是否在 desktop runtime 环境中 */
    isDesktopRuntimeAvailable,
    /** 确保在 desktop runtime 环境中执行 */
    ensureDesktopRuntime,
    isDesktopRuntime,
    requireDesktopRuntime,
  }
}
