import { randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import type {
  DesktopProjectFileChangedEvent,
  DesktopProjectFileChangeEventType,
  DesktopProjectDirectoryEntry,
  DesktopProjectTextFileChunk,
  DesktopProjectTextFileTail,
  DesktopProjectTextFileUpdate,
  ScannedPdkDirectory,
  ScannedRtlDirectory,
  WorkspaceDirectoryReplacement,
} from '@ecos-studio/shared'
import { LogTailService } from './logTailService'
import { isPathWithinRoot, isSameOrAncestorPath } from './pathScope'
import { scanRtlDirectory as scanRtlDirectoryFiles } from './rtlDirectoryScanner'
import {
  addWorkspaceDesignFiles,
  getWorkspaceFilelistPath,
  listWorkspaceDesignFiles,
  removeWorkspaceDesignFile,
} from './designFileService'
import {
  editWorkspaceParameters as editWorkspaceParametersFile,
  locateWorkspaceParametersFile,
  parseWorkspaceParametersText,
  readWorkspaceConfigContained,
} from './workspaceParametersFile'
import type {
  WorkspaceDesignFileAddResult,
  WorkspaceDesignFileEntry,
} from '@ecos-studio/shared'

export interface ProjectScopeProvider {
  approvePendingExternalReadRoots?(
    expectedProjectRoot: string,
    expectedRoots: string[],
  ): Promise<string[]>
  clearProjectRoot(): Promise<void>
  getProjectRoot(): Promise<string>
  isProjectDirectory(path: string): Promise<boolean>
  listPendingExternalReadRoots?(): Promise<string[]>
  requestProjectPathAccess(path: string): Promise<string>
  requestWritableProjectPathAccess(path: string): Promise<string>
  registerProjectReadRoot(path: string): Promise<string>
  registerProjectRoot(path: string): Promise<string>
  scanPdkDirectory(path: string): Promise<ScannedPdkDirectory>
}

export interface WorkspaceServiceOptions {
  projectScopeProvider: ProjectScopeProvider
  replacementJournalDirectory: string
  runtimeMutationGuard?: RuntimeMutationGuard
}

export interface RuntimeMutationGuard {
  isWorkspaceRuntimeActive(projectRoot: string): boolean | Promise<boolean>
}

interface DirectoryReplacementRecord {
  backupPath: string
  journalPath: string
  projectRoot: string
  recoveryMode: DirectoryReplacementRecoveryMode
  targetPath: string
}

type DirectoryReplacementJournalState =
  | 'preparing'
  | 'prepared'
  | 'committed'
  | 'retained'
type DirectoryReplacementRecoveryMode = 'delete' | 'retain' | 'rollback'

interface DirectoryReplacementJournalRecord {
  backupPath: string
  id: string
  projectRoot: string
  recoveryMode: DirectoryReplacementRecoveryMode
  state: DirectoryReplacementJournalState
  targetPath: string
  version: 1
}

const UTF8_MAX_BYTES_PER_CODE_UNIT = 4
export const WORKSPACE_RUNTIME_MUTATION_BLOCKED_MESSAGE =
  'Cannot save workspace configuration while the workspace flow is running. Wait for it to finish before editing parameters or step config.'
const WORKSPACE_REPLACEMENT_BLOCKED_MESSAGE =
  'Cannot replace a workspace while its flow is running. Wait for it to finish before deleting or replacing the workspace.'

function isDirectoryReplacementJournalRecord(
  value: unknown,
): value is DirectoryReplacementJournalRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    record.version === 1 &&
    typeof record.id === 'string' &&
    typeof record.projectRoot === 'string' &&
    typeof record.targetPath === 'string' &&
    typeof record.backupPath === 'string' &&
    (record.recoveryMode === 'delete' ||
      record.recoveryMode === 'retain' ||
      record.recoveryMode === 'rollback') &&
    (record.state === 'preparing' ||
      record.state === 'prepared' ||
      record.state === 'committed' ||
      record.state === 'retained')
  )
}

function boundedTextCharCount(maxChars: number): number {
  return Math.max(1, Math.min(Math.floor(maxChars), 2 * 1024 * 1024))
}

const MAX_PROJECT_TEXT_CHUNK_BYTES = 256 * 1024

function boundedTextChunkBytes(maxBytes: number): number {
  const requestedBytes = Number.isFinite(maxBytes)
    ? Math.floor(maxBytes)
    : MAX_PROJECT_TEXT_CHUNK_BYTES
  return Math.max(4, Math.min(requestedBytes, MAX_PROJECT_TEXT_CHUNK_BYTES))
}

function completeUtf8PrefixLength(buffer: Buffer): number {
  const end = buffer.length
  if (end === 0) return 0

  let continuationBytes = 0
  while (
    continuationBytes < end &&
    (buffer[end - continuationBytes - 1]! & 0b1100_0000) === 0b1000_0000
  ) {
    continuationBytes += 1
  }
  const start = end - continuationBytes - 1
  if (start < 0) return end

  const leadingByte = buffer[start]!
  const expectedLength =
    (leadingByte & 0b1000_0000) === 0
      ? 1
      : (leadingByte & 0b1110_0000) === 0b1100_0000
        ? 2
        : (leadingByte & 0b1111_0000) === 0b1110_0000
          ? 3
          : (leadingByte & 0b1111_1000) === 0b1111_0000
            ? 4
            : 1
  return end - start < expectedLength ? start : end
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === code
  )
}

function isSamePath(path: string, otherPath: string): boolean {
  return relative(path, otherPath) === ''
}

function shouldIgnoreWatchPath(path: string, targetPath: string): boolean {
  return !isSameOrAncestorPath(path, targetPath)
}

function normalizeRelativePathForMatch(path: string): string {
  return path.replace(/\\/g, '/')
}

function normalizePathForMatch(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/g, '')
}

async function readManifestReplacementReferences(
  projectRoot: string,
  targetPath: string,
  backupPath: string,
): Promise<{ backupReferenced: boolean; targetReferenced: boolean }> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(join(projectRoot, 'project.json'), 'utf8'),
    )
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('workspaces' in parsed) ||
      !Array.isArray(parsed.workspaces)
    ) {
      return { backupReferenced: false, targetReferenced: false }
    }

    const normalizedTargetPath = normalizePathForMatch(targetPath)
    const normalizedBackupPath = normalizePathForMatch(backupPath)
    let backupReferenced = false
    let targetReferenced = false
    for (const workspace of parsed.workspaces) {
      if (
        typeof workspace !== 'object' ||
        workspace === null ||
        !('workspace_path' in workspace) ||
        typeof workspace.workspace_path !== 'string'
      ) {
        continue
      }
      const workspacePath = normalizePathForMatch(workspace.workspace_path)
      backupReferenced ||= workspacePath === normalizedBackupPath
      targetReferenced ||= workspacePath === normalizedTargetPath
    }
    return { backupReferenced, targetReferenced }
  } catch {
    return { backupReferenced: false, targetReferenced: false }
  }
}

function isRuntimeProtectedProjectPath(
  canonicalPath: string,
  projectRoot: string,
): boolean {
  const relativePath = normalizeRelativePathForMatch(relative(projectRoot, canonicalPath))
  return (
    relativePath === 'home/ecc.toml' ||
    relativePath === 'home/parameters.json' ||
    (relativePath.startsWith('config/') && relativePath.endsWith('.json'))
  )
}

async function findProjectFileWatchDirectory(
  path: string,
  rootPath: string,
): Promise<string> {
  let candidate = dirname(path)

  while (candidate && isPathWithinRoot(candidate, rootPath)) {
    try {
      const candidateStats = await stat(candidate)
      if (candidateStats.isDirectory()) return candidate
    } catch (error) {
      if (!isNodeErrorWithCode(error, 'ENOENT')) {
        throw error
      }
    }

    candidate = dirname(candidate)
  }

  return rootPath
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) return false
    throw error
  }
}

async function createUniqueReplacementBackupPath(targetPath: string): Promise<string> {
  const targetParent = dirname(targetPath)
  const targetName = basename(targetPath)
  const timestamp = Date.now()

  for (let index = 0; index < 100; index += 1) {
    const suffix = index === 0 ? '' : `-${index}`
    const candidate = join(
      targetParent,
      `.${targetName}.replace-backup-${timestamp}${suffix}`,
    )
    if (!(await pathExists(candidate))) return candidate
  }

  throw new Error(`Unable to allocate a replacement backup path for ${targetPath}`)
}

type ChokidarProjectFileEvent = 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir'

function mapChokidarEventType(
  eventType: ChokidarProjectFileEvent,
): DesktopProjectFileChangeEventType {
  switch (eventType) {
    case 'add':
    case 'change':
      return 'change'
    case 'addDir':
    case 'unlink':
    case 'unlinkDir':
      return 'rename'
  }
}

function getRawEventPath(
  rawPath: string,
  details: unknown,
  watchDirectory: string,
  targetPath: string,
): string {
  if (isAbsolute(rawPath)) return rawPath

  const watchedPath =
    typeof details === 'object' &&
    details !== null &&
    'watchedPath' in details &&
    typeof details.watchedPath === 'string'
      ? details.watchedPath
      : watchDirectory

  if (isSamePath(watchedPath, targetPath)) return targetPath
  return join(watchedPath, rawPath)
}

async function waitForWatcherReady(watcher: FSWatcher): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      watcher.off('ready', onReady)
      watcher.off('error', onError)
    }
    const onReady = () => {
      cleanup()
      resolve()
    }
    const onError = (error: unknown) => {
      cleanup()
      reject(error)
    }

    watcher.once('ready', onReady)
    watcher.once('error', onError)
  })
}

export class WorkspaceService {
  private readonly projectScopeProvider: ProjectScopeProvider
  private readonly replacementJournalDirectory: string
  private readonly runtimeMutationGuard?: RuntimeMutationGuard
  private readonly logTailService: LogTailService
  private readonly directoryReplacements = new Map<string, DirectoryReplacementRecord>()
  private readonly projectFileWatchers = new Map<string, { close: () => Promise<void> }>()
  private nextProjectFileWatchId = 1

  constructor(options: WorkspaceServiceOptions) {
    this.projectScopeProvider = options.projectScopeProvider
    this.replacementJournalDirectory = options.replacementJournalDirectory
    this.runtimeMutationGuard = options.runtimeMutationGuard
    this.logTailService = new LogTailService({
      projectScopeProvider: this.projectScopeProvider,
      textReader: this,
    })
  }

  async isProjectDirectory(path: string): Promise<boolean> {
    return await this.projectScopeProvider.isProjectDirectory(path)
  }

  async pathExists(path: string): Promise<boolean> {
    return await pathExists(resolve(path))
  }

  /**
   * Remove an incomplete workspace directory left by a failed create.
   * Refuses complete ECOS workspaces and Project roots (directories with project.json).
   */
  async discardFailedWorkspaceCreate(path: string): Promise<boolean> {
    const canonicalPath = resolve(path)
    if (!(await pathExists(canonicalPath))) return false

    const pathStats = await stat(canonicalPath)
    if (!pathStats.isDirectory()) {
      throw new Error(`${canonicalPath} is not a directory`)
    }

    if (await this.projectScopeProvider.isProjectDirectory(canonicalPath)) {
      throw new Error('Refusing to discard a complete ECOS workspace')
    }

    if (await pathExists(join(canonicalPath, 'project.json'))) {
      throw new Error('Refusing to discard a Project root directory')
    }

    try {
      const projectRoot = await this.projectScopeProvider.getProjectRoot()
      if (isSamePath(canonicalPath, projectRoot)) {
        throw new Error('Refusing to discard the registered project root')
      }
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== 'Project root is not registered'
      ) {
        throw error
      }
    }

    await rm(canonicalPath, { force: true, recursive: true })
    return true
  }

  async registerProjectRoot(path: string): Promise<string> {
    return await this.projectScopeProvider.registerProjectRoot(path)
  }

  async listPendingExternalReadRoots(): Promise<string[]> {
    return (await this.projectScopeProvider.listPendingExternalReadRoots?.()) ?? []
  }

  async approvePendingExternalReadRoots(
    expectedProjectRoot: string,
    expectedRoots: string[],
  ): Promise<string[]> {
    return (
      (await this.projectScopeProvider.approvePendingExternalReadRoots?.(
        expectedProjectRoot,
        expectedRoots,
      )) ?? []
    )
  }

  async registerProjectReadRoot(path: string): Promise<string> {
    return await this.projectScopeProvider.registerProjectReadRoot(path)
  }

  async clearProjectRoot(): Promise<void> {
    // Per-window scope only. File/log subscriptions are tracked by the IPC layer
    // and cleaned up for the calling window (or on sender destroy).
    await this.projectScopeProvider.clearProjectRoot()
  }

  async requestProjectPathAccess(path: string): Promise<string> {
    return await this.projectScopeProvider.requestProjectPathAccess(path)
  }

  async readProjectTextFile(path: string): Promise<string> {
    const canonicalPath = await this.projectScopeProvider.requestProjectPathAccess(path)
    return await readFile(canonicalPath, 'utf8')
  }

  async readOptionalProjectTextFile(path: string): Promise<string | null> {
    try {
      return await this.readProjectTextFile(path)
    } catch (error) {
      if (isNodeErrorWithCode(error, 'ENOENT')) {
        return null
      }

      throw error
    }
  }

  /**
   * Read a workspace's persisted parameters (home/ecc.toml preferred, legacy
   * home/parameters.json fallback) for callers that only know the workspace
   * directory — e.g. wizard prefill before the workspace is opened.
   */
  async readWorkspaceParameters(
    workspacePath: string,
  ): Promise<Record<string, unknown> | null> {
    const location = await locateWorkspaceParametersFile(workspacePath)
    if (!location) return null
    try {
      const canonicalPath = await this.projectScopeProvider.requestProjectPathAccess(
        location.path,
      )
      const raw = await readWorkspaceConfigContained(location.path, canonicalPath)
      return parseWorkspaceParametersText(raw, location.format, workspacePath)
    } catch (error) {
      if (isNodeErrorWithCode(error, 'ENOENT')) {
        return null
      }

      throw error
    }
  }

  /**
   * Apply existing-path-only parameter edits (agent surface) to the
   * workspace configuration on disk. The path vocabulary is interpreted in
   * the on-disk file's format by the shared helper.
   */
  async editWorkspaceParameters(
    workspacePath: string,
    edits: { json_path: (string | number)[]; value: unknown }[],
  ): Promise<{ format: 'toml' | 'json'; path: string }> {
    const location = await locateWorkspaceParametersFile(workspacePath)
    if (!location) {
      throw new Error(`Workspace parameters file not found under: ${workspacePath}`)
    }
    const targetStats = await lstat(location.path)
    if (targetStats.isSymbolicLink()) {
      // A symlinked config path escapes the runtime mutation guard's
      // spelled-path protection and makes the write target ambiguous —
      // refuse it, matching ECC's own refusal to write through symlinks.
      throw new Error(
        `Refusing to edit workspace parameters through a symlink: ${location.path}`,
      )
    }
    const canonicalPath =
      await this.projectScopeProvider.requestWritableProjectPathAccess(location.path)
    await this.assertCanWriteProjectTextFile(canonicalPath)
    return await editWorkspaceParametersFile(workspacePath, edits, {
      format: location.format,
      path: canonicalPath,
      spelledPath: location.path,
    })
  }

  async readProjectTextFileTail(path: string, maxChars: number): Promise<string | null> {
    const result = await this.readOptionalProjectTextFileTail(path, maxChars)
    return result?.content ?? null
  }

  async readOptionalProjectTextFileTail(
    path: string,
    maxChars: number,
  ): Promise<DesktopProjectTextFileTail | null> {
    const canonicalPath = await this.projectScopeProvider.requestProjectPathAccess(path)
    const boundedMaxChars = boundedTextCharCount(maxChars)
    const readBytes = boundedMaxChars * UTF8_MAX_BYTES_PER_CODE_UNIT

    let handle: Awaited<ReturnType<typeof open>> | null = null
    try {
      handle = await open(canonicalPath, 'r')
      const fileStats = await handle.stat()
      const start = Math.max(0, fileStats.size - readBytes)
      const length = fileStats.size - start
      const buffer = Buffer.alloc(length)
      const result = await handle.read(buffer, 0, length, start)
      const raw = buffer.subarray(0, result.bytesRead).toString('utf8')
      return {
        content: raw.slice(-boundedMaxChars),
        truncated: start > 0 || raw.length > boundedMaxChars,
        sizeBytes: fileStats.size,
      }
    } catch (error) {
      if (isNodeErrorWithCode(error, 'ENOENT')) {
        return null
      }

      throw error
    } finally {
      await handle?.close()
    }
  }

  async readOptionalProjectTextFileUpdate(
    path: string,
    fromOffsetBytes: number,
    maxChars: number,
  ): Promise<DesktopProjectTextFileUpdate | null> {
    const canonicalPath = await this.projectScopeProvider.requestProjectPathAccess(path)
    const boundedMaxChars = boundedTextCharCount(maxChars)
    const readBytes = boundedMaxChars * UTF8_MAX_BYTES_PER_CODE_UNIT

    let handle: Awaited<ReturnType<typeof open>> | null = null
    try {
      handle = await open(canonicalPath, 'r')
      const fileStats = await handle.stat()
      const normalizedOffset = Math.max(0, Math.floor(fromOffsetBytes))
      const fileWasTruncated = normalizedOffset > fileStats.size
      const unreadBytes = Math.max(0, fileStats.size - normalizedOffset)
      const tooMuchUnread = unreadBytes > readBytes
      const start =
        fileWasTruncated || tooMuchUnread
          ? Math.max(0, fileStats.size - readBytes)
          : normalizedOffset
      const length = fileStats.size - start
      const buffer = Buffer.alloc(length)
      const result =
        length > 0 ? await handle.read(buffer, 0, length, start) : { bytesRead: 0 }
      const raw = buffer.subarray(0, result.bytesRead).toString('utf8')
      const decodedTooLong = raw.length > boundedMaxChars
      const truncated = fileWasTruncated || tooMuchUnread || decodedTooLong

      return {
        content: truncated ? raw.slice(-boundedMaxChars) : raw,
        fromOffsetBytes: start,
        nextOffsetBytes: fileStats.size,
        sizeBytes: fileStats.size,
        reset: fileWasTruncated || tooMuchUnread || decodedTooLong,
        truncated,
      }
    } catch (error) {
      if (isNodeErrorWithCode(error, 'ENOENT')) {
        return null
      }

      throw error
    } finally {
      await handle?.close()
    }
  }

  /**
   * Reads one bounded, UTF-8-safe chunk without materializing a complete NFS
   * log in Electron main or sending an unbounded IPC payload to the renderer.
   */
  async readOptionalProjectTextFileChunk(
    path: string,
    fromOffsetBytes: number,
    maxBytes: number,
  ): Promise<DesktopProjectTextFileChunk | null> {
    const canonicalPath = await this.projectScopeProvider.requestProjectPathAccess(path)
    const normalizedOffset = Math.max(0, Math.floor(fromOffsetBytes))
    const chunkBytes = boundedTextChunkBytes(maxBytes)

    let handle: Awaited<ReturnType<typeof open>> | null = null
    try {
      handle = await open(canonicalPath, 'r')
      const fileStats = await handle.stat()
      const start = Math.min(normalizedOffset, fileStats.size)
      const length = Math.min(chunkBytes, fileStats.size - start)
      if (length === 0) {
        return {
          content: '',
          eof: true,
          nextOffsetBytes: start,
          sizeBytes: fileStats.size,
        }
      }

      const buffer = Buffer.alloc(length)
      const result = await handle.read(buffer, 0, length, start)
      const bytes = buffer.subarray(0, result.bytesRead)
      // Do not split the final UTF-8 code point across separate IPC responses.
      const reachesEof = start + bytes.length >= fileStats.size
      const consumedBytes = reachesEof ? bytes.length : completeUtf8PrefixLength(bytes)
      const content = bytes.subarray(0, consumedBytes).toString('utf8')
      const nextOffsetBytes = start + consumedBytes
      return {
        content,
        eof: reachesEof,
        nextOffsetBytes,
        sizeBytes: fileStats.size,
      }
    } catch (error) {
      if (isNodeErrorWithCode(error, 'ENOENT')) return null

      throw error
    } finally {
      await handle?.close()
    }
  }

  async subscribeProjectLogTail(
    path: string,
    options: {
      maxInitialChars?: number
      maxChunkChars?: number
      pollIntervalMs?: number
    } = {},
    listener: (event: import('@ecos-studio/shared').DesktopProjectLogTailEvent) => void,
  ): Promise<string> {
    return await this.logTailService.subscribeProjectLogTail(path, options, listener)
  }

  async unsubscribeProjectLogTail(subscriptionId: string): Promise<void> {
    await this.logTailService.unsubscribeProjectLogTail(subscriptionId)
  }

  async readProjectBinaryFile(path: string): Promise<Uint8Array> {
    const canonicalPath = await this.projectScopeProvider.requestProjectPathAccess(path)
    return new Uint8Array(await readFile(canonicalPath))
  }

  async writeProjectTextFile(path: string, content: string): Promise<void> {
    const canonicalPath =
      await this.projectScopeProvider.requestWritableProjectPathAccess(path)
    await this.assertCanWriteProjectTextFile(canonicalPath)
    await writeFile(canonicalPath, content, 'utf8')
  }

  async listProjectDirectory(path: string): Promise<DesktopProjectDirectoryEntry[]> {
    const canonicalPath = await this.projectScopeProvider.requestProjectPathAccess(path)
    try {
      const entries = await readdir(canonicalPath, { withFileTypes: true })
      return entries
        .filter((entry) => entry.isFile() || entry.isDirectory())
        .map((entry) => ({
          name: entry.name,
          path: join(canonicalPath, entry.name),
          type: entry.isDirectory() ? ('directory' as const) : ('file' as const),
        }))
        .sort((entry, otherEntry) => {
          if (entry.type !== otherEntry.type) {
            return entry.type === 'directory' ? -1 : 1
          }
          return entry.name.localeCompare(otherEntry.name)
        })
    } catch (error) {
      if (isNodeErrorWithCode(error, 'ENOENT')) {
        return []
      }

      throw error
    }
  }

  async prepareProjectDirectoryReplacement(
    path: string,
  ): Promise<WorkspaceDirectoryReplacement | null> {
    const canonicalPath =
      await this.projectScopeProvider.requestWritableProjectPathAccess(path)
    const projectRoot = await this.projectScopeProvider.getProjectRoot()
    return await this.prepareDirectoryReplacement(canonicalPath, projectRoot, {
      requireEcOSWorkspace: true,
    })
  }

  async prepareManagedProjectWorkspaceDirectoryReplacement(
    projectRoot: string,
    workspaceId: string,
    workspacePath: string,
  ): Promise<WorkspaceDirectoryReplacement | null> {
    const canonicalProjectRoot = resolve(projectRoot)
    const targetPath = resolve(workspacePath)
    if (!workspaceId || workspaceId.includes('/') || workspaceId.includes('\\')) {
      throw new Error('Workspace manifest id must name a direct project child directory')
    }
    const expectedTargetPath = join(canonicalProjectRoot, workspaceId)
    if (
      !isPathWithinRoot(targetPath, canonicalProjectRoot) ||
      !isSamePath(targetPath, expectedTargetPath)
    ) {
      throw new Error('Workspace manifest path is not a direct child of the project root')
    }
    return await this.prepareDirectoryReplacement(targetPath, canonicalProjectRoot, {
      requireEcOSWorkspace: false,
    })
  }

  private async prepareDirectoryReplacement(
    canonicalPath: string,
    projectRoot: string,
    options: { requireEcOSWorkspace: boolean },
  ): Promise<WorkspaceDirectoryReplacement | null> {
    if (isSamePath(canonicalPath, projectRoot)) {
      throw new Error('Refusing to replace the registered project root directly')
    }

    try {
      const pathStats = await stat(canonicalPath)
      if (!pathStats.isDirectory()) {
        throw new Error(`${canonicalPath} is not a directory`)
      }
    } catch (error) {
      if (isNodeErrorWithCode(error, 'ENOENT')) return null
      throw error
    }

    if (
      options.requireEcOSWorkspace &&
      !(await this.projectScopeProvider.isProjectDirectory(canonicalPath))
    ) {
      throw new Error('Refusing to replace a directory that is not an ECOS workspace')
    }
    await this.assertCanReplaceWorkspace(canonicalPath)

    const backupPath = await createUniqueReplacementBackupPath(canonicalPath)
    const id = randomUUID()
    const journalPath = this.replacementJournalPath(id)
    const journal: DirectoryReplacementJournalRecord = {
      backupPath,
      id,
      projectRoot,
      recoveryMode: 'rollback',
      state: 'preparing',
      targetPath: canonicalPath,
      version: 1,
    }
    await this.writeReplacementJournal(journalPath, journal)

    try {
      await rename(canonicalPath, backupPath)
      await this.writeReplacementJournal(journalPath, {
        ...journal,
        state: 'prepared',
      })
    } catch (error) {
      await this.recoverDirectoryReplacement(journalPath, journal).catch(() => undefined)
      throw error
    }

    this.directoryReplacements.set(id, {
      backupPath,
      journalPath,
      projectRoot,
      recoveryMode: journal.recoveryMode,
      targetPath: canonicalPath,
    })
    return {
      id,
      targetPath: canonicalPath,
      backupPath,
    }
  }

  async restoreProjectDirectoryReplacement(replacementId: string): Promise<void> {
    const replacement = this.requireDirectoryReplacement(replacementId)
    const { backupPath, targetPath } = replacement

    await this.assertCanReplaceWorkspace(targetPath)

    if (!(await pathExists(backupPath))) {
      throw new Error(
        `Workspace replacement backup is missing: ${backupPath}. Refusing to delete ${targetPath}.`,
      )
    }

    await rm(targetPath, { force: true, recursive: true })

    try {
      await rename(backupPath, targetPath)
      this.directoryReplacements.delete(replacementId)
      await this.removeReplacementJournal(replacement.journalPath).catch(() => undefined)
    } catch (error) {
      throw new Error(
        `Failed to restore workspace replacement backup from ${backupPath} to ${targetPath}.`,
        { cause: error },
      )
    }
  }

  async finalizeProjectDirectoryReplacement(replacementId: string): Promise<void> {
    const replacement = this.requireDirectoryReplacement(replacementId)
    await this.writeReplacementJournal(replacement.journalPath, {
      backupPath: replacement.backupPath,
      id: replacementId,
      projectRoot: replacement.projectRoot,
      recoveryMode: replacement.recoveryMode,
      state: 'committed',
      targetPath: replacement.targetPath,
      version: 1,
    })
    await rm(replacement.backupPath, { force: true, recursive: true })
    this.directoryReplacements.delete(replacementId)
    await this.removeReplacementJournal(replacement.journalPath).catch(() => undefined)
  }

  async retainProjectDirectoryReplacement(replacementId: string): Promise<void> {
    const replacement = this.requireDirectoryReplacement(replacementId)
    await this.writeReplacementJournal(replacement.journalPath, {
      backupPath: replacement.backupPath,
      id: replacementId,
      projectRoot: replacement.projectRoot,
      recoveryMode: replacement.recoveryMode,
      state: 'retained',
      targetPath: replacement.targetPath,
      version: 1,
    })
    this.directoryReplacements.delete(replacementId)
    await this.removeReplacementJournal(replacement.journalPath).catch(() => undefined)
  }

  async setProjectDirectoryReplacementRecoveryMode(
    replacementId: string,
    recoveryMode: Exclude<DirectoryReplacementRecoveryMode, 'rollback'>,
  ): Promise<void> {
    const replacement = this.requireDirectoryReplacement(replacementId)
    await this.writeReplacementJournal(replacement.journalPath, {
      backupPath: replacement.backupPath,
      id: replacementId,
      projectRoot: replacement.projectRoot,
      recoveryMode,
      state: 'prepared',
      targetPath: replacement.targetPath,
      version: 1,
    })
    replacement.recoveryMode = recoveryMode
  }

  async recoverProjectDirectoryReplacements(): Promise<void> {
    let entries: string[]
    try {
      entries = await readdir(this.replacementJournalDirectory)
    } catch (error) {
      if (isNodeErrorWithCode(error, 'ENOENT')) return
      throw error
    }

    let firstError: unknown = null
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue
      const journalPath = join(this.replacementJournalDirectory, entry)
      try {
        const journal = await this.readReplacementJournal(journalPath)
        await this.recoverDirectoryReplacement(journalPath, journal)
      } catch (error) {
        firstError ??= error
      }
    }
    if (firstError) throw firstError
  }

  getProjectDirectoryReplacement(
    replacementId: string,
  ): WorkspaceDirectoryReplacement & { projectRoot: string } {
    const replacement = this.requireDirectoryReplacement(replacementId)
    return {
      id: replacementId,
      targetPath: replacement.targetPath,
      backupPath: replacement.backupPath,
      projectRoot: replacement.projectRoot,
    }
  }

  private requireDirectoryReplacement(replacementId: string): DirectoryReplacementRecord {
    if (!replacementId) {
      throw new Error('Workspace replacement id is required')
    }

    const replacement = this.directoryReplacements.get(replacementId)
    if (!replacement) {
      throw new Error('Workspace replacement is missing or has already been completed')
    }

    if (
      !isPathWithinRoot(replacement.targetPath, replacement.projectRoot) ||
      !isPathWithinRoot(replacement.backupPath, replacement.projectRoot)
    ) {
      this.directoryReplacements.delete(replacementId)
      throw new Error(
        'Workspace replacement paths are outside the registered project root',
      )
    }

    return replacement
  }

  private replacementJournalPath(replacementId: string): string {
    return join(this.replacementJournalDirectory, `${replacementId}.json`)
  }

  private async writeReplacementJournal(
    journalPath: string,
    journal: DirectoryReplacementJournalRecord,
  ): Promise<void> {
    await mkdir(this.replacementJournalDirectory, { recursive: true })
    const temporaryPath = `${journalPath}.${randomUUID()}.tmp`
    try {
      await writeFile(temporaryPath, JSON.stringify(journal), 'utf8')
      await rename(temporaryPath, journalPath)
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      throw error
    }
  }

  private async readReplacementJournal(
    journalPath: string,
  ): Promise<DirectoryReplacementJournalRecord> {
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(journalPath, 'utf8'))
    } catch (error) {
      throw new Error(`Unable to read workspace replacement journal: ${journalPath}`, {
        cause: error,
      })
    }

    if (!isDirectoryReplacementJournalRecord(parsed)) {
      throw new Error(`Invalid workspace replacement journal: ${journalPath}`)
    }
    this.assertReplacementJournalPaths(parsed)
    return parsed
  }

  private async recoverDirectoryReplacement(
    journalPath: string,
    journal: DirectoryReplacementJournalRecord,
  ): Promise<void> {
    this.assertReplacementJournalPaths(journal)
    if (journal.state === 'retained') {
      await this.removeReplacementJournal(journalPath)
      return
    }
    if (journal.state === 'committed') {
      await rm(journal.backupPath, { force: true, recursive: true })
      await this.removeReplacementJournal(journalPath)
      return
    }

    const backupExists = await pathExists(journal.backupPath)
    const targetExists = await pathExists(journal.targetPath)
    if (journal.recoveryMode !== 'rollback') {
      const references = await readManifestReplacementReferences(
        journal.projectRoot,
        journal.targetPath,
        journal.backupPath,
      )
      if (journal.recoveryMode === 'retain' && references.backupReferenced) {
        await this.removeReplacementJournal(journalPath)
        return
      }
      if (journal.recoveryMode === 'delete' && !references.targetReferenced) {
        if (backupExists) {
          await rm(journal.backupPath, { force: true, recursive: true })
        }
        await this.removeReplacementJournal(journalPath)
        return
      }
    }
    if (backupExists) {
      if (targetExists) {
        await rm(journal.targetPath, { force: true, recursive: true })
      }
      await rename(journal.backupPath, journal.targetPath)
    }
    await this.removeReplacementJournal(journalPath)
  }

  private assertReplacementJournalPaths(
    journal: DirectoryReplacementJournalRecord,
  ): void {
    if (
      !isAbsolute(journal.projectRoot) ||
      !isAbsolute(journal.targetPath) ||
      !isAbsolute(journal.backupPath) ||
      isSamePath(journal.targetPath, journal.projectRoot) ||
      !isPathWithinRoot(journal.targetPath, journal.projectRoot) ||
      !isPathWithinRoot(journal.backupPath, journal.projectRoot)
    ) {
      throw new Error('Workspace replacement journal paths are outside the project root')
    }
  }

  private async removeReplacementJournal(journalPath: string): Promise<void> {
    await rm(journalPath, { force: true })
  }

  async watchProjectFile(
    path: string,
    listener: (event: DesktopProjectFileChangedEvent) => void,
  ): Promise<string> {
    const canonicalPath = await this.projectScopeProvider.requestProjectPathAccess(path)
    const projectRoot = await this.projectScopeProvider.getProjectRoot()
    const watchDirectory = await findProjectFileWatchDirectory(canonicalPath, projectRoot)
    const subscriptionId = `project-file-watch-${this.nextProjectFileWatchId++}`
    let closed = false
    let pendingRawEmitTimer: ReturnType<typeof setTimeout> | null = null
    let pendingRawEventType: DesktopProjectFileChangeEventType = 'change'

    const clearPendingRawEmit = () => {
      if (!pendingRawEmitTimer) return
      clearTimeout(pendingRawEmitTimer)
      pendingRawEmitTimer = null
    }

    const emit = (eventType: DesktopProjectFileChangeEventType) => {
      if (closed) return
      listener({
        subscriptionId,
        path: canonicalPath,
        eventType,
      })
    }

    const scheduleRawFallbackEmit = (eventType: DesktopProjectFileChangeEventType) => {
      pendingRawEventType = eventType
      if (pendingRawEmitTimer) return
      pendingRawEmitTimer = setTimeout(() => {
        pendingRawEmitTimer = null
        emit(pendingRawEventType)
      }, 50)
    }

    const watcher = watch(watchDirectory, {
      ignored: (path) => shouldIgnoreWatchPath(path, canonicalPath),
      ignoreInitial: true,
      persistent: false,
    })

    watcher.on('all', (eventType, changedPath) => {
      if (
        eventType !== 'add' &&
        eventType !== 'addDir' &&
        eventType !== 'change' &&
        eventType !== 'unlink' &&
        eventType !== 'unlinkDir'
      ) {
        return
      }
      if (!isSamePath(changedPath, canonicalPath)) return

      clearPendingRawEmit()
      emit(mapChokidarEventType(eventType))
    })
    watcher.on('raw', (rawEventType, rawPath, details) => {
      if (rawEventType !== 'change' && rawEventType !== 'rename') return
      if (typeof rawPath !== 'string' || !rawPath) return
      const changedPath = getRawEventPath(rawPath, details, watchDirectory, canonicalPath)
      if (!isSamePath(changedPath, canonicalPath)) return

      scheduleRawFallbackEmit(rawEventType === 'rename' ? 'rename' : 'change')
    })
    watcher.on('error', () => {
      emit('error')
    })

    try {
      await waitForWatcherReady(watcher)
    } catch (error) {
      await watcher.close()
      throw error
    }

    this.projectFileWatchers.set(subscriptionId, {
      close: async () => {
        closed = true
        clearPendingRawEmit()
        await watcher.close()
      },
    })
    return subscriptionId
  }

  async unwatchProjectFile(subscriptionId: string): Promise<void> {
    const record = this.projectFileWatchers.get(subscriptionId)
    if (!record) return
    await record.close()
    this.projectFileWatchers.delete(subscriptionId)
  }

  async scanPdkDirectory(path: string): Promise<ScannedPdkDirectory> {
    return await this.projectScopeProvider.scanPdkDirectory(path)
  }

  async scanRtlDirectory(path: string): Promise<ScannedRtlDirectory> {
    return await scanRtlDirectoryFiles(path)
  }

  async listDesignFiles(): Promise<WorkspaceDesignFileEntry[]> {
    const projectRoot = await this.projectScopeProvider.getProjectRoot()
    return await listWorkspaceDesignFiles(projectRoot)
  }

  async addDesignFiles(sourcePaths: string[]): Promise<WorkspaceDesignFileAddResult> {
    const projectRoot = await this.projectScopeProvider.getProjectRoot()
    const canonicalFilelist =
      await this.projectScopeProvider.requestWritableProjectPathAccess(
        getWorkspaceFilelistPath(projectRoot),
      )
    await this.assertCanWriteProjectTextFile(canonicalFilelist)
    return await addWorkspaceDesignFiles(projectRoot, sourcePaths)
  }

  async removeDesignFile(
    filelistEntry: string,
  ): Promise<WorkspaceDesignFileEntry | null> {
    const projectRoot = await this.projectScopeProvider.getProjectRoot()
    const canonicalFilelist =
      await this.projectScopeProvider.requestWritableProjectPathAccess(
        getWorkspaceFilelistPath(projectRoot),
      )
    await this.assertCanWriteProjectTextFile(canonicalFilelist)
    return await removeWorkspaceDesignFile(projectRoot, filelistEntry)
  }

  private async closeAllProjectFileWatchers(): Promise<void> {
    await Promise.all(
      [...this.projectFileWatchers.values()].map(async (record) => {
        await record.close()
      }),
    )
    this.projectFileWatchers.clear()
  }

  private async assertCanWriteProjectTextFile(canonicalPath: string): Promise<void> {
    if (!this.runtimeMutationGuard) return

    const projectRoot = await this.projectScopeProvider.getProjectRoot()
    if (!isRuntimeProtectedProjectPath(canonicalPath, projectRoot)) return

    if (await this.runtimeMutationGuard.isWorkspaceRuntimeActive(projectRoot)) {
      throw new Error(WORKSPACE_RUNTIME_MUTATION_BLOCKED_MESSAGE)
    }
  }

  private async assertCanReplaceWorkspace(canonicalPath: string): Promise<void> {
    if (
      this.runtimeMutationGuard &&
      (await this.runtimeMutationGuard.isWorkspaceRuntimeActive(canonicalPath))
    ) {
      throw new Error(WORKSPACE_REPLACEMENT_BLOCKED_MESSAGE)
    }
  }
}
