/** Plain-object check: class instances (TOML dates) are not tables. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function assertLosslessShape(value: unknown, label: string): void {
  if (value instanceof Date) {
    throw new Error(
      `Parameter ${label} holds a TOML date where a table or array was expected; ` +
        'edit the workspace configuration manually',
    )
  }
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
}

/**
 * GUI-known scalar fields: a table would stringify to "[object Object]" and an
 * array to a comma-joined list (or Number([]) === 0). Callers must handle Date
 * first so TOML dates keep their own error.
 */
export function assertScalarNotContainer(value: unknown, label: string): void {
  if (Array.isArray(value)) {
    throw new Error(
      `Parameter ${label} must be a scalar, not an array; ` +
        'edit the workspace configuration manually',
    )
  }
  if (typeof value === 'object' && value !== null) {
    throw new Error(
      `Parameter ${label} must be a scalar, not a table; ` +
        'edit the workspace configuration manually',
    )
  }
}

/**
 * optionalRecord for GUI-known table fields: a TOML date, bigint, or
 * non-finite scalar where a table is expected would otherwise flatten into
 * defaults that a save then persists over the original value, so fail loud.
 */
export function losslessOptionalRecord(
  value: unknown,
  label: string,
): Record<string, unknown> | null {
  if (value == null) return null
  assertLosslessShape(value, label)
  if (!isPlainRecord(value)) {
    throw new Error(
      `Parameter ${label} must be a table, not a scalar; ` +
        'edit the workspace configuration manually',
    )
  }
  return value
}

/**
 * GUI-known numeric arrays (`die.size`, `core.margin`): a defined
 * non-array (date, bigint, scalar) would otherwise load as `[]` and be
 * overwritten on the next save.
 */
export function losslessNumberList(value: unknown, label: string): number[] {
  if (value == null) return []
  assertLosslessShape(value, label)
  if (!Array.isArray(value)) {
    throw new Error(
      `Parameter ${label} must be an array, not a scalar; ` +
        'edit the workspace configuration manually',
    )
  }
  return value.map((item) => losslessNumber(item, label))
}

/**
 * optionalString for GUI-known fields: a TOML date, bigint, table, or array
 * would fall through to a default and be written back over the original value
 * on the next save, so fail loud instead of falling back.
 */
export function losslessOptionalString(value: unknown, label: string): string {
  if (value instanceof Date || typeof value === 'bigint') {
    throw new Error(
      `Parameter ${label} holds a value the wizard cannot edit losslessly; ` +
        'edit the workspace configuration manually',
    )
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error(
      `Parameter ${label} value ${value} is not a finite number; ` +
        'edit the workspace configuration manually',
    )
  }
  assertScalarNotContainer(value, label)
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

/**
 * optionalNumber for GUI-known numeric fields: omitted values (null/undefined)
 * keep their documented defaults. Defined but unrepresentable values still
 * fail loud so a later save cannot persist a corrupted conversion.
 */
export function losslessOptionalNumber(
  value: unknown,
  fallback: number,
  label: string,
): number {
  if (value == null) return fallback
  return losslessNumber(value, label)
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
  if (
    typeof value === 'number' &&
    !Number.isSafeInteger(value) &&
    Number.isInteger(value)
  ) {
    throw new Error(
      `Parameter ${label} value ${value} exceeds the safe integer range; ` +
        'edit the workspace configuration manually',
    )
  }
  assertScalarNotContainer(value, label)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed) || String(parsed) !== trimmed) {
      throw new Error(
        `Parameter ${label} value ${value} cannot round-trip as a JavaScript number; ` +
          'edit the workspace configuration manually',
      )
    }
    if (Number.isInteger(parsed) && !Number.isSafeInteger(parsed)) {
      throw new Error(
        `Parameter ${label} value ${value} exceeds the safe integer range; ` +
          'edit the workspace configuration manually',
      )
    }
    return parsed
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(
      `Parameter ${label} value ${value} is not a finite number; ` +
        'edit the workspace configuration manually',
    )
  }
  if (Number.isInteger(parsed) && !Number.isSafeInteger(parsed)) {
    throw new Error(
      `Parameter ${label} value ${parsed} exceeds the safe integer range; ` +
        'edit the workspace configuration manually',
    )
  }
  return parsed
}
