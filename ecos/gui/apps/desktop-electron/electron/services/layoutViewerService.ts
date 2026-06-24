import { execFile as execFileCallback, spawn as spawnProcessCallback } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  resolveProjectFileAbsolutePath,
  type LayoutViewerOpenRequest,
  type LayoutViewerOpenResult,
} from '@ecos-studio/shared'

const BUILD_HINT =
  'Build them with: cd ecos/layout-viewer && cargo build --release -p layout-viewer-native -p ecos-layout-packer'

type FileExists = (path: string) => boolean
type ExecFileRunner = (file: string, args: string[]) => Promise<void>
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
  resourcesPath?: string
  spawnProcess?: SpawnProcess
}

interface LayoutViewerBinaries {
  packerPath: string
  viewerPath: string
}

function defaultExecFile(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFileCallback(file, args, (error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
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

export class LayoutViewerService {
  private readonly appPath: string
  private readonly cwd: string
  private readonly env: NodeJS.ProcessEnv
  private readonly execFile: ExecFileRunner
  private readonly fileExists: FileExists
  private readonly isPackaged: boolean
  private readonly platform: NodeJS.Platform
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

    if (request.rebuildPackage || !this.fileExists(join(layoutPackagePath, 'manifest.json'))) {
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
