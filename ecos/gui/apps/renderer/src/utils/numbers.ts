/**
 * TOML parsing yields a bigint exactly when an integer exceeds the safe
 * range, and inf/nan as non-finite numbers — both mean a later save would
 * silently persist a corrupted value. Fail loud instead; strings and other
 * non-numeric inputs still convert (NaN) so fallback handling keeps working.
 */
export function losslessNumber(value: unknown, label: string): number {
  if (typeof value === 'bigint') {
    throw new Error(
      `Parameter ${label} value ${value} exceeds the safe integer range; ` +
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
