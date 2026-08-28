import {
  desktopAgentParameterWriteFiles,
  type DesktopAgentWorkspaceParameterWrite,
  type DesktopAgentWorkspaceRerunParameterPatch,
} from '../contracts/desktopAgent.ts'
import { hasSafeJsonPath } from './jsonPath.ts'
import { normalizeParameterKey } from './parameterKeys.ts'

const PARAMETER_SURFACE_FILES = new Set(['home/ecc.toml', 'home/parameters.json'])
const NESTED_PARAMETER_TABLES = new Set(['core', 'die', 'die_area'])

/**
 * Canonical identity of a resolved write: both workspace-config aliases
 * (`home/ecc.toml` and `home/parameters.json`) materialize onto whichever
 * config actually exists, so they must collide. String path segments are
 * folded through the ecc mechanical key rule so display-key and snake_case
 * spellings of the same leaf also collide.
 */
export function canonicalParameterWriteKey(
  write: DesktopAgentWorkspaceParameterWrite,
): string {
  const file = PARAMETER_SURFACE_FILES.has(write.file)
    ? 'home/workspace-config'
    : write.file
  const path = write.json_path.map((segment) =>
    typeof segment === 'string' ? normalizeParameterKey(segment) : segment,
  )
  return `${file}:${JSON.stringify(path)}`
}

/**
 * True when every advertised patch entry has exactly one matching write:
 * same knob, corresponding value, legal surface/file pairing, and a unique
 * canonical target. Length equality alone is not enough — a hostile contract
 * can advertise `place.target_density` and write `pdk_root` in `home/ecc.toml`.
 */
export function parameterWritesMatchPatch(
  patch: readonly DesktopAgentWorkspaceRerunParameterPatch[],
  writes: readonly DesktopAgentWorkspaceParameterWrite[],
): boolean {
  if (writes.length !== patch.length) return false
  const patchesByKnob = new Map(patch.map((item) => [item.knob_id, item]))
  const writeKnobs = new Set<string>()
  const writePaths = new Set<string>()
  return writes.every((write) => {
    const pathKey = canonicalParameterWriteKey(write)
    const patchItem = patchesByKnob.get(write.knob_id)
    if (
      !patchItem ||
      writeKnobs.has(write.knob_id) ||
      writePaths.has(pathKey) ||
      !(desktopAgentParameterWriteFiles as readonly string[]).includes(write.file) ||
      PARAMETER_SURFACE_FILES.has(write.file) !== (write.surface === 'parameters') ||
      !hasSafeJsonPath(write.json_path) ||
      !writePathMatchesKnob(write) ||
      !writeValueMatchesPatch(write, patchItem)
    ) {
      return false
    }
    writeKnobs.add(write.knob_id)
    writePaths.add(pathKey)
    return true
  })
}

/**
 * The advertised knob is bound to the complete write path, not just the
 * last segment: `place.target_density` may be spelled `target_density` or
 * `Target density`, and `floorplan.utilitization` may live under `Core`,
 * but `['future', 'target_density']` is not the advertised knob.
 */
function writePathMatchesKnob(write: DesktopAgentWorkspaceParameterWrite): boolean {
  const last = write.json_path[write.json_path.length - 1]
  if (typeof last !== 'string') return false
  const knobParts = write.knob_id.split('.')
  const knobLeaf = knobParts[knobParts.length - 1]
  if (!knobLeaf || normalizeParameterKey(last) !== knobLeaf) return false
  if (write.json_path.length === 1) return true
  if (write.surface === 'step_config' || write.json_path.length !== 2) return false
  const parent = write.json_path[0]
  return (
    typeof parent === 'string' &&
    NESTED_PARAMETER_TABLES.has(normalizeParameterKey(parent))
  )
}

function writeValueMatchesPatch(
  write: DesktopAgentWorkspaceParameterWrite,
  patch: DesktopAgentWorkspaceRerunParameterPatch,
): boolean {
  const expected =
    patch.knob_id === 'place.routability_opt' && typeof patch.value === 'boolean'
      ? Number(patch.value)
      : patch.value
  return JSON.stringify(write.value) === JSON.stringify(expected)
}
