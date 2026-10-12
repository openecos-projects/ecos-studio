const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

function pluralize(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? '' : 's'} ago`
}

/**
 * Compact relative age for an ISO timestamp ("5 minutes ago"). Returns null
 * when the input is missing or unparseable. `now` is injectable so callers
 * and tests can pin the comparison instant.
 */
export function formatRelativeTime(
  iso: string | null | undefined,
  now: number = Date.now(),
): string | null {
  if (!iso) return null
  const timestamp = Date.parse(iso)
  if (Number.isNaN(timestamp)) return null

  const elapsed = now - timestamp
  if (elapsed < MINUTE_MS) return 'just now'
  if (elapsed < HOUR_MS) return pluralize(Math.floor(elapsed / MINUTE_MS), 'minute')
  if (elapsed < DAY_MS) return pluralize(Math.floor(elapsed / HOUR_MS), 'hour')
  return pluralize(Math.floor(elapsed / DAY_MS), 'day')
}
