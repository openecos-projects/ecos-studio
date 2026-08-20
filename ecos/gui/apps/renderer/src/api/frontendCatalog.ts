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

const FRONTEND_CATALOG_VERSION = 1
const CATALOG_ENTRY_ARRAYS = [
  'cores',
  'soc_harnesses',
  'toolchains',
  'test_suites',
] as const
const CATALOG_ENTRY_OPTIONAL_STRINGS = [
  'integration_level',
  'required_cpu_top_module',
  'cpu_reset_vector',
  'sim_program_link_base',
  'default_program_link_base',
  'bootloader_payload_link_base',
] as const
const COMPATIBILITY_SUPPORT_LEVELS = new Set(['supported', 'experimental', 'unsupported'])
const CPU_PORT_DIRECTIONS = new Set(['input', 'output', 'inout'])

export function parseFrontendCatalogPayload(value: unknown): FrontendCatalogPayload {
  const record = catalogRecord(value, 'catalog')
  if (record.version !== FRONTEND_CATALOG_VERSION) {
    throw invalidCatalog(
      `unsupported version ${String(record.version)}; expected ${FRONTEND_CATALOG_VERSION}`,
    )
  }

  const defaultsRecord = catalogRecord(record.defaults, 'defaults')
  const defaults = {
    core_id: catalogText(defaultsRecord, 'core_id', 'defaults'),
    soc_harness_id: catalogText(defaultsRecord, 'soc_harness_id', 'defaults'),
    toolchain_id: catalogText(defaultsRecord, 'toolchain_id', 'defaults'),
    test_suite_id: catalogText(defaultsRecord, 'test_suite_id', 'defaults'),
  }
  const collections = Object.fromEntries(
    CATALOG_ENTRY_ARRAYS.map((key) => [key, parseCatalogEntries(record[key], key)]),
  ) as Record<(typeof CATALOG_ENTRY_ARRAYS)[number], FrontendCatalogEntry[]>

  const ids = {
    cores: catalogIds(collections.cores, 'cores'),
    soc_harnesses: catalogIds(collections.soc_harnesses, 'soc_harnesses'),
    toolchains: catalogIds(collections.toolchains, 'toolchains'),
    test_suites: catalogIds(collections.test_suites, 'test_suites'),
  }
  requireCatalogReference(ids.cores, defaults.core_id, 'defaults.core_id')
  requireCatalogReference(
    ids.soc_harnesses,
    defaults.soc_harness_id,
    'defaults.soc_harness_id',
  )
  requireCatalogReference(ids.toolchains, defaults.toolchain_id, 'defaults.toolchain_id')
  requireCatalogReference(
    ids.test_suites,
    defaults.test_suite_id,
    'defaults.test_suite_id',
  )

  const compatibility =
    record.compatibility === undefined
      ? undefined
      : parseCompatibilityEntries(record.compatibility, ids)

  return {
    version: FRONTEND_CATALOG_VERSION,
    defaults,
    ...collections,
    ...(compatibility ? { compatibility } : {}),
  }
}

export async function listFrontendCatalogApi(): Promise<
  ResponseData<FrontendCatalogPayload>
> {
  const data = await getDesktopApi().runtime.frontend.catalog()
  return {
    cmd: CMDEnum.catalog_list,
    data: parseFrontendCatalogPayload(data),
    message: responseMessages(data.message),
    response: responseStatus(data.response),
  }
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

function parseCatalogEntries(value: unknown, path: string): FrontendCatalogEntry[] {
  if (!Array.isArray(value)) throw invalidCatalog(`${path} must be an array`)
  return value.map((item, index) => parseCatalogEntry(item, `${path}[${index}]`))
}

function parseCatalogEntry(value: unknown, path: string): FrontendCatalogEntry {
  const record = catalogRecord(value, path)
  const entry: FrontendCatalogEntry = {
    ...record,
    id: catalogText(record, 'id', path),
    name: catalogText(record, 'name', path),
    description: catalogString(record, 'description', path),
    status: catalogText(record, 'status', path),
  }

  for (const key of CATALOG_ENTRY_OPTIONAL_STRINGS) {
    const field = optionalCatalogString(record, key, path)
    if (field !== undefined) entry[key] = field
  }
  const isa = optionalCatalogStringArray(record, 'isa', path)
  if (isa) entry.isa = isa
  const tags = optionalCatalogStringArray(record, 'tags', path)
  if (tags) entry.tags = tags
  const ports = optionalCpuPortContract(record.required_cpu_top_port_contract, path)
  if (ports) entry.required_cpu_top_port_contract = ports
  return entry
}

function optionalCpuPortContract(
  value: unknown,
  path: string,
): FrontendCpuPortContract[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    throw invalidCatalog(`${path}.required_cpu_top_port_contract must be an array`)
  }

  const names = new Set<string>()
  return value.map((item, index) => {
    const portPath = `${path}.required_cpu_top_port_contract[${index}]`
    const record = catalogRecord(item, portPath)
    const name = catalogText(record, 'name', portPath)
    const direction = catalogText(record, 'direction', portPath)
    if (!CPU_PORT_DIRECTIONS.has(direction)) {
      throw invalidCatalog(`${portPath}.direction is invalid`)
    }
    if (!Number.isSafeInteger(record.width) || Number(record.width) < 1) {
      throw invalidCatalog(`${portPath}.width must be a positive integer`)
    }
    if (names.has(name)) throw invalidCatalog(`${portPath}.name duplicates ${name}`)
    names.add(name)
    return {
      name,
      direction: direction as FrontendCpuPortContract['direction'],
      width: Number(record.width),
    }
  })
}

function catalogIds(entries: FrontendCatalogEntry[], path: string): Set<string> {
  const ids = new Set<string>()
  for (const entry of entries) {
    if (ids.has(entry.id))
      throw invalidCatalog(`${path} contains duplicate id ${entry.id}`)
    ids.add(entry.id)
  }
  return ids
}

function parseCompatibilityEntries(
  value: unknown,
  ids: Record<(typeof CATALOG_ENTRY_ARRAYS)[number], Set<string>>,
): FrontendCompatibilityEntry[] {
  if (!Array.isArray(value)) throw invalidCatalog('compatibility must be an array')
  const pairs = new Set<string>()
  return value.map((item, index) => {
    const path = `compatibility[${index}]`
    const record = catalogRecord(item, path)
    const coreId = catalogText(record, 'core_id', path)
    const socHarnessId = catalogText(record, 'soc_harness_id', path)
    requireCatalogReference(ids.cores, coreId, `${path}.core_id`)
    requireCatalogReference(ids.soc_harnesses, socHarnessId, `${path}.soc_harness_id`)
    const pair = `${coreId}\0${socHarnessId}`
    if (pairs.has(pair))
      throw invalidCatalog(`${path} duplicates ${coreId}/${socHarnessId}`)
    pairs.add(pair)

    const supportLevel = catalogText(record, 'support_level', path)
    if (!COMPATIBILITY_SUPPORT_LEVELS.has(supportLevel)) {
      throw invalidCatalog(`${path}.support_level is invalid`)
    }
    const supportedTestSuites = catalogStringArray(record, 'supported_test_suites', path)
    for (const testSuiteId of supportedTestSuites) {
      requireCatalogReference(
        ids.test_suites,
        testSuiteId,
        `${path}.supported_test_suites`,
      )
    }
    if (!Array.isArray(record.issues))
      throw invalidCatalog(`${path}.issues must be an array`)
    const issues = record.issues.map((issue, issueIndex) => {
      const issuePath = `${path}.issues[${issueIndex}]`
      const issueRecord = catalogRecord(issue, issuePath)
      return {
        code: catalogText(issueRecord, 'code', issuePath),
        message: catalogText(issueRecord, 'message', issuePath),
      }
    })

    return {
      core_id: coreId,
      soc_harness_id: socHarnessId,
      can_create_workspace: catalogBoolean(record, 'can_create_workspace', path),
      support_level: supportLevel as FrontendCompatibilityEntry['support_level'],
      status: catalogText(record, 'status', path),
      summary: catalogText(record, 'summary', path),
      supported_test_suites: supportedTestSuites,
      issues,
      requires_cpu_filelist: catalogBoolean(record, 'requires_cpu_filelist', path),
    }
  })
}

function requireCatalogReference(ids: Set<string>, id: string, path: string): void {
  if (!ids.has(id)) throw invalidCatalog(`${path} references unknown id ${id}`)
}

function catalogRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidCatalog(`${path} must be an object`)
  }
  return value as Record<string, unknown>
}

function catalogString(
  record: Record<string, unknown>,
  key: string,
  path: string,
): string {
  if (typeof record[key] !== 'string') {
    throw invalidCatalog(`${path}.${key} must be a string`)
  }
  return record[key]
}

function catalogText(record: Record<string, unknown>, key: string, path: string): string {
  const value = catalogString(record, key, path).trim()
  if (!value) throw invalidCatalog(`${path}.${key} must not be empty`)
  return value
}

function optionalCatalogString(
  record: Record<string, unknown>,
  key: string,
  path: string,
): string | undefined {
  return record[key] === undefined ? undefined : catalogString(record, key, path)
}

function catalogStringArray(
  record: Record<string, unknown>,
  key: string,
  path: string,
): string[] {
  const value = record[key]
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw invalidCatalog(`${path}.${key} must be an array of strings`)
  }
  return value.map((item) => item.trim()).filter(Boolean)
}

function optionalCatalogStringArray(
  record: Record<string, unknown>,
  key: string,
  path: string,
): string[] | undefined {
  return record[key] === undefined ? undefined : catalogStringArray(record, key, path)
}

function catalogBoolean(
  record: Record<string, unknown>,
  key: string,
  path: string,
): boolean {
  if (typeof record[key] !== 'boolean') {
    throw invalidCatalog(`${path}.${key} must be a boolean`)
  }
  return record[key]
}

function responseMessages(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((message): message is string => typeof message === 'string')
    : []
}

function responseStatus(value: unknown): ResponseEnum {
  switch (value) {
    case ResponseEnum.error:
    case ResponseEnum.failed:
    case ResponseEnum.success:
    case ResponseEnum.warning:
      return value
    default:
      return ResponseEnum.success
  }
}

function invalidCatalog(detail: string): Error {
  return new Error(`Invalid frontend catalog: ${detail}.`)
}
