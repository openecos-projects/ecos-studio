import { inject, type InjectionKey } from 'vue'

/**
 * Leaf-path diff between the baseline and current step-config documents, used
 * for the side-by-side baseline comparison highlighting.
 *
 * Path convention: object keys are joined with '.', array indices are appended
 * as '[i]' without a dot — e.g. `ifp.thread_number`,
 * `pdn_generator.stripe[2].width_micron`, `RT.-top_routing_layer`.
 *
 * Semantics:
 * - A leaf is anything that is not a plain object or array; objects and arrays
 *   are containers.
 * - Arrays compare positionally (no alignment): inserting a row flags the
 *   shifted tail. Deterministic and predictable for config-sized arrays.
 * - A key present on one side only marks every leaf under it as changed.
 *   Empty objects/arrays contribute no leaves, so views materializing missing
 *   empty containers do not create phantom diffs.
 */
export interface StepConfigDiff {
  readonly count: number
  /** True when the leaf at `path` differs between baseline and current. */
  isChanged(path: string): boolean
  /** Number of changed leaves at `prefix` itself or anywhere under it. */
  changedCountUnder(prefix: string): number
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isContainer(value: unknown): boolean {
  return isPlainObject(value) || Array.isArray(value)
}

function leafSignature(value: unknown): string {
  if (value === undefined) return 'undefined'
  try {
    return JSON.stringify(value) ?? 'undefined'
  } catch {
    return String(value)
  }
}

function childKeyPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key
}

function collectLeaves(value: unknown, path: string, changed: Set<string>): void {
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      collectLeaves(value[key], childKeyPath(path, key), changed)
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectLeaves(item, `${path}[${index}]`, changed))
    return
  }
  changed.add(path)
}

function collectChangedPaths(
  baseline: unknown,
  current: unknown,
  path: string,
  changed: Set<string>,
): void {
  if (isPlainObject(baseline) && isPlainObject(current)) {
    const keys = new Set([...Object.keys(baseline), ...Object.keys(current)])
    for (const key of keys) {
      const childPath = childKeyPath(path, key)
      if (!(key in baseline) || !(key in current)) {
        collectLeaves(key in baseline ? baseline[key] : current[key], childPath, changed)
        continue
      }
      collectChangedPaths(baseline[key], current[key], childPath, changed)
    }
    return
  }

  if (Array.isArray(baseline) && Array.isArray(current)) {
    const length = Math.max(baseline.length, current.length)
    for (let index = 0; index < length; index += 1) {
      const childPath = `${path}[${index}]`
      if (index >= baseline.length || index >= current.length) {
        collectLeaves(
          index < baseline.length ? baseline[index] : current[index],
          childPath,
          changed,
        )
        continue
      }
      collectChangedPaths(baseline[index], current[index], childPath, changed)
    }
    return
  }

  if (isContainer(baseline) || isContainer(current)) {
    // Container vs scalar (or object vs array): the mismatch itself and every
    // leaf on the container side are changed.
    changed.add(path)
    if (isContainer(baseline)) collectLeaves(baseline, path, changed)
    if (isContainer(current)) collectLeaves(current, path, changed)
    return
  }

  if (leafSignature(baseline) !== leafSignature(current)) changed.add(path)
}

export function computeStepConfigDiff(baseline: unknown, current: unknown): StepConfigDiff {
  const changed = new Set<string>()
  collectChangedPaths(baseline, current, '', changed)
  const sorted = [...changed]
  return {
    count: sorted.length,
    isChanged(path: string): boolean {
      return changed.has(path)
    },
    changedCountUnder(prefix: string): number {
      if (!prefix) return sorted.length
      return sorted.filter(
        (path) =>
          path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`),
      ).length
    },
  }
}

// ---- provide/inject wiring shared by both comparison columns ----

export interface StepConfigDiffContext {
  isChanged(path: string): boolean
  changedCountUnder(prefix: string): number
}

export const stepConfigDiffKey: InjectionKey<StepConfigDiffContext | null> = Symbol(
  'step-config-diff',
)

/** Diff context provided by StepConfigPanel when a baseline comparison is active. */
export function useStepConfigDiff(): StepConfigDiffContext | null {
  return inject(stepConfigDiffKey, null)
}
