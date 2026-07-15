import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

type RuntimePlatform = NodeJS.Platform | 'linux' | 'darwin' | 'win32'

export interface EccRuntimeEnvOptions {
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

function prependPath(
  env: NodeJS.ProcessEnv,
  directory: string,
  platform: RuntimePlatform,
): {
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

function resolvePackagedRuntimeBin(options: EccRuntimeEnvOptions): string | null {
  const binariesPath = resolvePackagedBinariesPath(options)
  const executableName = options.platform === 'win32' ? 'ecc.cmd' : 'ecc'

  return existsSync(join(binariesPath, executableName)) ? binariesPath : null
}

function resolvePackagedBinariesPath(options: EccRuntimeEnvOptions): string {
  const resourcesPath = resolvePackagedResourcesPath(options)
  return options.env.ECOS_ELECTRON_BINARIES_DIR ?? join(resourcesPath, 'binaries')
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

function resolvePackagedResourcesPath(options: EccRuntimeEnvOptions): string {
  return options.env.ECOS_ELECTRON_RESOURCES_PATH ?? join(options.appPath, 'resources')
}

function packagedEccLibraryEnv(
  env: NodeJS.ProcessEnv,
  binariesPath: string,
  platform: RuntimePlatform,
): NodeJS.ProcessEnv {
  if (platform !== 'linux') return {}

  const libraryPath = join(binariesPath, '_internal', 'ecc_tools_bin', 'lib')
  if (!existsSync(libraryPath)) return {}

  const currentPath = env.LD_LIBRARY_PATH ?? ''
  return {
    LD_LIBRARY_PATH: currentPath ? `${libraryPath}:${currentPath}` : libraryPath,
  }
}

function ensureRepoEccDevShim(
  userDataPath: string,
  wrapperScript: string,
  platform: RuntimePlatform,
): string {
  const runtimeBin = join(userDataPath, 'runtime-bin')
  mkdirSync(runtimeBin, { recursive: true })

  if (platform === 'win32') {
    const shimPath = join(runtimeBin, 'ecc.cmd')
    writeFileSync(shimPath, `@echo off\r\n"${wrapperScript}" %*\r\n`)
    return runtimeBin
  }

  const shimPath = join(runtimeBin, 'ecc')
  writeFileSync(shimPath, `#!/usr/bin/env bash\nexec "${wrapperScript}" "$@"\n`)
  chmodSync(shimPath, 0o755)
  return runtimeBin
}

function resolveDevelopmentEccBinDir(options: EccRuntimeEnvOptions): string | null {
  const repoRoot = findRepoRootFromAppPath(options.appPath)
  if (!repoRoot) {
    return null
  }

  const wrapperScript = join(repoRoot, 'ecos', 'scripts', 'ecc-wrapper.sh')
  if (options.platform !== 'win32' && existsSync(wrapperScript)) {
    return ensureRepoEccDevShim(options.userDataPath, wrapperScript, options.platform)
  }

  return null
}

export function createEccRuntimeEnv(options: EccRuntimeEnvOptions): NodeJS.ProcessEnv {
  if (options.isPackaged) {
    const packagedRuntimeBin = resolvePackagedRuntimeBin(options)
    const resourcesPath = resolvePackagedResourcesPath(options)
    const binariesPath = resolvePackagedBinariesPath(options)
    const {
      CHIPCOMPILER_OSS_CAD_DIR: _inheritedOssCadDir,
      ECOS_ELECTRON_OSS_CAD_DIR: _inheritedElectronOssCadDir,
      ...baseEnv
    } = options.env
    const libraryEnv = packagedEccLibraryEnv(baseEnv, binariesPath, options.platform)

    if (packagedRuntimeBin) {
      const nextPath = prependPath(baseEnv, packagedRuntimeBin, options.platform)

      return {
        ...baseEnv,
        ...libraryEnv,
        ECOS_ELECTRON_RESOURCES_PATH: resourcesPath,
        [nextPath.key]: nextPath.value,
      }
    }

    if (Object.keys(libraryEnv).length > 0) {
      return {
        ...baseEnv,
        ...libraryEnv,
        ECOS_ELECTRON_RESOURCES_PATH: resourcesPath,
      }
    }

    return { ...baseEnv }
  }

  const developmentBinDir = resolveDevelopmentEccBinDir(options)
  if (!developmentBinDir) {
    return { ...options.env }
  }

  const nextPath = prependPath(options.env, developmentBinDir, options.platform)

  return {
    ...options.env,
    [nextPath.key]: nextPath.value,
  }
}
