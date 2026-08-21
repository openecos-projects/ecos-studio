import { projectManagementWorkspaceStepConfigPaths } from '@ecos-studio/shared'

/**
 * Renderer mirror of the main-process step→config-file mapping
 * (workspaceResourceService buildConfigInfo / configResourceForEccStep) so the
 * baseline workspace's config file can be resolved from its own flow.json
 * (name, tool) — including tool drift and legacy pre-migration filenames.
 */
export type StepConfigResource =
  | { kind: 'config'; path: string; legacyPaths: string[] }
  | { kind: 'frontend'; directoryName: string; path: string }
  | { kind: 'none' }

const ECC_STEP_CONFIG_FILES: Record<string, { path: string; legacyPaths: string[] }> = {
  floorplan: { path: 'config/floorplan_ecc.json', legacyPaths: ['config/fp_default_config.json'] },
  cts: { path: 'config/cts_ecc.json', legacyPaths: ['config/cts_default_config.json'] },
  route: { path: 'config/route_ecc.json', legacyPaths: ['config/rt_default_config.json'] },
  drc: { path: 'config/drc_ecc.json', legacyPaths: ['config/drc_default_config.json'] },
  fixfanout: {
    path: 'config/fixfanout_ecc.json',
    legacyPaths: ['config/no_default_config_fixfanout.json'],
  },
  filler: { path: 'config/filler_ecc.json', legacyPaths: ['config/pl_default_config.json'] },
  rcx: { path: 'config/rcx_ecc.json', legacyPaths: ['config/rcx.json'] },
  sta: { path: 'config/sta_ecc.json', legacyPaths: ['config/sta.json'] },
  db: { path: 'config/db_ecc.json', legacyPaths: ['config/db_default_config.json'] },
}

function isFrontendTool(tool: string): boolean {
  return tool === 'fe' || tool === 'slang' || tool === 'verilator'
}

export function resolveStepConfigResource(step: {
  name: string
  tool: string
}): StepConfigResource {
  const tool = step.tool.trim().toLowerCase()
  const name = step.name.trim().toLowerCase()

  if (tool === 'dreamplace') {
    return {
      kind: 'config',
      path: 'config/dreamplace_ecc.json',
      legacyPaths: ['config/dreamplace.json'],
    }
  }
  if (tool === 'ecc') {
    const file = ECC_STEP_CONFIG_FILES[name]
    if (file) return { kind: 'config', ...file }
    return { kind: 'none' }
  }
  if (isFrontendTool(tool)) {
    const directoryName = `${step.name.trim()}_${step.tool.trim()}`
    return { kind: 'frontend', directoryName, path: `${directoryName}/config/flow_config.json` }
  }
  return { kind: 'none' }
}

/** Paths requested in one readWorkspaceTexts call for a baseline workspace. */
export const baselineStepConfigReadPaths: readonly string[] = [
  'home/flow.json',
  ...projectManagementWorkspaceStepConfigPaths,
]

export function pickConfigText(
  texts: Record<string, string | null>,
  resource: { kind: 'config'; path: string; legacyPaths: string[] },
): { path: string; text: string } | null {
  for (const path of [resource.path, ...resource.legacyPaths]) {
    const text = texts[path]
    if (text != null) return { path, text }
  }
  return null
}
