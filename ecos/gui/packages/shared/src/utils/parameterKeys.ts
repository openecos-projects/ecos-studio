/**
 * Mechanical normalization between display parameter keys and the
 * canonical flat snake_case vocabulary used by `home/ecc.toml`.
 *
 * Mirrors `ecc/chipcompiler/data/parameter_keys.py` (normalize_key /
 * normalize_parameter_dict): strip `[unit]` suffixes, lowercase, fold
 * non-alphanumeric runs into `_`, trim leading/trailing `_`. Keep the two
 * implementations aligned when either side changes the rule.
 */

const UNIT_SUFFIX = /\[[^\]]*\]/g
const NON_ALNUM = /[^a-z0-9]+/g
const EDGE_UNDERSCORES = /^_+|_+$/g

/** Map one display key to its canonical snake_case form. */
export function normalizeParameterKey(key: string): string {
  const withoutUnits = String(key).replace(UNIT_SUFFIX, '')
  return withoutUnits
    .trim()
    .toLowerCase()
    .replace(NON_ALNUM, '_')
    .replace(EDGE_UNDERSCORES, '')
}

/**
 * Recursively normalize every dict key, preserving the plain object shape.
 * The input is not mutated. When a long display key and its already-canonical
 * form collide, the long-key value wins and the flat duplicate is dropped
 * (same rule as ecc's `normalize_parameter_dict`). Only plain records are
 * traversed: scalar-like objects (e.g. `Date` from TOML datetimes) pass
 * through untouched, matching ecc's scalar-preserving normalization.
 */
export function normalizeParameterKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeParameterKeys(item))
  }
  if (!isPlainRecord(value)) {
    return value
  }
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const canonical = normalizeParameterKey(key)
    if (Object.prototype.hasOwnProperty.call(result, canonical) && key === canonical) {
      // Inert flat duplicate of a long key already seen: the long-key value
      // wins, the flat one is dropped. Own-property check: `in` would also
      // match inherited names like `constructor`, silently dropping a real
      // document key.
      continue
    }
    // defineProperty, not assignment: a `__proto__` canonical key must become
    // an own data property, not a prototype mutation.
    Object.defineProperty(result, canonical, {
      value: normalizeParameterKeys(item),
      writable: true,
      enumerable: true,
      configurable: true,
    })
  }
  return result
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
