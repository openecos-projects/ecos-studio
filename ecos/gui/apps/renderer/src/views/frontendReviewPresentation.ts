export function resolveReviewStructuralStatus(
  probe: Record<string, unknown> | null | undefined,
): string {
  const status = String(probe?.status || '')
    .trim()
    .toLowerCase()
  if (status === 'failed' && hasOnlyToolLimitErrors(probe?.diagnostics)) {
    return 'tool_limited'
  }
  return status || 'not_run'
}

function hasOnlyToolLimitErrors(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  const errors = value.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item && typeof item === 'object') &&
      String((item as Record<string, unknown>).severity || '').toLowerCase() === 'error',
  )
  return (
    errors.length > 0 &&
    errors.every((item) => String(item.category || '').toLowerCase() === 'tool-limit')
  )
}
