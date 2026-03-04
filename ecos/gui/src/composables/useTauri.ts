/**
 * Tauri 环境检测和工具函数
 */

/**
 * 检测是否在 Tauri 环境中运行
 * 
 * Tauri v2 在 window 对象上注入 __TAURI_INTERNALS__ 作为标识
 * 这是比检查 __TAURI_IPC__ 更可靠的方式
 * 
 * @returns {boolean} 是否在 Tauri 环境中
 */
export function isTauri(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  
  return '__TAURI_INTERNALS__' in window
}

/**
 * 获取 Tauri 版本信息
 * 
 * @returns {string | null} Tauri 版本号，如果不在 Tauri 环境中则返回 null
 */
export function getTauriVersion(): string | null {
  if (!isTauri()) {
    return null
  }
  
  // Tauri v2 中可以从 __TAURI_INTERNALS__ 获取更多信息
  const internals = (window as any).__TAURI_INTERNALS__
  return internals?.metadata?.version || null
}

/**
 * 检测是否在开发模式
 * 
 * @returns {boolean} 是否在开发模式
 */
export function isTauriDevMode(): boolean {
  return import.meta.env.DEV
}

/**
 * useTauri composable
 * 提供 Tauri 环境相关的状态和工具函数
 */
export function useTauri() {
  const isInTauri = isTauri()
  const version = getTauriVersion()
  const isDevMode = isTauriDevMode()
  
  /**
   * 确保在 Tauri 环境中执行操作
   * 如果不在 Tauri 环境中，抛出错误或显示提示
   * 
   * @param showAlert 是否显示警告弹窗，默认为 true
   * @throws {Error} 如果不在 Tauri 环境且 showAlert 为 false
   */
  function ensureTauri(showAlert = true): void {
    if (!isInTauri) {
      const message = 'This feature is only available in the desktop app. Please run it with the Tauri client.'
      
      if (showAlert) {
        alert(message)
      } else {
        throw new Error(message)
      }
    }
  }
  
  return {
    /** 是否在 Tauri 环境中 */
    isInTauri,
    /** Tauri 版本号 */
    version,
    /** 是否在开发模式 */
    isDevMode,
    /** 确保在 Tauri 环境中执行 */
    ensureTauri,
    /** 检测函数（向后兼容） */
    isTauri
  }
}
