import {
  desktopAgentParameterWriteFiles,
  type DesktopAgentWorkspaceParameterWrite,
  type DesktopAgentWorkspaceRerunParameterPatch,
} from '../contracts/desktopAgent.ts'
import { hasSafeJsonPath } from './jsonPath.ts'

const workspacePaths: Record<string, (string | number)[]> = {
  'design.clock': ['design', 'clock_port'],
  'design.frequency_max': ['design', 'frequency_mhz'],
  'floorplan.utilitization': ['params', 'core', 'utilitization'],
  'floorplan.aspect_ratio': ['params', 'core', 'aspect_ratio'],
  'floorplan.margin_x': ['params', 'core', 'margin', 0],
  'floorplan.margin_y': ['params', 'core', 'margin', 1],
  'floorplan.die_width': ['params', 'die', 'size', 0],
  'floorplan.die_height': ['params', 'die', 'size', 1],
}

export function canonicalParameterWriteKey(
  write: DesktopAgentWorkspaceParameterWrite,
): string {
  return JSON.stringify([write.file, ...write.json_path])
}

export function agentParameterIdentity(item: { knob_id: string; step?: string }): string {
  return item.step ? `${item.step}:${item.knob_id}` : item.knob_id
}

/**
 * True when every advertised patch entry has exactly one matching write:
 * same knob, corresponding value, legal surface/file pairing, and a unique
 * canonical target. Length equality alone is not enough — a hostile contract
 * can advertise `place.target_density` and write `pdk_root` in `home/params.toml`.
 */
export function parameterWritesMatchPatch(
  patch: readonly DesktopAgentWorkspaceRerunParameterPatch[],
  writes: readonly DesktopAgentWorkspaceParameterWrite[],
): boolean {
  if (writes.length !== patch.length) return false
  const patchesByKnob = new Map(patch.map((item) => [agentParameterIdentity(item), item]))
  const writeKnobs = new Set<string>()
  const writePaths = new Set<string>()
  return writes.every((write) => {
    const pathKey = canonicalParameterWriteKey(write)
    const key = agentParameterIdentity(write)
    const patchItem = patchesByKnob.get(key)
    if (
      !patchItem ||
      writeKnobs.has(key) ||
      writePaths.has(pathKey) ||
      !(desktopAgentParameterWriteFiles as readonly string[]).includes(write.file) ||
      (write.file === 'home/params.toml') !== (write.surface === 'parameters') ||
      !hasSafeJsonPath(write.json_path) ||
      !writePathMatchesKnob(write) ||
      !writeValueMatchesPatch(write, patchItem)
    ) {
      return false
    }
    writeKnobs.add(key)
    writePaths.add(pathKey)
    return true
  })
}

function writePathMatchesKnob(write: DesktopAgentWorkspaceParameterWrite): boolean {
  const [domain, field] = write.knob_id.split('.')
  let expected: (string | number)[] | undefined
  if (write.file === 'home/params.toml') {
    if (domain === 'place') {
      const name =
        field === 'target_overflow'
          ? 'stop_overflow'
          : field === 'routability_opt'
            ? 'routability_opt_flag'
            : field
      expected = ['params', 'step_params', write.step ?? 'placement', `place.${name}`]
    } else {
      expected = workspacePaths[write.knob_id]
    }
  } else if (domain === 'cts' && write.file === 'config/cts_ecc.json' && field) {
    expected = [field]
  } else if (domain === 'route' && write.file === 'config/routing_ecc.json' && field) {
    const routingField =
      field === 'bottom_layer'
        ? 'bottom_routing_layer'
        : field === 'top_layer'
          ? 'top_routing_layer'
          : field
    expected = ['RT', `-${routingField}`]
  }
  return !!expected && JSON.stringify(expected) === JSON.stringify(write.json_path)
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
