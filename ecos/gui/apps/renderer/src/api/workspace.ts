import { toDesktopBridgeData } from './desktopPayload'
import { CMDEnum, ResponseEnum } from './type'
import { getDesktopApi } from '@/platform/desktop'
import type { DesignTool } from '@ecos-studio/shared'

// Types for API requests and responses
export interface ProjectInfo {
  name: string
  path: string
  flow?: Record<string, unknown>
}

export interface WorkspaceResponse {
  cmd: CMDEnum
  response: string
  data: {
    directory: string
    designTool?: DesignTool
    workspace_handle?: string
    workspaceHandle?: string
  }
  message: string[]
}

export interface LoadWorkspaceRequest {
  cmd: CMDEnum.load_workspace
  data: {
    cpu_filelist?: string
    cpu_rtl_files?: string[]
    designTool?: DesignTool
    directory: string
  }
}

export interface CreateWorkspaceRequest {
  cmd: CMDEnum.create_workspace
  data: {
    pdk: string
    pdk_root: string
    directory: string
    parameters: Record<string, unknown>
    origin_def: string
    origin_verilog: string
    filelist: string
    rtl_list: string[]
    design_input_mode?: string
    sdc?: string
    flow_config?: Record<string, unknown>
    pdk_config_mode?: string
    pdk_config?: Record<string, unknown>
    pdk_json?: string
    project_context?: Record<string, unknown>
    soc_filelist?: string
    testbench?: string
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
        workspace_handle: result.workspaceHandle,
        workspaceHandle: result.workspaceHandle,
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
export function createWorkspaceApi(options: {
  directory?: string
  designTool?: DesignTool
  pdk?: string
  parameters?: Record<string, unknown>
  origin_def?: string
  origin_verilog?: string
  rtl_list?: string[]
  pdk_root?: string
  filelist?: string
  design_input_mode?: string
  sdc?: string
  flow_config?: Record<string, unknown>
  pdk_config_mode?: string
  pdk_config?: Record<string, unknown>
  pdk_json?: string
  project_context?: Record<string, unknown>
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
}) {
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

  const data = toDesktopBridgeData({
    directory: options?.directory || '',
    pdk: options?.pdk || '',
    parameters: options.parameters || {},
    origin_def: options.origin_def || '',
    origin_verilog: options.origin_verilog || '',
    rtl_list: options.rtl_list || [],
    pdk_root: options.pdk_root || '',
    filelist: options.filelist || '',
    design_input_mode: options.design_input_mode || '',
    sdc: options.sdc || '',
    flow_config: options.flow_config || {},
    pdk_config_mode: options.pdk_config_mode || '',
    pdk_config: options.pdk_config || {},
    pdk_json: options.pdk_json || '',
    project_context: options.project_context || {},
  })
  return getDesktopApi()
    .runtime.workspace.create({
      designTool: 'backend',
      payload: {
        directory: String(data.directory ?? ''),
        filelist: String(data.filelist ?? ''),
        flowConfig: (data.flow_config as Record<string, unknown>) ?? {},
        originDef: String(data.origin_def ?? ''),
        originVerilog: String(data.origin_verilog ?? ''),
        parameters: (data.parameters as Record<string, unknown>) ?? {},
        pdk: String(data.pdk ?? ''),
        pdkJson: String(data.pdk_json ?? ''),
        pdkRoot: String(data.pdk_root ?? ''),
        rtlList: Array.isArray(data.rtl_list) ? (data.rtl_list as string[]) : [],
        sdc: String(data.sdc ?? ''),
      },
    })
    .then((result) => ({
      cmd: CMDEnum.create_workspace,
      data: {
        directory: result.directory,
        workspace_handle: result.workspaceHandle,
        workspaceHandle: result.workspaceHandle,
      },
      message: [],
      response: ResponseEnum.success,
    })) as Promise<WorkspaceResponse>
}
