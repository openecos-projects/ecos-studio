import { frontendDesignKindFromConfig } from '@ecos-studio/shared'
import type { WorkspaceConfig } from '@/types'
import type { FrontendWorkspaceCreateOptions } from '@/api/workspace'

export function frontendInputsRequireBackup(
  config: WorkspaceConfig,
  workspacePath: string,
): boolean {
  if (frontendDesignKindFromConfig(config) !== 'generic_rtl') return false
  const root = workspacePath.replace(/\\/g, '/').replace(/\/+$/, '')
  return [config.filelist, config.origin_verilog, ...config.rtl_list].some((value) => {
    const source = value?.replace(/\\/g, '/')
    return source === root || source?.startsWith(`${root}/`)
  })
}

export function genericRtlInputIssues(config: Partial<WorkspaceConfig>): string[] {
  const issues: string[] = []
  const top = String(config.parameters?.top_module ?? '').trim()
  if (!/^[a-zA-Z_][a-zA-Z0-9_$]*$/.test(top))
    issues.push('Enter a valid top module name.')
  const frequency = Number(config.parameters?.frequency_max)
  if (!Number.isFinite(frequency) || frequency <= 0)
    issues.push('Target frequency must be greater than zero.')
  const files = config.rtl_list ?? []
  const inputs = [config.filelist, config.origin_verilog, files.length > 0].filter(
    Boolean,
  )
  if (inputs.length !== 1) issues.push('Choose either one filelist or RTL source files.')
  const sources = [...files, ...(config.origin_verilog ? [config.origin_verilog] : [])]
  if (!config.filelist && !sources.some((file) => /\.(v|sv)$/i.test(file)))
    issues.push('Include at least one .v or .sv source file.')
  if (sources.some((file) => !/\.(v|sv|vh|svh)$/i.test(file)))
    issues.push('Only Verilog and SystemVerilog source or header files are supported.')
  return issues
}

/** Remove CPU-specific settings when the user chooses a standalone RTL design. */
export function genericRtlParameters(parameters: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(parameters).filter(
      ([key]) =>
        !/^(cpu_|required_cpu_|soc_|sim_)/.test(key) &&
        ![
          'core_id',
          'frontend_core_id',
          'core_supported_test_suites',
          'toolchain_id',
          'test_suite_id',
          'testbench',
        ].includes(key),
    ),
  )
}

export function frontendWorkspaceOptions(
  config: Partial<WorkspaceConfig> | undefined,
  directory: string,
): FrontendWorkspaceCreateOptions {
  const kind = frontendDesignKindFromConfig(config)
  const generic = kind === 'generic_rtl'
  const input = config?.parameters ?? {}
  const parameters = {
    ...(generic ? genericRtlParameters(input) : input),
    frontend_design_kind: kind,
    Design: String(
      input.design ||
        input.Design ||
        directory.split('/').filter(Boolean).pop() ||
        'New_Chip_Design',
    ),
    'Design Tool': 'frontend',
    'Top module': generic
      ? (input.top_module ?? input['Top module'] ?? 'top')
      : input.top_module || input['Top module'] || 'ecos_sim_top',
    Clock: generic
      ? (input.clock ?? input.Clock ?? '')
      : input.clock || input.Clock || 'clk',
    'Frequency max [MHz]': generic
      ? (input.frequency_max ?? input['Frequency max [MHz]'] ?? 100)
      : input.frequency_max || input['Frequency max [MHz]'] || 100,
  }
  const common = {
    designTool: 'frontend' as const,
    directory,
    frontend_design_kind: kind,
    parameters,
  }
  if (generic) {
    return {
      ...common,
      filelist: config?.filelist ?? '',
      origin_verilog: config?.origin_verilog ?? '',
      rtl_list: [...(config?.rtl_list ?? [])],
    }
  }
  const list = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : []
  return {
    ...common,
    cpu_filelist: String(input.cpu_filelist || ''),
    cpu_rtl_files: config?.cpu_rtl_files || [],
    cpu_top_module: String(input.cpu_top_module || ''),
    sim_build_all_programs: Boolean(input.sim_build_all_programs),
    sim_build_test_script: String(input.sim_build_test_script || ''),
    sim_cflags: list(input.sim_cflags),
    sim_compile_extra_cflags: list(input.sim_compile_extra_cflags),
    sim_compile_mabi: String(input.sim_compile_mabi || ''),
    sim_compile_march: String(input.sim_compile_march || ''),
    sim_compile_opt_level: String(input.sim_compile_opt_level || ''),
    sim_compile_preset: String(input.sim_compile_preset || ''),
    sim_coremark_has_float: Boolean(input.sim_coremark_has_float),
    sim_coremark_iterations: String(input.sim_coremark_iterations || ''),
    sim_coremark_total_data_size: String(input.sim_coremark_total_data_size || ''),
    sim_cpp_sources: list(input.sim_cpp_sources),
    sim_images: list(input.sim_images),
    sim_ldflags: list(input.sim_ldflags),
    sim_program_names: list(input.sim_program_names),
    sim_program_sources: list(input.sim_program_sources),
    sim_program_link_base: String(input.sim_program_link_base || ''),
    sim_programs_dir: String(input.sim_programs_dir || ''),
    sim_run_args: list(input.sim_run_args),
    sim_soc_root: String(input.sim_soc_root || ''),
    sim_tests_dir: String(input.sim_tests_dir || ''),
    sim_tests_out_dir: String(input.sim_tests_out_dir || ''),
    soc_harness_id: String(input.soc_harness_id || ''),
    soc_filelist: String(input.soc_filelist || ''),
    soc_variant: String(input.soc_variant || 'soc1'),
    testbench: String(input.testbench || ''),
    toolchain_id: String(input.toolchain_id || ''),
    test_suite_id: String(input.test_suite_id || ''),
    core_id: String(input.frontend_core_id || input.core_id || ''),
  }
}
