import {
  accessSync,
  chmodSync,
  existsSync,
  mkdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { constants as fsConstants } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { resolveContainedSymlinkDir } from '../cliInstallerArtifacts'

type RuntimePlatform = NodeJS.Platform | 'linux' | 'darwin' | 'win32'

export interface EccRuntimeEnvOptions {
  appPath: string
  cwd: string
  env: NodeJS.ProcessEnv
  isPackaged: boolean
  platform: RuntimePlatform
  userDataPath: string
  /** Host data home; defaults to XDG_DATA_HOME (or ~/.local/share). */
  dataHome?: string
  /**
   * Explicit external ECC bin directory (settings-ready injection point).
   * Takes precedence over the ECOS_ECC_BIN_DIR environment variable.
   */
  externalEccBinDir?: string | null
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

/** Host data home shared with the Resource Manager and the CLI installer. */
export function resolveDataHome(options: EccRuntimeEnvOptions): string {
  return (
    options.dataHome || options.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
  )
}

/**
 * Stable bundle-home location (`<dataHome>/ecos-studio/ecc-runtime/current`)
 * where the CLI installer materializes the ECC bundle. The `current` symlink
 * only ever points at a complete installation, so existence of the binary is
 * a sufficient readiness check.
 */
export function resolveBundleHomeBinariesPath(options: EccRuntimeEnvOptions): string {
  return join(
    resolveDataHome(options),
    'ecos-studio',
    'ecc-runtime',
    'current',
    'binaries',
  )
}

function resolveBundleHomeRuntimeBin(options: EccRuntimeEnvOptions): string | null {
  // Physical containment check: a tampered 'current' link (possibly via
  // intermediate symlinks) must not redirect the executed ECC binary.
  const homeRoot = join(resolveDataHome(options), 'ecos-studio', 'ecc-runtime')
  const currentPhysical = resolveContainedSymlinkDir(join(homeRoot, 'current'), homeRoot)
  if (!currentPhysical) return null
  const binariesPath = join(currentPhysical, 'binaries')
  return existsSync(join(binariesPath, packagedEccExecutableName(options.platform)))
    ? binariesPath
    : null
}

/**
 * Validate an external ECC bin directory override (the ECOS_ECC_BIN_DIR
 * environment variable or the explicit option): it must be an absolute path
 * containing an executable `ecc`. Invalid values resolve to null, which
 * ignores the override.
 */
export function resolveExternalEccBinDir(
  value: string | null | undefined,
  platform: RuntimePlatform,
): string | null {
  const trimmed = value?.trim()
  if (!trimmed || !isAbsolute(trimmed)) return null
  try {
    const executable = join(trimmed, packagedEccExecutableName(platform))
    accessSync(executable, fsConstants.X_OK)
    // X_OK alone accepts a searchable directory on POSIX; the override must
    // name a regular executable file.
    return statSync(executable).isFile() ? trimmed : null
  } catch {
    return null
  }
}

/**
 * The external ECC bin directory when an override is configured, else null.
 * The explicit option wins over the environment variable; an explicit value
 * that fails validation disables the override entirely (no env fallback).
 */
function resolveExternalRuntimeBin(options: EccRuntimeEnvOptions): string | null {
  const explicit = options.externalEccBinDir?.trim()
  if (explicit) {
    return resolveExternalEccBinDir(explicit, options.platform)
  }
  return resolveExternalEccBinDir(options.env.ECOS_ECC_BIN_DIR, options.platform)
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

/** POSIX single-quote a value so it stays literal in the generated shim. */
function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
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

  // Single-quote the wrapper path so checkout paths containing $, backticks,
  // or double quotes stay literal.
  const shimPath = join(runtimeBin, 'ecc')
  writeFileSync(shimPath, `#!/usr/bin/env bash\nexec ${shQuote(wrapperScript)} "$@"\n`)
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

  // An explicit external runtime wins every other resolution, in packaged
  // and development mode alike.
  const externalBin = resolveExternalRuntimeBin(options)
  if (externalBin) return join(externalBin, executableName)

  if (options.isPackaged) {
    const packagedCandidate = join(resolvePackagedBinariesPath(options), executableName)
    if (existsSync(packagedCandidate)) {
      return packagedCandidate
    }
    const bundleHomeBin = resolveBundleHomeRuntimeBin(options)
    return bundleHomeBin ? join(bundleHomeBin, executableName) : null
  }

  const developmentBinDir = resolveDevelopmentEccBinDir(options)
  if (!developmentBinDir) {
    return null
  }

  const candidate = join(developmentBinDir, executableName)
  return existsSync(candidate) ? candidate : null
}

/**
 * Directory that wins the ECC runtime resolution (external override,
 * packaged binaries, bundle home, or the development runtime-bin shim), or
 * null when none is usable. This is the directory createEccRuntimeEnv
 * prepends to PATH.
 */
export function resolveEccRuntimeBinDir(options: EccRuntimeEnvOptions): string | null {
  const externalBin = resolveExternalRuntimeBin(options)
  if (externalBin) return externalBin
  if (options.isPackaged) {
    return resolvePackagedRuntimeBin(options) ?? resolveBundleHomeRuntimeBin(options)
  }
  return resolveDevelopmentEccBinDir(options)
}

export function createEccRuntimeEnv(options: EccRuntimeEnvOptions): NodeJS.ProcessEnv {
  const externalRuntimeBin = resolveExternalRuntimeBin(options)

  if (options.isPackaged) {
    const packagedRuntimeBin = resolvePackagedRuntimeBin(options)
    const bundleHomeRuntimeBin = resolveBundleHomeRuntimeBin(options)
    const runtimeBin = externalRuntimeBin ?? packagedRuntimeBin ?? bundleHomeRuntimeBin
    const libraryBinariesPath = runtimeBin ?? resolvePackagedBinariesPath(options)
    const resourcesPath = resolvePackagedResourcesPath(options)
    const {
      CHIPCOMPILER_OSS_CAD_DIR: _inheritedOssCadDir,
      ECOS_ELECTRON_OSS_CAD_DIR: _inheritedElectronOssCadDir,
      ...baseEnv
    } = options.env
    const libraryEnv = packagedEccLibraryEnv(
      baseEnv,
      libraryBinariesPath,
      options.platform,
    )

    if (runtimeBin) {
      const nextPath = prependPath(baseEnv, runtimeBin, options.platform)

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

  const developmentBinDir = externalRuntimeBin ?? resolveDevelopmentEccBinDir(options)
  if (!developmentBinDir) {
    return { ...options.env }
  }

  const nextPath = prependPath(options.env, developmentBinDir, options.platform)
  // An external bundle ships the same _internal layout as a packaged one;
  // its native tools need the library path in development mode too.
  const libraryEnv = externalRuntimeBin
    ? packagedEccLibraryEnv(options.env, externalRuntimeBin, options.platform)
    : {}

  return {
    ...options.env,
    ...libraryEnv,
    [nextPath.key]: nextPath.value,
  }
}
