import { spawn as spawnChild } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type {
  DesktopAgentEvent,
  DesktopAgentListSessionsRequest,
  DesktopAgentListSessionsResponse,
  DesktopAgentProviderRequest,
  DesktopAgentResumeSessionRequest,
  DesktopAgentResumeSessionResponse,
  DesktopAgentSendMessageRequest,
  DesktopAgentSendMessageResponse,
  DesktopAgentSetModeRequest,
  DesktopAgentStartRequest,
  DesktopAgentStartSessionRequest,
  DesktopAgentStartSessionResponse,
  DesktopAgentStatus,
} from '@ecos-studio/shared'
import type { AgentProviderRuntime } from './agentProviderContract'
import type { ResolvedAgentProviderManifest } from './agentProviderPlugin'
import { RuntimeEventFanout } from '../runtime/runtimeEvents'

type SpawnLike = typeof spawnChild
type AgentProviderMethod =
  | 'getStatus'
  | 'interrupt'
  | 'listSessions'
  | 'resumeSession'
  | 'sendMessage'
  | 'setMode'
  | 'start'
  | 'startSession'
  | 'stop'

export interface AgentProviderProtocolRequest {
  id: string
  method: AgentProviderMethod
  params?: unknown
}

interface AgentProviderProtocolResponse {
  error?: string | { message?: string }
  id?: string
  result?: unknown
}

interface AgentProviderProcessRuntimeOptions {
  env?: NodeJS.ProcessEnv
  manifest: ResolvedAgentProviderManifest
  spawn?: SpawnLike
}

interface PendingRequest {
  reject(error: Error): void
  resolve(value: unknown): void
}

export class AgentProviderProcessRuntime implements AgentProviderRuntime {
  private readonly env: NodeJS.ProcessEnv
  private readonly eventFanout = new RuntimeEventFanout<DesktopAgentEvent>()
  private readonly manifest: ResolvedAgentProviderManifest
  private readonly pendingRequests = new Map<string, PendingRequest>()
  private readonly spawnImpl: SpawnLike
  private child: ReturnType<SpawnLike> | null = null
  private stdoutBuffer = ''

  constructor(options: AgentProviderProcessRuntimeOptions) {
    this.env = options.env ?? process.env
    this.manifest = options.manifest
    this.spawnImpl = options.spawn ?? spawnChild
  }

  async start(request?: DesktopAgentStartRequest): Promise<void> {
    await this.sendRequest('start', request)
  }

  async startSession(request: DesktopAgentStartSessionRequest): Promise<DesktopAgentStartSessionResponse> {
    return await this.sendRequest('startSession', request) as DesktopAgentStartSessionResponse
  }

  async sendMessage(request: DesktopAgentSendMessageRequest): Promise<DesktopAgentSendMessageResponse> {
    return await this.sendRequest('sendMessage', request) as DesktopAgentSendMessageResponse
  }

  async interrupt(request?: DesktopAgentProviderRequest): Promise<void> {
    await this.sendRequest('interrupt', request)
  }

  async getStatus(request?: DesktopAgentProviderRequest): Promise<DesktopAgentStatus> {
    return await this.sendRequest('getStatus', request) as DesktopAgentStatus
  }

  async setMode(request: DesktopAgentSetModeRequest): Promise<DesktopAgentStatus> {
    return await this.sendRequest('setMode', request) as DesktopAgentStatus
  }

  async listSessions(request: DesktopAgentListSessionsRequest): Promise<DesktopAgentListSessionsResponse> {
    return await this.sendRequest('listSessions', request) as DesktopAgentListSessionsResponse
  }

  async resumeSession(request: DesktopAgentResumeSessionRequest): Promise<DesktopAgentResumeSessionResponse> {
    return await this.sendRequest('resumeSession', request) as DesktopAgentResumeSessionResponse
  }

  async stop(request?: DesktopAgentProviderRequest): Promise<void> {
    await this.sendRequest('stop', request)
  }

  onEvent(listener: (event: DesktopAgentEvent) => void): () => void {
    return this.eventFanout.onEvent(listener)
  }

  private sendRequest(method: AgentProviderMethod, params?: unknown): Promise<unknown> {
    const child = this.ensureChild()
    const stdin = child.stdin
    if (!stdin || stdin.destroyed || stdin.writableEnded) {
      return Promise.reject(new Error(`Agent provider ${this.manifest.providerId} stdin is closed`))
    }
    const id = randomUUID()
    const request: AgentProviderProtocolRequest = {
      id,
      method,
      ...(params === undefined ? {} : { params }),
    }

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { reject, resolve })
      try {
        stdin.write(`${JSON.stringify(request)}\n`, (error?: Error | null) => {
          if (error) {
            this.handleChildFailure(child, error)
            child.kill()
          }
        })
      } catch (error) {
        this.handleChildFailure(child, error instanceof Error ? error : new Error(String(error)))
        child.kill()
      }
    })
  }

  private ensureChild(): ReturnType<SpawnLike> {
    if (this.child) return this.child

    this.stdoutBuffer = ''
    const child = this.spawnImpl(
      this.manifest.command,
      this.manifest.args ?? [],
      {
        cwd: this.manifest.pluginRoot,
        env: this.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    this.child = child

    child.stdout?.on('data', (data: unknown) => {
      if (this.child !== child) return
      this.handleStdout(dataToString(data))
    })
    child.stderr?.on('data', () => {
      // Drain diagnostics so provider stderr cannot fill its pipe and block stdout responses.
    })
    child.stdin?.once('error', (error) => {
      if (this.child !== child) return
      this.handleChildFailure(child, error instanceof Error ? error : new Error(String(error)))
      child.kill()
    })
    child.once('error', (error) => {
      if (this.child !== child) return
      this.handleChildFailure(child, error instanceof Error ? error : new Error(String(error)))
    })
    child.once('close', (code, signal) => {
      if (this.child !== child) return
      const message = signal
        ? `Agent provider ${this.manifest.providerId} exited with signal ${signal}`
        : `Agent provider ${this.manifest.providerId} exited with code ${code ?? 'unknown'}`
      this.handleChildFailure(child, new Error(message))
    })

    return child
  }

  private handleStdout(text: string): void {
    this.stdoutBuffer += text
    const lines = this.stdoutBuffer.split(/\r?\n/)
    this.stdoutBuffer = lines.pop() ?? ''
    let deferredError: unknown
    let hasDeferredError = false

    for (const line of lines) {
      const record = this.readProtocolLine(line)
      if (!record) continue
      try {
        this.handleProtocolRecord(record)
      } catch (error) {
        if (!hasDeferredError) {
          deferredError = error
          hasDeferredError = true
        }
      }
    }

    if (hasDeferredError) {
      throw deferredError
    }
  }

  private readProtocolLine(line: string): Record<string, unknown> | null {
    if (!line.trim()) return null

    try {
      return readRecord(JSON.parse(line))
    } catch (error) {
      this.rejectPending(new Error(
        `Invalid JSON from agent provider ${this.manifest.providerId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ))
      return null
    }
  }

  private handleProtocolRecord(record: Record<string, unknown>): void {
    if (record.type === 'event') {
      const event = readRecord(record.event) as Partial<DesktopAgentEvent>
      if (typeof event.type === 'string') {
        this.eventFanout.emit({
          ...event,
          providerId: event.providerId ?? this.manifest.providerId,
        } as DesktopAgentEvent)
      }
      return
    }

    const response = record as AgentProviderProtocolResponse
    if (!response.id) return
    const pending = this.pendingRequests.get(response.id)
    if (!pending) return
    this.pendingRequests.delete(response.id)

    if (response.error) {
      pending.reject(new Error(errorMessage(response.error)))
      return
    }
    pending.resolve(response.result)
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error)
    }
    this.pendingRequests.clear()
  }

  private handleChildFailure(child: ReturnType<SpawnLike>, error: Error): void {
    if (this.child !== child) return
    this.rejectPending(error)
    this.child = null
    this.stdoutBuffer = ''
  }
}

function dataToString(data: unknown): string {
  return Buffer.isBuffer(data) ? data.toString('utf8') : String(data)
}

function errorMessage(error: string | { message?: string }): string {
  return typeof error === 'string' ? error : error.message ?? 'Agent provider request failed'
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}
