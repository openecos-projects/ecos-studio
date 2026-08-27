/**
 * TOML parsing yields a bigint exactly when an integer exceeds the safe
 * range, so a bigint here always means Number() would round. Fail loud
 * instead of letting a rounded value silently overwrite the workspace on
 * a later save.
 */
export function losslessNumber(value: unknown, label: string): number {
  if (typeof value === 'bigint') {
    throw new Error(
      `Parameter ${label} value ${value} exceeds the safe integer range; ` +
        'edit the workspace configuration manually',
    )
  }
  return Number(value)
}
