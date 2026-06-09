import { open, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import type {
  DesktopProjectFileChangedEvent,
  DesktopProjectFileChangeEventType,
  DesktopProjectTextFileTail,
  DesktopProjectTextFileUpdate,
  ScannedPdkDirectory,
} from '@ecos-studio/shared'
import { LogTailService } from './logTailService'

export interface ProjectScopeProvider {
  clearProjectRoot(): Promise<void>
  getProjectRoot(): Promise<string>
  isProjectDirectory(path: string): Promise<boolean>
  requestProjectPathAccess(path: string): Promise<string>
  registerProjectRoot(path: string): Promise<string>
  scanPdkDirectory(path: string): Promise<ScannedPdkDirectory>
}

export interface WorkspaceServiceOptions {
  projectScopeProvider: ProjectScopeProvider
  runtimeMutationGuard?: RuntimeMutationGuard
}

export interface RuntimeMutationGuard {
  isWorkspaceRuntimeActive(projectRoot: string): boolean | Promise<boolean>
}

const UTF8_MAX_BYTES_PER_CODE_UNIT = 4
const WORKSPACE_RUNTIME_MUTATION_BLOCKED_MESSAGE =
  'Cannot save workspace configuration while the workspace flow is running. Wait for it to finish before editing parameters or step config.'

function boundedTextCharCount(maxChars: number): number {
  return Math.max(1, Math.min(Math.floor(maxChars), 2 * 1024 * 1024))
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === code
  )
}

function isWithinRoot(candidatePath: string, rootPath: string): boolean {
  const relativePath = relative(rootPath, candidatePath)
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

function isSamePath(path: string, otherPath: string): boolean {
  return relative(path, otherPath) === ''
}

function isSameOrAncestorPath(path: string, descendantPath: string): boolean {
  const relativePath = relative(path, descendantPath)
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

function shouldIgnoreWatchPath(path: string, targetPath: string): boolean {
  return !isSameOrAncestorPath(path, targetPath)
}

function normalizeRelativePathForMatch(path: string): string {
  return path.replace(/\\/g, '/')
}

function isRuntimeProtectedProjectPath(canonicalPath: string, projectRoot: string): boolean {
  const relativePath = normalizeRelativePathForMatch(relative(projectRoot, canonicalPath))
  return (
    relativePath === 'home/parameters.json'
    || (relativePath.startsWith('config/') && relativePath.endsWith('.json'))
  )
}

async function findProjectFileWatchDirectory(
  path: string,
  rootPath: string,
): Promise<string> {
  let candidate = dirname(path)

  while (candidate && isWithinRoot(candidate, rootPath)) {
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

  const watchedPath = (
    typeof details === 'object'
    && details !== null
    && 'watchedPath' in details
    && typeof details.watchedPath === 'string'
  )
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
  private readonly runtimeMutationGuard?: RuntimeMutationGuard
  private readonly logTailService: LogTailService
  private readonly projectFileWatchers = new Map<string, { close: () => Promise<void> }>()
  private nextProjectFileWatchId = 1

  constructor(options: WorkspaceServiceOptions) {
    this.projectScopeProvider = options.projectScopeProvider
    this.runtimeMutationGuard = options.runtimeMutationGuard
    this.logTailService = new LogTailService({
      projectScopeProvider: this.projectScopeProvider,
      textReader: this,
    })
  }

  async isProjectDirectory(path: string): Promise<boolean> {
    return await this.projectScopeProvider.isProjectDirectory(path)
  }

  async registerProjectRoot(path: string): Promise<string> {
    return await this.projectScopeProvider.registerProjectRoot(path)
  }

  async clearProjectRoot(): Promise<void> {
    await this.closeAllProjectFileWatchers()
    await this.logTailService.clearProjectRoot()
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
      const start = fileWasTruncated || tooMuchUnread
        ? Math.max(0, fileStats.size - readBytes)
        : normalizedOffset
      const length = fileStats.size - start
      const buffer = Buffer.alloc(length)
      const result = length > 0
        ? await handle.read(buffer, 0, length, start)
        : { bytesRead: 0 }
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
    const canonicalPath = await this.projectScopeProvider.requestProjectPathAccess(path)
    await this.assertCanWriteProjectTextFile(canonicalPath)
    await writeFile(canonicalPath, content, 'utf8')
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
        eventType !== 'add'
        && eventType !== 'addDir'
        && eventType !== 'change'
        && eventType !== 'unlink'
        && eventType !== 'unlinkDir'
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
}
