import { existsSync } from 'node:fs'
import { join } from 'node:path'

type RuntimePlatform = NodeJS.Platform | 'linux' | 'darwin' | 'win32'

export interface EccCliRuntimeEnvOptions {
  appPath: string
  cwd: string
  env: NodeJS.ProcessEnv
  isPackaged: boolean
  platform: RuntimePlatform
  userDataPath: string
}

function getPathKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
}

function prependPath(env: NodeJS.ProcessEnv, directory: string, platform: RuntimePlatform): {
  key: string
  value: string
} {
  const separator = platform === 'win32' ? ';' : ':'
  const key = getPathKey(env)
  const currentPath = env[key] ?? ''

  return {
    key,
    value: currentPath ? `${directory}${separator}${currentPath}` : directory,
  }
}

function resolvePackagedRuntimeBin(options: EccCliRuntimeEnvOptions): string | null {
  const resourcesPath = options.env.ECOS_ELECTRON_RESOURCES_PATH
    ?? join(options.appPath, 'resources')
  const binariesPath = options.env.ECOS_ELECTRON_BINARIES_DIR
    ?? join(resourcesPath, 'binaries')
  const executableName = options.platform === 'win32' ? 'ecc.cmd' : 'ecc'

  return existsSync(join(binariesPath, executableName)) ? binariesPath : null
}

export function createEccCliRuntimeEnv(
  options: EccCliRuntimeEnvOptions,
): NodeJS.ProcessEnv {
  if (options.isPackaged) {
    const packagedRuntimeBin = resolvePackagedRuntimeBin(options)
    if (packagedRuntimeBin) {
      const nextPath = prependPath(options.env, packagedRuntimeBin, options.platform)

      return {
        ...options.env,
        ECOS_ELECTRON_RESOURCES_PATH: options.env.ECOS_ELECTRON_RESOURCES_PATH
          ?? join(options.appPath, 'resources'),
        [nextPath.key]: nextPath.value,
      }
    }

    return { ...options.env }
  }

  return { ...options.env }
}

export const createDevEccCliRuntimeEnv = createEccCliRuntimeEnv
