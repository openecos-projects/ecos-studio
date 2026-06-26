import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
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

function resolvePackagedResourcesPath(options: EccCliRuntimeEnvOptions): string {
  return options.env.ECOS_ELECTRON_RESOURCES_PATH
    ?? join(options.appPath, 'resources')
}

function repoEccVenvBinDir(repoRoot: string, platform: RuntimePlatform): string | null {
  const venvBin = join(repoRoot, 'ecc', '.venv', 'bin')
  const candidates = platform === 'win32'
    ? ['ecc.exe', 'ecc.cmd', 'ecc']
    : ['ecc']

  if (candidates.some((name) => existsSync(join(venvBin, name)))) {
    return venvBin
  }

  return null
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

function resolveDevelopmentEccBinDir(options: EccCliRuntimeEnvOptions): string | null {
  const repoRoot = findRepoRootFromAppPath(options.appPath)
  if (!repoRoot) {
    return null
  }

  const venvBin = repoEccVenvBinDir(repoRoot, options.platform)
  if (venvBin) {
    return venvBin
  }

  const wrapperScript = join(repoRoot, 'ecos', 'scripts', 'ecc-wrapper.sh')
  if (options.platform !== 'win32' && existsSync(wrapperScript)) {
    return ensureRepoEccDevShim(options.userDataPath, wrapperScript, options.platform)
  }

  return null
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
