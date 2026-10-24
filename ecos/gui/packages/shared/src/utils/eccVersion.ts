const PYTHON_PRERELEASE = /^(\d+\.\d+\.\d+)(a|b|rc)(\d+)$/

const PRERELEASE_LABELS = {
  a: 'alpha',
  b: 'beta',
  rc: 'rc',
} as const

/**
 * Normalize ECC's Python/PEP 440 prerelease spelling for comparison with the
 * semver-style bundle identity (for example 0.1.0a12 -> 0.1.0-alpha.12).
 */
export function normalizeEccVersion(version: string): string {
  const trimmed = version.trim()
  const match = trimmed.match(PYTHON_PRERELEASE)
  if (!match) return trimmed
  return `${match[1]}-${PRERELEASE_LABELS[match[2] as keyof typeof PRERELEASE_LABELS]}.${match[3]}`
}
