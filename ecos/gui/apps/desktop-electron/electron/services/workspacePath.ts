/**
 * Normalize a workspace filesystem path for map keys and equality checks.
 * Trims, unifies separators to `/`, and strips a trailing slash (except root).
 */
export function normalizeWorkspacePath(path: string): string {
  let normalized = path.trim().replace(/\\/g, '/')
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1)
  }
  return normalized
}
