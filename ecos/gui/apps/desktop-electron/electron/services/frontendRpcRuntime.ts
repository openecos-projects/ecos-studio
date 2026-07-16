import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { EccRpcSidecarLaunch } from './eccRpc/sidecarProcess'
import { resolveFrontendDevelopmentRoot } from './frontendRuntimeAdapter'

export interface FrontendRpcLaunchResolverOptions {
  env?: NodeJS.ProcessEnv
  frontendRootSearchRoots?: string[]
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
