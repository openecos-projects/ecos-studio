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

export type ResourceType = 'tool' | 'pdk'
export type ResourceAction =
  | 'install'
  | 'update'
  | 'uninstall'
  | 'validate'
  | 'activate'
  | 'remove_reference'

export interface ResourceInfo {
  id: string
  type: ResourceType
  name: string
  display_name: string
  description: string
  category: string
  status: ToolStatus | string
  installed_version: string | null
  available_versions: string[]
  active_version: string | null
  active: boolean
  path: string | null
  platform: string | null
  size: number | null
  source: string
  homepage: string
  actions: ResourceAction[]
  health: Record<string, unknown>
  error: string | null
}

interface ResourceList {
  resources: ResourceInfo[]
  diagnostics: string[]
}

interface ResourceJob {
  id: string
  resource_id: string
  action: ResourceAction
  phase: string
  progress: number
  message: string
  error: string | null
}

export type InstallPhase =
  | 'downloading'
  | 'verifying'
  | 'extracting'
  | 'done'
  | 'error'
  | 'uninstalling'

export interface InstallProgress {
  tool: string
  phase: InstallPhase | string
  progress: number
  message: string
}

/** Alova 默认缓存 GET 5 分钟；工具列表必须始终打后端，否则会一直看到旧状态 */
const NO_CACHE = { cacheFor: 0 as const }

function resourceIdForTool(name: string): string {
  return `tool:${name}`
}

export function resourceToToolInfo(resource: ResourceInfo): ToolInfo {
  return {
    name: resource.name,
    display_name: resource.display_name,
    description: resource.description,
    category: resource.category,
    status: resource.status as ToolStatus,
    installed_version: resource.installed_version,
    available_versions: resource.available_versions,
    install_path: resource.path,
  }
}

export function resourceListToTools(payload: ResourceList): ToolInfo[] {
  return payload.resources
    .filter((resource) => resource.type === 'tool')
    .map(resourceToToolInfo)
}

export function resourceListToResources(payload: ResourceList): ResourceInfo[] {
  return payload.resources
}

export function resourceJobToInstallProgress(job: ResourceJob): InstallProgress {
  return {
    tool: job.resource_id.replace(/^tool:/, ''),
    phase: job.phase,
    progress: job.progress,
    message: job.message || job.error || '',
  }
}

export async function listToolsApi(): Promise<ToolInfo[]> {
  const payload = await alovaInstance.Get<ResourceList>('/api/resources', NO_CACHE)
  return resourceListToTools(payload)
}

export async function listResourcesApi(): Promise<ResourceInfo[]> {
  const payload = await alovaInstance.Get<ResourceList>('/api/resources', NO_CACHE)
  return resourceListToResources(payload)
}

export async function getToolStatusApi(name: string): Promise<ToolInfo> {
  const resource = await alovaInstance.Get<ResourceInfo>(
    `/api/resources/${encodeURIComponent(resourceIdForTool(name))}`,
    NO_CACHE,
  )
  return resourceToToolInfo(resource)
}

export function activatePdkApi(resourceId: string) {
  return alovaInstance.Post<{ status: string; resource_id: string }>(
    `/api/resources/${encodeURIComponent(resourceId)}/activate`,
    {},
  )
}

export function validatePdkApi(resourceId: string) {
  return alovaInstance.Post<{ resource_id: string; health: { status: string } }>(
    `/api/resources/${encodeURIComponent(resourceId)}/validate`,
    {},
  )
}

export function removePdkReferenceApi(resourceId: string) {
  return alovaInstance.Delete<{ status: string; resource_id: string }>(
    `/api/resources/pdks/${encodeURIComponent(resourceId.replace(/^pdk:/, ''))}`,
  )
}

export function installToolApi(name: string, version?: string) {
  return alovaInstance.Post<{ status: string; tool: string; version: string }>(
    `/api/resources/${encodeURIComponent(resourceIdForTool(name))}/install`,
    version ? { version } : {},
  )
}

export function uninstallToolApi(name: string) {
  return alovaInstance.Post<{ status: string; tool: string }>(
    `/api/resources/${encodeURIComponent(resourceIdForTool(name))}/uninstall`,
    {},
  )
}

export function refreshRegistryApi() {
  return alovaInstance.Post<{ status: string; tools_count: number }>('/api/resources/registry/refresh')
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
      const job: ResourceJob = JSON.parse(e.data as string)
      onProgress(resourceJobToInstallProgress(job))
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
