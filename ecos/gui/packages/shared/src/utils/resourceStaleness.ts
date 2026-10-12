import type {
  ResourceStalenessErrorPayload,
  ResourceStalenessItem,
  ResourceUpdateKind,
} from '../contracts/resources.ts'

/**
 * Stable error code thrown by Electron main when a flow run is about to use
 * resources that have an update available. The renderer converts it into a
 * confirmation dialog; retrying with `allowStaleResources: true` bypasses it.
 */
export const RESOURCE_UPDATE_AVAILABLE = 'RESOURCE_UPDATE_AVAILABLE'

export function isResourceStalenessError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === RESOURCE_UPDATE_AVAILABLE
  )
}

function readUpdateKind(value: unknown): ResourceUpdateKind | null {
  return value === 'version' || value === 'rebuild' ? value : null
}

function readStalenessItem(value: unknown): ResourceStalenessItem | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || record.id.length === 0) return null
  return {
    id: record.id,
    display_name:
      typeof record.display_name === 'string' ? record.display_name : record.id,
    installed_version:
      typeof record.installed_version === 'string' ? record.installed_version : null,
    latest_version:
      typeof record.latest_version === 'string' ? record.latest_version : null,
    update_kind: readUpdateKind(record.update_kind),
  }
}

/** Reads the `details` payload attached to a RESOURCE_UPDATE_AVAILABLE error. */
export function readResourceStalenessPayload(
  error: unknown,
): ResourceStalenessErrorPayload | null {
  if (!isResourceStalenessError(error)) return null
  const details = (error as { details?: unknown }).details
  if (typeof details !== 'object' || details === null) return null
  const resources = (details as Record<string, unknown>).resources
  if (!Array.isArray(resources)) return null
  const items = resources
    .map(readStalenessItem)
    .filter((item): item is ResourceStalenessItem => item !== null)
  return { resources: items }
}
