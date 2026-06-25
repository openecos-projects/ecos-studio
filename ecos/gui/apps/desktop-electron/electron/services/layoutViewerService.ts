import { execFile as execFileCallback, spawn as spawnProcessCallback } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  resolveProjectFileAbsolutePath,
  type LayoutViewerOpenRequest,
  type LayoutViewerOpenResult,
} from '@ecos-studio/shared'

const BUILD_HINT =
  'Build them with: cd ecos/layout-viewer && cargo build --release -p layout-viewer-native -p ecos-layout-packer'
const LAYOUT_PACKAGE_SCHEMA = 'ecos.layoutpkg.v1'
const LAYOUT_PACKAGE_VERSION = 1
const LAYOUT_PACKER_NAME = 'ecos-layout-packer'

type FileExists = (path: string) => boolean
interface ExecFileResult {
  stdout: string
  stderr: string
}
type ExecFileRunner = (file: string, args: string[]) => Promise<ExecFileResult>
type ReadTextFile = (path: string) => Promise<string>
type SpawnProcess = (
  file: string,
  args: string[],
  options: {
    detached: boolean
    env: NodeJS.ProcessEnv
    stdio: 'ignore'
  },
) => { unref(): void }

export interface LayoutViewerServiceOptions {
  appPath: string
  cwd: string
  env?: NodeJS.ProcessEnv
  execFile?: ExecFileRunner
  fileExists?: FileExists
  isPackaged: boolean
  platform?: NodeJS.Platform
  readTextFile?: ReadTextFile
  resourcesPath?: string
  spawnProcess?: SpawnProcess
}

interface LayoutViewerBinaries {
  packerPath: string
  viewerPath: string
}

interface LayoutPackageSourceMetadata {
  generator: {
    name: string
    version: string
  }
  source: {
    fingerprint: string
    kind: string
  }
}

interface LayoutPackageCacheManifest extends LayoutPackageSourceMetadata {
  schema: string
  version: number
}

function defaultExecFile(file: string, args: string[]): Promise<ExecFileResult> {
  return new Promise((resolve, reject) => {
    execFileCallback(file, args, { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        reject(error)
        return
      }
      resolve({
        stderr,
        stdout,
      })
    })
  })
}

async function defaultReadTextFile(path: string): Promise<string> {
  return readFile(path, 'utf8')
}

function executableName(baseName: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? `${baseName}.exe` : baseName
}

function ancestorPaths(startPath: string, maxDepth = 12): string[] {
  const paths: string[] = []
  let current = startPath
  for (let i = 0; i < maxDepth; i += 1) {
    paths.push(current)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return paths
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLayoutPackageSourceMetadata(value: unknown): value is LayoutPackageSourceMetadata {
  if (!isRecord(value) || !isRecord(value.generator) || !isRecord(value.source)) {
    return false
  }

  return (
    value.generator.name === LAYOUT_PACKER_NAME &&
    typeof value.generator.version === 'string' &&
    value.source.kind === 'view-json' &&
    typeof value.source.fingerprint === 'string'
  )
}

function isLayoutPackageCacheManifest(value: unknown): value is LayoutPackageCacheManifest {
  if (!isRecord(value)) {
    return false
  }

  return (
    isLayoutPackageSourceMetadata(value) &&
    value.schema === LAYOUT_PACKAGE_SCHEMA &&
    value.version === LAYOUT_PACKAGE_VERSION
  )
}

function layoutPackageCacheMatches(
  manifest: LayoutPackageCacheManifest,
  currentSource: LayoutPackageSourceMetadata,
): boolean {
  return (
    manifest.generator.version === currentSource.generator.version &&
    manifest.source.fingerprint === currentSource.source.fingerprint
  )
}

export class LayoutViewerService {
  private readonly appPath: string
  private readonly cwd: string
  private readonly env: NodeJS.ProcessEnv
  private readonly execFile: ExecFileRunner
  private readonly fileExists: FileExists
  private readonly isPackaged: boolean
  private readonly platform: NodeJS.Platform
  private readonly readTextFile: ReadTextFile
  private readonly resourcesPath?: string
  private readonly spawnProcess: SpawnProcess

  constructor(options: LayoutViewerServiceOptions) {
    this.appPath = options.appPath
    this.cwd = options.cwd
    this.env = options.env ?? process.env
    this.execFile = options.execFile ?? defaultExecFile
    this.fileExists = options.fileExists ?? existsSync
    this.isPackaged = options.isPackaged
    this.platform = options.platform ?? process.platform
    this.readTextFile = options.readTextFile ?? defaultReadTextFile
    this.resourcesPath = options.resourcesPath
    this.spawnProcess = options.spawnProcess ?? spawnProcessCallback
  }

  async open(request: LayoutViewerOpenRequest): Promise<LayoutViewerOpenResult> {
    const packageRoot = resolveProjectFileAbsolutePath(
      request.projectPath,
      request.viewJsonPackageRoot,
    )
    const layoutPackagePath = join(packageRoot, '.layoutpkg')
    const binaries = this.resolveBinaries()

    if (
      await this.shouldRebuildPackage(
        request,
        binaries.packerPath,
        packageRoot,
        layoutPackagePath,
      )
    ) {
      await this.execFile(binaries.packerPath, [packageRoot, layoutPackagePath])
    }

    const child = this.spawnProcess(binaries.viewerPath, [layoutPackagePath], {
      detached: true,
      env: this.env,
      stdio: 'ignore',
    })
    child.unref()

    return {
      layoutPackagePath,
      packageRoot,
      spawned: true,
    }
  }

  private async shouldRebuildPackage(
    request: LayoutViewerOpenRequest,
    packerPath: string,
    packageRoot: string,
    layoutPackagePath: string,
  ): Promise<boolean> {
    if (request.rebuildPackage) {
      return true
    }

    const manifestPath = join(layoutPackagePath, 'manifest.json')
    if (!this.fileExists(manifestPath)) {
      return true
    }

    const cachedManifest = await this.readCachedManifest(manifestPath)
    if (!isLayoutPackageCacheManifest(cachedManifest)) {
      return true
    }

    const currentSource = await this.readCurrentSourceMetadata(packerPath, packageRoot)
    return !layoutPackageCacheMatches(cachedManifest, currentSource)
  }

  private async readCachedManifest(manifestPath: string): Promise<unknown> {
    try {
      return JSON.parse(await this.readTextFile(manifestPath))
    } catch {
      return undefined
    }
  }

  private async readCurrentSourceMetadata(
    packerPath: string,
    packageRoot: string,
  ): Promise<LayoutPackageSourceMetadata> {
    const result = await this.execFile(packerPath, ['--fingerprint', '--json', packageRoot])
    let parsed: unknown
    try {
      parsed = JSON.parse(result.stdout)
    } catch {
      throw new Error(`Failed to parse layout package fingerprint output from ${packerPath}.`)
    }

    if (!isLayoutPackageSourceMetadata(parsed)) {
      throw new Error(`Layout package fingerprint output from ${packerPath} is not supported.`)
    }

    return parsed
  }

  private resolveBinaries(): LayoutViewerBinaries {
    if (this.isPackaged) {
      return this.resolvePackagedBinaries()
    }

    return this.resolveDevBinaries()
  }

  private resolvePackagedBinaries(): LayoutViewerBinaries {
    const binaryDir = this.resourcesPath ? join(this.resourcesPath, 'binaries') : ''
    const packerPath = join(binaryDir, executableName('ecos-layout-packer', this.platform))
    const viewerPath = join(binaryDir, executableName('layout-viewer-native', this.platform))

    if (this.fileExists(packerPath) && this.fileExists(viewerPath)) {
      return { packerPath, viewerPath }
    }

    throw new Error(`Packaged layout viewer binaries were not found under ${binaryDir}.`)
  }

  private resolveDevBinaries(): LayoutViewerBinaries {
    const repoRoot = this.findRepoRoot()
    const packerName = executableName('ecos-layout-packer', this.platform)
    const viewerName = executableName('layout-viewer-native', this.platform)
    const profiles = ['release', 'debug']

    for (const profile of profiles) {
      const targetDir = join(repoRoot, 'ecos/layout-viewer/target', profile)
      const packerPath = join(targetDir, packerName)
      const viewerPath = join(targetDir, viewerName)
      if (this.fileExists(packerPath) && this.fileExists(viewerPath)) {
        return { packerPath, viewerPath }
      }
    }

    throw new Error(`Layout viewer dev binaries were not found. ${BUILD_HINT}`)
  }

  private findRepoRoot(): string {
    for (const startPath of [this.appPath, this.cwd]) {
      for (const candidate of ancestorPaths(startPath)) {
        if (this.fileExists(join(candidate, 'ecos/layout-viewer/Cargo.toml'))) {
          return candidate
        }
      }
    }

    throw new Error(`Unable to locate ecos/layout-viewer from ${this.appPath}. ${BUILD_HINT}`)
  }
}
