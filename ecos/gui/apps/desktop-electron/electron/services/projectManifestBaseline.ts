import type { ProjectManifestBaseDesign } from '@ecos-studio/shared'
import type { WorkspaceBaselineSnapshot } from './eccRpc/workspaceSnapshotLoader'

export function baselineBaseDesign(
  current: ProjectManifestBaseDesign,
  snapshot: WorkspaceBaselineSnapshot,
): ProjectManifestBaseDesign {
  const parameters = snapshot.parameters
  const dbInput = recordValue(snapshot.db.INPUT) ?? {}
  const nextParameters: Record<string, unknown> = {
    ...current.parameters,
    ...normalizedBaselineParameters(parameters),
  }
  const next: ProjectManifestBaseDesign = {
    ...current,
    parameters: nextParameters,
  }
  const pdk = firstString(parameters.PDK, parameters.pdk)
  const pdkRoot = firstString(parameters['PDK Root'], parameters.pdk_root)
  const topModule = firstString(
    parameters['Top module'],
    parameters['Top Module'],
    parameters.top_module,
  )
  const clock = firstString(parameters.Clock, parameters.clock)
  if (!pdk || !topModule || !clock) {
    throw new Error(
      'Baseline workspace snapshot is incomplete: PDK, top module, and clock are required.',
    )
  }
  const rtlList = stringArray(dbInput.rtl_list, dbInput.rtl_paths)
  const originVerilog = firstString(dbInput.origin_verilog, dbInput.verilog_path)
  const originDef = firstString(dbInput.origin_def, dbInput.def_path)

  next.pdk = pdk
  if (pdkRoot) next.pdk_root = pdkRoot
  next.top_module = topModule
  next.clock = clock
  if (rtlList.length > 0) next.rtl_list = rtlList
  if (originVerilog) next.origin_verilog = originVerilog
  if (originDef) next.origin_def = originDef
  return next
}

function normalizedBaselineParameters(
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  const die = recordValue(parameters.Die) ?? {}
  const core = recordValue(parameters.Core) ?? {}
  const dieArea = recordValue(parameters['Die Area']) ?? {}
  const dieSize = numberArray(die.Size)
  const margins = numberArray(core.Margin)
  return {
    design: firstString(parameters.Design, parameters.design),
    top_module: firstString(
      parameters['Top module'],
      parameters['Top Module'],
      parameters.top_module,
    ),
    clock: firstString(parameters.Clock, parameters.clock),
    frequency_max: firstValue(
      parameters['Frequency max [MHz]'],
      parameters.frequency_max,
    ),
    max_fanout: firstValue(parameters['Max fanout'], parameters.max_fanout),
    die_area_mode: firstString(dieArea.mode, parameters.die_area_mode),
    die_width: firstValue(dieArea.width, dieSize[0], parameters.die_width),
    die_height: firstValue(dieArea.height, dieSize[1], parameters.die_height),
    utilitization: firstValue(
      dieArea.utilitization,
      core.Utilitization,
      parameters.utilitization,
    ),
    margin: firstValue(dieArea.margin, margins[0], parameters.margin),
  }
}

function firstString(...values: unknown[]): string {
  return (
    values
      .find(
        (value): value is string => typeof value === 'string' && value.trim().length > 0,
      )
      ?.trim() ?? ''
  )
}

function firstValue(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null)
}

function stringArray(...values: unknown[]): string[] {
  for (const value of values) {
    if (!Array.isArray(value)) continue
    const entries = value.filter(
      (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
    )
    if (entries.length > 0) return entries
  }
  return []
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is number => typeof entry === 'number')
    : []
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
