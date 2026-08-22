import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

type RuntimePlatform = NodeJS.Platform | 'linux' | 'darwin' | 'win32'

// PATH-style list of the bin directories the ECOS runtime layer added on top
// of the inherited environment, in resolved-PATH order. Rebuilt from scratch
// on every runtime env construction so nested launches (an ECOS Studio
// started from an integrated terminal) never inherit stale entries. The
// integrated terminal re-applies these entries after shell startup files that
// reset PATH.
export const runtimeBinPathEnvVariable = 'ECOS_ELECTRON_RUNTIME_BIN_PATH'

// Internal handoff between the generated zsh wrapper startup files. Only the
// terminal spawn plan may set it; a fresh launch env must never honor one
// inherited from an outer session.
export const userZdotdirEnvVariable = 'ECOS_USER_ZDOTDIR'

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

function packagedEccExecutableName(platform: RuntimePlatform): string {
  return platform === 'win32' ? 'ecc.cmd' : 'ecc'
}

function resolvePackagedRuntimeBin(options: EccRuntimeEnvOptions): string | null {
  const binariesPath = resolvePackagedBinariesPath(options)
  return existsSync(join(binariesPath, packagedEccExecutableName(options.platform)))
    ? binariesPath
    : null
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

export function resolveEccExecutable(options: EccRuntimeEnvOptions): string | null {
  const executableName = packagedEccExecutableName(options.platform)

  if (options.isPackaged) {
    const candidate = join(resolvePackagedBinariesPath(options), executableName)
    return existsSync(candidate) ? candidate : null
  }

  const developmentBinDir = resolveDevelopmentEccBinDir(options)
  if (!developmentBinDir) {
    return null
  }

  const candidate = join(developmentBinDir, executableName)
  return existsSync(candidate) ? candidate : null
}

export function createEccRuntimeEnv(options: EccRuntimeEnvOptions): NodeJS.ProcessEnv {
  const {
    [runtimeBinPathEnvVariable]: _inheritedRuntimeBinPath,
    [userZdotdirEnvVariable]: _inheritedUserZdotdir,
    ...cleanEnv
  } = options.env

  if (options.isPackaged) {
    const packagedRuntimeBin = resolvePackagedRuntimeBin({
      ...options,
      env: cleanEnv,
    })
    const resourcesPath = resolvePackagedResourcesPath(options)
    const binariesPath = resolvePackagedBinariesPath(options)
    const {
      CHIPCOMPILER_OSS_CAD_DIR: _inheritedOssCadDir,
      ECOS_ELECTRON_OSS_CAD_DIR: _inheritedElectronOssCadDir,
      ...baseEnv
    } = cleanEnv
    const libraryEnv = packagedEccLibraryEnv(baseEnv, binariesPath, options.platform)

    if (packagedRuntimeBin) {
      const nextPath = prependPath(baseEnv, packagedRuntimeBin, options.platform)

      return {
        ...baseEnv,
        ...libraryEnv,
        ECOS_ELECTRON_RESOURCES_PATH: resourcesPath,
        [runtimeBinPathEnvVariable]: packagedRuntimeBin,
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
    return { ...cleanEnv }
  }

  const nextPath = prependPath(cleanEnv, developmentBinDir, options.platform)

  return {
    ...cleanEnv,
    [runtimeBinPathEnvVariable]: developmentBinDir,
    [nextPath.key]: nextPath.value,
  }
}
