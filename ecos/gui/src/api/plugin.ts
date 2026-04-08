/**
 * Plugin / EDA tools management API
 */

import { alovaInstance, API_BASE_URL } from './client'

export type ToolStatus =
  | 'available'
  | 'installing'
  | 'installed'
  | 'update_available'
  | 'uninstalling'
  | 'error'

export interface ToolInfo {
  name: string
  display_name: string
  description: string
  category: string
  status: ToolStatus
  installed_version: string | null
  available_versions: string[]
  install_path: string | null
}

export type InstallPhase = 'downloading' | 'verifying' | 'extracting' | 'done' | 'error'

export interface InstallProgress {
  tool: string
  phase: InstallPhase | string
  progress: number
  message: string
}

/** Alova 默认缓存 GET 5 分钟；工具列表必须始终打后端，否则会一直看到旧状态 */
const NO_CACHE = { cacheFor: 0 as const }

export function listToolsApi() {
  return alovaInstance.Get<ToolInfo[]>('/plugin/tools', NO_CACHE)
}

export function getToolStatusApi(name: string) {
  return alovaInstance.Get<ToolInfo>(`/plugin/tools/${encodeURIComponent(name)}/status`, NO_CACHE)
}

export function installToolApi(name: string, version?: string) {
  return alovaInstance.Post<{ status: string; tool: string; version: string }>(
    `/plugin/tools/${encodeURIComponent(name)}/install`,
    version ? { version } : {},
  )
}

export function uninstallToolApi(name: string) {
  return alovaInstance.Post<{ status: string; tool: string }>(
    `/plugin/tools/${encodeURIComponent(name)}/uninstall`,
    {},
  )
}

export function refreshRegistryApi() {
  return alovaInstance.Post<{ status: string; tools_count: number }>('/plugin/registry/refresh')
}

export function subscribePluginProgress(
  toolName: string,
  onProgress: (progress: InstallProgress) => void,
  onError?: (ev: Event) => void,
): { close: () => void } {
  const url = `${API_BASE_URL}/plugin/sse/${encodeURIComponent(toolName)}`
  const es = new EventSource(url)

  es.addEventListener('progress', (e: MessageEvent) => {
    try {
      const data: InstallProgress = JSON.parse(e.data as string)
      onProgress(data)
    } catch (err) {
      console.error('Plugin SSE parse error:', err)
    }
  })

  es.onerror = (e) => {
    onError?.(e)
  }

  return {
    close: () => es.close(),
  }
}
