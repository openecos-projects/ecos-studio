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
  name: string
  display_name: string
  description: string
  category: string
  status: ToolStatus
  installed_version: string | null
  available_versions: string[]
  install_path: string | null
}

export type ResourceStatus = ToolStatus

export interface ResourceInfo {
  id: string
  type: ResourceType
  name: string
  display_name: string
  description: string
  category: string
  status: ResourceStatus
  installed_version: string | null
  available_versions: string[]
  active_version: string | null
  active: boolean
  path: string | null
  managed_root: string | null
  platform: string | null
  size: number | null
  source: string
  homepage: string
  actions: ResourceAction[]
  health: Record<string, unknown>
  error: string | null
}

export interface ResourceItem extends ResourceInfo {}

export interface ResourceList {
  resources: ResourceInfo[]
  diagnostics: string[]
}

export interface ResourceJob {
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
  | string

export interface InstallProgress {
  resourceId: string
  resourceName: string
  tool: string
  phase: InstallPhase
  progress: number
  message: string
}

/** Alova 默认缓存 GET 5 分钟；工具列表必须始终打后端，否则会一直看到旧状态 */
const NO_CACHE = { cacheFor: 0 as const }

function resourceIdForTool(name: string): string {
  return `tool:${name}`
}

function resourceNameFromId(resourceId: string): string {
  return resourceId.replace(/^(tool|pdk):/, '')
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

export function resourceToResourceItem(resource: ResourceInfo): ResourceItem {
  return { ...resource }
}

export function resourceListToTools(payload: ResourceList): ToolInfo[] {
  return payload.resources
    .filter((resource) => resource.type === 'tool')
    .map(resourceToToolInfo)
}

export function resourceListToResources(payload: ResourceList): ResourceItem[] {
  return payload.resources.map(resourceToResourceItem)
}

export function resourceJobToInstallProgress(job: ResourceJob): InstallProgress {
  const resourceName = resourceNameFromId(job.resource_id)
  return {
    resourceId: job.resource_id,
    resourceName,
    tool: resourceName,
    phase: job.phase,
    progress: job.progress,
    message: job.message || job.error || '',
  }
}

export async function listToolsApi(): Promise<ToolInfo[]> {
  const payload = await alovaInstance.Get<ResourceList>('/api/resources', NO_CACHE)
  return resourceListToTools(payload)
}

export async function listResourcesApi(): Promise<ResourceItem[]> {
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
  const pdkId = resourceNameFromId(resourceId)
  return alovaInstance.Delete<{ status: string; resource_id: string }>(
    `/api/resources/pdks/${encodeURIComponent(pdkId)}`,
  )
}

export function importPdkPathApi(path: string) {
  return alovaInstance.Post<ResourceItem>('/api/resources/pdks/import', { path })
}

export function installResourceApi(resourceId: string, version?: string) {
  return alovaInstance.Post<{ status: string; resource_id: string; version: string }>(
    `/api/resources/${encodeURIComponent(resourceId)}/install`,
    version ? { version } : {},
  )
}

export function updateResourceApi(resourceId: string) {
  return alovaInstance.Post<{ status: string; resource_id: string; version: string }>(
    `/api/resources/${encodeURIComponent(resourceId)}/update`,
    {},
  )
}

export function uninstallResourceApi(resourceId: string) {
  return alovaInstance.Post<{ status: string; resource_id: string }>(
    `/api/resources/${encodeURIComponent(resourceId)}/uninstall`,
    {},
  )
}

export function installToolApi(name: string, version?: string) {
  return installResourceApi(resourceIdForTool(name), version)
}

export function updateToolApi(name: string) {
  return updateResourceApi(resourceIdForTool(name))
}

export function uninstallToolApi(name: string) {
  return uninstallResourceApi(resourceIdForTool(name))
}

export function refreshRegistryApi() {
  return alovaInstance.Post<{ status: string; tools_count: number }>('/api/resources/registry/refresh')
}

export function subscribeResourceProgress(
  resourceId: string,
  onProgress: (progress: InstallProgress) => void,
  onError?: (ev: Event) => void,
): { close: () => void } {
  const url = `${API_BASE_URL}/api/resources/sse/${encodeURIComponent(resourceId)}`
  const es = new EventSource(url)

  es.addEventListener('progress', (e: MessageEvent) => {
    try {
      const job: ResourceJob = JSON.parse(e.data as string)
      onProgress(resourceJobToInstallProgress(job))
    } catch (err) {
      console.error('Resource SSE parse error:', err)
    }
  })

  es.onerror = (e) => {
    onError?.(e)
  }

  return {
    close: () => es.close(),
  }
}

export function subscribePluginProgress(
  toolName: string,
  onProgress: (progress: InstallProgress) => void,
  onError?: (ev: Event) => void,
): { close: () => void } {
  return subscribeResourceProgress(resourceIdForTool(toolName), onProgress, onError)
}
