import type {
  ResourceAction as DesktopResourceAction,
  ResourceInfo as DesktopResourceInfo,
  ResourceJob as DesktopResourceJob,
  ResourceList as DesktopResourceList,
  ResourceStatus as DesktopResourceStatus,
  ResourceType as DesktopResourceType,
} from '@ecos-studio/shared'
import { getDesktopApi } from '@/platform/desktop'

export type ResourceType = DesktopResourceType
export type ResourceStatus = DesktopResourceStatus
export type ResourceInfo = DesktopResourceInfo
export type ResourceList = DesktopResourceList
export type ResourceJob = DesktopResourceJob

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

export type ResourceAction = DesktopResourceAction

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

export interface ResourceItem extends ResourceInfo {}

export type InstallPhase =
  | 'downloading'
  | 'verifying'
  | 'extracting'
  | 'post_install'
  | 'done'
  | 'cancelled'
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
  const payload = await getDesktopApi().resources.list()
  return resourceListToTools(payload)
}

export async function listResourcesApi(): Promise<ResourceItem[]> {
  const payload = await getDesktopApi().resources.list()
  return resourceListToResources(payload)
}

export async function getToolStatusApi(name: string): Promise<ToolInfo> {
  const resource = await getDesktopApi().resources.get(resourceIdForTool(name))
  return resourceToToolInfo(resource)
}

export function activatePdkApi(resourceId: string) {
  return getDesktopApi().resources.activatePdk(resourceId)
}

export function validatePdkApi(resourceId: string) {
  return getDesktopApi().resources.validatePdk(resourceId)
}

export function removePdkReferenceApi(resourceId: string) {
  return getDesktopApi().resources.removePdkReference(resourceId)
}

export function importPdkPathApi(path: string) {
  return getDesktopApi().resources.importPdkPath({ path })
}

export function installResourceApi(resourceId: string, version?: string) {
  return getDesktopApi().resources.install({ resourceId, version })
}

export function updateResourceApi(resourceId: string) {
  return getDesktopApi().resources.update(resourceId)
}

export function cancelResourceApi(resourceId: string) {
  return getDesktopApi().resources.cancel(resourceId)
}

export function uninstallResourceApi(resourceId: string) {
  return getDesktopApi().resources.uninstall(resourceId)
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
  return getDesktopApi().resources.refreshRegistry()
}

export function subscribeResourceProgress(
  resourceId: string,
  onProgress: (progress: InstallProgress) => void,
  onError?: (ev: Event) => void,
): { close: () => void } {
  const unsubscribe = getDesktopApi().resources.onProgress((job) => {
    if (job.resource_id !== resourceId) return
    onProgress(resourceJobToInstallProgress(job))
  })

  return {
    close: () => {
      try {
        unsubscribe()
      } catch (error) {
        onError?.(error instanceof Event ? error : new Event('error'))
      }
    },
  }
}

export function subscribePluginProgress(
  toolName: string,
  onProgress: (progress: InstallProgress) => void,
  onError?: (ev: Event) => void,
): { close: () => void } {
  return subscribeResourceProgress(resourceIdForTool(toolName), onProgress, onError)
}
