export function encodeCliValue(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

export function requireString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error('Required value is missing.')
  return value
}

export function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

export function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Required object is missing.')
  return value
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
