import {
  execFile as execFileCallback,
  spawn as spawnProcessCallback,
} from 'node:child_process'
import {
  closeSync,
  existsSync,
  openSync,
  type FSWatcher,
  watch as watchFsDirectoryCallback,
} from 'node:fs'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import {
  normalizeLocalPath,
  type ChipViewerOpenRequest,
  type ChipViewerOpenResult,
  type WorkspaceStepInfoResult,
} from '@ecos-studio/shared'

const BUILD_HINT =
  'Build them with: cd ecos/chip-viewer && cargo build --release -p chip-viewer-native; then build ecc-geometry-snapshot in ecc/chipcompiler/thirdparty/ecc-tools and the ECC CLI package.'
const DB_CONFIG_RELATIVE_PATH = 'config/db_default_config.json'
const GEOMETRY_SCHEMA_VERSION = 1
const VIEWER_STARTUP_HEALTH_CHECK_MS = 800
const REQUIRED_GEOMETRY_MANIFEST_FILE_KEYS = [
  'meta',
  'shapes',
  'owners',
  'payload',
  'names',
  'name_index',
  'sidmap',
  'view',
] as const
const OPTIONAL_GEOMETRY_MANIFEST_FILE_KEYS = [
  'delta',
  'layers',
  'sites',
  'masters',
  'vias',
  'grids',
  'connectivity',
  'nets',
  'buses',
  'groups',
] as const
const REQUIRED_GEOMETRY_MANIFEST_NUMBER_KEYS = [
  'shape_count',
  'owner_count',
  'payload_size',
] as const
const OPTIONAL_GEOMETRY_MANIFEST_NUMBER_KEYS = [
  'dirty_lod_tile_count',
  'dirty_lod_rebuild_candidate_count',
] as const

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
type OpenLogFile = (path: string, flags: string) => number
type CloseLogFile = (fd: number) => void
type DirectoryWatcher = Pick<FSWatcher, 'close'>
type WatchDirectory = (
  path: string,
  listener: (fileName: string) => void,
) => DirectoryWatcher
interface SpawnedViewerProcess {
  pid?: number
  unref(): void
  once(event: 'error', listener: (error: Error) => void): this
  once(
    event: 'exit',
    listener: (code: number | null, signal: string | null) => void,
  ): this
  off(event: 'error', listener: (error: Error) => void): this
  off(event: 'exit', listener: (code: number | null, signal: string | null) => void): this
}
type SpawnProcess = (
  file: string,
  args: string[],
  options: {
    detached: boolean
    env: NodeJS.ProcessEnv
    stdio: ['ignore', number, number]
  },
) => SpawnedViewerProcess

const defaultSpawnProcess: SpawnProcess = (file, args, options) =>
  spawnProcessCallback(file, args, options)

interface ChipViewerBinaries {
  eccPath: string
  snapshotPath: string
  viewerPath: string
}

interface PackagedBinaryResolution {
  binaries: ChipViewerBinaries | null
  missingPaths: string[]
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
  openLogFile?: OpenLogFile
  platform?: NodeJS.Platform
  readTextFile?: ReadTextFile
  renameFile?: RenameFile
  resourcesPath?: string
  spawnProcess?: SpawnProcess
  closeLogFile?: CloseLogFile
  viewerLogDirectory?: string
  viewerStartupCheckMs?: number
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
  dbPath: string
  defPath: string
  drcDataPath?: string
  drcStatisPath?: string
  editCommandDirectory: string
  editResultDirectory: string
  gdsPath: string
  geometryDir: string
  imagePath: string
  manifestPath: string
  workspaceStepDirectory: string
}

interface DbGeometryConfig {
  lefPaths: string[]
  techLefPath: string
}

type ChipViewerMode = NonNullable<ChipViewerOpenRequest['mode']>

interface SnapshotSourcePath {
  label: string
  path: string
}

interface ViewerLogPaths {
  stderr: string
  stdout: string
}

interface ViewerLaunchContext {
  args: string[]
  manifestPath: string
  stderrLogPath: string
  stdoutLogPath: string
  viewerPath: string
}

type SnapshotBuildReason =
  | { kind: 'forced' }
  | { kind: 'missing-manifest' }
  | { detail: string; kind: 'invalid-manifest' }
  | { kind: 'stale'; source: SnapshotSourcePath }

function defaultExecFile(file: string, args: string[]): Promise<ExecFileResult> {
  return new Promise((resolve, reject) => {
    execFileCallback(file, args, { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stderr, stdout }))
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

function packagedRuntimePayloadPaths(
  binaryDir: string,
  platform: NodeJS.Platform,
): string[] {
  if (platform !== 'linux') {
    return []
  }
  const eccToolsPackageDir = join(binaryDir, '_internal', 'ecc_tools_bin')
  return [eccToolsPackageDir, join(eccToolsPackageDir, 'lib')]
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

function snapshotInputPaths(
  dbConfig: DbGeometryConfig,
): { label: string; path: string }[] {
  return [
    { label: 'tech LEF', path: dbConfig.techLefPath },
    ...dbConfig.lefPaths.map((path) => ({ label: 'LEF', path })),
  ]
}

function snapshotSourcePaths(
  dbConfig: DbGeometryConfig,
  dbConfigPath: string,
  snapshotInputs: SnapshotInputs,
): SnapshotSourcePath[] {
  return [
    { label: 'DEF', path: snapshotInputs.defPath },
    { label: 'geometry DB config', path: dbConfigPath },
    ...snapshotInputPaths(dbConfig),
  ]
}

function snapshotBuildReasonText(reason: SnapshotBuildReason): string {
  if (reason.kind === 'forced') {
    return 'forced rebuild'
  }
  if (reason.kind === 'missing-manifest') {
    return 'creating missing snapshot'
  }
  if (reason.kind === 'invalid-manifest') {
    return `rebuilding invalid snapshot; ${reason.detail}`
  }
  return `rebuilding stale snapshot; stale source: ${reason.source.label} ${reason.source.path}`
}

function stringDetail(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function processFailureDetails(error: unknown): string[] {
  const details: string[] = []
  if (error instanceof Error && error.message.trim()) {
    details.push(error.message.trim())
  } else if (error !== undefined && error !== null) {
    details.push(String(error))
  }

  if (isRecord(error)) {
    const stderr = stringDetail(error.stderr)
    const stdout = stringDetail(error.stdout)
    const code = error.code
    const signal = error.signal
    if (stderr) {
      details.push(`stderr: ${stderr}`)
    }
    if (stdout) {
      details.push(`stdout: ${stdout}`)
    }
    if (code !== undefined) {
      details.push(`exit code: ${String(code)}`)
    }
    if (signal !== undefined) {
      details.push(`signal: ${String(signal)}`)
    }
  }

  return details
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

function parseGeometryManifestText(raw: string): Map<string, string> {
  const values = new Map<string, string>()
  for (const line of raw.split(/\r?\n/)) {
    const separatorIndex = line.indexOf('=')
    if (separatorIndex < 0) {
      continue
    }
    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim()
    if (key) {
      values.set(key, value)
    }
  }
  return values
}

function resolveManifestPath(manifestPath: string, value: string): string {
  return isAbsolute(value) ? value : join(dirname(manifestPath), value)
}

function invalidManifestNumber(values: Map<string, string>, key: string): string | null {
  const raw = values.get(key)
  if (raw === undefined || raw.length === 0) {
    return `manifest is missing ${key}`
  }
  if (!/^[0-9]+$/.test(raw)) {
    return `manifest ${key} is not a non-negative integer: ${raw}`
  }
  return null
}

function isDrcWorkspaceStep(
  step: string,
  stepLabel: string,
  stepDirectory: string,
): boolean {
  const candidates = [step, stepLabel, basename(stepDirectory)]
  return candidates.some((candidate) => {
    const normalized = candidate.toLowerCase()
    return (
      normalized === 'drc' || normalized === 'drc_ecc' || normalized.startsWith('drc_')
    )
  })
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

function sanitizeLogSegment(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '')
  return sanitized || 'step'
}

function createViewerLogPaths(logDirectory: string, step: string): ViewerLogPaths {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const baseName = `${timestamp}-${sanitizeLogSegment(step)}-${process.pid}`
  return {
    stderr: join(logDirectory, `${baseName}.stderr.log`),
    stdout: join(logDirectory, `${baseName}.stdout.log`),
  }
}

function createChipViewerProcessEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const {
    ELECTRON_NO_ATTACH_CONSOLE: _electronNoAttachConsole,
    ELECTRON_RUN_AS_NODE: _electronRunAsNode,
    NODE_OPTIONS: _nodeOptions,
    ...viewerEnv
  } = env
  return viewerEnv
}

function hasLinuxDisplayEnvironment(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY || env.WAYLAND_SOCKET)
}

function viewerLaunchFailureMessage(
  summary: string,
  context: ViewerLaunchContext,
): string {
  return [
    summary,
    `Viewer binary: ${context.viewerPath}`,
    `Arguments: ${context.args.join(' ')}`,
    `Manifest: ${context.manifestPath}`,
    `stdout log: ${context.stdoutLogPath}`,
    `stderr log: ${context.stderrLogPath}`,
  ].join('\n')
}

export class ChipViewerService {
  private readonly appPath: string
  private readonly cwd: string
  private readonly env: NodeJS.ProcessEnv
  private readonly closeLogFile: CloseLogFile
  private readonly ensureDirectory: EnsureDirectory
  private readonly execFile: ExecFileRunner
  private readonly fileExists: FileExists
  private readonly getFileModifiedTime: GetFileModifiedTime
  private readonly isPackaged: boolean
  private readonly openLogFile: OpenLogFile
  private readonly platform: NodeJS.Platform
  private readonly readTextFile: ReadTextFile
  private readonly renameFile: RenameFile
  private readonly resourcesPath?: string
  private readonly spawnProcess: SpawnProcess
  private readonly viewerLogDirectory: string
  private readonly viewerStartupCheckMs: number
  private readonly watchDirectory: WatchDirectory
  private readonly writeTextFile: WriteTextFile
  private readonly workspaceResourceService: ChipViewerServiceOptions['workspaceResourceService']
  private readonly editBridgeWatchers = new Map<string, DirectoryWatcher>()
  private readonly processedEditCommands = new Set<string>()

  constructor(options: ChipViewerServiceOptions) {
    this.appPath = options.appPath
    this.cwd = options.cwd
    this.env = options.env ?? process.env
    this.closeLogFile = options.closeLogFile ?? closeSync
    this.ensureDirectory = options.ensureDirectory ?? defaultEnsureDirectory
    this.execFile = options.execFile ?? defaultExecFile
    this.fileExists = options.fileExists ?? existsSync
    this.getFileModifiedTime = options.getFileModifiedTime ?? defaultGetFileModifiedTime
    this.isPackaged = options.isPackaged
    this.openLogFile = options.openLogFile ?? openSync
    this.platform = options.platform ?? process.platform
    this.readTextFile = options.readTextFile ?? defaultReadTextFile
    this.renameFile = options.renameFile ?? rename
    this.resourcesPath = options.resourcesPath
    this.spawnProcess = options.spawnProcess ?? defaultSpawnProcess
    this.viewerLogDirectory =
      options.viewerLogDirectory ?? join(this.cwd, 'chip-viewer-logs')
    this.viewerStartupCheckMs =
      options.viewerStartupCheckMs ?? VIEWER_STARTUP_HEALTH_CHECK_MS
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
      if (!this.fileExists(dbConfigPath)) {
        throw new Error(`Geometry DB config does not exist: ${dbConfigPath}`)
      }

      const config = parseDbGeometryConfig(
        await this.readTextFile(dbConfigPath),
        dbConfigPath,
      )
      this.validateSnapshotInputs(config)
      return config
    }

    let buildReason: SnapshotBuildReason | null = request.rebuildGeometry
      ? { kind: 'forced' }
      : null
    if (!buildReason && !this.fileExists(snapshotInputs.manifestPath)) {
      buildReason = { kind: 'missing-manifest' }
    }
    if (!buildReason) {
      const invalidManifest = await this.findInvalidSnapshotManifest(
        snapshotInputs.manifestPath,
      )
      if (invalidManifest) {
        buildReason = { detail: invalidManifest, kind: 'invalid-manifest' }
      }
    }
    if (!buildReason) {
      dbConfig = await readDbConfig()
      const staleSource = await this.findStaleSnapshotSource(
        snapshotInputs.manifestPath,
        snapshotSourcePaths(dbConfig, dbConfigPath, snapshotInputs),
      )
      if (staleSource) {
        buildReason = { kind: 'stale', source: staleSource }
      }
    }

    if (buildReason) {
      dbConfig ??= await readDbConfig()
      await this.generateSnapshot(
        binaries.snapshotPath,
        this.snapshotArgs(dbConfig, snapshotInputs, 'snapshot'),
        snapshotInputs,
        request.step,
        buildReason,
      )
    }

    const viewerArgs = ['--manifest', snapshotInputs.manifestPath, '--mode', mode]
    if (snapshotInputs.drcDataPath) {
      viewerArgs.push('--drc-data', snapshotInputs.drcDataPath)
    }
    if (snapshotInputs.drcStatisPath) {
      viewerArgs.push('--drc-statis', snapshotInputs.drcStatisPath)
    }
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

    await this.launchViewer(binaries.viewerPath, viewerArgs, snapshotInputs)

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
    const dbPath = readStringInfo(layoutInfo, 'db')
    const defPath = readStringInfo(layoutInfo, 'def')
    const gdsPath = readStringInfo(layoutInfo, 'gds')
    const imagePath = readStringInfo(layoutInfo, 'image')
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
    if (!dbPath) {
      throw new Error(`Workspace step ${step} does not expose an output DB path.`)
    }
    if (!gdsPath) {
      throw new Error(`Workspace step ${step} does not expose an output GDS path.`)
    }
    if (!imagePath) {
      throw new Error(`Workspace step ${step} does not expose an output image path.`)
    }
    if (!isPathInside(projectPath, defPath)) {
      throw new Error(`Workspace step DEF is outside the project path: ${defPath}`)
    }
    for (const [label, path] of [
      ['DB', dbPath],
      ['GDS', gdsPath],
      ['image', imagePath],
    ] as const) {
      if (!isPathInside(projectPath, path)) {
        throw new Error(`Workspace step ${label} is outside the project path: ${path}`)
      }
    }
    if (!this.fileExists(defPath)) {
      throw new Error(`Workspace step DEF does not exist: ${defPath}`)
    }

    const outputDirectory = dirname(defPath)
    const workspaceStepDirectory = dirname(outputDirectory)
    const geometryDir = join(outputDirectory, 'geometry')
    const editDirectory = join(geometryDir, 'edit')
    const drcDataPath = join(workspaceStepDirectory, 'feature', 'drc.step.json')
    const drcStatisPath = join(workspaceStepDirectory, 'analysis', 'drc_statis.csv')
    const isDrcStep = isDrcWorkspaceStep(step, stepLabel, workspaceStepDirectory)

    return {
      dbPath,
      defPath,
      drcDataPath: isDrcStep && this.fileExists(drcDataPath) ? drcDataPath : undefined,
      drcStatisPath:
        isDrcStep && this.fileExists(drcStatisPath) ? drcStatisPath : undefined,
      editCommandDirectory: join(editDirectory, 'commands'),
      editResultDirectory: join(editDirectory, 'results'),
      gdsPath,
      geometryDir,
      imagePath,
      manifestPath: join(geometryDir, 'geometry.manifest'),
      workspaceStepDirectory,
    }
  }

  private async launchViewer(
    viewerPath: string,
    viewerArgs: string[],
    snapshotInputs: SnapshotInputs,
  ): Promise<void> {
    const viewerEnv = createChipViewerProcessEnv(this.env)
    if (this.platform === 'linux' && !hasLinuxDisplayEnvironment(viewerEnv)) {
      throw new Error(
        [
          'Chip viewer cannot start because no Linux display environment is available.',
          'Set DISPLAY, WAYLAND_DISPLAY, or WAYLAND_SOCKET before launching ECOS Studio.',
          `Manifest: ${snapshotInputs.manifestPath}`,
        ].join('\n'),
      )
    }

    await this.ensureDirectory(this.viewerLogDirectory)
    const logPaths = createViewerLogPaths(
      this.viewerLogDirectory,
      basename(snapshotInputs.workspaceStepDirectory),
    )
    const launchContext: ViewerLaunchContext = {
      args: viewerArgs,
      manifestPath: snapshotInputs.manifestPath,
      stderrLogPath: logPaths.stderr,
      stdoutLogPath: logPaths.stdout,
      viewerPath,
    }

    let stdoutFd: number | null = null
    let stderrFd: number | null = null
    try {
      stdoutFd = this.openLogFile(logPaths.stdout, 'a')
      stderrFd = this.openLogFile(logPaths.stderr, 'a')
      const child = this.spawnProcess(viewerPath, viewerArgs, {
        detached: true,
        env: viewerEnv,
        stdio: ['ignore', stdoutFd, stderrFd],
      })
      this.closeOpenLogFile(stdoutFd)
      stdoutFd = null
      this.closeOpenLogFile(stderrFd)
      stderrFd = null

      await this.waitForViewerStartup(child)
      child.unref()
    } catch (error) {
      this.closeOpenLogFile(stdoutFd)
      this.closeOpenLogFile(stderrFd)
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(
        viewerLaunchFailureMessage(
          `Chip viewer failed to launch: ${detail}`,
          launchContext,
        ),
      )
    }
  }

  private closeOpenLogFile(fd: number | null): void {
    if (fd === null) {
      return
    }
    try {
      this.closeLogFile(fd)
    } catch {
      // Launch diagnostics must not fail because the parent copy of a log fd
      // could not be closed after spawning the viewer.
    }
  }

  private waitForViewerStartup(child: SpawnedViewerProcess): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout>
      const cleanup = () => {
        clearTimeout(timer)
        child.off('error', onError)
        child.off('exit', onExit)
      }
      const resolveOnce = () => {
        if (settled) return
        settled = true
        cleanup()
        resolve()
      }
      const rejectOnce = (error: Error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }
      const onError = (error: Error) => {
        rejectOnce(new Error(error.message || String(error)))
      }
      const onExit = (code: number | null, signal: string | null) => {
        const codeText = code === null ? 'none' : String(code)
        const signalText = signal ? `, signal: ${signal}` : ''
        rejectOnce(
          new Error(
            `native viewer exited during startup (exit code: ${codeText}${signalText})`,
          ),
        )
      }

      child.once('error', onError)
      child.once('exit', onExit)
      timer = setTimeout(resolveOnce, Math.max(0, this.viewerStartupCheckMs))
    })
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
        '--write-db',
        snapshotInputs.dbPath,
        '--write-gds',
        snapshotInputs.gdsPath,
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
      const gdsModifiedTimeBefore = await this.getFileModifiedTime(snapshotInputs.gdsPath)
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
      try {
        await this.refreshLayoutImageIfGdsChanged(
          binaries,
          snapshotInputs,
          gdsModifiedTimeBefore,
        )
      } catch (imageError) {
        await this.appendEditResultMessage(
          temporaryResultPath,
          `layout image refresh failed: ${
            imageError instanceof Error ? imageError.message : String(imageError)
          }`,
        )
      }
      await this.renameFile(temporaryResultPath, resultPath)
    } catch (error) {
      await this.writeRejectedEditResult(commandPath, temporaryResultPath, error)
      await this.renameFile(temporaryResultPath, resultPath)
    }
  }

  private async refreshLayoutImageIfGdsChanged(
    binaries: ChipViewerBinaries,
    snapshotInputs: SnapshotInputs,
    gdsModifiedTimeBefore: number | null,
  ): Promise<void> {
    const gdsModifiedTimeAfter = await this.getFileModifiedTime(snapshotInputs.gdsPath)
    if (gdsModifiedTimeAfter === null || gdsModifiedTimeAfter === gdsModifiedTimeBefore) {
      return
    }

    await this.ensureDirectory(dirname(snapshotInputs.imagePath))
    await this.execFile(binaries.eccPath, [
      'layout-image',
      '--gds',
      snapshotInputs.gdsPath,
      '--image',
      snapshotInputs.imagePath,
    ])
  }

  private async appendEditResultMessage(
    resultPath: string,
    message: string,
  ): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(await this.readTextFile(resultPath))
      if (!isRecord(parsed)) {
        return
      }
      const currentMessage =
        typeof parsed.message === 'string' ? parsed.message.trim() : ''
      parsed.message = currentMessage ? `${currentMessage}; ${message}` : message
      await this.writeTextFile(resultPath, `${JSON.stringify(parsed, null, 2)}\n`)
    } catch {
      // Keep the accepted edit result publishable even if warning annotation fails.
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
      const packaged = this.resolvePackagedBinaries()
      if (packaged.binaries) {
        return packaged.binaries
      }

      try {
        return this.resolvePathBinaries()
      } catch (error) {
        throw new Error(
          `Packaged chip viewer binaries are incomplete. Missing: ${packaged.missingPaths.join(
            ', ',
          )}. PATH fallback failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    }

    return this.resolveDevBinaries()
  }

  private resolvePackagedBinaries(): PackagedBinaryResolution {
    const binaryDir = this.resourcesPath ? join(this.resourcesPath, 'binaries') : ''
    const eccPath = join(binaryDir, executableName('ecc', this.platform))
    const snapshotPath = join(
      binaryDir,
      executableName('ecc-geometry-snapshot', this.platform),
    )
    const viewerPath = join(
      binaryDir,
      executableName('chip-viewer-native', this.platform),
    )
    const runtimePayloadPaths = packagedRuntimePayloadPaths(binaryDir, this.platform)

    const missingPaths = [
      eccPath,
      snapshotPath,
      viewerPath,
      ...runtimePayloadPaths,
    ].filter((path) => !this.fileExists(path))

    if (missingPaths.length === 0) {
      return {
        binaries: { eccPath, snapshotPath, viewerPath },
        missingPaths: [],
      }
    }

    return {
      binaries: null,
      missingPaths,
    }
  }

  private resolvePathBinaries(): ChipViewerBinaries {
    const eccPath = this.resolveCommandFromPath('ecc')
    const snapshotPath = this.resolveCommandFromPath('ecc-geometry-snapshot')
    const viewerPath = this.resolveCommandFromPath('chip-viewer-native')

    if (eccPath && snapshotPath && viewerPath) {
      return { eccPath, snapshotPath, viewerPath }
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
    const eccWrapperPath = join(repoRoot, 'ecos/scripts/ecc-wrapper.sh')
    const viewerWrapperPath = join(repoRoot, 'ecos/scripts/chip-viewer-native-wrapper.sh')

    if (
      !this.fileExists(eccWrapperPath) ||
      !this.fileExists(snapshotWrapperPath) ||
      !this.fileExists(viewerWrapperPath)
    ) {
      throw new Error(
        `Chip viewer wrappers were not found under ${join(repoRoot, 'ecos/scripts')}. ${BUILD_HINT}`,
      )
    }

    return {
      eccPath: eccWrapperPath,
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

  private async findStaleSnapshotSource(
    manifestPath: string,
    sourcePaths: SnapshotSourcePath[],
  ): Promise<SnapshotSourcePath | null> {
    const manifestModifiedTime = await this.getFileModifiedTime(manifestPath)
    if (manifestModifiedTime === null) {
      return { label: 'manifest', path: manifestPath }
    }

    for (const sourcePath of sourcePaths) {
      const sourceModifiedTime = await this.getFileModifiedTime(sourcePath.path)
      if (sourceModifiedTime !== null && sourceModifiedTime > manifestModifiedTime) {
        return sourcePath
      }
    }

    return null
  }

  private async findInvalidSnapshotManifest(
    manifestPath: string,
  ): Promise<string | null> {
    let values: Map<string, string>
    try {
      values = parseGeometryManifestText(await this.readTextFile(manifestPath))
    } catch (error) {
      return `manifest cannot be read: ${
        error instanceof Error ? error.message : String(error)
      }`
    }

    if (values.size === 0) {
      return `manifest has no key/value entries: ${manifestPath}`
    }

    const schemaVersion = values.get('schema_version')
    if (schemaVersion === undefined || schemaVersion.length === 0) {
      return 'manifest is missing schema_version'
    }
    if (!/^[0-9]+$/.test(schemaVersion)) {
      return `manifest schema_version is not a non-negative integer: ${schemaVersion}`
    }
    if (Number(schemaVersion) !== GEOMETRY_SCHEMA_VERSION) {
      return `manifest schema_version ${schemaVersion} is unsupported; expected ${GEOMETRY_SCHEMA_VERSION}`
    }

    for (const key of REQUIRED_GEOMETRY_MANIFEST_NUMBER_KEYS) {
      const invalidNumber = invalidManifestNumber(values, key)
      if (invalidNumber) {
        return invalidNumber
      }
    }
    for (const key of OPTIONAL_GEOMETRY_MANIFEST_NUMBER_KEYS) {
      if (!values.has(key)) {
        continue
      }
      const invalidNumber = invalidManifestNumber(values, key)
      if (invalidNumber) {
        return invalidNumber
      }
    }

    for (const key of REQUIRED_GEOMETRY_MANIFEST_FILE_KEYS) {
      const value = values.get(key)
      if (value === undefined || value.length === 0) {
        return `manifest is missing ${key}`
      }
      const path = resolveManifestPath(manifestPath, value)
      if (!this.fileExists(path)) {
        return `manifest ${key} file does not exist: ${path}`
      }
    }

    for (const key of OPTIONAL_GEOMETRY_MANIFEST_FILE_KEYS) {
      const value = values.get(key)
      if (value === undefined || value.length === 0) {
        continue
      }
      const path = resolveManifestPath(manifestPath, value)
      if (!this.fileExists(path)) {
        return `manifest ${key} file does not exist: ${path}`
      }
    }

    return null
  }

  private async generateSnapshot(
    snapshotPath: string,
    args: string[],
    snapshotInputs: SnapshotInputs,
    step: string,
    reason: SnapshotBuildReason,
  ): Promise<void> {
    try {
      const result = await this.execFile(snapshotPath, args)
      if (!this.fileExists(snapshotInputs.manifestPath)) {
        throw Object.assign(
          new Error(
            `Snapshot command completed but did not create manifest: ${snapshotInputs.manifestPath}`,
          ),
          result,
        )
      }
      const invalidManifest = await this.findInvalidSnapshotManifest(
        snapshotInputs.manifestPath,
      )
      if (invalidManifest) {
        throw Object.assign(
          new Error(
            `Snapshot command completed but wrote an invalid manifest: ${invalidManifest}`,
          ),
          result,
        )
      }
    } catch (error) {
      const details = [
        `Geometry snapshot generation failed while ${snapshotBuildReasonText(
          reason,
        )} for step ${step}.`,
        `Snapshot binary: ${snapshotPath}`,
        `DEF: ${snapshotInputs.defPath}`,
        `Output: ${snapshotInputs.geometryDir}`,
        `Manifest: ${snapshotInputs.manifestPath}`,
        ...processFailureDetails(error),
      ]
      throw new Error(details.join('\n'))
    }
  }

  private validateSnapshotInputs(dbConfig: DbGeometryConfig): void {
    for (const input of snapshotInputPaths(dbConfig)) {
      if (!this.fileExists(input.path)) {
        throw new Error(`Geometry snapshot ${input.label} does not exist: ${input.path}`)
      }
    }
  }
}
