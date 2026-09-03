const FORBIDDEN_JSON_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

export function isForbiddenJsonPathSegment(segment: string | number): boolean {
  return typeof segment === 'string' && FORBIDDEN_JSON_PATH_SEGMENTS.has(segment)
}

/**
 * Agent json_path segments must be own-property names or array indexes:
 * inherited lookups (`__proto__`, `constructor`, `prototype`) would pass an
 * existence check and let an assignment mutate Object.prototype.
 */
export function hasSafeJsonPath(path: readonly (string | number)[]): boolean {
  return (
    path.length > 0 &&
    path.length <= 8 &&
    path.every((segment) => {
      if (typeof segment === 'number') {
        return Number.isInteger(segment) && segment >= 0
      }
      return (
        typeof segment === 'string' &&
        segment.length > 0 &&
        segment.length <= 128 &&
        !FORBIDDEN_JSON_PATH_SEGMENTS.has(segment)
      )
    })
  )
}

export function readOwnJsonPathSegment(node: unknown, key: string | number): unknown {
  if (typeof key === 'number') {
    return Array.isArray(node) && key < node.length ? node[key] : undefined
  }
  return isPlainObject(node) && Object.prototype.hasOwnProperty.call(node, key)
    ? node[key]
    : undefined
}

export function assignOwnJsonPathValue(
  document: Record<string, unknown>,
  jsonPath: readonly (string | number)[],
  value: unknown,
  missing: () => never,
): void {
  if (!hasSafeJsonPath(jsonPath)) {
    throw new Error(`Parameter path ${JSON.stringify(jsonPath)} is not allowed.`)
  }
  let node: unknown = document
  for (const key of jsonPath.slice(0, -1)) {
    node = readOwnJsonPathSegment(node, key) ?? missing()
  }
  const last = jsonPath[jsonPath.length - 1]
  if (last === undefined || readOwnJsonPathSegment(node, last) === undefined) missing()
  if (typeof last === 'number') (node as unknown[])[last] = value
  else (node as Record<string, unknown>)[last] = value
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
