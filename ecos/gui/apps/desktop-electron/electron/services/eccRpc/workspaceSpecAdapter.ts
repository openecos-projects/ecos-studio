import type { EccWorkspaceCreateRequest } from '@ecos-studio/shared'

interface InputRef {
  inputId: string
  role: 'rtl' | 'filelist' | 'netlist' | 'def' | 'sdc'
}

const PARAMETER_MAP: Record<string, string> = {
  'Frequency max [MHz]': 'design.frequency_mhz',
  'Max fanout': 'synth.max_fanout',
  'Target density': 'place.target_density',
  'Target overflow': 'place.target_overflow',
  'Global right padding': 'place.global_right_padding',
  'Cell padding x': 'place.cell_padding_x',
  'Routability opt flag': 'place.routability_opt',
  'Bottom layer': 'route.bottom_layer',
  'Top layer': 'route.top_layer',
  'STA max paths': 'sta.max_paths',
  frequency_max: 'design.frequency_mhz',
  core_utilization: 'floorplan.core_util',
  target_density: 'place.target_density',
  target_overflow: 'place.target_overflow',
  max_fanout: 'synth.max_fanout',
  die_width: 'floorplan.die_width',
  die_height: 'floorplan.die_height',
}

const NON_ENGINEERING_PARAMETER_KEYS = new Set([
  'design',
  'description',
  'top_module',
  'clock',
  'Design',
  'Top module',
  'Clock',
  'PDK',
  'PDK Root',
  'PDK Config',
])

export function workspaceSpecCreatePayload(
  request: EccWorkspaceCreateRequest,
): Record<string, unknown> {
  if (!request.commandId) throw new Error('Workspace commandId is required')
  const inputs: InputRef[] = []
  const inputBindings: Record<string, string> = {}
  const inputMode = resolveInputMode(request)
  if (request.filelist)
    addInput(inputs, inputBindings, 'filelist', 'filelist', request.filelist)
  for (const [index, path] of (request.rtlList ?? []).entries()) {
    addInput(inputs, inputBindings, `rtl-${index + 1}`, 'rtl', path)
  }
  if (!request.filelist && !request.rtlList?.length && request.originVerilog) {
    addInput(
      inputs,
      inputBindings,
      inputMode === 'rtl' ? 'rtl-main' : 'netlist',
      inputMode === 'rtl' ? 'rtl' : 'netlist',
      request.originVerilog,
    )
  }
  if (request.originDef) addInput(inputs, inputBindings, 'def', 'def', request.originDef)
  if (request.sdc) addInput(inputs, inputBindings, 'sdc', 'sdc', request.sdc)

  const pdkJson = legacyPdkJson(request.pdkJson)
  const techLefs = request.pdkConfig?.tech_lef ?? compactStrings([pdkJson.tech])
  const cellLefs = request.pdkConfig?.cell_lef ?? compactStrings(pdkJson.lefs)
  const liberties = request.pdkConfig?.liberty ?? compactStrings(pdkJson.libs)
  const mappingFile = stringValue(pdkJson.mapping_file)
  const hasManualFiles = Boolean(
    techLefs.length || cellLefs.length || liberties.length || mappingFile,
  )
  if (request.pdkConfigMode === 'default' && hasManualFiles) {
    throw new Error('unsupported_legacy_field: pdkJson')
  }
  const pdkMode = request.pdkConfigMode ?? (hasManualFiles ? 'manual' : 'default')
  const pdkFiles: Array<{
    fileId: string
    role: 'tech' | 'lef' | 'liberty' | 'mapping'
  }> = []
  const pdkFileBindings: Record<string, string> = {}
  if (pdkMode === 'manual') {
    for (const [index, path] of techLefs.entries()) {
      addPdkFile(
        pdkFiles,
        pdkFileBindings,
        index ? `tech-${index + 1}` : 'tech',
        'tech',
        path,
      )
    }
    for (const [index, path] of cellLefs.entries()) {
      addPdkFile(pdkFiles, pdkFileBindings, `lef-${index + 1}`, 'lef', path)
    }
    for (const [index, path] of liberties.entries()) {
      addPdkFile(pdkFiles, pdkFileBindings, `liberty-${index + 1}`, 'liberty', path)
    }
    if (mappingFile) {
      addPdkFile(pdkFiles, pdkFileBindings, 'mapping', 'mapping', mappingFile)
    }
  }

  const parameters = canonicalParameters(request.parameters ?? {})
  const flow = canonicalFlow(request.flowConfig)
  const version = request.pdkVersion || stringValue(pdkJson.version) || undefined
  const mpc = canonicalMpc(request.mpc)
  return {
    commandId: request.commandId,
    targetDirectory: request.directory,
    workspaceSpec: {
      schemaVersion: 1,
      design: {
        name: identityString(request.parameters, 'design', 'Design'),
        topModule: identityString(request.parameters, 'top_module', 'Top module'),
        ...(identityString(request.parameters, 'clock', 'Clock')
          ? { clockPort: identityString(request.parameters, 'clock', 'Clock') }
          : {}),
      },
      inputMode: inputMode === 'post_synthesis' ? 'postSynthesis' : 'rtl',
      inputs,
      pdk: {
        familyId: request.pdk || stringValue(pdkJson.name),
        mode: pdkMode,
        ...(version ? { version } : {}),
        ...(pdkMode === 'manual' ? { files: pdkFiles } : {}),
      },
      flow,
      ...(mpc ? { mpc: mpc.spec } : {}),
      parameters,
    },
    workspaceBindings: {
      inputs: inputBindings,
      pdk: {
        root: request.pdkRoot || stringValue(pdkJson.root),
        ...(version ? { version } : {}),
        ...(pdkMode === 'manual' ? { files: pdkFileBindings } : {}),
      },
      ...(mpc ? { mpc: mpc.binding } : {}),
    },
  }
}

function canonicalParameters(input: Record<string, unknown>): Record<string, unknown> {
  const parameters: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (NON_ENGINEERING_PARAMETER_KEYS.has(key)) continue
    if (key.includes('.')) {
      parameters[key] = value
      continue
    }
    const canonical = PARAMETER_MAP[key]
    if (canonical) {
      parameters[canonical] = value
      continue
    }
    if (key === 'die_area_mode') {
      parameters['floorplan.mode'] =
        value === 'utilitization_margin' ? 'utilization' : value
      continue
    }
    if (key === 'utilitization') {
      parameters['floorplan.core_util'] ??= value
      continue
    }
    if (key === 'margin') {
      parameters['floorplan.core_margin'] = [value, value]
      continue
    }
    if (key === 'Core' && isRecord(value)) {
      mapLegacyCore(value, parameters)
      continue
    }
    if (key === 'Die' && isRecord(value)) {
      mapLegacyDie(value, parameters)
      continue
    }
    if (key === 'Die Area' && isRecord(value)) {
      if (value.mode !== undefined) {
        parameters['floorplan.mode'] =
          value.mode === 'utilitization_margin' ? 'utilization' : value.mode
      }
      if (value.width !== undefined) parameters['floorplan.die_width'] = value.width
      if (value.height !== undefined) parameters['floorplan.die_height'] = value.height
      if (value.utilitization !== undefined)
        parameters['floorplan.core_util'] = value.utilitization
      continue
    }
    throw new Error(`unsupported_legacy_field: parameters.${key}`)
  }
  return parameters
}

function canonicalFlow(
  config: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const steps = Array.isArray(config?.steps)
    ? config.steps.filter((step): step is string => typeof step === 'string')
    : []
  const start = stringValue(config?.start_step) || steps[0] || ''
  const end = stringValue(config?.end_step) || steps.at(-1) || ''
  const selected = new Set([...steps, start, end])
  const flowId = selected.has('Harden')
    ? 'harden'
    : selected.has('RCX') || selected.has('sta')
      ? 'rcx'
      : selected.size === 1 && selected.has('Synthesis')
        ? 'syn_sta'
        : 'rtl2gds'
  return {
    flowId,
    ...(start && end ? { fromStepId: start, throughStepId: end } : {}),
  }
}

function resolveInputMode(request: EccWorkspaceCreateRequest): 'rtl' | 'post_synthesis' {
  if (request.designInputMode) return request.designInputMode
  return request.filelist || request.rtlList?.length ? 'rtl' : 'post_synthesis'
}

function identityString(
  parameters: Record<string, unknown> | undefined,
  currentKey: string,
  legacyKey: string,
): string {
  return stringValue(parameters?.[currentKey]) || stringValue(parameters?.[legacyKey])
}

function addInput(
  refs: InputRef[],
  bindings: Record<string, string>,
  inputId: string,
  role: InputRef['role'],
  path: string,
): void {
  refs.push({ inputId, role })
  bindings[inputId] = path
}

function addPdkFile(
  refs: Array<{
    fileId: string
    role: 'tech' | 'lef' | 'liberty' | 'mapping'
  }>,
  bindings: Record<string, string>,
  fileId: string,
  role: 'tech' | 'lef' | 'liberty' | 'mapping',
  path: string,
): void {
  refs.push({ fileId, role })
  bindings[fileId] = path
}

function mapLegacyCore(
  value: Record<string, unknown>,
  parameters: Record<string, unknown>,
): void {
  if (value.Utilitization !== undefined)
    parameters['floorplan.core_util'] = value.Utilitization
  if (value['Aspect ratio'] !== undefined)
    parameters['floorplan.aspect_ratio'] = value['Aspect ratio']
  if (value.Margin !== undefined) parameters['floorplan.core_margin'] = value.Margin
}

function mapLegacyDie(
  value: Record<string, unknown>,
  parameters: Record<string, unknown>,
): void {
  if (!Array.isArray(value.Size)) return
  if (value.Size[0] !== undefined) parameters['floorplan.die_width'] = value.Size[0]
  if (value.Size[1] !== undefined) parameters['floorplan.die_height'] = value.Size[1]
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function compactStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : []
}

function legacyPdkJson(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null || value === '') return {}
  if (!isRecord(value)) throw new Error('unsupported_legacy_field: pdkJson')
  const supported = new Set([
    'name',
    'version',
    'root',
    'tech',
    'lefs',
    'libs',
    'mapping_file',
  ])
  for (const [key, field] of Object.entries(value)) {
    if (!supported.has(key) && hasLegacyValue(field)) {
      throw new Error(`unsupported_legacy_field: pdkJson.${key}`)
    }
  }
  return value
}

function hasLegacyValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false
  if (Array.isArray(value)) return value.length > 0
  if (isRecord(value)) return Object.keys(value).length > 0
  return true
}

function canonicalMpc(value: Record<string, unknown> | null | undefined): {
  binding: Record<string, unknown>
  spec: Record<string, unknown>
} | null {
  if (!value) return null
  const design = isRecord(value.design) ? value.design : {}
  return {
    spec: {
      resourceId: stringValue(value.resource_id),
      version: stringValue(value.installed_version),
      designId: stringValue(design.design_name) || String(design.index ?? ''),
    },
    binding: {
      template: isRecord(value.core_template) ? value.core_template : {},
      sourcePath: stringValue(value.spec_path) || stringValue(value.path),
    },
  }
}
