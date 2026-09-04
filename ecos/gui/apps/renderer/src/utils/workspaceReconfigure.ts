import type { EccWorkspaceRuntimeSnapshot } from '@ecos-studio/shared'
import type { WorkspaceConfig } from '@/types'
import type { ProjectRouteContext } from '@/utils/projectManifestRegistration'
import type { WorkspaceWizardInitialConfig } from '@/utils/workspaceNavigation'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map(record).filter((item) => Object.keys(item).length)
    : []
}

export function workspaceReconfigureInitialConfig(
  snapshot: EccWorkspaceRuntimeSnapshot,
  workspacePath: string,
  projectContext: ProjectRouteContext | null,
): WorkspaceWizardInitialConfig {
  const configuration = snapshot.configuration
  if (!configuration) throw new Error('ECC Workspace configuration is unavailable.')

  const spec = record(configuration.workspaceSpec)
  const bindings = record(configuration.workspaceBindings)
  const design = record(spec.design)
  const pdk = record(spec.pdk)
  const flow = record(spec.flow)
  const parameters = record(spec.parameters)
  const inputBindings = record(bindings.inputs)
  const pdkBindings = record(bindings.pdk)
  const inputs = records(spec.inputs)
  const pdkFiles = records(pdk.files)
  const pathForInputRole = (role: string) => {
    const ref = inputs.find((item) => item.role === role)
    return text(inputBindings[text(ref?.inputId)])
  }
  const pathsForInputRole = (role: string) =>
    inputs
      .filter((item) => item.role === role)
      .map((item) => text(inputBindings[text(item.inputId)]))
      .filter(Boolean)
  const pathsForPdkRole = (role: string) =>
    pdkFiles
      .filter((item) => item.role === role)
      .map((item) => text(record(pdkBindings.files)[text(item.fileId)]))
      .filter(Boolean)
  const steps = snapshot.flow.steps
    .map((step) => step.name)
    .filter((step) => step && step.toLowerCase() !== 'fixfanout')
  const coreMargin = Array.isArray(parameters.core_margin)
    ? parameters.core_margin.filter((value): value is number => typeof value === 'number')
    : []
  const dieWidth = number(parameters.die_width) ?? 0
  const dieHeight = number(parameters.die_height) ?? 0
  const pdkMode = pdk.mode === 'manual' ? 'manual' : 'default'

  return {
    directory: workspacePath,
    lockWorkspaceDirectory: true,
    standaloneWorkspace: !projectContext,
    pdk: text(pdk.familyId) || 'ics55',
    pdk_root: text(pdkBindings.root),
    parameters: {
      ...parameters,
      design: text(design.name),
      top_module: text(design.topModule),
      clock: text(design.clockPort),
      die_area_mode:
        dieWidth > 0 && dieHeight > 0 ? 'width_height' : 'utilitization_margin',
      die_width: dieWidth,
      die_height: dieHeight,
      utilitization: number(parameters.core_utilization),
      margin: coreMargin[0],
    } as WorkspaceConfig['parameters'],
    origin_def: pathForInputRole('def'),
    origin_verilog: pathForInputRole('netlist'),
    rtl_list: pathsForInputRole('rtl'),
    filelist: pathForInputRole('filelist'),
    design_input_mode: spec.inputMode === 'postSynthesis' ? 'post_synthesis' : 'rtl',
    sdc: pathForInputRole('sdc'),
    pdk_config_mode: pdkMode,
    pdk_config: {
      mode: pdkMode,
      tech_lef: pathsForPdkRole('tech'),
      cell_lef: pathsForPdkRole('lef'),
      liberty: pathsForPdkRole('liberty'),
    },
    pdk_json: '',
    flow_config: {
      start_step: text(flow.fromStepId) || steps[0] || 'Synthesis',
      end_step: text(flow.throughStepId) || steps[steps.length - 1] || 'Harden',
      steps,
    },
    project_context: projectContext
      ? {
          mode: 'select',
          project_name:
            projectContext.projectName ||
            projectContext.projectRoot.split('/').filter(Boolean).pop() ||
            '',
          project_root: projectContext.projectRoot,
          project_json_path: `${projectContext.projectRoot}/project.json`,
        }
      : undefined,
  }
}
