import type { EccWorkspaceConfigurationUpdateRequest } from '@ecos-studio/shared'
import { updateWorkspaceConfigurationApi } from '@/api/workspace'
import type { ConfigData } from './useParameters'

const FIXED_BOTTOM_LAYER = 'MET2'
const FIXED_TOP_LAYER = 'MET5'

export function workspaceConfigurationPatch(
  current: ConfigData,
  original: ConfigData,
): EccWorkspaceConfigurationUpdateRequest['configuration'] {
  const currentConfiguration = canonicalConfiguration(current)
  const originalConfiguration = canonicalConfiguration(original)
  return {
    design: changedEntries(currentConfiguration.design, originalConfiguration.design),
    pdk: changedEntries(currentConfiguration.pdk, originalConfiguration.pdk),
    parameters: changedEntries(
      currentConfiguration.parameters,
      originalConfiguration.parameters,
    ),
  }
}

export async function updateManagedWorkspaceConfiguration(options: {
  config: ConfigData
  original: ConfigData
  workspaceHandle: string
  workspaceRevision: number
}): Promise<number> {
  const result = await updateWorkspaceConfigurationApi({
    commandId: crypto.randomUUID(),
    configuration: workspaceConfigurationPatch(options.config, options.original),
    expectedWorkspaceRevision: options.workspaceRevision,
    ...(options.config.pdkRoot !== options.original.pdkRoot
      ? { pdkRoot: options.config.pdkRoot }
      : {}),
    workspaceHandle: options.workspaceHandle,
  })
  if (!('workspaceRevision' in result) || typeof result.workspaceRevision !== 'number') {
    throw new Error('Workspace configuration update did not return a revision.')
  }
  return result.workspaceRevision
}

function canonicalConfiguration(config: ConfigData) {
  return {
    design: {
      name: config.design,
      topModule: config.topModule,
      clockPort: config.clock,
    },
    pdk: { familyId: config.pdk },
    parameters: {
      'design.frequency_mhz': config.frequencyMax,
      'floorplan.core_util': config.core.utilization,
      'floorplan.die_builder.mode': config.die.Size.length ? 'die_size' : 'die_util',
      'floorplan.die_builder.die_size.width_micron': config.die.Size[0] ?? 0,
      'floorplan.die_builder.die_size.height_micron': config.die.Size[1] ?? 0,
      'floorplan.core_margin': [...config.core.margin],
      'floorplan.aspect_ratio': config.core.aspectRatio,
      'cts.max_fanout': config.maxFanout,
      'place.target_density': config.targetDensity,
      'place.target_overflow': config.targetOverflow,
      'place.global_right_padding': config.globalRightPadding,
      'place.cell_padding_x': config.cellPaddingX,
      'place.routability_opt': config.routabilityOptFlag ? 1 : 0,
      'route.bottom_layer': FIXED_BOTTOM_LAYER,
      'route.top_layer': FIXED_TOP_LAYER,
    },
  }
}

function changedEntries<T extends Record<string, unknown>>(
  current: T,
  original: T,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(current).filter(
      ([key, value]) => JSON.stringify(value) !== JSON.stringify(original[key]),
    ),
  ) as Partial<T>
}
