import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {
  DesktopCliCommandEvent,
  DesktopCliCommandName,
  DesktopCliCommandRequest,
  DesktopCliCommandResult,
} from '@ecos-studio/shared'

export type DesktopRuntimeEventListener = (event: DesktopCliCommandEvent) => void

export interface DesktopRuntimeAdapterContext {
  emit(event: Omit<DesktopCliCommandEvent, 'cmd' | 'jobId'>): void
}

export interface DesktopRuntimeAdapter {
  execute(
    request: DesktopCliCommandRequest,
    context: DesktopRuntimeAdapterContext,
  ): Promise<DesktopCliCommandResult>
}

export interface DesktopRuntimeManagerOptions {
  adapter: DesktopRuntimeAdapter
  runtimeLockRoot?: string
}

const supportedCommands = new Set<DesktopCliCommandName>([
  'help',
  'clear',
  'load_workspace',
  'create_workspace',
  'run_step',
  'rtl2gds',
  'get_info',
  'home_page',
  'refresh_config',
  'sync_config',
])

const longRunningCommands = new Set<DesktopCliCommandName>([
  'create_workspace',
  'load_workspace',
  'run_step',
  'rtl2gds',
  'refresh_config',
  'sync_config',
])

function isSupportedCommand(cmd: string): cmd is DesktopCliCommandName {
  return supportedCommands.has(cmd as DesktopCliCommandName)
}

function createResult(
  cmd: DesktopCliCommandName,
  response: DesktopCliCommandResult['response'],
  message: string[],
): DesktopCliCommandResult {
  return {
    cmd,
    data: {},
    message,
    ok: response === 'success' || response === 'warning',
    response,
  }
}

const globalLongRunningScope = '__global__'

interface RuntimeLockHandle {
  directory: string
  release(): Promise<void>
}

interface RuntimeLockOwner {
  jobId: string
  pid: number
  scope: string
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizeDirectoryScope(directory: string): string {
  const normalized = directory.trim().replace(/\\/g, '/')
  return normalized.length > 1 && normalized.endsWith('/')
    ? normalized.slice(0, -1)
    : normalized
}

function workspaceScopeForRequest(request: DesktopCliCommandRequest): {
  directory?: string
  scope: string
  workspaceId?: string
} {
  const directory = normalizeDirectoryScope(readString(request.data.directory))
  if (!directory) return { scope: globalLongRunningScope }
  return {
    directory,
    scope: directory,
    workspaceId: directory,
  }
}

function runtimeLockName(scope: string): string {
  return createHash('sha256').update(scope).digest('hex').slice(0, 24)
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === 'EPERM'
  }
}

async function readRuntimeLockOwner(lockDirectory: string): Promise<RuntimeLockOwner | null> {
  try {
    const raw = await readFile(path.join(lockDirectory, 'owner.json'), 'utf8')
    const parsed = JSON.parse(raw) as Partial<RuntimeLockOwner>
    if (
      typeof parsed.jobId === 'string'
      && typeof parsed.scope === 'string'
      && typeof parsed.pid === 'number'
    ) {
      return {
        jobId: parsed.jobId,
        pid: parsed.pid,
        scope: parsed.scope,
      }
    }
  } catch {
    return null
  }
  return null
}

async function acquireRuntimeLock(
  rootDirectory: string,
  scope: string,
  jobId: string,
): Promise<RuntimeLockHandle | null> {
  await mkdir(rootDirectory, { recursive: true })
  const lockDirectory = path.join(rootDirectory, `${runtimeLockName(scope)}.lock`)
  try {
    await mkdir(lockDirectory)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EEXIST') throw error

    const owner = await readRuntimeLockOwner(lockDirectory)
    if (!owner || !isProcessAlive(owner.pid)) {
      await rm(lockDirectory, { force: true, recursive: true })
      return acquireRuntimeLock(rootDirectory, scope, jobId)
    }
    return null
  }

  await writeFile(
    path.join(lockDirectory, 'owner.json'),
    JSON.stringify({
      jobId,
      pid: process.pid,
      scope,
    }, null, 2),
  )

  return {
    directory: lockDirectory,
    release: async () => {
      await rm(lockDirectory, { force: true, recursive: true })
    },
  }
}

export class DesktopRuntimeManager {
  private readonly adapter: DesktopRuntimeAdapter
  private readonly runtimeLockRoot: string
  private readonly activeLongRunningJobsByScope = new Map<string, string>()
  private readonly listeners = new Set<DesktopRuntimeEventListener>()

  constructor(options: DesktopRuntimeManagerOptions) {
    this.adapter = options.adapter
    this.runtimeLockRoot = options.runtimeLockRoot
      ?? path.join(os.tmpdir(), 'ecos-studio-runtime-locks')
  }

  onEvent(listener: DesktopRuntimeEventListener): () => void {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  async isWorkspaceRuntimeActive(directory: string): Promise<boolean> {
    const scope = normalizeDirectoryScope(directory)
    if (!scope) return false

    if (this.activeLongRunningJobsByScope.has(scope)) return true

    const lockDirectory = path.join(this.runtimeLockRoot, `${runtimeLockName(scope)}.lock`)
    const owner = await readRuntimeLockOwner(lockDirectory)
    if (!owner) return false

    if (!isProcessAlive(owner.pid)) {
      await rm(lockDirectory, { force: true, recursive: true })
      return false
    }

    return true
  }

  private emit(event: DesktopCliCommandEvent, listener?: DesktopRuntimeEventListener): void {
    listener?.(event)
    for (const registeredListener of this.listeners) {
      registeredListener(event)
    }
  }

  async execute(
    request: DesktopCliCommandRequest,
    listener?: DesktopRuntimeEventListener,
  ): Promise<DesktopCliCommandResult> {
    if (!isSupportedCommand(request.cmd)) {
      return {
        cmd: request.cmd as DesktopCliCommandName,
        data: {},
        message: [`Unknown command: ${request.cmd}`],
        ok: false,
        response: 'error',
      }
    }

    const jobId = randomUUID()
    const isLongRunning = longRunningCommands.has(request.cmd)
    const workspaceScope = workspaceScopeForRequest(request)
    let runtimeLock: RuntimeLockHandle | null = null
    const eventWorkspace = workspaceScope.directory
      ? {
          directory: workspaceScope.directory,
          workspaceId: workspaceScope.workspaceId,
        }
      : {}

    this.emit({
      cmd: request.cmd,
      jobId,
      ...eventWorkspace,
      stream: 'system',
      text: `Queued ${request.cmd}`,
      type: 'queued',
    }, listener)

    if (isLongRunning && this.activeLongRunningJobsByScope.has(workspaceScope.scope)) {
      const result = createResult(
        request.cmd,
        'warning',
        workspaceScope.directory
          ? [`Another ECOS command is already running for ${workspaceScope.directory}. Wait for it to finish before starting a new one.`]
          : ['Another ECOS command is already running. Wait for it to finish before starting a new one.'],
      )
      result.ok = false
      this.emit({
        cmd: request.cmd,
        jobId,
        ...eventWorkspace,
        result,
        stream: 'system',
        text: result.message.join('\n'),
        type: 'failed',
      }, listener)
      return result
    }

    if (isLongRunning) {
      runtimeLock = await acquireRuntimeLock(this.runtimeLockRoot, workspaceScope.scope, jobId)
      if (!runtimeLock) {
        const result = createResult(
          request.cmd,
          'warning',
          workspaceScope.directory
            ? [`Another ECOS command is already running for ${workspaceScope.directory}. Wait for it to finish before starting a new one.`]
            : ['Another ECOS command is already running. Wait for it to finish before starting a new one.'],
        )
        result.ok = false
        this.emit({
          cmd: request.cmd,
          jobId,
          ...eventWorkspace,
          result,
          stream: 'system',
          text: result.message.join('\n'),
          type: 'failed',
        }, listener)
        return result
      }
      this.activeLongRunningJobsByScope.set(workspaceScope.scope, jobId)
    }

    this.emit({
      cmd: request.cmd,
      data: { ...request.data },
      jobId,
      ...eventWorkspace,
      stream: 'system',
      text: `Started ${request.cmd}`,
      type: 'started',
    }, listener)

    const context: DesktopRuntimeAdapterContext = {
      emit: (event) => {
        this.emit({
          ...event,
          cmd: request.cmd,
          jobId,
          ...eventWorkspace,
        }, listener)
      },
    }

    try {
      const result = request.cmd === 'help'
        ? createResult(request.cmd, 'success', ['Type "ecos help" to list available commands.'])
        : request.cmd === 'clear'
          ? createResult(request.cmd, 'success', [])
          : await this.adapter.execute(request, context)
      this.emit({
        cmd: request.cmd,
        jobId,
        ...eventWorkspace,
        result,
        stream: result.ok ? 'system' : result.response === 'warning' ? 'system' : 'stderr',
        text: result.message.join('\n'),
        type: result.response === 'cancelled'
          ? 'cancelled'
          : result.ok ? 'completed' : 'failed',
      }, listener)
      return result
    } catch (error) {
      const result = createResult(
        request.cmd,
        'error',
        [error instanceof Error ? error.message : String(error)],
      )
      this.emit({
        cmd: request.cmd,
        jobId,
        ...eventWorkspace,
        result,
        stream: 'stderr',
        text: result.message.join('\n'),
        type: 'failed',
      }, listener)
      return result
    } finally {
      if (isLongRunning && this.activeLongRunningJobsByScope.get(workspaceScope.scope) === jobId) {
        this.activeLongRunningJobsByScope.delete(workspaceScope.scope)
      }
      await runtimeLock?.release()
    }
  }
}
