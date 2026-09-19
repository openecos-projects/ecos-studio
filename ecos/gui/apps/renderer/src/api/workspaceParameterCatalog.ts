import {
  buildWorkspaceDisplayKeyIndex,
  workspaceParameterCatalogEntries,
} from '@ecos-studio/shared'
import { getDesktopApi } from '@/platform/desktop'

/**
 * Renderer-side consumption of the ECC workspace parameter catalog. The
 * display-key index (display_key -> ECC spec key) drives the wizard's
 * display-key -> spec-key mapping in `backendWorkspaceOptions`. Results are
 * cached briefly: the catalog is static for a given ECC runtime version and
 * this loader may run on every workspace create/update.
 *
 * Degradation: returns null when the desktop bridge is unavailable, the
 * request fails, or the catalog carries no display_key fields (old ECC);
 * callers then fall back to the built-in mapping.
 */

const CACHE_TTL_MS = 5 * 60 * 1000

let cachedIndex: { index: Record<string, string>; at: number } | null = null
let inflight: Promise<Record<string, string> | null> | null = null

async function fetchDisplayKeyIndex(): Promise<Record<string, string> | null> {
  try {
    const model = await getDesktopApi().workspaceCreationModel.get({})
    const index = buildWorkspaceDisplayKeyIndex(
      workspaceParameterCatalogEntries(model?.discovery),
    )
    return Object.keys(index).length > 0 ? index : null
  } catch {
    return null
  }
}

export function invalidateWorkspaceParameterDisplayIndex(): void {
  cachedIndex = null
}

export async function loadWorkspaceParameterDisplayIndex(
  options: { force?: boolean } = {},
): Promise<Record<string, string> | null> {
  if (!options.force && cachedIndex && Date.now() - cachedIndex.at < CACHE_TTL_MS) {
    return cachedIndex.index
  }
  inflight ??= fetchDisplayKeyIndex().then((index) => {
    if (index) cachedIndex = { index, at: Date.now() }
    return index
  })
  try {
    return await inflight
  } finally {
    inflight = null
  }
}
