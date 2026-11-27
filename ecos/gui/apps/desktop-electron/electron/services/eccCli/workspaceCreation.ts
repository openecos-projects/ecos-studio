import { basename, join, resolve } from 'node:path'
import type { EccWorkspaceCreateRequest } from '@ecos-studio/shared'
import { EccCliCommandError } from './cliProcess'
import {
  encodeCliValue,
  isRecord,
  optionalString,
  requireRecord,
  requireString,
} from './cliValues'

function workspaceFlowArgs(spec: Record<string, unknown>): string[] {
  const flow = isRecord(spec.flow) ? spec.flow : {}
  return [
    ...(flow.fromStepId !== undefined &&
    flow.fromStepId !== null &&
    flow.fromStepId !== ''
      ? ['--from', requireStepName(flow.fromStepId)]
      : []),
    ...(flow.throughStepId !== undefined &&
    flow.throughStepId !== null &&
    flow.throughStepId !== ''
      ? ['--to', requireStepName(flow.throughStepId)]
      : []),
  ]
}

/**
 * Absolute source paths of the request's design inputs, keyed by input role.
 */
function inputRolePaths(
  request: Pick<EccWorkspaceCreateRequest, 'workspaceSpec' | 'workspaceBindings'>,
): Map<string, string[]> {
  const spec = request.workspaceSpec
  const bindings = request.workspaceBindings
  const inputBindings = requireRecord(bindings.inputs)
  const inputs = Array.isArray(spec.inputs) ? spec.inputs : []
  const byRole = new Map<string, string[]>()
  for (const value of inputs) {
    if (!isRecord(value)) continue
    const inputId = optionalString(value.inputId)
    const role = optionalString(value.role)
    const path = inputId ? optionalString(inputBindings[inputId]) : null
    if (!role || !path) continue
    byRole.set(role, [...(byRole.get(role) ?? []), path])
  }
  return byRole
}

/**
 * Build the `ecc rtl import` argv that copies the request's pending RTL
 * selection into the project rtl/ directory. RTL/filelist inputs on a
 * non-derived create mean "import into the project"; reuse sends none.
 */
export function rtlImportArgs(
  projectRoot: string,
  selection: { filelist?: string | null; verilog?: string[] | null },
): string[] | null {
  const filelist =
    typeof selection.filelist === 'string' && selection.filelist.trim()
      ? selection.filelist
      : null
  const verilog = (selection.verilog ?? []).filter(
    (path) => typeof path === 'string' && path.trim(),
  )
  if (filelist && verilog.length) {
    throw new Error('RTL import accepts either a filelist or Verilog files, not both.')
  }
  if (filelist) {
    return ['rtl', 'import', '--project', projectRoot, '--filelist', filelist, '--plain']
  }
  if (!verilog.length) return null
  return [
    'rtl',
    'import',
    '--project',
    projectRoot,
    ...verilog.flatMap((path) => ['--verilog', path]),
    '--plain',
  ]
}

export function workspaceCreateRtlImport(
  request: EccWorkspaceCreateRequest,
  projectRoot: string,
): string[] | null {
  if (request.deriveFrom) return null
  const byRole = inputRolePaths(request)
  return rtlImportArgs(projectRoot, {
    filelist: byRole.get('filelist')?.[0],
    verilog: byRole.get('rtl') ?? [],
  })
}

export function workspaceRtlImport(
  request: Pick<EccWorkspaceCreateRequest, 'workspaceSpec' | 'workspaceBindings'>,
  projectRoot: string,
  current: Pick<EccWorkspaceCreateRequest, 'workspaceSpec' | 'workspaceBindings'>,
): string[] | null {
  const requested = inputRolePaths(request)
  if (sameInputRolePaths(requested, inputRolePaths(current))) return null
  return rtlImportArgs(projectRoot, {
    filelist: requested.get('filelist')?.[0],
    verilog: requested.get('rtl') ?? [],
  })
}

function sameInputRolePaths(
  left: Map<string, string[]>,
  right: Map<string, string[]>,
): boolean {
  if (left.size !== right.size) return false
  for (const [role, paths] of left) {
    const other = right.get(role)
    if (!other || other.length !== paths.length) return false
    if (paths.some((path, index) => path !== other[index])) return false
  }
  return true
}

export function projectSettingsArgs(
  request: Pick<
    EccWorkspaceCreateRequest,
    'workspaceSpec' | 'workspaceBindings' | 'eccPdkConfig'
  >,
  current?: Pick<EccWorkspaceCreateRequest, 'workspaceSpec' | 'workspaceBindings'>,
): string[] {
  const spec = request.workspaceSpec
  const bindings = request.workspaceBindings
  const design = requireRecord(spec.design)
  const pdk = requireRecord(spec.pdk)
  const flow = requireRecord(spec.flow)
  const pdkBindings = requireRecord(bindings.pdk)
  const byRole = inputRolePaths(request)
  const sdc = byRole.get('sdc')?.[0]
  // The persisted binding can refer to the executable Tcl that ECC generated.
  const currentSdc = current ? inputRolePaths(current).get('sdc')?.[0] : undefined
  const parameters = isRecord(spec.parameters) ? spec.parameters : {}
  const set = (key: string, value: unknown): string[] => {
    if (typeof value === 'string' && value.trim()) return ['--set', `${key}=${value}`]
    if (typeof value === 'number' && Number.isFinite(value)) {
      return ['--set', `${key}=${String(value)}`]
    }
    if (Array.isArray(value) && value.length) {
      return ['--set', `${key}=${JSON.stringify(value)}`]
    }
    return []
  }
  const pdkConfig = request.eccPdkConfig
  // design.rtl is intentionally absent: RTL sources are imported into the
  // project rtl/ directory by `ecc rtl import` (see workspaceCreateRtlImport)
  // and ECC materializes workspaces from the project's ecc.toml.
  return [
    ...set('design.name', design.name),
    ...set('design.top', design.topModule),
    ...set('design.clock_port', design.clockPort),
    ...set('design.frequency_mhz', parameters['design.frequency_mhz']),
    ...set('design.netlist', byRole.get('netlist')?.[0]),
    ...set('design.def', byRole.get('def')?.[0]),
    ...set('design.sdc', sdc === currentSdc ? undefined : sdc),
    ...set('design.golden_netlist', byRole.get('golden_netlist')?.[0]),
    ...set('design.spef', byRole.get('spef')?.[0]),
    ...set('pdk.name', pdk.familyId),
    ...set('pdk.root', pdkBindings.root),
    ...set('pdk.external_paths', pdkConfig?.externalPaths),
    ...set('pdk.overrides.tech', pdkConfig?.overrides?.tech),
    ...set('pdk.overrides.lefs', pdkConfig?.overrides?.lefs),
    ...set('pdk.overrides.libs', pdkConfig?.overrides?.libs),
    ...set('flow.preset', flow.flowId),
  ]
}

export function projectInitArgs(
  request: EccWorkspaceCreateRequest,
  requestedProjectRoot: string,
): string[] | null {
  if (request.projectMode !== 'create') return null
  if (request.deriveFrom) {
    throw new Error('A derived Workspace requires an existing Project.')
  }
  const design = requireRecord(requireRecord(request.workspaceSpec).design)
  const args = [
    'init',
    requestedProjectRoot,
    '--project-name',
    request.projectName?.trim() || basename(requestedProjectRoot),
    '--design-name',
    requireString(design.name),
  ]
  if (request.projectMpc) {
    args.push(
      '--mpc-resource-id',
      request.projectMpc.resourceId,
      '--mpc-display-name',
      request.projectMpc.displayName,
      '--mpc-version',
      request.projectMpc.version,
      '--mpc-root',
      request.projectMpc.root,
      '--mpc-design-index',
      String(request.projectMpc.designIndex),
    )
  }
  return args
}

export function projectManifestCreateArgs(
  projectRoot: string,
  mutation: Record<string, unknown>,
): string[] {
  const args = [
    'init',
    projectRoot,
    '--project-name',
    requireString(mutation.name),
    '--design-name',
    requireString(mutation.designName),
  ]
  if (mutation.mpc === undefined || mutation.mpc === null) return args
  const mpc = requireRecord(mutation.mpc)
  const design = requireRecord(mpc.design)
  args.push(
    '--mpc-resource-id',
    requireString(mpc.resource_id),
    '--mpc-display-name',
    requireString(mpc.display_name),
    '--mpc-version',
    requireString(mpc.installed_version),
    '--mpc-root',
    requireString(mpc.path),
    '--mpc-design-index',
    String(requireNonNegativeInteger(design.index)),
  )
  return args
}

export function workspaceDraftUnsupported(error: unknown): boolean {
  return (
    error instanceof EccCliCommandError &&
    /No such option:\s*--draft\b/.test(error.stderr)
  )
}

export function workspaceDraftArgs(
  request: EccWorkspaceCreateRequest,
  projectRoot: string,
  options: string[] = [],
): string[] {
  const flow = validateWorkspaceCreationFlow(request)
  const selection = inputRolePaths(request)
  const filelist = selection.get('filelist')?.[0]
  const rtl = selection.get('rtl')
  if (filelist && rtl?.length) {
    throw new Error('RTL import accepts either a filelist or Verilog files, not both.')
  }
  const values = (value: unknown) =>
    flowEditFlags('--step', value).filter((_, i) => i % 2)
  const draft = {
    settings: projectSettingsArgs(request).filter((_, i) => i % 2),
    enable: values(flow.enableSteps),
    disable: values(flow.disableSteps),
    insert: values(flow.insertSteps),
    remove: values(flow.removeSteps),
    maxParallelSteps: flow.maxParallelSteps,
    filelist,
    rtl,
  }
  const target = resolve(request.targetDirectory)
  const workspaceId = requireWorkspaceId(basename(target))
  return [
    'workspace',
    'create',
    '--project',
    projectRoot,
    '--path',
    join(projectRoot, basename(target)),
    '--command-id',
    request.commandId,
    '--no-wait',
    ...workspaceFlowArgs(request.workspaceSpec),
    ...parameterArgs(request.workspaceSpec.parameters),
    '--draft',
    JSON.stringify(draft),
    ...options,
    '--',
    workspaceId,
  ]
}

export function workspaceCreateCommands(
  request: EccWorkspaceCreateRequest,
  projectRoot: string,
): string[][] {
  const workspaceId = requireWorkspaceId(basename(resolve(request.targetDirectory)))
  const flow = validateWorkspaceCreationFlow(request)
  if (request.deriveFrom) {
    const sourceId = requireWorkspaceId(request.deriveFrom.workspaceId)
    if (
      typeof flow.fromStepId !== 'string' ||
      !flow.fromStepId.trim() ||
      typeof flow.throughStepId !== 'string' ||
      !flow.throughStepId.trim()
    ) {
      throw new Error('Creating from output requires a continuation step and endpoint.')
    }
    const fromStep = requireStepName(flow.fromStepId)
    const throughStep = requireStepName(flow.throughStepId)
    const parameters = parameterArgs(request.workspaceSpec.parameters)
    return [
      [
        'workspace',
        'fork',
        '--project',
        projectRoot,
        '--from',
        fromStep,
        '--to',
        throughStep,
        '--command-id',
        request.commandId,
        '--no-wait',
        '--',
        sourceId,
        workspaceId,
      ],
      ...(parameters.length
        ? [
            [
              'param',
              'apply',
              '--project',
              projectRoot,
              '--workspace',
              workspaceId,
              '--no-wait',
              ...parameters,
            ],
          ]
        : []),
    ]
  }
  const edits = [
    ...flowEditFlags('--enable', flow.enableSteps),
    ...flowEditFlags('--disable', flow.disableSteps),
    ...flowEditFlags('--insert', flow.insertSteps),
  ]
  return [
    [
      'project',
      'apply',
      '--project',
      projectRoot,
      ...projectSettingsArgs(request),
      '--no-wait',
    ],
    ...(edits.length
      ? [['flow', 'edit', '--project', projectRoot, '--yes', '--plain', ...edits]]
      : []),
    [
      'workspace',
      'create',
      '--project',
      projectRoot,
      '--path',
      resolve(request.targetDirectory),
      '--command-id',
      request.commandId,
      '--no-wait',
      ...workspaceFlowArgs(request.workspaceSpec),
      ...parameterArgs(request.workspaceSpec.parameters),
      '--',
      workspaceId,
    ],
  ]
}

export function requireWorkspaceId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    throw new Error('Invalid Workspace ID.')
  }
  return value
}

export function requireStepName(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z][A-Za-z0-9_]*(?:@[A-Za-z][A-Za-z0-9_]*)?$/.test(value) ||
    value.length > 256
  ) {
    throw new Error('Invalid ECC step name.')
  }
  return value
}

function validateWorkspaceCreationFlow(request: EccWorkspaceCreateRequest) {
  const flow = requireRecord(request.workspaceSpec.flow)
  const limit = flow.maxParallelSteps
  if (
    limit !== undefined &&
    (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1)
  ) {
    throw new Error('Flow concurrency must be a positive integer.')
  }
  return flow
}

function flowEditFlags(flag: string, value: unknown): string[] {
  if (value === undefined) return []
  if (
    !Array.isArray(value) ||
    value.some(
      (step) =>
        typeof step !== 'string' || !/^[a-z][a-z0-9_]*(?:@[a-z][a-z0-9_]*)?$/.test(step),
    )
  ) {
    throw new Error('Flow selection contains an invalid ECC step.')
  }
  return value.flatMap((step: string) => [flag, step])
}

function parameterArgs(value: unknown): string[] {
  if (!isRecord(value)) return []
  return Object.entries(value).flatMap(([key, parameter]) => [
    '--set',
    `${key}=${encodeCliValue(parameter)}`,
  ])
}

function requireNonNegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error('Expected a non-negative integer.')
  }
  return Number(value)
}

/**
 * Normalize an untyped create-mutation `rtlImport` record into the selection
 * shape consumed by rtlImportArgs. Shape validity is enforced upstream by
 * validateProjectManifestMutation.
 */
export function rtlImportSelection(value: unknown): {
  filelist?: string | null
  verilog?: string[] | null
} {
  if (!isRecord(value)) return {}
  const filelist = optionalString(value.filelist)
  const verilog = Array.isArray(value.verilog)
    ? value.verilog.filter((item): item is string => typeof item === 'string')
    : []
  return { filelist, verilog }
}
