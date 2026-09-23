import {
  workspaceParameterCatalogEntries,
  type WorkspaceParameterCatalogEntry,
} from '@ecos-studio/shared'

/**
 * In-memory cache of the latest `workspace_spec.describe` discovery document
 * seen by the main process. Feeding points are the IPC handlers that already
 * call `describeWorkspaceSpec` (workspace creation model). Agent contract
 * parsing reads the cache synchronously; when the cache is cold or the
 * catalog carries no `knob_id` fields (old ECC), consumers fall back to
 * their built-in tables.
 */
let cachedDiscovery: Record<string, unknown> | null = null

export function rememberWorkspaceParameterCatalog(discovery: unknown): void {
  if (discovery && typeof discovery === 'object' && !Array.isArray(discovery)) {
    cachedDiscovery = discovery as Record<string, unknown>
  }
}

export function workspaceParameterCatalogSnapshot(): WorkspaceParameterCatalogEntry[] {
  return workspaceParameterCatalogEntries(cachedDiscovery)
}

/** Test hook: reset the cached discovery document. */
export function clearWorkspaceParameterCatalogCache(): void {
  cachedDiscovery = null
}
