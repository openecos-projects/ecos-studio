import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  DesktopCliCommandRequest,
  DesktopCliCommandResult,
} from '@ecos-studio/shared'
import type {
  DesktopRuntimeAdapter,
  DesktopRuntimeAdapterContext,
} from './desktopRuntimeManager'

type DesignToolRoute = 'backend' | 'frontend'

export interface DesignToolRuntimeAdapterOptions {
  backend: DesktopRuntimeAdapter
  frontend: DesktopRuntimeAdapter
  workspaceParameterReader?: (directory: string) => Record<string, unknown> | null
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/')
  return normalized.length > 1 && normalized.endsWith('/')
    ? normalized.slice(0, -1)
    : normalized
}

function readDesignTool(data: Record<string, unknown>): string {
  const parameters = readRecord(data.parameters)
  return (
    readString(data.designTool) ||
    readString(data.design_tool) ||
    readString(data.designToolType) ||
    readString(parameters['Design Tool']) ||
    readString(parameters.designTool) ||
    readString(parameters.design_tool)
  )
    .trim()
    .toLowerCase()
}

function isFrontendDesignTool(value: string): boolean {
  return (
    value === 'frontend' || value === 'fe' || value === 'fecompiler' || value === 'ecc-fe'
  )
}

function hasFrontendOnlyFields(data: Record<string, unknown>): boolean {
  return [
    'cpuFilelist',
    'cpu_filelist',
    'socFilelist',
    'soc_filelist',
    'testbench',
    'simCppSources',
    'sim_cpp_sources',
    'simProgramNames',
    'sim_program_names',
    'simProgramSources',
    'sim_program_sources',
    'simTestSuite',
    'sim_test_suite',
    'simCpuTestMode',
    'sim_cpu_test_mode',
    'simCpuTestCases',
    'sim_cpu_test_cases',
    'simCompilePreset',
    'sim_compile_preset',
    'simCompileOptLevel',
    'sim_compile_opt_level',
    'simCompileMarch',
    'sim_compile_march',
    'simCompileMabi',
    'sim_compile_mabi',
    'simCompileExtraCflags',
    'sim_compile_extra_cflags',
    'simCoremarkIterations',
    'sim_coremark_iterations',
    'simCoremarkTotalDataSize',
    'sim_coremark_total_data_size',
    'simCoremarkHasFloat',
    'sim_coremark_has_float',
    'simAllTests',
    'sim_all_tests',
    'simBuildAllPrograms',
    'sim_build_all_programs',
    'simCflags',
    'sim_cflags',
    'simImages',
    'sim_images',
    'simLdflags',
    'sim_ldflags',
    'simProgramsDir',
    'sim_programs_dir',
    'simRunArgs',
    'sim_run_args',
    'simTestsDir',
    'sim_tests_dir',
    'simTestsOutDir',
    'sim_tests_out_dir',
    'socVariant',
    'soc_variant',
  ].some((field) => field in data)
}

function defaultWorkspaceParameterReader(
  directory: string,
): Record<string, unknown> | null {
  const normalized = normalizePath(directory)
  if (!normalized) return null

  const parametersPath = join(normalized, 'home', 'parameters.json')
  if (!existsSync(parametersPath)) return null

  try {
    return JSON.parse(readFileSync(parametersPath, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

export class DesignToolRuntimeAdapter implements DesktopRuntimeAdapter {
  private readonly backend: DesktopRuntimeAdapter
  private readonly frontend: DesktopRuntimeAdapter
  private readonly workspaceParameterReader: (
    directory: string,
  ) => Record<string, unknown> | null
  private activeRoute: DesignToolRoute = 'backend'
  private readonly frontendWorkspaces = new Set<string>()

  constructor(options: DesignToolRuntimeAdapterOptions) {
    this.backend = options.backend
    this.frontend = options.frontend
    this.workspaceParameterReader =
      options.workspaceParameterReader ?? defaultWorkspaceParameterReader
  }

  async execute(
    request: DesktopCliCommandRequest,
    context: DesktopRuntimeAdapterContext,
  ): Promise<DesktopCliCommandResult> {
    const useFrontend = this.isFrontendRequest(request)
    const adapter = useFrontend ? this.frontend : this.backend
    const result = await adapter.execute(request, context)

    this.rememberRoute(request, result, useFrontend ? 'frontend' : 'backend')

    return result
  }

  private isFrontendRequest(request: DesktopCliCommandRequest): boolean {
    if (request.cmd === 'catalog_list' || request.cmd === 'validate_frontend_config')
      return true

    const data = readRecord(request.data)
    if (isFrontendDesignTool(readDesignTool(data))) return true
    if (hasFrontendOnlyFields(data)) return true

    const directory = normalizePath(readString(data.directory))
    if (!directory) return this.activeRoute === 'frontend'
    if (this.frontendWorkspaces.has(directory)) return true

    const parameters = this.workspaceParameterReader(directory)
    return parameters ? isFrontendDesignTool(readDesignTool({ parameters })) : false
  }

  private rememberRoute(
    request: DesktopCliCommandRequest,
    result: DesktopCliCommandResult,
    route: DesignToolRoute,
  ): void {
    const data = readRecord(request.data)
    const directory = normalizePath(
      readString(result.data.directory) || readString(data.directory),
    )

    if (route === 'frontend') {
      if (directory) {
        this.activeRoute = 'frontend'
        this.frontendWorkspaces.add(directory)
      }
      return
    }

    if (
      result.response === 'success' &&
      (request.cmd === 'create_workspace' || request.cmd === 'load_workspace')
    ) {
      this.activeRoute = 'backend'
    }
  }
}
