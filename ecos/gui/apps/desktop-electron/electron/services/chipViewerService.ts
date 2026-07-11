import {
  execFile as execFileCallback,
  spawn as spawnProcessCallback,
} from 'node:child_process'
import { existsSync, type FSWatcher, watch as watchFsDirectoryCallback } from 'node:fs'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'
import {
  normalizeLocalPath,
  type ChipViewerOpenRequest,
  type ChipViewerOpenResult,
  type WorkspaceStepInfoResult,
} from '@ecos-studio/shared'

const BUILD_HINT =
  'Build them with: cd ecos/chip-viewer && cargo build --release -p chip-viewer-native; then build ecc-geometry-snapshot in ecc/chipcompiler/thirdparty/ecc-tools.'
const DB_CONFIG_RELATIVE_PATH = 'config/db_default_config.json'

type FileExists = (path: string) => boolean
type EnsureDirectory = (path: string) => Promise<void>
interface ExecFileResult {
  stdout: string
  stderr: string
}
type ExecFileRunner = (file: string, args: string[]) => Promise<ExecFileResult>
type GetFileModifiedTime = (path: string) => Promise<number | null>
type ReadTextFile = (path: string) => Promise<string>
type RenameFile = (from: string, to: string) => Promise<void>
type WriteTextFile = (path: string, content: string) => Promise<void>
type DirectoryWatcher = Pick<FSWatcher, 'close'>
type WatchDirectory = (
  path: string,
  listener: (fileName: string) => void,
) => DirectoryWatcher
type SpawnProcess = (
  file: string,
  args: string[],
  options: {
    detached: boolean
    env: NodeJS.ProcessEnv
    stdio: 'ignore'
  },
) => { unref(): void }

interface ChipViewerBinaries {
  snapshotPath: string
  viewerPath: string
}

export interface ChipViewerServiceOptions {
  appPath: string
  cwd: string
  env?: NodeJS.ProcessEnv
  execFile?: ExecFileRunner
  ensureDirectory?: EnsureDirectory
  fileExists?: FileExists
  getFileModifiedTime?: GetFileModifiedTime
  isPackaged: boolean
  platform?: NodeJS.Platform
  readTextFile?: ReadTextFile
  renameFile?: RenameFile
  resourcesPath?: string
  spawnProcess?: SpawnProcess
  watchDirectory?: WatchDirectory
  writeTextFile?: WriteTextFile
  workspaceResourceService: {
    resolveStepInfo(request: {
      id: 'layout'
      step: string
    }): Promise<WorkspaceStepInfoResult>
  }
}

interface SnapshotInputs {
  defPath: string
  editCommandDirectory: string
  editResultDirectory: string
  geometryDir: string
  manifestPath: string
  workspaceStepDirectory: string
}

interface DbGeometryConfig {
  lefPaths: string[]
  techLefPath: string
}

type ChipViewerMode = NonNullable<ChipViewerOpenRequest['mode']>

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

async function defaultWriteTextFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, 'utf8')
}

async function defaultEnsureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
}

async function defaultGetFileModifiedTime(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mtimeMs
  } catch {
    return null
  }
}

function defaultWatchDirectory(
  path: string,
  listener: (fileName: string) => void,
): DirectoryWatcher {
  return watchFsDirectoryCallback(path, (_eventType, fileName) => {
    if (typeof fileName === 'string' && fileName.length > 0) {
      listener(fileName)
    }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value : ''
}

function stringArrayValue(record: Record<string, unknown>, key: string): string[] {
  const value = record[key]
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry !== '')
    : []
}

function parseDbGeometryConfig(raw: string, path: string): DbGeometryConfig {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`Failed to parse geometry DB config: ${path}`)
  }

  if (!isRecord(parsed) || !isRecord(parsed.INPUT)) {
    throw new Error(`Geometry DB config is missing INPUT: ${path}`)
  }

  const techLefPath = stringValue(parsed.INPUT, 'tech_lef_path')
  const lefPaths = stringArrayValue(parsed.INPUT, 'lef_paths')
  if (!techLefPath || lefPaths.length === 0) {
    throw new Error('Geometry snapshot requires tech LEF and LEF paths')
  }

  return {
    lefPaths,
    techLefPath,
  }
}

function isPathInside(rootPath: string, targetPath: string): boolean {
  const normalizedRoot = normalizeLocalPath(rootPath).replace(/[\\/]+$/, '')
  const normalizedTarget = normalizeLocalPath(targetPath)
  const delta = relative(normalizedRoot, normalizedTarget)
  return delta === '' || (!delta.startsWith('..') && !isAbsolute(delta))
}

function readStringInfo(result: WorkspaceStepInfoResult, key: string): string | null {
  const value = result.info[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function workspaceStepDetails(result: WorkspaceStepInfoResult): string {
  const details = [
    ...result.message,
    ...(result.missing.length > 0 ? [`Missing: ${result.missing.join(', ')}`] : []),
  ]
  return details.length > 0 ? ` ${details.join(' ')}` : ''
}

function normalizeChipViewerMode(mode: unknown): ChipViewerMode {
  if (mode === undefined || mode === 'view') {
    return 'view'
  }
  if (mode === 'edit') {
    return 'edit'
  }
  throw new Error(`Unsupported chip viewer mode: ${String(mode)}`)
}

export class ChipViewerService {
  private readonly appPath: string
  private readonly cwd: string
  private readonly env: NodeJS.ProcessEnv
  private readonly ensureDirectory: EnsureDirectory
  private readonly execFile: ExecFileRunner
  private readonly fileExists: FileExists
  private readonly getFileModifiedTime: GetFileModifiedTime
  private readonly isPackaged: boolean
  private readonly platform: NodeJS.Platform
  private readonly readTextFile: ReadTextFile
  private readonly renameFile: RenameFile
  private readonly resourcesPath?: string
  private readonly spawnProcess: SpawnProcess
  private readonly watchDirectory: WatchDirectory
  private readonly writeTextFile: WriteTextFile
  private readonly workspaceResourceService: ChipViewerServiceOptions['workspaceResourceService']
  private readonly editBridgeWatchers = new Map<string, DirectoryWatcher>()
  private readonly processedEditCommands = new Set<string>()

  constructor(options: ChipViewerServiceOptions) {
    this.appPath = options.appPath
    this.cwd = options.cwd
    this.env = options.env ?? process.env
    this.ensureDirectory = options.ensureDirectory ?? defaultEnsureDirectory
    this.execFile = options.execFile ?? defaultExecFile
    this.fileExists = options.fileExists ?? existsSync
    this.getFileModifiedTime = options.getFileModifiedTime ?? defaultGetFileModifiedTime
    this.isPackaged = options.isPackaged
    this.platform = options.platform ?? process.platform
    this.readTextFile = options.readTextFile ?? defaultReadTextFile
    this.renameFile = options.renameFile ?? rename
    this.resourcesPath = options.resourcesPath
    this.spawnProcess = options.spawnProcess ?? spawnProcessCallback
    this.watchDirectory = options.watchDirectory ?? defaultWatchDirectory
    this.writeTextFile = options.writeTextFile ?? defaultWriteTextFile
    this.workspaceResourceService = options.workspaceResourceService
  }

  async open(request: ChipViewerOpenRequest): Promise<ChipViewerOpenResult> {
    const projectPath = normalizeLocalPath(request.projectPath)
    const mode = normalizeChipViewerMode(request.mode)
    const binaries = this.resolveBinaries()
    const snapshotInputs = await this.resolveSnapshotInputs(projectPath, request.step)
    const dbConfigPath = join(projectPath, DB_CONFIG_RELATIVE_PATH)
    let dbConfig: DbGeometryConfig | null = null
    const readDbConfig = async () => {
      return parseDbGeometryConfig(await this.readTextFile(dbConfigPath), dbConfigPath)
    }

    let shouldBuildSnapshot =
      request.rebuildGeometry || !this.fileExists(snapshotInputs.manifestPath)
    if (!shouldBuildSnapshot) {
      dbConfig = await readDbConfig()
      shouldBuildSnapshot = await this.isSnapshotStale(snapshotInputs.manifestPath, [
        snapshotInputs.defPath,
        dbConfigPath,
        dbConfig.techLefPath,
        ...dbConfig.lefPaths,
      ])
    }

    if (shouldBuildSnapshot) {
      dbConfig ??= await readDbConfig()
      await this.execFile(
        binaries.snapshotPath,
        this.snapshotArgs(dbConfig, snapshotInputs, 'snapshot'),
      )
    }

    const viewerArgs = ['--manifest', snapshotInputs.manifestPath, '--mode', mode]
    let editCommandDirectory: string | undefined
    let editResultDirectory: string | undefined
    if (mode === 'edit') {
      dbConfig ??= await readDbConfig()
      await this.ensureDirectory(snapshotInputs.editCommandDirectory)
      await this.ensureDirectory(snapshotInputs.editResultDirectory)
      this.startEditCommandBridge(binaries, dbConfig, snapshotInputs)
      viewerArgs.push(
        '--edit-command-dir',
        snapshotInputs.editCommandDirectory,
        '--edit-result-dir',
        snapshotInputs.editResultDirectory,
      )
      editCommandDirectory = snapshotInputs.editCommandDirectory
      editResultDirectory = snapshotInputs.editResultDirectory
    }

    const child = this.spawnProcess(binaries.viewerPath, viewerArgs, {
      detached: true,
      env: this.env,
      stdio: 'ignore',
    })
    child.unref()

    return {
      editCommandDirectory,
      editResultDirectory,
      geometryManifestPath: snapshotInputs.manifestPath,
      spawned: true,
      workspaceStepDirectory: snapshotInputs.workspaceStepDirectory,
    }
  }

  private async resolveSnapshotInputs(
    projectPath: string,
    step: string,
  ): Promise<SnapshotInputs> {
    const layoutInfo = await this.workspaceResourceService.resolveStepInfo({
      id: 'layout',
      step,
    })
    const defPath = readStringInfo(layoutInfo, 'def')
    const stepLabel = layoutInfo.step || step

    if (layoutInfo.response === 'error') {
      throw new Error(
        `Workspace step ${stepLabel} layout resources are unavailable.${workspaceStepDetails(layoutInfo)}`,
      )
    }
    if (
      layoutInfo.response === 'missing' &&
      (!defPath || layoutInfo.missing.includes(defPath))
    ) {
      throw new Error(
        `Workspace step ${stepLabel} layout resources are missing.${workspaceStepDetails(layoutInfo)}`,
      )
    }

    if (!defPath) {
      throw new Error(`Workspace step ${step} does not expose an output DEF.`)
    }
    if (!isPathInside(projectPath, defPath)) {
      throw new Error(`Workspace step DEF is outside the project path: ${defPath}`)
    }
    if (!this.fileExists(defPath)) {
      throw new Error(`Workspace step DEF does not exist: ${defPath}`)
    }

    const outputDirectory = dirname(defPath)
    const workspaceStepDirectory = dirname(outputDirectory)
    const geometryDir = join(outputDirectory, 'geometry')
    const editDirectory = join(geometryDir, 'edit')

    return {
      defPath,
      editCommandDirectory: join(editDirectory, 'commands'),
      editResultDirectory: join(editDirectory, 'results'),
      geometryDir,
      manifestPath: join(geometryDir, 'geometry.manifest'),
      workspaceStepDirectory,
    }
  }

  private snapshotArgs(
    dbConfig: DbGeometryConfig,
    snapshotInputs: SnapshotInputs,
    mode: 'snapshot' | 'apply-edit',
    editCommandPath?: string,
    editResultPath?: string,
  ): string[] {
    const args = [
      '--tech-lef',
      dbConfig.techLefPath,
      ...dbConfig.lefPaths.flatMap((lefPath) => ['--lef', lefPath]),
      '--def',
      snapshotInputs.defPath,
      '--out',
      snapshotInputs.geometryDir,
      '--mode',
      mode,
    ]
    if (mode === 'apply-edit') {
      if (!editCommandPath || !editResultPath) {
        throw new Error('Edit command and result paths are required')
      }
      args.push(
        '--edit-command',
        editCommandPath,
        '--edit-result',
        editResultPath,
        '--write-def',
        snapshotInputs.defPath,
      )
    }
    return args
  }

  private startEditCommandBridge(
    binaries: ChipViewerBinaries,
    dbConfig: DbGeometryConfig,
    snapshotInputs: SnapshotInputs,
  ): void {
    if (this.editBridgeWatchers.has(snapshotInputs.editCommandDirectory)) {
      return
    }

    const watcher = this.watchDirectory(
      snapshotInputs.editCommandDirectory,
      (fileName) => {
        void this.handleEditCommandFile(binaries, dbConfig, snapshotInputs, fileName)
      },
    )
    this.editBridgeWatchers.set(snapshotInputs.editCommandDirectory, watcher)
  }

  private async handleEditCommandFile(
    binaries: ChipViewerBinaries,
    dbConfig: DbGeometryConfig,
    snapshotInputs: SnapshotInputs,
    fileName: string,
  ): Promise<void> {
    if (!/^command-[0-9]+\.json$/.test(fileName)) {
      return
    }

    const commandPath = join(snapshotInputs.editCommandDirectory, fileName)
    if (this.processedEditCommands.has(commandPath)) {
      return
    }
    this.processedEditCommands.add(commandPath)

    const resultPath = join(
      snapshotInputs.editResultDirectory,
      fileName.replace(/^command-/, 'result-'),
    )
    const temporaryResultPath = `${resultPath}.tmp`

    try {
      await this.execFile(
        binaries.snapshotPath,
        this.snapshotArgs(
          dbConfig,
          snapshotInputs,
          'apply-edit',
          commandPath,
          temporaryResultPath,
        ),
      )
      await this.renameFile(temporaryResultPath, resultPath)
    } catch (error) {
      await this.writeRejectedEditResult(commandPath, temporaryResultPath, error)
      await this.renameFile(temporaryResultPath, resultPath)
    }
  }

  private async writeRejectedEditResult(
    commandPath: string,
    resultPath: string,
    error: unknown,
  ): Promise<void> {
    let command: { command_id?: unknown; shape_id?: unknown } = {}
    try {
      command = JSON.parse(await this.readTextFile(commandPath)) as typeof command
    } catch {
      command = {}
    }

    const commandId = typeof command.command_id === 'number' ? command.command_id : 0
    const shapeId = typeof command.shape_id === 'number' ? command.shape_id : 0
    await this.writeTextFile(
      resultPath,
      `${JSON.stringify(
        {
          command_id: commandId,
          shape_id: shapeId,
          new_version: 0,
          status: 'rejected',
          committed_bbox: {
            hx: 0,
            hy: 0,
            lx: 0,
            ly: 0,
          },
          message: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      )}\n`,
    )
  }

  private resolveBinaries(): ChipViewerBinaries {
    if (this.isPackaged) {
      return this.resolvePackagedBinaries() ?? this.resolvePathBinaries()
    }

    return this.resolveDevBinaries()
  }

  private resolvePackagedBinaries(): ChipViewerBinaries | null {
    const binaryDir = this.resourcesPath ? join(this.resourcesPath, 'binaries') : ''
    const snapshotPath = join(
      binaryDir,
      executableName('ecc-geometry-snapshot', this.platform),
    )
    const viewerPath = join(
      binaryDir,
      executableName('chip-viewer-native', this.platform),
    )

    if (this.fileExists(snapshotPath) && this.fileExists(viewerPath)) {
      return { snapshotPath, viewerPath }
    }

    return null
  }

  private resolvePathBinaries(): ChipViewerBinaries {
    const snapshotPath = this.resolveCommandFromPath('ecc-geometry-snapshot')
    const viewerPath = this.resolveCommandFromPath('chip-viewer-native')

    if (snapshotPath && viewerPath) {
      return { snapshotPath, viewerPath }
    }

    throw new Error('Chip viewer binaries were not found on PATH.')
  }

  private resolveCommandFromPath(command: string): string | null {
    const pathValue = this.env.PATH ?? ''
    const separator = this.platform === 'win32' ? ';' : ':'

    for (const directory of pathValue.split(separator).filter(Boolean)) {
      const commandPath = join(directory, executableName(command, this.platform))
      if (this.fileExists(commandPath)) {
        return commandPath
      }
    }

    return null
  }

  private resolveDevBinaries(): ChipViewerBinaries {
    let repoRoot: string
    try {
      repoRoot = this.findRepoRoot()
    } catch {
      return this.resolvePathBinaries()
    }
    const snapshotWrapperPath = join(
      repoRoot,
      'ecos/scripts/ecc-geometry-snapshot-wrapper.sh',
    )
    const viewerWrapperPath = join(repoRoot, 'ecos/scripts/chip-viewer-native-wrapper.sh')

    if (!this.fileExists(snapshotWrapperPath) || !this.fileExists(viewerWrapperPath)) {
      throw new Error(
        `Chip viewer wrappers were not found under ${join(repoRoot, 'ecos/scripts')}. ${BUILD_HINT}`,
      )
    }

    return {
      snapshotPath: snapshotWrapperPath,
      viewerPath: viewerWrapperPath,
    }
  }

  private findRepoRoot(): string {
    for (const startPath of [this.appPath, this.cwd]) {
      for (const candidate of ancestorPaths(startPath)) {
        if (this.fileExists(join(candidate, 'ecos/chip-viewer/Cargo.toml'))) {
          return candidate
        }
      }
    }

    throw new Error(
      `Unable to locate ecos/chip-viewer from ${this.appPath}. ${BUILD_HINT}`,
    )
  }

  private async isSnapshotStale(
    manifestPath: string,
    sourcePaths: string[],
  ): Promise<boolean> {
    const manifestModifiedTime = await this.getFileModifiedTime(manifestPath)
    if (manifestModifiedTime === null) {
      return true
    }

    for (const sourcePath of sourcePaths) {
      const sourceModifiedTime = await this.getFileModifiedTime(sourcePath)
      if (sourceModifiedTime !== null && sourceModifiedTime > manifestModifiedTime) {
        return true
      }
    }

    return false
  }
}
