import { toDesktopBridgeData } from './desktopPayload'
import { CMDEnum, ResponseEnum } from './type'
import { getDesktopApi } from '@/platform/desktop'
import {
  projectIdFromName,
  type DesignTool,
  type EccPdkOverrides,
  type EccWorkspaceConfigurationUpdateRequest,
  type EccWorkspaceCreateRequest,
  type EccWorkspaceStepConfigurationReadRequest,
  type EccWorkspaceStepConfigurationReadResult,
  type EccWorkspaceStepConfigurationUpdateRequest,
  type EccWorkspaceStepOutputsResult,
  type ProjectManifestMpc,
  type WorkspaceConfig,
} from '@ecos-studio/shared'

export interface WorkspaceResponse {
  cmd: CMDEnum
  response: string
  data: {
    directory: string
    creationId?: string
    designTool?: DesignTool
    reused?: boolean
    workspace_handle?: string
    workspaceHandle?: string
    workspaceRevision?: number
  }
  message: string[]
}

type BackendWorkspaceCreateOptions = Omit<EccWorkspaceCreateRequest, 'commandId'> & {
  designTool: 'backend'
}

interface FrontendWorkspaceCreateOptions {
  directory?: string
  designTool: 'frontend'
  pdk?: string
  parameters?: Record<string, unknown>
  origin_def?: string
  origin_verilog?: string
  rtl_list?: string[]
  pdk_root?: string
  filelist?: string
  cpu_filelist?: string
  cpu_rtl_files?: string[]
  cpu_top_module?: string
  soc_filelist?: string
  testbench?: string
  sim_cpp_sources?: string[]
  sim_cflags?: string[]
  sim_ldflags?: string[]
  sim_run_args?: string[]
  sim_images?: string[]
  sim_program_names?: string[]
  sim_program_sources?: string[]
  sim_program_link_base?: string
  sim_programs_dir?: string
  sim_compile_preset?: string
  sim_compile_opt_level?: string
  sim_compile_march?: string
  sim_compile_mabi?: string
  sim_compile_extra_cflags?: string[]
  sim_coremark_iterations?: string
  sim_coremark_total_data_size?: string
  sim_coremark_has_float?: boolean
  sim_tests_dir?: string
  sim_tests_out_dir?: string
  sim_build_all_programs?: boolean
  sim_soc_root?: string
  sim_build_test_script?: string
  soc_harness_id?: string
  soc_variant?: string
  toolchain_id?: string
  test_suite_id?: string
  core_id?: string
}

export function backendWorkspaceOptions(
  config: WorkspaceConfig,
  targetDirectory: string,
  parameterDisplayIndex?: Record<string, string> | null,
): BackendWorkspaceCreateOptions {
  const parameters = config.parameters ?? {}
  // Display keys come from the ECC parameter catalog when it carries
  // display_key fields; each maps to its ECC spec key. Old ECC (or an
  // unavailable catalog) yields a null/empty index, in which case the
  // built-in fallback spec keys below are used unchanged.
  const specKey = (displayKey: string, fallback: string): string => {
    const mapped = parameterDisplayIndex?.[displayKey]
    return mapped && mapped.trim() ? mapped : fallback
  }
  const inputs: Array<{ inputId: string; role: string }> = []
  const inputBindings: Record<string, string> = {}
  const addInput = (inputId: string, role: string, path: string) => {
    if (!path) return
    inputs.push({ inputId, role })
    inputBindings[inputId] = path
  }
  if (config.filelist) addInput('filelist', 'filelist', config.filelist)
  else config.rtl_list.forEach((path, index) => addInput(`rtl-${index + 1}`, 'rtl', path))
  if (!config.filelist && !config.rtl_list.length) {
    addInput(
      config.design_input_mode === 'post_synthesis' ? 'netlist' : 'rtl-main',
      config.design_input_mode === 'post_synthesis' ? 'netlist' : 'rtl',
      config.origin_verilog,
    )
  }
  addInput('def', 'def', config.origin_def)
  addInput('sdc', 'sdc', config.sdc ?? '')

  const pdkMode = config.pdk_config_mode === 'manual' ? 'manual' : 'default'
  const pdkFiles: Array<{ fileId: string; role: string }> = []
  const pdkFileBindings: Record<string, string> = {}
  const addPdkFiles = (role: string, paths: string[]) => {
    paths.forEach((path, index) => {
      const fileId = role === 'tech' && index === 0 ? 'tech' : `${role}-${index + 1}`
      pdkFiles.push({ fileId, role })
      pdkFileBindings[fileId] = path
    })
  }
  if (pdkMode === 'manual') {
    addPdkFiles('tech', config.pdk_config?.tech_lef ?? [])
    addPdkFiles('lef', config.pdk_config?.cell_lef ?? [])
    addPdkFiles('liberty', config.pdk_config?.liberty ?? [])
  }

  // Project ecc.toml persistence intent: external PDK directories and the
  // manual resource selection are recorded by the Electron bridge so ECC
  // CLI fresh runs and future wizard sessions see the same declaration.
  const externalPaths = config.pdk_external_paths ?? []
  const manualOverrides: EccPdkOverrides | undefined =
    pdkMode === 'manual' &&
    (config.pdk_config?.tech_lef.length ||
      config.pdk_config?.cell_lef.length ||
      config.pdk_config?.liberty.length)
      ? {
          tech: config.pdk_config?.tech_lef[0] ?? '',
          lefs: [...(config.pdk_config?.cell_lef ?? [])],
          libs: [...(config.pdk_config?.liberty ?? [])],
        }
      : undefined
  const eccPdkConfig =
    externalPaths.length || manualOverrides
      ? {
          externalPaths,
          ...(manualOverrides ? { overrides: manualOverrides } : {}),
        }
      : undefined

  const numberValue = (value: unknown, fallback: number) => {
    const number = Number(value)
    return Number.isFinite(number) ? number : fallback
  }
  const fixedDie = parameters.die_area_mode === 'width_height'
  const flowSteps = config.flow_config?.steps ?? []
  const startStep = config.flow_config?.start_step || flowSteps[0]
  const endStep = config.flow_config?.end_step || flowSteps[flowSteps.length - 1]
  const selectedSteps = new Set([...flowSteps, startStep, endStep].filter(Boolean))
  const flowId =
    selectedSteps.size === 1 && selectedSteps.has('Synthesis') ? 'syn_sta' : 'rtl2gds'
  // Mirrors ECC's applicability aliases (ecc/chipcompiler/engine/workspace_spec.py
  // _parameter_applies_to_flow); an empty step set means the full flow.
  const normalizedSteps = new Set([...selectedSteps].map((step) => step.toLowerCase()))
  const parameterApplies = (aliases: string[]) =>
    normalizedSteps.size === 0 || aliases.some((alias) => normalizedSteps.has(alias))
  const synthesisApplies = parameterApplies(['synthesis'])
  const floorplanApplies = parameterApplies([
    'prefloorplan',
    'macroplacement',
    'postfloorplan',
  ])
  const ctsApplies = parameterApplies(['cts'])
  const placementApplies = parameterApplies(['placement', 'place', 'macroplacement'])
  const mpc = config.mpc as ProjectManifestMpc | null | undefined
  const projectContext = config.project_context

  return {
    designTool: 'backend',
    targetDirectory,
    pdkInstallationId: config.pdk_installation_id,
    pdkRequirement: config.pdk_requirement,
    ...(eccPdkConfig ? { eccPdkConfig } : {}),
    projectId:
      projectContext?.project_id ??
      projectIdFromName(
        projectContext?.project_name || targetDirectory.split('/').pop() || '',
      ),
    projectRoot: projectContext?.project_root || targetDirectory,
    workspaceSpec: {
      schemaVersion: 1,
      design: {
        name: String(parameters.design || targetDirectory.split('/').pop() || ''),
        topModule: String(parameters.top_module || 'top'),
        clockPort: String(parameters.clock || 'clk'),
      },
      inputMode: config.design_input_mode === 'post_synthesis' ? 'postSynthesis' : 'rtl',
      inputs,
      pdk: {
        familyId: config.pdk || 'ics55',
        mode: pdkMode,
        ...(config.pdk_requirement?.version
          ? { version: config.pdk_requirement.version }
          : {}),
        ...(pdkMode === 'manual' ? { files: pdkFiles } : {}),
      },
      flow: {
        flowId,
        ...(startStep && endStep
          ? {
              fromStepId: startStep,
              throughStepId: endStep,
            }
          : {}),
      },
      ...(mpc
        ? {
            mpc: {
              resourceId: mpc.resource_id,
              version: mpc.installed_version,
              designId: mpc.design.design_name || String(mpc.design.index),
            },
          }
        : {}),
      parameters: {
        ...(synthesisApplies
          ? {
              [specKey('frequency_max', 'design.frequency_mhz')]: numberValue(
                parameters.frequency_max,
                100,
              ),
            }
          : {}),
        ...(floorplanApplies
          ? {
              [specKey('utilization', 'floorplan.core_util')]: numberValue(
                parameters.utilization ??
                  parameters.utilitization ??
                  parameters.core_utilization,
                fixedDie ? 0.5 : 0.6,
              ),
              [specKey('die_area_mode', 'floorplan.die_builder.mode')]: fixedDie
                ? 'die_size'
                : 'die_util',
              ...(fixedDie
                ? {
                    [specKey(
                      'die_width',
                      'floorplan.die_builder.die_size.width_micron',
                    )]: numberValue(parameters.die_width, 100),
                    [specKey(
                      'die_height',
                      'floorplan.die_builder.die_size.height_micron',
                    )]: numberValue(parameters.die_height, 100),
                  }
                : {
                    [specKey('margin', 'floorplan.core_margin')]: [
                      numberValue(parameters.margin, 0),
                      numberValue(parameters.margin, 0),
                    ],
                  }),
            }
          : {}),
        ...(ctsApplies
          ? {
              [specKey('max_fanout', 'cts.max_fanout')]: numberValue(
                parameters.max_fanout,
                20,
              ),
            }
          : {}),
        ...(placementApplies
          ? {
              [specKey('target_density', 'place.target_density')]: numberValue(
                parameters.target_density,
                0.2,
              ),
              [specKey('target_overflow', 'place.target_overflow')]: numberValue(
                parameters.target_overflow,
                0.1,
              ),
            }
          : {}),
      },
    },
    workspaceBindings: {
      inputs: inputBindings,
      pdk: {
        root: config.pdk_root,
        ...(pdkMode === 'manual' ? { files: pdkFileBindings } : {}),
      },
      ...(mpc
        ? {
            mpc: {
              template: mpc.core_template,
              sourcePath: mpc.spec_path || mpc.path,
            },
          }
        : {}),
    },
  }
}

/**
 * Open an existing project
 * @param path - Full path to the project directory
 */
export function loadWorkspaceApi(directory: string, designTool: DesignTool = 'backend') {
  return getDesktopApi()
    .runtime.workspace.open({ designTool, directory })
    .then((result) => ({
      cmd: CMDEnum.load_workspace,
      data: {
        designTool,
        directory: result.directory,
        reused: result.reused,
        workspace_handle: result.workspaceHandle,
        workspaceHandle: result.workspaceHandle,
        workspaceRevision: result.workspaceRevision,
      },
      message: [],
      response: ResponseEnum.success,
    })) as Promise<WorkspaceResponse>
}

export function closeWorkspaceApi(
  workspaceHandle: string,
  designTool: DesignTool = 'backend',
) {
  return getDesktopApi().runtime.workspace.close({ designTool, workspaceHandle })
}

/**
 * Create a new project
 * @param path - Parent directory where the project will be created
 * @param name - Name of the new project (optional, defaults to "New_Chip_Design")
 * @param options - Additional project configuration options from wizard
 */
export function createWorkspaceApi(
  options: BackendWorkspaceCreateOptions | FrontendWorkspaceCreateOptions,
) {
  if (options.designTool === 'frontend') {
    const payload = toDesktopBridgeData({
      cpu_filelist: options.cpu_filelist || '',
      cpu_rtl_files: options.cpu_rtl_files || [],
      cpu_top_module: options.cpu_top_module || '',
      designTool: 'frontend',
      directory: options.directory || '',
      filelist: options.filelist || '',
      origin_def: options.origin_def || '',
      origin_verilog: options.origin_verilog || '',
      parameters: options.parameters || {},
      pdk: options.pdk || '',
      pdk_root: options.pdk_root || '',
      rtl_list: options.rtl_list || [],
      sim_build_all_programs: options.sim_build_all_programs ?? false,
      sim_build_test_script: options.sim_build_test_script || '',
      sim_cflags: options.sim_cflags || [],
      sim_compile_extra_cflags: options.sim_compile_extra_cflags || [],
      sim_compile_mabi: options.sim_compile_mabi || '',
      sim_compile_march: options.sim_compile_march || '',
      sim_compile_opt_level: options.sim_compile_opt_level || '',
      sim_compile_preset: options.sim_compile_preset || '',
      sim_coremark_has_float: options.sim_coremark_has_float ?? false,
      sim_coremark_iterations: options.sim_coremark_iterations || '',
      sim_coremark_total_data_size: options.sim_coremark_total_data_size || '',
      sim_cpp_sources: options.sim_cpp_sources || [],
      sim_images: options.sim_images || [],
      sim_ldflags: options.sim_ldflags || [],
      sim_program_link_base: options.sim_program_link_base || '',
      sim_program_names: options.sim_program_names || [],
      sim_program_sources: options.sim_program_sources || [],
      sim_programs_dir: options.sim_programs_dir || '',
      sim_run_args: options.sim_run_args || [],
      sim_soc_root: options.sim_soc_root || '',
      sim_tests_dir: options.sim_tests_dir || '',
      sim_tests_out_dir: options.sim_tests_out_dir || '',
      soc_filelist: options.soc_filelist || '',
      soc_harness_id: options.soc_harness_id || '',
      soc_variant: options.soc_variant || '',
      test_suite_id: options.test_suite_id || '',
      testbench: options.testbench || '',
      toolchain_id: options.toolchain_id || '',
      core_id: options.core_id || '',
    })
    return getDesktopApi()
      .runtime.workspace.create({
        designTool: 'frontend',
        payload: payload as { directory: string } & Record<string, unknown>,
      })
      .then((result) => ({
        cmd: CMDEnum.create_workspace,
        data: {
          designTool: 'frontend' as const,
          directory: result.directory,
          workspace_handle: result.workspaceHandle,
          workspaceHandle: result.workspaceHandle,
        },
        message: [],
        response: ResponseEnum.success,
      })) as Promise<WorkspaceResponse>
  }

  const { designTool: _designTool, ...draft } = options
  const payload = toDesktopBridgeData({
    ...draft,
    commandId: crypto.randomUUID(),
  }) as unknown as EccWorkspaceCreateRequest
  return getDesktopApi()
    .productCommands.execute({
      command: 'workspace.create',
      payload,
    })
    .then((result) => ({
      cmd: CMDEnum.create_workspace,
      data: {
        creationId: 'creationId' in result ? result.creationId : undefined,
        directory: 'directory' in result ? result.directory : '',
        workspace_handle: 'workspaceHandle' in result ? result.workspaceHandle : '',
        workspaceHandle: 'workspaceHandle' in result ? result.workspaceHandle : '',
        workspaceRevision:
          'workspaceRevision' in result ? result.workspaceRevision : undefined,
      },
      message: [],
      response: ResponseEnum.success,
    })) as Promise<WorkspaceResponse>
}

export function updateWorkspaceApi(
  options: BackendWorkspaceCreateOptions,
  workspaceHandle: string,
  expectedWorkspaceRevision: number,
) {
  const { designTool: _designTool, ...request } = options
  return getDesktopApi().productCommands.execute({
    command: 'workspace.update',
    payload: {
      draft: toDesktopBridgeData(request) as Omit<EccWorkspaceCreateRequest, 'commandId'>,
      commandId: crypto.randomUUID(),
      expectedWorkspaceRevision,
      workspaceHandle,
    },
  })
}

export function updateWorkspaceConfigurationApi(
  request: EccWorkspaceConfigurationUpdateRequest,
) {
  return getDesktopApi().productCommands.execute({
    command: 'workspace.updateConfiguration',
    payload: request,
  })
}

export function updateWorkspaceStepConfigurationApi(
  request: EccWorkspaceStepConfigurationUpdateRequest,
) {
  return getDesktopApi().productCommands.execute({
    command: 'workspace.updateStepConfiguration',
    payload: request,
  })
}

export function readWorkspaceStepConfigurationApi(
  request: EccWorkspaceStepConfigurationReadRequest,
): Promise<EccWorkspaceStepConfigurationReadResult> {
  return getDesktopApi().runtime.workspace.stepConfiguration({
    ...request,
    designTool: 'backend',
  })
}

/**
 * Resolve a workspace's committed flow-step output artifacts through the ECC
 * runtime, which owns the real step directory and filename conventions.
 */
export function readWorkspaceStepOutputsApi(
  directory: string,
): Promise<EccWorkspaceStepOutputsResult> {
  return getDesktopApi().runtime.workspace.stepOutputs({
    designTool: 'backend',
    directory,
  })
}
