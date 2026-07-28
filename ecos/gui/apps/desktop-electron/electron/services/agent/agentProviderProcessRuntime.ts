import { spawn as spawnChild } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type {
  DesktopAgentEventType,
  DesktopAgentEvent,
  DesktopAgentExecutionContract,
  DesktopAgentWorkspaceSetupStepRequest,
  DesktopAgentWorkspaceSetupContract,
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

  async startSession(
    request: DesktopAgentStartSessionRequest,
  ): Promise<DesktopAgentStartSessionResponse> {
    return (await this.sendRequest(
      'startSession',
      request,
    )) as DesktopAgentStartSessionResponse
  }

  async sendMessage(
    request: DesktopAgentSendMessageRequest,
  ): Promise<DesktopAgentSendMessageResponse> {
    return (await this.sendRequest(
      'sendMessage',
      request,
    )) as DesktopAgentSendMessageResponse
  }

  async interrupt(request?: DesktopAgentProviderRequest): Promise<void> {
    await this.sendRequest('interrupt', request)
  }

  async getStatus(request?: DesktopAgentProviderRequest): Promise<DesktopAgentStatus> {
    return (await this.sendRequest('getStatus', request)) as DesktopAgentStatus
  }

  async setMode(request: DesktopAgentSetModeRequest): Promise<DesktopAgentStatus> {
    return (await this.sendRequest('setMode', request)) as DesktopAgentStatus
  }

  async listSessions(
    request: DesktopAgentListSessionsRequest,
  ): Promise<DesktopAgentListSessionsResponse> {
    return (await this.sendRequest(
      'listSessions',
      request,
    )) as DesktopAgentListSessionsResponse
  }

  async resumeSession(
    request: DesktopAgentResumeSessionRequest,
  ): Promise<DesktopAgentResumeSessionResponse> {
    return (await this.sendRequest(
      'resumeSession',
      request,
    )) as DesktopAgentResumeSessionResponse
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
      return Promise.reject(
        new Error(`Agent provider ${this.manifest.providerId} stdin is closed`),
      )
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
        this.handleChildFailure(
          child,
          error instanceof Error ? error : new Error(String(error)),
        )
        child.kill()
      }
    })
  }

  private ensureChild(): ReturnType<SpawnLike> {
    if (this.child) return this.child

    this.stdoutBuffer = ''
    const child = this.spawnImpl(this.manifest.command, this.manifest.args ?? [], {
      cwd: this.manifest.pluginRoot,
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
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
      this.handleChildFailure(
        child,
        error instanceof Error ? error : new Error(String(error)),
      )
      child.kill()
    })
    child.once('error', (error) => {
      if (this.child !== child) return
      this.handleChildFailure(
        child,
        error instanceof Error ? error : new Error(String(error)),
      )
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
      this.rejectPending(
        new Error(
          `Invalid JSON from agent provider ${this.manifest.providerId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      )
      return null
    }
  }

  private handleProtocolRecord(record: Record<string, unknown>): void {
    if (record.type === 'event') {
      const event = readDesktopAgentEvent(record.event)
      if (event) {
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
  return typeof error === 'string'
    ? error
    : (error.message ?? 'Agent provider request failed')
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

const agentEventTypes = new Set<DesktopAgentEventType>([
  'status',
  'session',
  'message',
  'tool',
  'contract',
  'workspace_setup',
  'workspace_setup_step',
  'workspace_create',
  'error',
])

function readDesktopAgentEvent(value: unknown): DesktopAgentEvent | null {
  const record = readRecord(value)
  const type = record.type
  if (typeof type !== 'string' || !agentEventTypes.has(type as DesktopAgentEventType)) {
    return null
  }
  const contract = readExecutionContract(record.contract)
  const workspaceSetup = readWorkspaceSetupContract(record.workspaceSetup)
  const workspaceSetupStep = readWorkspaceSetupStepRequest(record.workspaceSetupStep)
  const workspaceCreateSetupId = readOptionalIdentifier(record.workspaceCreateSetupId)
  if (type === 'contract' && !contract) return null
  if (type === 'workspace_setup' && !workspaceSetup) return null
  if (type === 'workspace_setup_step' && !workspaceSetupStep) return null
  if (type === 'workspace_create' && !workspaceCreateSetupId) return null
  const providerId = readEventText(record.providerId)
  const sessionId = readEventText(record.sessionId)
  const text = readEventText(record.text)

  return {
    ...(contract ? { contract } : {}),
    ...(providerId ? { providerId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(text ? { text } : {}),
    ...(workspaceSetup ? { workspaceSetup } : {}),
    ...(workspaceSetupStep ? { workspaceSetupStep } : {}),
    ...(workspaceCreateSetupId ? { workspaceCreateSetupId } : {}),
    type: type as DesktopAgentEventType,
  }
}

const workspaceSetupFlowSteps = [
  'Synthesis',
  'Floorplan',
  'fixFanout',
  'place',
  'CTS',
  'legalization',
  'route',
  'drc',
  'filler',
  'RCX',
  'sta',
  'Harden',
]

function readWorkspaceSetupContract(
  value: unknown,
): DesktopAgentWorkspaceSetupContract | null {
  const record = readRecord(value)
  if (
    record.schema_version !== 'flow-agent.workspace_setup_contract.v1' ||
    record.pdk !== 'ics55' ||
    record.requires_gui_review !== true ||
    !readEventText(record.title)
  ) {
    return null
  }
  const suggestedWorkspaceName = readOptionalIdentifier(record.suggested_workspace_name)
  if (record.suggested_workspace_name != null && !suggestedWorkspaceName) return null
  const parameters = readWorkspaceSetupParameters(record.parameters)
  const flowConfig = readWorkspaceSetupFlowConfig(record.flow_config)
  const setupId = readOptionalIdentifier(record.setup_id)
  if (!parameters || !flowConfig || !setupId) return null
  return {
    flow_config: flowConfig,
    parameters,
    pdk: 'ics55',
    requires_gui_review: true,
    schema_version: 'flow-agent.workspace_setup_contract.v1',
    setup_id: setupId,
    ...(suggestedWorkspaceName
      ? { suggested_workspace_name: suggestedWorkspaceName }
      : {}),
    title: readEventText(record.title) as string,
  }
}

function readWorkspaceSetupStepRequest(
  value: unknown,
): DesktopAgentWorkspaceSetupStepRequest | null {
  const record = readRecord(value)
  const setupId = readOptionalIdentifier(record.setup_id)
  const step = record.step
  const defaults = readRecord(record.defaults)
  if (
    record.schema_version !== 'flow-agent.workspace_setup_step_request.v1' ||
    !setupId ||
    (step !== 'project' &&
      step !== 'basic' &&
      step !== 'flow' &&
      step !== 'design_files' &&
      step !== 'pdk' &&
      step !== 'spec') ||
    (record.authority !== 'gui_native' && record.authority !== 'agent_text') ||
    (record.authority === 'gui_native' &&
      step !== 'project' &&
      step !== 'design_files' &&
      step !== 'pdk') ||
    (record.authority === 'agent_text' &&
      step !== 'basic' &&
      step !== 'flow' &&
      step !== 'spec')
  ) {
    return null
  }
  if (!readWorkspaceSetupStepDefaults(step, defaults)) return null
  return {
    authority: record.authority,
    defaults,
    schema_version: 'flow-agent.workspace_setup_step_request.v1',
    setup_id: setupId,
    step,
  }
}

function readWorkspaceSetupStepDefaults(
  step: DesktopAgentWorkspaceSetupStepRequest['step'],
  defaults: Record<string, unknown>,
): boolean {
  if (step === 'project')
    return (
      hasOnlyKeys(defaults, ['project_name']) &&
      readWorkspaceSetupText(defaults.project_name) !== null
    )
  if (step === 'basic')
    return (
      hasOnlyKeys(defaults, ['description', 'workspace_name']) &&
      readWorkspaceSetupDescription(defaults.description) !== null &&
      readWorkspaceSetupText(defaults.workspace_name) !== null
    )
  if (step === 'flow')
    return (
      hasOnlyKeys(defaults, ['flow_end', 'flow_start']) &&
      isWorkspaceSetupFlowStep(defaults.flow_start) &&
      isWorkspaceSetupFlowStep(defaults.flow_end)
    )
  if (step === 'design_files')
    return (
      hasOnlyKeys(defaults, ['flow_start']) &&
      isWorkspaceSetupFlowStep(defaults.flow_start)
    )
  if (step === 'pdk') return hasOnlyKeys(defaults, ['pdk']) && defaults.pdk === 'ics55'
  return (
    hasOnlyKeys(defaults, ['clock', 'design', 'frequency_max', 'top_module']) &&
    readWorkspaceSetupText(defaults.clock) !== null &&
    readWorkspaceSetupText(defaults.design) !== null &&
    readFiniteNumber(defaults.frequency_max, 1, 10_000) !== null &&
    readWorkspaceSetupText(defaults.top_module) !== null
  )
}

function hasOnlyKeys(record: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(record).length === keys.length && keys.every((key) => key in record)
}

function isWorkspaceSetupFlowStep(value: unknown): boolean {
  return typeof value === 'string' && workspaceSetupFlowSteps.includes(value)
}

function readWorkspaceSetupParameters(
  value: unknown,
): DesktopAgentWorkspaceSetupContract['parameters'] | null {
  const record = readRecord(value)
  const design = readWorkspaceSetupText(record.design)
  const topModule = readWorkspaceSetupText(record.top_module)
  const clock = readWorkspaceSetupText(record.clock)
  const description = readWorkspaceSetupDescription(record.description)
  const dieAreaMode = record.die_area_mode
  const frequency = readFiniteNumber(record.frequency_max, 1, 10_000)
  const margin = readFiniteNumber(record.margin, 0, 1_000_000)
  const maxFanout = readFiniteNumber(record.max_fanout, 1, 1_000_000)
  const density = readFiniteNumber(record.target_density, 0.1, 1)
  const overflow = readFiniteNumber(record.target_overflow, Number.MIN_VALUE, 1)
  if (
    design === null ||
    topModule === null ||
    clock === null ||
    description === null ||
    (dieAreaMode !== 'utilitization_margin' && dieAreaMode !== 'width_height') ||
    frequency === null ||
    margin === null ||
    maxFanout === null ||
    density === null ||
    overflow === null
  ) {
    return null
  }
  if (dieAreaMode === 'width_height') {
    const width = readFiniteNumber(record.die_width, Number.MIN_VALUE, 1_000_000)
    const height = readFiniteNumber(record.die_height, Number.MIN_VALUE, 1_000_000)
    return width === null || height === null
      ? null
      : {
          clock,
          description,
          design,
          die_area_mode: dieAreaMode,
          die_height: height,
          die_width: width,
          frequency_max: frequency,
          margin,
          max_fanout: maxFanout,
          target_density: density,
          target_overflow: overflow,
          top_module: topModule,
        }
  }
  const utilization = readFiniteNumber(record.utilitization, 0.1, 0.95)
  return utilization === null
    ? null
    : {
        clock,
        description,
        design,
        die_area_mode: dieAreaMode,
        frequency_max: frequency,
        margin,
        max_fanout: maxFanout,
        target_density: density,
        target_overflow: overflow,
        top_module: topModule,
        utilitization: utilization,
      }
}

function readWorkspaceSetupFlowConfig(
  value: unknown,
): DesktopAgentWorkspaceSetupContract['flow_config'] | null {
  const record = readRecord(value)
  const start = typeof record.start_step === 'string' ? record.start_step : ''
  const end = typeof record.end_step === 'string' ? record.end_step : ''
  const steps = Array.isArray(record.steps) ? record.steps : []
  const startIndex = workspaceSetupFlowSteps.indexOf(start)
  const endIndex = workspaceSetupFlowSteps.indexOf(end)
  if (
    startIndex < 0 ||
    endIndex < startIndex ||
    steps.length !== endIndex - startIndex + 1 ||
    steps.some((step, index) => step !== workspaceSetupFlowSteps[startIndex + index])
  ) {
    return null
  }
  return { end_step: end, start_step: start, steps }
}

function readOptionalIdentifier(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)
    ? value
    : null
}

function readWorkspaceSetupText(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 128) return null
  return value === '' || /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) ? value : null
}

function readWorkspaceSetupDescription(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 512 ? value : null
}

function readFiniteNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : null
}

function readExecutionContract(value: unknown): DesktopAgentExecutionContract | null {
  const record = readRecord(value)
  if (
    record.schema_version !== 'flow-agent.resolved_execution_contract.v1' ||
    !readEventText(record.title) ||
    !Array.isArray(record.fields) ||
    record.fields.length === 0 ||
    record.fields.length > 16
  ) {
    return null
  }

  const fields = record.fields.map((value) => {
    const field = readRecord(value)
    const label = readEventText(field.label)
    const fieldValue = readEventText(field.value)
    return label && fieldValue ? { label, value: fieldValue } : null
  })
  if (fields.some((field) => field === null)) return null

  return {
    fields: fields as DesktopAgentExecutionContract['fields'],
    schema_version: 'flow-agent.resolved_execution_contract.v1',
    title: readEventText(record.title) as string,
  }
}

function readEventText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096
    ? value
    : null
}
