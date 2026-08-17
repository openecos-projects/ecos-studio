import { spawn as spawnChild } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { EventEmitter } from 'node:events'
import type { Readable, Writable } from 'node:stream'
import type { EccRuntimeEvent } from '@ecos-studio/shared'

import { EccJsonRpcClient, type JsonRpcNotificationPayload } from './jsonRpcClient'

export interface SpawnedEccRpcSidecar extends EventEmitter {
  kill(signal?: NodeJS.Signals): boolean
  stderr?: Readable | null
  stdin?: Writable | null
  stdout?: Readable | null
}

export type EccRpcSidecarSpawn = (
  command: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv
    stdio: ['pipe', 'pipe', 'pipe']
  },
) => SpawnedEccRpcSidecar

export interface EccRpcSidecarProcessOptions {
  command?: string
  env?: NodeJS.ProcessEnv
  envProvider?: () => NodeJS.ProcessEnv | Promise<NodeJS.ProcessEnv>
  logDirectoryProvider?: () => string | null
  onEvent?: (event: EccRuntimeEvent) => void
  onNotification?: (notification: JsonRpcNotificationPayload) => void
  shutdownTimeoutMs?: number
  spawn?: EccRpcSidecarSpawn
  tempDir?: string
}

export class EccRpcShutdownDeferredError extends Error {
  readonly shutdownBarrier: unknown

  constructor(shutdownBarrier: unknown) {
    super('ECC RPC sidecar shutdown is deferred by an active operation.')
    this.name = 'EccRpcShutdownDeferredError'
    this.shutdownBarrier = shutdownBarrier
  }
}

type ShutdownRequestResult =
  | { kind: 'acknowledged' }
  | { kind: 'deferred'; shutdownBarrier?: unknown }
  | { kind: 'failed' }

function timestampForFile(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    '-' +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

function dataToString(data: unknown): string {
  return Buffer.isBuffer(data) ? data.toString('utf8') : String(data)
}

function environmentsEqual(
  left: NodeJS.ProcessEnv | null,
  right: NodeJS.ProcessEnv,
): boolean {
  if (!left) {
    return false
  }
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    if (left[key] !== right[key]) {
      return false
    }
  }
  return true
}

function pathIsWithin(path: string, directory: string): boolean {
  const relativePath = relative(resolve(directory), resolve(path))
  return (
    relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
    !isAbsolute(relativePath)
  )
}

export class EccRpcSidecarProcess {
  private child: SpawnedEccRpcSidecar | null = null
  private client: EccJsonRpcClient | null = null
  private readonly command: string
  private readonly env: NodeJS.ProcessEnv
  private readonly forceKillTimeoutMs: number
  private readonly shutdownTimeoutMs: number
  private readonly spawnImpl: EccRpcSidecarSpawn
  private readonly tempDir: string
  private forceKillTimer: ReturnType<typeof setTimeout> | null = null
  private shuttingDown = false
  private spawnEnv: NodeJS.ProcessEnv | null = null
  logFile: string | null = null

  constructor(private readonly options: EccRpcSidecarProcessOptions = {}) {
    this.command = options.command ?? 'ecc'
    this.env = { ...(options.env ?? process.env) }
    this.forceKillTimeoutMs = 1000
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 3000
    this.spawnImpl = options.spawn ?? (spawnChild as unknown as EccRpcSidecarSpawn)
    this.tempDir = options.tempDir ?? tmpdir()
  }

  async start(): Promise<EccJsonRpcClient> {
    const env = await this.resolveEnv()
    if (this.client && environmentsEqual(this.spawnEnv, env)) {
      return this.client
    }
    if (this.client) {
      const child = this.child
      if (child) {
        await this.stopForRestart(child)
      }
    }

    this.logFile = this.createLogFile()
    this.shuttingDown = false
    this.appendLog(`[sidecar] spawning ${this.command} rpc serve --stdio --persistent-db\n`)

    const child = this.spawnImpl(
      this.command,
      ['rpc', 'serve', '--stdio', '--persistent-db'],
      {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    this.child = child
    this.spawnEnv = { ...env }

    const client = new EccJsonRpcClient({
      onNotification: (notification) => this.options.onNotification?.(notification),
      writeFrame: (frame) => {
        if (!child.stdin?.writable) {
          throw new Error('ECC RPC sidecar stdin is not writable.')
        }
        child.stdin.write(frame)
      },
    })
    this.client = client

    child.stdout?.on('data', (chunk) => {
      try {
        client.feedStdout(chunk as Buffer)
      } catch (error) {
        const recovered = client.recoverStdout()
        if (recovered) {
          const text = `[protocol] discarded malformed stdout before the next RPC frame:\n${recovered}\n`
          this.appendLog(text)
          this.options.onEvent?.({
            logFile: this.logFile ?? undefined,
            text,
            type: 'runtime.stderr',
          })
          try {
            client.feedStdout(Buffer.alloc(0))
            return
          } catch (recoveryError) {
            client.rejectPending(
              recoveryError instanceof Error
                ? recoveryError
                : new Error(String(recoveryError)),
            )
            return
          }
        }
        client.rejectPending(error instanceof Error ? error : new Error(String(error)))
      }
    })

    child.stderr?.on('data', (chunk) => {
      const text = dataToString(chunk)
      this.appendLog(text)
      this.options.onEvent?.({
        logFile: this.logFile ?? undefined,
        text,
        type: 'runtime.stderr',
      })
    })

    child.once('error', (error) => {
      const sidecarError =
        error instanceof Error ? error : new Error(`ECC RPC sidecar error: ${error}`)
      client.rejectPending(sidecarError)
    })

    child.once('close', (code: number | null, signal: NodeJS.Signals | null) => {
      this.clearForceKillTimer()
      const reason = this.shuttingDown ? 'shutdown' : 'unexpected'
      const message =
        reason === 'unexpected'
          ? `ECC RPC sidecar exited with ${signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`}.`
          : undefined
      const exitError = new Error(message ?? 'ECC RPC sidecar exited.')
      client.rejectPending(exitError)
      if (this.child === child) {
        this.client = null
        this.child = null
        this.spawnEnv = null
      }
      this.options.onEvent?.({
        code,
        logFile: this.logFile ?? undefined,
        message,
        reason,
        signal,
        type: 'runtime.exited',
      })
    })

    return client
  }

  async shutdown(): Promise<void> {
    const child = this.child
    if (!child) {
      return
    }
    await this.stopForRestart(child)
  }

  /**
   * Move a legacy workspace-owned sidecar log before ECC deletes rerun artifacts.
   * stderr is appended by path, so updating logFile synchronously prevents the
   * child from recreating the old file after this method returns.
   */
  relocateLogFileFrom(workspaceDirectory: string | null | undefined): void {
    const previousLogFile = this.logFile
    if (
      !previousLogFile ||
      !workspaceDirectory ||
      !pathIsWithin(previousLogFile, workspaceDirectory)
    ) {
      return
    }

    const nextLogFile = this.createLogFile()
    try {
      try {
        renameSync(previousLogFile, nextLogFile)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
          throw error
        }
        copyFileSync(previousLogFile, nextLogFile)
        unlinkSync(previousLogFile)
      }
      this.logFile = nextLogFile
    } catch (error) {
      unlinkSync(nextLogFile)
      throw error
    }
  }

  private async stopForRestart(child: SpawnedEccRpcSidecar): Promise<void> {
    let didExit = false
    let resolveExit: (() => void) | undefined
    const onClose = () => {
      didExit = true
      resolveExit?.()
    }
    const exited = new Promise<void>((resolve) => {
      resolveExit = resolve
      child.once('close', onClose)
    })

    try {
      this.clearForceKillTimer()
      const client = this.client
      const shutdownResult = client
        ? await this.requestShutdown(client)
        : { kind: 'failed' as const }
      if (shutdownResult.kind === 'deferred') {
        this.shuttingDown = false
        throw new EccRpcShutdownDeferredError(shutdownResult.shutdownBarrier)
      }
      const shutdownAcknowledged = shutdownResult.kind === 'acknowledged'
      if (didExit || this.child !== child) {
        return
      }
      if (
        shutdownAcknowledged &&
        (await this.waitForExit(exited, this.shutdownTimeoutMs))
      ) {
        return
      }

      child.kill('SIGTERM')
      if (await this.waitForExit(exited, this.forceKillTimeoutMs)) {
        return
      }

      child.kill('SIGKILL')
      if (await this.waitForExit(exited, this.shutdownTimeoutMs)) {
        return
      }
      throw new Error('ECC RPC sidecar did not exit after SIGKILL.')
    } finally {
      child.off('close', onClose)
    }
  }

  private async requestShutdown(
    client: EccJsonRpcClient,
  ): Promise<ShutdownRequestResult> {
    this.shuttingDown = true
    try {
      const result = await client.call<{
        deferred?: boolean
        ok?: boolean
        shutdownBarrier?: unknown
      }>('rpc.shutdown', undefined, {
        timeoutMs: this.shutdownTimeoutMs,
      })
      if (result?.deferred || result?.ok === false) {
        return { kind: 'deferred', shutdownBarrier: result.shutdownBarrier }
      }
      return { kind: 'acknowledged' }
    } catch {
      return { kind: 'failed' }
    }
  }

  private async waitForExit(exited: Promise<void>, timeoutMs: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs)
    })
    const result = await Promise.race([exited.then(() => true as const), timedOut])
    if (timer) {
      clearTimeout(timer)
    }
    return result
  }

  private clearForceKillTimer(): void {
    if (!this.forceKillTimer) {
      return
    }
    clearTimeout(this.forceKillTimer)
    this.forceKillTimer = null
  }

  private async resolveEnv(): Promise<NodeJS.ProcessEnv> {
    if (!this.options.envProvider) {
      return this.env
    }

    try {
      return await this.options.envProvider()
    } catch {
      return this.spawnEnv ? { ...this.spawnEnv } : this.env
    }
  }

  private createLogFile(): string {
    const preferredDir = this.options.logDirectoryProvider?.()
    const logDir = preferredDir ?? join(this.tempDir, 'ecos-ecc-rpc-logs')
    mkdirSync(logDir, { recursive: true })
    const path = join(logDir, `ecc-rpc-runtime-${timestampForFile()}-${randomUUID()}.log`)
    writeFileSync(path, '', { encoding: 'utf8', flag: 'w' })
    return path
  }

  private appendLog(text: string): void {
    if (!this.logFile) {
      return
    }
    appendFileSync(this.logFile, text, 'utf8')
  }
}
