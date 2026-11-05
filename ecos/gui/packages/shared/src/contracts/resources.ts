export type ResourceType = 'tool' | 'pdk' | 'mpc'

/**
 * Download mirror preference for registry resources, persisted in the desktop
 * settings store under DESKTOP_DOWNLOAD_SOURCE_SETTING_KEY:
 * - `auto`: try GitHub first and fall back to the CNB mirror (default).
 * - `github`: never use the CNB mirror.
 * - `cnb`: prefer the CNB mirror and fall back to GitHub; assets without a
 *   `cnb_url` in the registry still download from GitHub.
 */
export type DesktopDownloadSource = 'auto' | 'github' | 'cnb'

export const DESKTOP_DOWNLOAD_SOURCE_SETTING_KEY = 'download_source'

export const DESKTOP_DOWNLOAD_SOURCE_OPTIONS: readonly DesktopDownloadSource[] = [
  'auto',
  'github',
  'cnb',
]

export const DEFAULT_DESKTOP_DOWNLOAD_SOURCE: DesktopDownloadSource = 'auto'

/** Normalize an untrusted persisted value; null when it is not a valid source. */
export function normalizeDesktopDownloadSource(
  value: unknown,
): DesktopDownloadSource | null {
  return typeof value === 'string' &&
    (DESKTOP_DOWNLOAD_SOURCE_OPTIONS as readonly string[]).includes(value)
    ? (value as DesktopDownloadSource)
    : null
}

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
  | 'remove_reference'
  | 'cancel'

/**
 * Distinguishes why a resource has status `update_available`: `version` means
 * the registry publishes a newer version; `rebuild` means the installed
 * version was republished upstream (same version, different artifact sha256).
 */
export type ResourceUpdateKind = 'version' | 'rebuild'

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
  /** Present when status is `update_available`; null/omitted otherwise. */
  update_kind?: ResourceUpdateKind | null
  /**
   * True when a managed installation has no recorded archive sha256, so
   * rebuild-drift detection is impossible; the UI should suggest reinstalling.
   */
  checksum_missing?: boolean
  requires?: string[]
  installed_requires?: string[]
  missing_requires?: string[]
}

export interface ResourceList {
  resources: ResourceInfo[]
  diagnostics: string[]
}

export interface ResourceUpdateCheckItem {
  resource_id: string
  checked_at: string | null
  sha256: string | null
  status: 'checked' | 'skipped' | 'error'
  update_available: boolean
  error: string | null
  /** Provenance from the published release metadata sidecar, when available. */
  commit?: string | null
  built_at?: string | null
}

export interface ResourceUpdatesDetectedItem {
  resource_id: string
  display_name: string
  update_kind: ResourceUpdateKind | null
  installed_version: string | null
  latest_version: string | null
}

/** Pushed from Electron main when an automatic check finds new updates. */
export interface ResourceUpdatesDetectedEvent {
  resources: ResourceUpdatesDetectedItem[]
}

export interface ResourceStalenessItem {
  id: string
  display_name: string
  installed_version: string | null
  latest_version: string | null
  update_kind: ResourceUpdateKind | null
}

/**
 * Error `details` payload attached to errors coded RESOURCE_UPDATE_AVAILABLE,
 * thrown by main when a flow run would use stale resources.
 */
export interface ResourceStalenessErrorPayload {
  resources: ResourceStalenessItem[]
}

export interface ResourceUpdateCheckResult {
  status: string
  checked_count: number
  update_count: number
  diagnostics: string[]
  resources: ResourceUpdateCheckItem[]
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

export interface MpcSpecReadResult {
  resource_id: string
  installed_version: string
  spec_path: string
  spec: unknown
}

export interface ResourceImportPdkRequest {
  path: string
}

export interface ResourceImportLocalRequest {
  resourceId: string
  path: string
}

export interface ResourceInstallRequest {
  resourceId: string
  version?: string
}
