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

interface LintRuleDiagnosticLike {
  code?: unknown
  source?: unknown
  ownership?: unknown
  actionable?: unknown
}

export function selectLintRuleDiagnostic<T extends LintRuleDiagnosticLike>(
  ruleCode: string,
  diagnostics: readonly T[],
): T | null {
  const normalizedCode = ruleCode.trim().toUpperCase()
  if (!normalizedCode) return null

  const matches = diagnostics.filter(
    (diagnostic) =>
      String(diagnostic.code || '')
        .trim()
        .toUpperCase() === normalizedCode,
  )
  return (
    matches.find(
      (diagnostic) =>
        diagnostic.actionable === true ||
        String(diagnostic.ownership || '').toLowerCase() === 'cpu',
    ) ??
    matches.find((diagnostic) => Boolean(String(diagnostic.source || '').trim())) ??
    matches[0] ??
    null
  )
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
