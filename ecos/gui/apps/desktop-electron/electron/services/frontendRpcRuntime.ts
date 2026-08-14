import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { EccRuntimeEvent } from '@ecos-studio/shared'
import type { EccRpcSidecarLaunch } from './eccRpc/sidecarProcess'
import { resolveFrontendDevelopmentRoot } from './frontendDevelopmentRoot'

let legacyFrontendProtocolSequence = 0

export interface FrontendRpcLaunchResolverOptions {
  env?: NodeJS.ProcessEnv
  frontendRootSearchRoots?: string[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function firstMessage(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value
  if (!Array.isArray(value)) return undefined
  const message = value.find((item) => typeof item === 'string' && item.trim())
  return typeof message === 'string' ? message : undefined
}

function frontendCommandMethod(command: unknown): string | null {
  if (command === 'rtl2gds') return 'flow.run'
  if (command === 'run_step') return 'flow.run_step'
  return null
}

export function frontendRuntimeEventFromNotification(
  notificationMethod: string,
  params: unknown,
): EccRuntimeEvent | null {
  if (notificationMethod !== 'runtime.event') return null
  const payload = asRecord(params)
  if (!payload || payload.type !== 'event') return null

  const data = asRecord(payload.data) ?? {}
  const method = frontendCommandMethod(payload.cmd)
  const phase = typeof payload.phase === 'string' ? payload.phase : ''
  if (!method || !phase) return null

  const normalizedData =
    phase === 'subflow.stage'
      ? {
          ...data,
          runtimeProtocolType: 'subflow.stage',
          subflowPeakMemory: data.peak_memory_mb,
          subflowRuntime: data.runtime,
          subflowStep: data.subflow_step,
        }
      : data

  return {
    data: normalizedData,
    message: firstMessage(payload.message),
    method,
    phase,
    step: typeof normalizedData.step === 'string' ? normalizedData.step : undefined,
    type: 'operation.progress',
    workspaceDirectory:
      typeof normalizedData.directory === 'string' ? normalizedData.directory : undefined,
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function protocolTypeForFrontendProgress(
  event: Extract<EccRuntimeEvent, { type: 'operation.progress' }>,
): 'step.started' | 'step.completed' | 'subflow.stage' | null {
  if (event.phase === 'started') return 'step.started'
  if (event.phase === 'subflow.stage') return 'subflow.stage'
  if (event.phase === 'completed' || event.phase === 'failed') return 'step.completed'

  const state = stringValue(event.data?.state)?.toLowerCase()
  return state &&
    [
      'success',
      'succeeded',
      'complete',
      'completed',
      'failed',
      'failure',
      'error',
      'invalid',
      'incomplete',
    ].includes(state)
    ? 'step.completed'
    : null
}

/**
 * Convert the legacy ECC-FE progress stream to the same protocol consumed by
 * the backend renderer. This is deliberately placed at the runtime boundary;
 * no renderer feature should need to know which sidecar produced the event.
 */
export function normalizeFrontendRuntimeEvent(event: EccRuntimeEvent): EccRuntimeEvent {
  if (event.type !== 'operation.progress') return event

  const protocolType = protocolTypeForFrontendProgress(event)
  const operationId = event.operationId
  const workspaceHandle = event.workspaceHandle
  if (!protocolType || !operationId || !workspaceHandle) return event

  const data = event.data ?? {}
  const step = stringValue(data.step) ?? stringValue(event.step)
  const rawState = stringValue(data.state)
  const state =
    rawState ??
    (protocolType === 'step.started'
      ? 'Ongoing'
      : event.phase === 'failed'
        ? 'Incomplete'
        : undefined)
  const subflowStep = stringValue(data.subflowStep) ?? stringValue(data.subflow_step)
  const subflowRuntime = stringValue(data.subflowRuntime) ?? stringValue(data.runtime)
  const subflowPeakMemory =
    typeof data.subflowPeakMemory === 'number'
      ? data.subflowPeakMemory
      : typeof data.peak_memory_mb === 'number'
        ? data.peak_memory_mb
        : undefined
  const sequence = ++legacyFrontendProtocolSequence
  const payload: Record<string, unknown> = {
    ...data,
    ...(step ? { step } : {}),
    ...(state ? { state } : {}),
    ...(subflowStep ? { subflowStep } : {}),
    ...(subflowRuntime ? { subflowRuntime } : {}),
    ...(subflowPeakMemory !== undefined ? { subflowPeakMemory } : {}),
  }

  return {
    event: {
      eventId: `frontend-legacy-${operationId}-${sequence}`,
      kind: event.method === 'flow.run' ? 'flow' : 'step',
      operationId,
      origin: 'gui',
      payload,
      sequence,
      timestamp: Date.now(),
      type: protocolType,
      workspaceId: workspaceHandle,
    },
    type: 'runtime.protocol',
    ...(event.workspaceDirectory ? { workspaceDirectory: event.workspaceDirectory } : {}),
    workspaceHandle,
  }
}

function commandBasename(command: string): string {
  return command.split(/[\\/]/).pop()?.toLowerCase() ?? command.toLowerCase()
}

function isPythonCommand(command: string): boolean {
  const basename = commandBasename(command).replace(/\.exe$/, '')
  return basename === 'python' || /^python\d+(\.\d+)?$/.test(basename)
}

function defaultPythonCommand(): string {
  return process.platform === 'win32' ? 'python' : 'python3'
}

function resolvePythonCommand(env: NodeJS.ProcessEnv, frontendRoot: string): string {
  const siblingEccPython =
    process.platform === 'win32'
      ? join(dirname(frontendRoot), 'ecc', '.venv', 'Scripts', 'python.exe')
      : join(dirname(frontendRoot), 'ecc', '.venv', 'bin', 'python')
  const candidates = [
    env.ECOS_FE_PYTHON ?? '',
    env.PYTHON_INTERPRETER ?? '',
    siblingEccPython,
  ]
  for (const candidate of candidates) {
    const value = candidate.trim()
    if (value && existsSync(value)) return value
  }
  return defaultPythonCommand()
}

function frontendEnvironment(
  env: NodeJS.ProcessEnv,
  frontendRoot: string,
  includePythonPath: boolean,
): NodeJS.ProcessEnv {
  if (!frontendRoot || !existsSync(join(frontendRoot, 'fecompiler'))) {
    return { ...env }
  }
  const result = {
    ...env,
    ECOS_FE_COMPILER_ROOT: frontendRoot,
  }
  if (!includePythonPath) return result

  const separator = process.platform === 'win32' ? ';' : ':'
  const currentPythonPath = env.PYTHONPATH ?? ''
  return {
    ...result,
    PYTHONPATH: currentPythonPath
      ? `${frontendRoot}${separator}${currentPythonPath}`
      : frontendRoot,
  }
}

function frontendRootCommand(frontendRoot: string): string {
  const binDir = join(frontendRoot, 'bin')
  const candidates =
    process.platform === 'win32' ? ['ecc-fe.cmd', 'ecc-fe.exe', 'ecc-fe'] : ['ecc-fe']
  for (const candidate of candidates) {
    const command = join(binDir, candidate)
    if (existsSync(command)) return command
  }
  return ''
}

export function createFrontendRpcLaunchResolver(
  options: FrontendRpcLaunchResolverOptions = {},
): (env: NodeJS.ProcessEnv) => EccRpcSidecarLaunch {
  const developmentRoot = resolveFrontendDevelopmentRoot({
    env: options.env,
    searchRoots: options.frontendRootSearchRoots,
  })

  return (env) => {
    const frontendRoot = developmentRoot ?? env.ECOS_FE_COMPILER_ROOT?.trim() ?? ''
    const developmentCommand = developmentRoot ? frontendRootCommand(developmentRoot) : ''
    const configuredCommand = env.ECOS_FE_CLI?.trim() ?? ''
    const command =
      developmentCommand ||
      configuredCommand ||
      (frontendRoot ? frontendRootCommand(frontendRoot) : '') ||
      (frontendRoot ? resolvePythonCommand(env, frontendRoot) : 'ecc-fe')
    const pythonMode = isPythonCommand(command)
    const args = [
      ...(pythonMode ? ['-m', 'fecompiler.cli.main'] : []),
      'rpc',
      'serve',
      '--stdio',
    ]

    return {
      args,
      command,
      env: frontendEnvironment(env, frontendRoot, pythonMode),
    }
  }
}
