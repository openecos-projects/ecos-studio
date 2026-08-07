import { getDesktopApi } from '@/platform/desktop'
import { toDesktopBridgeData } from './desktopPayload'
import { CMDEnum, ResponseEnum, type ResponseData } from './type'

export interface FrontendCpuPortContract {
  name: string
  direction: 'input' | 'output' | 'inout'
  width: number
}

export interface FrontendCatalogEntry {
  id: string
  name: string
  description: string
  status: string
  integration_level?: string
  isa?: string[]
  tags?: string[]
  required_cpu_top_module?: string
  required_cpu_top_port_contract?: FrontendCpuPortContract[]
  cpu_reset_vector?: string
  sim_program_link_base?: string
  default_program_link_base?: string
  bootloader_payload_link_base?: string
  [key: string]: unknown
}

export interface FrontendCatalogPayload {
  version: number
  defaults: {
    core_id: string
    soc_harness_id: string
    toolchain_id: string
    test_suite_id: string
  }
  cores: FrontendCatalogEntry[]
  soc_harnesses: FrontendCatalogEntry[]
  toolchains: FrontendCatalogEntry[]
  test_suites: FrontendCatalogEntry[]
  compatibility?: FrontendCompatibilityEntry[]
}

export interface FrontendCompatibilityEntry {
  core_id: string
  soc_harness_id: string
  can_create_workspace: boolean
  support_level: 'supported' | 'experimental' | 'unsupported'
  status: string
  summary: string
  supported_test_suites: string[]
  issues: Array<{
    code: string
    message: string
  }>
  requires_cpu_filelist: boolean
}

export interface FrontendValidationRequest extends Record<string, unknown> {
  core_id: string
  cpu_filelist?: string
  cpu_rtl_files?: string[]
  cpu_top_module?: string
  soc_harness_id: string
  test_suite_id: string
  toolchain_id: string
}

export interface FrontendValidationIssue {
  severity: 'error' | 'warning'
  code: string
  message: string
  field: string
}

export interface FrontendValidationResult {
  ok: boolean
  support_level: 'supported' | 'experimental' | 'unsupported'
  summary: string
  normalized: {
    core_id: string
    soc_harness_id: string
    soc_variant: string
    toolchain_id: string
    test_suite_id: string
    cpu_filelist: string
    cpu_rtl_files?: string[]
    core_cpu_filelist?: string
    cpu_adapter_filelist?: string
    core_capability?: string
    cpu_wrapper_contract?: string
    cpu_socket_contract?: string
    cpu_wrapper_top?: string
    cpu_top_module?: string
    required_cpu_top_module?: string
    required_cpu_top_ports?: string[]
    required_cpu_top_port_contract?: FrontendCpuPortContract[]
    required_cpu_reset_vector?: string
    cpu_standard_top?: string
    cpu_wrapper_generation?: string
    cpu_supports_difftest?: boolean
    core_supported_test_suites?: string[]
    core_sim_program_link_base?: string
    soc_harness_capability?: string
    soc_wrapper_contract?: string
    soc_wrapper_top?: string
    soc_cpu_socket_contract?: string
    soc_cpu_reset_vector?: string
    soc_default_program_link_base?: string
    soc_bootloader_payload_link_base?: string
    soc_supports_difftest?: boolean
    soc_supported_test_suites?: string[]
    required_capability?: string
    compatibility_status?: string
    compatibility_summary?: string
    compatible_test_suites?: string[]
  }
  issues: FrontendValidationIssue[]
}

export function listFrontendCatalogApi() {
  return getDesktopApi()
    .runtime.frontend.catalog()
    .then((data) => ({
      cmd: CMDEnum.catalog_list,
      data: data as unknown as FrontendCatalogPayload,
      message: Array.isArray(data.message) ? (data.message as string[]) : [],
      response: String(data.response ?? ResponseEnum.success),
    })) as Promise<ResponseData<FrontendCatalogPayload>>
}

export function validateFrontendConfigApi(config: FrontendValidationRequest) {
  return getDesktopApi()
    .runtime.frontend.validateConfig(toDesktopBridgeData(config))
    .then((data) => ({
      cmd: CMDEnum.validate_frontend_config,
      data: data as unknown as FrontendValidationResult,
      message: Array.isArray(data.message) ? (data.message as string[]) : [],
      response: String(data.response ?? ResponseEnum.success),
    })) as Promise<ResponseData<FrontendValidationResult>>
}
