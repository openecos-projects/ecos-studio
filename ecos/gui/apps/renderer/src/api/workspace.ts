import { toDesktopCliData } from './desktopPayload'
import { CMDEnum } from './type'
import { getDesktopApi } from '@/platform/desktop'
import type { DesignTool } from '@ecos-studio/shared'

// Types for API requests and responses
export interface ProjectInfo {
  name: string
  path: string
  flow?: Record<string, unknown>
}

export interface WorkspaceResponse {
  cmd: CMDEnum;
  response: string;
  data: {
    directory: string;
    workspace_id?: string;  // 前端用于订阅 CLI runtime events
  };
  message: string[];
}

export interface LoadWorkspaceRequest {
  cmd: CMDEnum.load_workspace;
  data: {
    directory: string;
    designTool?: DesignTool;
  }
}

export interface CreateWorkspaceRequest {
  cmd: CMDEnum.create_workspace;
  data: {
    cpu_filelist?: string,
    cpu_rtl_files?: string[],
    designTool?: DesignTool,
    directory: string,
    filelist: string,
    origin_def: string,
    origin_verilog: string,
    parameters: Record<string, unknown>,
    pdk: string,
    pdk_root: string,
    rtl_list: string[]
    sim_build_all_programs?: boolean,
    sim_build_test_script?: string,
    sim_cflags?: string[],
    sim_cpp_sources?: string[],
    sim_images?: string[],
    sim_ldflags?: string[],
    sim_program_names?: string[],
    sim_program_sources?: string[],
    sim_program_link_base?: string,
    sim_programs_dir?: string,
    sim_compile_preset?: string,
    sim_compile_opt_level?: string,
    sim_compile_march?: string,
    sim_compile_mabi?: string,
    sim_compile_extra_cflags?: string[],
    sim_coremark_iterations?: string,
    sim_coremark_total_data_size?: string,
    sim_coremark_has_float?: boolean,
    sim_run_args?: string[],
    sim_soc_root?: string,
    sim_test_suite?: string,
    sim_tests_dir?: string,
    sim_tests_out_dir?: string,
    soc_harness_id?: string,
    soc_filelist?: string,
    soc_variant?: string,
    testbench?: string,
    toolchain_id?: string,
    test_suite_id?: string,
    core_id?: string,
  }
}

/**
 * Open an existing project
 * @param path - Full path to the project directory
 */
export function loadWorkspaceApi(directory: string, designTool?: DesignTool) {
  return getDesktopApi().cli.execute({
    cmd: 'load_workspace',
    data: toDesktopCliData({
      directory,
      ...(designTool ? { designTool } : {}),
    }),
    source: 'button',
  }) as unknown as Promise<WorkspaceResponse>
}

/**
 * Create a new project
 * @param path - Parent directory where the project will be created
 * @param name - Name of the new project (optional, defaults to "New_Chip_Design")
 * @param options - Additional project configuration options from wizard
 */
export function createWorkspaceApi(
  options: {
    directory?: string,
    designTool?: DesignTool,
    pdk?: string,
    parameters?: Record<string, unknown>,
    origin_def?: string,
    origin_verilog?: string,
    rtl_list?: string[]
    pdk_root?: string
    filelist?: string
    cpu_filelist?: string
    cpu_rtl_files?: string[]
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
) {
  const data = toDesktopCliData({
    cpu_filelist: options.cpu_filelist || '',
    cpu_rtl_files: options.cpu_rtl_files || [],
    designTool: options.designTool,
    directory: options?.directory || '',
    filelist: options.filelist || '',
    origin_def: options.origin_def || '',
    origin_verilog: options.origin_verilog || '',
    parameters: options.parameters || {},
    pdk: options?.pdk || '',
    pdk_root: options.pdk_root || '',
    rtl_list: options.rtl_list || [],
    sim_build_all_programs: options.sim_build_all_programs ?? false,
    sim_build_test_script: options.sim_build_test_script || '',
    sim_cflags: options.sim_cflags || [],
    sim_cpp_sources: options.sim_cpp_sources || [],
    sim_images: options.sim_images || [],
    sim_ldflags: options.sim_ldflags || [],
    sim_program_names: options.sim_program_names || [],
    sim_program_sources: options.sim_program_sources || [],
    sim_program_link_base: options.sim_program_link_base || '',
    sim_programs_dir: options.sim_programs_dir || '',
    sim_compile_preset: options.sim_compile_preset || '',
    sim_compile_opt_level: options.sim_compile_opt_level || '',
    sim_compile_march: options.sim_compile_march || '',
    sim_compile_mabi: options.sim_compile_mabi || '',
    sim_compile_extra_cflags: options.sim_compile_extra_cflags || [],
    sim_coremark_iterations: options.sim_coremark_iterations || '',
    sim_coremark_total_data_size: options.sim_coremark_total_data_size || '',
    sim_coremark_has_float: options.sim_coremark_has_float ?? false,
    sim_run_args: options.sim_run_args || [],
    sim_soc_root: options.sim_soc_root || '',
    sim_tests_dir: options.sim_tests_dir || '',
    sim_tests_out_dir: options.sim_tests_out_dir || '',
    soc_harness_id: options.soc_harness_id || '',
    soc_filelist: options.soc_filelist || '',
    soc_variant: options.soc_variant || '',
    testbench: options.testbench || '',
    toolchain_id: options.toolchain_id || '',
    test_suite_id: options.test_suite_id || '',
    core_id: options.core_id || '',
  })
  return getDesktopApi().cli.execute({
    cmd: 'create_workspace',
    data,
    source: 'button',
  }) as unknown as Promise<WorkspaceResponse>
}
