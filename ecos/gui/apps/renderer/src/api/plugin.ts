import { alovaInstance, API_BASE_URL } from './client'

export type ResourceType = 'tool' | 'pdk'

export type ToolStatus =
  | 'available'
  | 'installing'
  | 'installed'
  | 'update_available'
  | 'uninstalling'
  | 'error'
  | 'missing'
  | 'invalid'
  | 'removing'

export type ResourceAction =
  | 'install'
  | 'update'
  | 'uninstall'
  | 'validate'
  | 'activate'
  | 'remove_reference'

export interface ToolInfo {
  id: string
  type: ResourceType
  name: string
  display_name: string
  description: string
  category: string
  status: ToolStatus
  installed_version: string | null
  available_versions: string[]
  active_version?: string | null
  active?: boolean
  path: string | null
  platform?: string | null
  size?: number | null
  source?: string
  homepage?: string
  actions?: ResourceAction[]
  health?: Record<string, unknown>
  error?: string | null
}

export type InstallPhase = 'downloading' | 'verifying' | 'extracting' | 'done' | 'error' | string

export interface InstallProgress {
  id?: string
  resource_id: string
  action?: ResourceAction
  tool?: string
  phase: InstallPhase
  progress: number
  message: string
  error?: string | null
}

export interface ResourceListResponse {
  resources: ToolInfo[]
  diagnostics: string[]
}

/** Alova 默认缓存 GET 5 分钟；工具列表必须始终打后端，否则会一直看到旧状态 */
const NO_CACHE = { cacheFor: 0 as const }

export function listToolsApi() {
  return alovaInstance.Get<ResourceListResponse>('/api/resources', NO_CACHE)
}

export function getToolStatusApi(name: string) {
  return alovaInstance.Get<ToolInfo>(`/api/resources/${encodeURIComponent(resourceIdForTool(name))}`, NO_CACHE)
}

export function installToolApi(name: string, version?: string) {
  return alovaInstance.Post<{ status: string; resource_id: string; version: string }>(
    `/api/resources/${encodeURIComponent(resourceIdForTool(name))}/install`,
    version ? { version } : {},
  )
}

export function updateToolApi(name: string) {
  return alovaInstance.Post<{ status: string; resource_id: string; version: string }>(
    `/api/resources/${encodeURIComponent(resourceIdForTool(name))}/update`,
    {},
  )
}

export function uninstallToolApi(name: string) {
  return alovaInstance.Post<{ status: string; resource_id: string }>(
    `/api/resources/${encodeURIComponent(resourceIdForTool(name))}/uninstall`,
    {},
  )
}

export function refreshRegistryApi() {
  return alovaInstance.Post<{ status: string; tools_count: number; diagnostics?: string[] }>(
    '/api/resources/registry/refresh',
    {},
  )
}

export function subscribePluginProgress(
  toolName: string,
  onProgress: (progress: InstallProgress) => void,
  onError?: (ev: Event) => void,
): { close: () => void } {
  const url = `${API_BASE_URL}/api/resources/sse/${encodeURIComponent(resourceIdForTool(toolName))}`
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

function resourceIdForTool(name: string): string {
  return name.startsWith('tool:') ? name : `tool:${name}`
}
