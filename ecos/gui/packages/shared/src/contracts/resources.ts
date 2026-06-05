export type ResourceType = 'tool' | 'pdk'

export type ResourceStatus =
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
  | 'cancel'

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

export interface ResourceOperationResult {
  status: string
  resource_id: string
  version?: string
}

export interface ResourceImportPdkRequest {
  path: string
}

export interface ResourceInstallRequest {
  resourceId: string
  version?: string
}
