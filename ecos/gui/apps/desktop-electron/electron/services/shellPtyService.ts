import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import type {
  DesktopShellDataEvent,
  DesktopShellExitEvent,
  DesktopShellSession,
  DesktopShellSessionOptions,
} from '@ecos-studio/shared'
import { spawn as spawnPty } from 'node-pty'
import { electronLogger } from './logger'

type ShellPlatform = NodeJS.Platform | 'linux' | 'darwin' | 'win32'
type RuntimeEnvProvider = () => Promise<NodeJS.ProcessEnv> | NodeJS.ProcessEnv

interface PtyEventDisposable {
  dispose(): void
}

interface PtyProcessLike {
  pid: number
  kill(): void
  onData(listener: (data: string) => void): PtyEventDisposable
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): PtyEventDisposable
  resize(cols: number, rows: number): void
  write(data: string): void
}

interface PtyBackend {
  spawn(
    file: string,
    args: string[],
    options: {
      cols: number
      cwd: string
      env: NodeJS.ProcessEnv
      name: string
      rows: number
    },
  ): PtyProcessLike
}

export type ShellPtyEventListener = (
  event: DesktopShellDataEvent | DesktopShellExitEvent,
) => void

export interface ShellPtyServiceOptions {
  env?: NodeJS.ProcessEnv
  envProvider?: RuntimeEnvProvider
  platform?: ShellPlatform
  ptyBackend?: PtyBackend
}

interface ShellSessionRecord {
  dataSubscription: PtyEventDisposable
  exitSubscription: PtyEventDisposable
  pty: PtyProcessLike
}

function getDefaultShell(platform: ShellPlatform, env: NodeJS.ProcessEnv): string {
  if (platform === 'win32') {
    return env.COMSPEC || 'powershell.exe'
  }

  return env.SHELL || '/bin/bash'
}

function getDefaultCwd(env: NodeJS.ProcessEnv): string {
  return env.HOME || homedir()
}

function normalizePositiveInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback
  }

  return Math.max(1, Math.floor(value))
}

export class ShellPtyService {
  private readonly env: NodeJS.ProcessEnv
  private readonly envProvider?: RuntimeEnvProvider
  private readonly platform: ShellPlatform
  private readonly ptyBackend: PtyBackend
  private readonly sessions = new Map<string, ShellSessionRecord>()

  constructor(options: ShellPtyServiceOptions = {}) {
    this.env = options.env ?? process.env
    this.envProvider = options.envProvider
    this.platform = options.platform ?? process.platform
    this.ptyBackend = options.ptyBackend ?? { spawn: spawnPty }
  }

  async createSession(
    options: DesktopShellSessionOptions,
    listener: ShellPtyEventListener,
  ): Promise<DesktopShellSession> {
    const env = await this.resolveEnv()
    const sessionId = randomUUID()
    const shell = getDefaultShell(this.platform, env)
    const cwd = options.cwd || getDefaultCwd(env)
    const pty = this.ptyBackend.spawn(shell, [], {
      cols: normalizePositiveInteger(options.cols, 80),
      cwd,
      env: {
        ...env,
        TERM: 'xterm-256color',
      },
      name: 'xterm-256color',
      rows: normalizePositiveInteger(options.rows, 24),
    })
    const dataSubscription = pty.onData((data) => {
      listener({
        data,
        sessionId,
      })
    })
    const exitSubscription = pty.onExit((event) => {
      this.sessions.delete(sessionId)
      listener({
        exitCode: event.exitCode,
        sessionId,
        signal: event.signal,
      })
    })

    this.sessions.set(sessionId, {
      dataSubscription,
      exitSubscription,
      pty,
    })

    return {
      pid: pty.pid,
      sessionId,
      shell,
    }
  }

  write(sessionId: string, data: string): void {
    this.getSession(sessionId).pty.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.getSession(sessionId).pty.resize(
      normalizePositiveInteger(cols, 80),
      normalizePositiveInteger(rows, 24),
    )
  }

  kill(sessionId: string): void {
    const session = this.getSession(sessionId)
    this.sessions.delete(sessionId)
    session.dataSubscription.dispose()
    session.exitSubscription.dispose()
    session.pty.kill()
  }

  private getSession(sessionId: string): ShellSessionRecord {
    const session = this.sessions.get(sessionId)

    if (!session) {
      throw new Error(`Unknown shell session: ${sessionId}`)
    }

    return session
  }

  private async resolveEnv(): Promise<NodeJS.ProcessEnv> {
    if (!this.envProvider) {
      return this.env
    }

    try {
      return await this.envProvider()
    } catch (error) {
      electronLogger.debug(
        '[shell] env provider failed: %s',
        error instanceof Error ? error.message : String(error),
      )
      return this.env
    }
  }
}
