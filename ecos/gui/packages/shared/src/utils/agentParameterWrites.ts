import {
  desktopAgentParameterWriteFiles,
  type DesktopAgentWorkspaceParameterWrite,
  type DesktopAgentWorkspaceRerunParameterPatch,
} from '../contracts/desktopAgent.ts'
import { hasSafeJsonPath } from './jsonPath.ts'
import { normalizeParameterKey } from './parameterKeys.ts'

const PARAMETER_SURFACE_FILES = ['home/ecc.toml', 'home/parameters.json'] as const
const STEP_CONFIG_FILE_BY_KNOB_PREFIX: Record<string, string> = {
  place: 'config/dreamplace_ecc.json',
  legalization: 'config/dreamplace_ecc.json',
  cts: 'config/cts_ecc.json',
  route: 'config/route_ecc.json',
}

/**
 * Extra canonical parameter-surface paths beyond the flat knob leaf.
 * `floorplan.utilitization` is stored under Core in legacy JSON.
 */
const NESTED_PARAMETER_KNOB_PATHS: Record<string, readonly (readonly string[])[]> = {
  'floorplan.utilitization': [
    ['core', 'utilitization'],
    ['die_area', 'utilitization'],
  ],
}

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
  const file = (PARAMETER_SURFACE_FILES as readonly string[]).includes(write.file)
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
      (PARAMETER_SURFACE_FILES as readonly string[]).includes(write.file) !==
        (write.surface === 'parameters') ||
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
 * Each advertised knob may only land on an explicit (surface, file, path)
 * combination. `place.target_density` is the flat leaf on the workspace
 * config; it is not `core.target_density`, and a step-config knob may not
 * target a different tool's config file.
 */
function writePathMatchesKnob(write: DesktopAgentWorkspaceParameterWrite): boolean {
  const canonicalPath = write.json_path.map((segment) =>
    typeof segment === 'string' ? normalizeParameterKey(segment) : segment,
  )
  if (canonicalPath.some((segment) => typeof segment !== 'string')) return false
  return allowedWriteLocations(write.knob_id).some(
    (location) =>
      location.surface === write.surface &&
      (location.files as readonly string[]).includes(write.file) &&
      JSON.stringify(location.path) === JSON.stringify(canonicalPath),
  )
}

function allowedWriteLocations(knobId: string): Array<{
  files: readonly string[]
  path: readonly string[]
  surface: DesktopAgentWorkspaceParameterWrite['surface']
}> {
  const parts = knobId.split('.')
  const prefix = parts[0]
  const leaf = parts[parts.length - 1]
  if (!prefix || !leaf) return []
  const locations: Array<{
    files: readonly string[]
    path: readonly string[]
    surface: DesktopAgentWorkspaceParameterWrite['surface']
  }> = [{ files: PARAMETER_SURFACE_FILES, path: [leaf], surface: 'parameters' }]
  for (const nested of NESTED_PARAMETER_KNOB_PATHS[knobId] ?? []) {
    locations.push({
      files: PARAMETER_SURFACE_FILES,
      path: nested,
      surface: 'parameters',
    })
  }
  const stepFile = STEP_CONFIG_FILE_BY_KNOB_PREFIX[prefix]
  if (stepFile) {
    locations.push({ files: [stepFile], path: [leaf], surface: 'step_config' })
  }
  return locations
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
