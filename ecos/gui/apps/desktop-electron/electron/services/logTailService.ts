import { stat } from 'node:fs/promises'
import { watch, type FSWatcher } from 'chokidar'
import { dirname, isAbsolute, join, relative } from 'node:path'
import type {
  DesktopProjectLogTailEvent,
  DesktopProjectLogTailSubscriptionOptions,
  DesktopProjectTextFileUpdate,
} from '@ecos-studio/shared'
import type { ProjectScopeProvider } from './workspaceService'

export interface LogTailTextReader {
  readOptionalProjectTextFileUpdate(
    path: string,
    fromOffsetBytes: number,
    maxChars: number,
  ): Promise<DesktopProjectTextFileUpdate | null>
}

export interface LogTailServiceOptions {
  projectScopeProvider: ProjectScopeProvider
  textReader: LogTailTextReader
}

const DEFAULT_MAX_INITIAL_CHARS = 192 * 1024
const DEFAULT_MAX_CHUNK_CHARS = 192 * 1024
const DEFAULT_RETRY_DELAY_MS = 1200
const MIN_RETRY_DELAY_MS = 250
const MAX_RETRY_DELAY_MS = 8000
const SYNC_DEBOUNCE_DELAY_MS = 80

function boundedTextCharCount(maxChars: number): number {
  return Math.max(1, Math.min(Math.floor(maxChars), 2 * 1024 * 1024))
}

function boundedRetryDelayMs(delayMs: number): number {
  return Math.max(MIN_RETRY_DELAY_MS, Math.min(Math.floor(delayMs), MAX_RETRY_DELAY_MS))
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

interface LogTailSubscriptionState {
  subscriptionId: string
  canonicalPath: string
  watchDirectory: string
  listener: (event: DesktopProjectLogTailEvent) => void
  maxInitialChars: number
  maxChunkChars: number
  baseRetryDelayMs: number
  retryDelayMs: number
  hasSnapshot: boolean
  wasMissing: boolean
  currentOffsetBytes: number
  currentSizeBytes: number
  closed: boolean
  watcher: FSWatcher | null
  syncTimer: ReturnType<typeof setTimeout> | null
  retryTimer: ReturnType<typeof setTimeout> | null
  syncInFlight: boolean
  syncQueued: boolean
}

export class LogTailService {
  private readonly projectScopeProvider: ProjectScopeProvider
  private readonly textReader: LogTailTextReader
  private readonly subscriptions = new Map<string, LogTailSubscriptionState>()
  private nextSubscriptionId = 1
  private readonly emitEvent = this.emit.bind(this)

  constructor(options: LogTailServiceOptions) {
    this.projectScopeProvider = options.projectScopeProvider
    this.textReader = options.textReader
  }

  async subscribeProjectLogTail(
    path: string,
    options: DesktopProjectLogTailSubscriptionOptions = {},
    listener: (event: DesktopProjectLogTailEvent) => void,
  ): Promise<string> {
    const canonicalPath = await this.projectScopeProvider.requestProjectPathAccess(path)
    const projectRoot = await this.projectScopeProvider.getProjectRoot()
    const watchDirectory = await findProjectFileWatchDirectory(canonicalPath, projectRoot)
    const subscriptionId = `project-log-tail-${this.nextSubscriptionId++}`
    const state: LogTailSubscriptionState = {
      subscriptionId,
      canonicalPath,
      watchDirectory,
      listener,
      maxInitialChars: boundedTextCharCount(options.maxInitialChars ?? DEFAULT_MAX_INITIAL_CHARS),
      maxChunkChars: boundedTextCharCount(options.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS),
      baseRetryDelayMs: boundedRetryDelayMs(options.pollIntervalMs ?? DEFAULT_RETRY_DELAY_MS),
      retryDelayMs: boundedRetryDelayMs(options.pollIntervalMs ?? DEFAULT_RETRY_DELAY_MS),
      hasSnapshot: false,
      wasMissing: false,
      currentOffsetBytes: 0,
      currentSizeBytes: 0,
      closed: false,
      watcher: null,
      syncTimer: null,
      retryTimer: null,
      syncInFlight: false,
      syncQueued: false,
    }

    this.subscriptions.set(subscriptionId, state)
    this.startWatcher(state)
    void this.scheduleSync(state, 0)
    return subscriptionId
  }

  async unsubscribeProjectLogTail(subscriptionId: string): Promise<void> {
    const state = this.subscriptions.get(subscriptionId)
    if (!state) return
    await this.closeSubscription(state, 'unsubscribed')
    this.subscriptions.delete(subscriptionId)
  }

  async clearProjectRoot(): Promise<void> {
    await Promise.all(
      [...this.subscriptions.values()].map(async (state) => {
        await this.closeSubscription(state, 'project-root-cleared')
      }),
    )
    this.subscriptions.clear()
  }

  private emit(state: LogTailSubscriptionState, event: DesktopProjectLogTailEvent): void {
    if (state.closed) return
    state.listener(event)
  }

  private clearSyncTimer(state: LogTailSubscriptionState): void {
    if (state.syncTimer === null) return
    clearTimeout(state.syncTimer)
    state.syncTimer = null
  }

  private clearRetryTimer(state: LogTailSubscriptionState): void {
    if (state.retryTimer === null) return
    clearTimeout(state.retryTimer)
    state.retryTimer = null
  }

  private scheduleRetry(state: LogTailSubscriptionState): void {
    if (state.closed) return
    this.clearRetryTimer(state)
    const delay = state.retryDelayMs
    state.retryDelayMs = Math.min(state.retryDelayMs * 2, MAX_RETRY_DELAY_MS)
    state.retryTimer = setTimeout(() => {
      state.retryTimer = null
      void this.scheduleSync(state, 0)
    }, delay)
  }

  private scheduleSync(
    state: LogTailSubscriptionState,
    delayMs = SYNC_DEBOUNCE_DELAY_MS,
  ): void {
    if (state.closed) return
    this.clearRetryTimer(state)
    if (state.syncInFlight) {
      state.syncQueued = true
      return
    }
    if (state.syncTimer !== null) return
    state.syncTimer = setTimeout(() => {
      state.syncTimer = null
      void this.performSync(state)
    }, delayMs)
  }

  private startWatcher(state: LogTailSubscriptionState): void {
    const watcher = watch(state.watchDirectory, {
      ignored: (path) => shouldIgnoreWatchPath(path, state.canonicalPath),
      ignoreInitial: true,
      persistent: false,
    })
    state.watcher = watcher

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
      if (!isSameOrAncestorPath(changedPath, state.canonicalPath)) return
      this.scheduleSync(state)
    })

    watcher.on('raw', (rawEventType, rawPath, details) => {
      if (rawEventType !== 'change' && rawEventType !== 'rename') return
      if (typeof rawPath !== 'string' || !rawPath) return
      const watchedPath = (
        typeof details === 'object'
        && details !== null
        && 'watchedPath' in details
        && typeof details.watchedPath === 'string'
      )
        ? details.watchedPath
        : state.watchDirectory
      const changedPath = isAbsolute(rawPath) ? rawPath : join(watchedPath, rawPath)
      if (!isSamePath(changedPath, state.canonicalPath)) return
      this.scheduleSync(state)
    })

    watcher.on('error', (error) => {
      if (state.closed) return
      this.emit(state, {
        subscriptionId: state.subscriptionId,
        path: state.canonicalPath,
        eventType: 'error',
        reason: error instanceof Error ? error.message : String(error),
      })
      this.scheduleRetry(state)
    })
  }

  private async performSync(state: LogTailSubscriptionState): Promise<void> {
    if (state.closed) return

    if (state.syncInFlight) {
      state.syncQueued = true
      return
    }

    state.syncInFlight = true
    try {
      const maxChars = state.hasSnapshot ? state.maxChunkChars : state.maxInitialChars
      const update = await this.textReader.readOptionalProjectTextFileUpdate(
        state.canonicalPath,
        state.currentOffsetBytes,
        maxChars,
      )

      if (state.closed) return

      if (update === null) {
        if (!state.wasMissing) {
          this.emitEvent(state, {
            subscriptionId: state.subscriptionId,
            path: state.canonicalPath,
            eventType: 'waiting',
            reason: 'missing',
          })
        }
        state.wasMissing = true
        this.scheduleRetry(state)
        return
      }

      const isInitialSnapshot = !state.hasSnapshot
      const wasMissing = state.wasMissing
      const isReset = !isInitialSnapshot && (update.reset || wasMissing)
      const eventType = isInitialSnapshot ? 'snapshot' : (isReset ? 'reset' : 'append')
      const shouldSkip =
        eventType === 'append'
        && update.content.length === 0
        && update.nextOffsetBytes === state.currentOffsetBytes
        && update.sizeBytes === state.currentSizeBytes

      if (shouldSkip) {
        state.wasMissing = false
        state.retryDelayMs = state.baseRetryDelayMs
        this.clearRetryTimer(state)
        return
      }

      this.emitEvent(state, {
        subscriptionId: state.subscriptionId,
        path: state.canonicalPath,
        eventType,
        content: update.content,
        fromOffsetBytes: update.fromOffsetBytes,
        nextOffsetBytes: update.nextOffsetBytes,
        sizeBytes: update.sizeBytes,
        reset: update.reset || isReset,
        truncated: update.truncated,
      })

      state.hasSnapshot = true
      state.wasMissing = false
      state.currentOffsetBytes = update.nextOffsetBytes
      state.currentSizeBytes = update.sizeBytes
      state.retryDelayMs = state.baseRetryDelayMs
      this.clearRetryTimer(state)
    } catch (error) {
      if (state.closed) return
      this.emitEvent(state, {
        subscriptionId: state.subscriptionId,
        path: state.canonicalPath,
        eventType: 'error',
        reason: error instanceof Error ? error.message : String(error),
      })
      this.scheduleRetry(state)
    } finally {
      state.syncInFlight = false
      if (state.syncQueued && !state.closed) {
        state.syncQueued = false
        this.scheduleSync(state, 0)
      }
    }
  }

  private async closeSubscription(
    state: LogTailSubscriptionState,
    reason: 'unsubscribed' | 'project-root-cleared',
  ): Promise<void> {
    if (state.closed) return
    state.closed = true
    this.clearSyncTimer(state)
    this.clearRetryTimer(state)
    this.emitEvent(state, {
      subscriptionId: state.subscriptionId,
      path: state.canonicalPath,
      eventType: 'closed',
      reason,
    })
    const watcher = state.watcher
    state.watcher = null
    if (watcher) {
      await watcher.close()
    }
  }
}
