import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

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

function findRepoRootFromAppPath(appPath: string): string | null {
  let current = appPath
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(current, 'ecc', 'pyproject.toml'))) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

function resolveDevelopmentRuntimeBin(options: EccCliRuntimeEnvOptions): string | null {
  if (options.platform === 'win32') return null

  const repoRoot = findRepoRootFromAppPath(options.appPath)
  if (!repoRoot) return null

  const venvBin = join(repoRoot, 'ecc', '.venv', 'bin')
  return existsSync(join(venvBin, 'ecc')) ? venvBin : null
}

function resolvePackagedResourcesPath(options: EccCliRuntimeEnvOptions): string {
  return options.env.ECOS_ELECTRON_RESOURCES_PATH
    ?? join(options.appPath, 'resources')
}


export function createEccCliRuntimeEnv(
  options: EccCliRuntimeEnvOptions,
): NodeJS.ProcessEnv {
  if (options.isPackaged) {
    const packagedRuntimeBin = resolvePackagedRuntimeBin(options)
    const resourcesPath = resolvePackagedResourcesPath(options)
    const {
      CHIPCOMPILER_OSS_CAD_DIR: _inheritedOssCadDir,
      ECOS_ELECTRON_OSS_CAD_DIR: _inheritedElectronOssCadDir,
      ...baseEnv
    } = options.env


    if (packagedRuntimeBin) {
      const nextPath = prependPath(baseEnv, packagedRuntimeBin, options.platform)

      return {
        ...baseEnv,
        ECOS_ELECTRON_RESOURCES_PATH: resourcesPath,
        [nextPath.key]: nextPath.value,
      }
    }

    return { ...baseEnv }
  }

  const developmentRuntimeBin = resolveDevelopmentRuntimeBin(options)
  if (developmentRuntimeBin) {
    const nextPath = prependPath(options.env, developmentRuntimeBin, options.platform)
    return {
      ...options.env,
      [nextPath.key]: nextPath.value,
    }
  }

  return { ...options.env }
}
