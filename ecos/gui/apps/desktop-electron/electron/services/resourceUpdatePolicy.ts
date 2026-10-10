/**
 * Shared staleness policy for resource update checks. Lives in its own module
 * so both ResourceManagerService (health reporting) and
 * ResourceUpdateScheduler (automatic checks) can import it without a cycle.
 */
export const UPDATE_CHECK_TTL_MS = 6 * 60 * 60 * 1000

/**
 * A check is stale when it never happened, its timestamp cannot be parsed, or
 * it is older than the TTL. Exactly-at-TTL still counts as fresh.
 */
export function isUpdateCheckStale(
  checkedAt: string | null | undefined,
  now: number,
): boolean {
  if (!checkedAt) return true
  const checkedAtMs = Date.parse(checkedAt)
  if (!Number.isFinite(checkedAtMs)) return true
  return now - checkedAtMs > UPDATE_CHECK_TTL_MS
}
