/** Plain-object check: class instances (TOML dates) are not tables. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * TOML parsing yields a bigint exactly when an integer exceeds the safe
 * range, inf/nan as non-finite numbers, and dates as Date instances — all of
 * which a later save would silently persist in corrupted form (rounded,
 * null, or an epoch timestamp). Fail loud instead; strings and other
 * non-numeric inputs still convert (NaN) so fallback handling keeps working.
 */
export function losslessNumber(value: unknown, label: string): number {
  if (typeof value === 'bigint') {
    throw new Error(
      `Parameter ${label} value ${value} exceeds the safe integer range; ` +
        'edit the workspace configuration manually',
    )
  }
  if (value instanceof Date) {
    throw new Error(
      `Parameter ${label} holds a TOML date the GUI cannot edit losslessly; ` +
        'edit the workspace configuration manually',
    )
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error(
      `Parameter ${label} value ${value} is not a finite number; ` +
        'edit the workspace configuration manually',
    )
  }
  return Number(value)
}
