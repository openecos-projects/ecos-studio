import { formatRelativeTime } from '@/utils/relativeTime'

export const CHECKSUM_MISSING_HINT = 'Checksum missing — reinstall recommended'

interface UpdateCheckFootnoteInput {
  checked_at?: unknown
  commit?: unknown
  stale?: unknown
}

/**
 * Small "Last checked …" line for resources whose health carries an
 * update_check record (tools and MPCs; PDK installations never have one).
 * Appends "· may be outdated" once the cached result exceeds its TTL, and the
 * short published commit when the release metadata recorded one. Returns null
 * when no check has run or the shape is unexpected.
 */
export function updateCheckFootnote(
  updateCheck: unknown,
  now: number = Date.now(),
): string | null {
  if (!updateCheck || typeof updateCheck !== 'object') return null
  const record = updateCheck as UpdateCheckFootnoteInput
  const checkedAt = record.checked_at
  if (typeof checkedAt !== 'string' || !checkedAt.trim()) return null
  const relative = formatRelativeTime(checkedAt, now)
  if (!relative) return null

  const parts = [`Last checked ${relative}`]
  if (record.stale === true) parts.push('may be outdated')
  const commit = record.commit
  if (typeof commit === 'string' && commit.trim()) {
    parts.push(commit.trim().slice(0, 8))
  }
  return parts.join(' · ')
}
