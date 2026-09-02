import { spawn as spawnChild } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type {
  DesktopAgentEventType,
  DesktopAgentEvent,
  DesktopAgentChoice,
  DesktopAgentExecutionContract,
  DesktopAgentWorkspaceContinueContract,
  DesktopAgentWorkspaceParameterUpdateContract,
  DesktopAgentWorkspaceParameterWrite,
  DesktopAgentWorkspaceRerunContract,
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
import { desktopAgentParameterWriteFiles } from '@ecos-studio/shared'
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

export type AgentProviderEnvOverrides = Record<string, string | undefined>

interface PendingRequest {
  reject(error: Error): void
  resolve(value: unknown): void
}

const MAX_STDERR_DIAGNOSTIC_LENGTH = 4096
const SENSITIVE_STDERR_PATTERN =
  /\b(?:api[ _-]?key|authorization|password|secret|token)\b/i

export class AgentProviderProcessRuntime implements AgentProviderRuntime {
  private readonly baseEnv: NodeJS.ProcessEnv
  private env: NodeJS.ProcessEnv
  private readonly eventFanout = new RuntimeEventFanout<DesktopAgentEvent>()
  private readonly manifest: ResolvedAgentProviderManifest
  private readonly pendingRequests = new Map<string, PendingRequest>()
  private readonly spawnImpl: SpawnLike
  private child: ReturnType<SpawnLike> | null = null
  private stderrTail = ''
  private stdoutBuffer = ''

  constructor(options: AgentProviderProcessRuntimeOptions) {
    this.baseEnv = { ...(options.env ?? process.env) }
    this.env = { ...this.baseEnv, ...options.manifest.environment }
    this.manifest = options.manifest
    this.spawnImpl = options.spawn ?? spawnChild
  }

  /**
   * Merge runtime overrides (e.g. settings-backed ECOS_AGENT_CODEX_BIN).
   * Restarts the provider child when an override value changes so the next
   * request spawns with the updated environment.
   */
  syncEnvironmentOverrides(overrides: AgentProviderEnvOverrides): void {
    const next: NodeJS.ProcessEnv = {
      ...this.baseEnv,
      ...this.manifest.environment,
    }
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined || value === '') {
        delete next[key]
      } else {
        next[key] = value
      }
    }
    const previousCodex = this.env.ECOS_AGENT_CODEX_BIN
    const nextCodex = next.ECOS_AGENT_CODEX_BIN
    this.env = next
    if (previousCodex !== nextCodex && this.child) {
      this.disposeChildForEnvReload()
    }
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

    this.stderrTail = ''
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
    child.stderr?.on('data', (data: unknown) => {
      if (this.child !== child) return
      this.stderrTail = `${this.stderrTail}${dataToString(data)}`.slice(
        -MAX_STDERR_DIAGNOSTIC_LENGTH,
      )
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
      this.handleChildFailure(
        child,
        new Error(withStderrDiagnostic(message, this.stderrTail)),
      )
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
    this.stderrTail = ''
    this.stdoutBuffer = ''
  }

  private disposeChildForEnvReload(): void {
    const child = this.child
    if (!child) return
    this.child = null
    this.stderrTail = ''
    this.stdoutBuffer = ''
    this.rejectPending(new Error('Agent provider restarted to apply Codex CLI path'))
    try {
      child.kill()
    } catch {
      // Best-effort restart.
    }
  }
}

function dataToString(data: unknown): string {
  return Buffer.isBuffer(data) ? data.toString('utf8') : String(data)
}

function withStderrDiagnostic(message: string, stderr: string): string {
  const diagnostic = stderr.trim().replace(/\s+/g, ' ')
  if (!diagnostic) return message
  if (SENSITIVE_STDERR_PATTERN.test(diagnostic)) {
    return `${message}: provider diagnostic redacted`
  }
  return `${message}: ${diagnostic}`
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
  'choice',
  'contract',
  'workspace_setup',
  'workspace_create',
  'workspace_rerun',
  'workspace_continue',
  'workspace_parameter_update',
  'error',
])

function readDesktopAgentEvent(value: unknown): DesktopAgentEvent | null {
  const record = readRecord(value)
  const type = record.type
  if (typeof type !== 'string' || !agentEventTypes.has(type as DesktopAgentEventType)) {
    return null
  }
  const contract = readExecutionContract(record.contract)
  const choice = readAgentChoice(record.choice)
  const workspaceSetup = readWorkspaceSetupContract(record.workspaceSetup)
  const workspaceCreateSetupId = readOptionalIdentifier(record.workspaceCreateSetupId)
  const workspaceRerun = readWorkspaceRerunContract(record.workspaceRerun)
  const workspaceContinue = readWorkspaceContinueContract(record.workspaceContinue)
  const workspaceParameterUpdate = readWorkspaceParameterUpdateContract(
    record.workspaceParameterUpdate,
  )
  const status = readAgentRunStatus(record.status)
  const delta = readEventText(record.delta)
  const messageId = readOptionalIdentifier(record.messageId)
  if (type === 'choice' && !choice) return null
  if (type === 'status' && !status) return null
  if (type === 'contract' && !contract) return null
  if (type === 'workspace_setup' && !workspaceSetup) return null
  if (type === 'workspace_create' && !workspaceCreateSetupId) return null
  if (type === 'workspace_rerun' && !workspaceRerun) return null
  if (type === 'workspace_continue' && !workspaceContinue) return null
  if (type === 'workspace_parameter_update' && !workspaceParameterUpdate) return null
  const providerId = readEventText(record.providerId)
  const sessionId = readEventText(record.sessionId)
  const text = readEventText(record.text)

  return {
    ...(choice ? { choice } : {}),
    ...(contract ? { contract } : {}),
    ...(delta ? { delta } : {}),
    ...(messageId ? { messageId } : {}),
    ...(providerId ? { providerId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(status ? { status } : {}),
    ...(text ? { text } : {}),
    ...(workspaceSetup ? { workspaceSetup } : {}),
    ...(workspaceCreateSetupId ? { workspaceCreateSetupId } : {}),
    ...(workspaceRerun ? { workspaceRerun } : {}),
    ...(workspaceContinue ? { workspaceContinue } : {}),
    ...(workspaceParameterUpdate ? { workspaceParameterUpdate } : {}),
    type: type as DesktopAgentEventType,
  }
}

function readAgentChoice(value: unknown): DesktopAgentChoice | null {
  const record = readRecord(value)
  const promptId = readOptionalIdentifier(record.promptId)
  const title = readEventText(record.title)
  const allowFreeText =
    record.allowFreeText === undefined
      ? undefined
      : typeof record.allowFreeText === 'boolean'
        ? record.allowFreeText
        : null
  if (
    !promptId ||
    !title ||
    (record.variant !== 'buttons' && record.variant !== 'list') ||
    !Array.isArray(record.options) ||
    record.options.length < 1 ||
    record.options.length > 32 ||
    allowFreeText === null
  ) {
    return null
  }
  const options = record.options.map((value) => {
    const option = readRecord(value)
    const id = readOptionalIdentifier(option.id)
    const label = readEventText(option.label)
    const optionValue = readEventText(option.value)
    return id && label && optionValue ? { id, label, value: optionValue } : null
  })
  if (options.some((option) => option === null)) return null
  return {
    ...(allowFreeText === undefined ? {} : { allowFreeText }),
    options: options as DesktopAgentChoice['options'],
    promptId,
    title,
    variant: record.variant,
  }
}

function readAgentRunStatus(value: unknown): DesktopAgentEvent['status'] | null {
  return value === 'idle' ||
    value === 'running' ||
    value === 'awaiting_choice' ||
    value === 'interrupted' ||
    value === 'error'
    ? value
    : null
}

const workspaceSetupFlowSteps = [
  'Synthesis',
  'Floorplan',
  'place',
  'CTS',
  'legalization',
  'Timing optimization',
  'route',
  'drc',
  'lvs',
  'filler',
  'RCX',
  'sta',
  'Harden',
]

function readWorkspaceRerunContract(
  value: unknown,
): DesktopAgentWorkspaceRerunContract | null {
  const record = readRecord(value)
  const sourceWorkspace = readWorkspaceRerunPath(record.source_workspace)
  const targetWorkspace = readWorkspaceRerunPath(record.target_workspace)
  const rerunId = readOptionalIdentifier(record.rerun_id)
  const designId = readOptionalIdentifier(record.design_id)
  const targetStep = record.target_step
  const endStep = record.end_step
  const executionScope = record.execution_scope
  const patch = readWorkspaceRerunPatch(record.parameter_patch)
  const writes =
    record.writes === undefined ||
    (Array.isArray(record.writes) && record.writes.length === 0)
      ? []
      : readWorkspaceParameterWrites(record.writes)
  const sourceStageArtifact = readWorkspaceRerunArtifactReference(
    record.source_stage_artifact,
  )
  const sourceFlowJsonSha256 = readSha256(record.source_flow_json_sha256)
  const sourceStageArtifactSha256 = readSha256(record.source_stage_artifact_sha256)
  if (
    record.schema_version !== 'flow-agent.workspace_rerun_contract.v1' ||
    record.requires_gui_review !== true ||
    !sourceWorkspace ||
    !targetWorkspace ||
    !rerunId ||
    !designId ||
    typeof targetStep !== 'string' ||
    !workspaceSetupFlowSteps.includes(targetStep) ||
    typeof endStep !== 'string' ||
    !workspaceSetupFlowSteps.includes(endStep) ||
    (executionScope !== 'single_step' && executionScope !== 'full_flow') ||
    (executionScope === 'single_step' && endStep !== targetStep) ||
    workspaceSetupFlowSteps.indexOf(endStep) <
      workspaceSetupFlowSteps.indexOf(targetStep) ||
    !patch ||
    !writes ||
    !sourceStageArtifact ||
    !sourceFlowJsonSha256 ||
    !sourceStageArtifactSha256
  ) {
    return null
  }
  return {
    design_id: designId,
    end_step: endStep,
    execution_scope: executionScope,
    parameter_patch: patch,
    writes,
    requires_gui_review: true,
    rerun_id: rerunId,
    schema_version: 'flow-agent.workspace_rerun_contract.v1',
    source_stage_artifact: sourceStageArtifact,
    source_flow_json_sha256: sourceFlowJsonSha256,
    source_stage_artifact_sha256: sourceStageArtifactSha256,
    source_workspace: sourceWorkspace,
    target_step: targetStep,
    target_workspace: targetWorkspace,
  }
}

function readWorkspaceSetupContract(
  value: unknown,
): DesktopAgentWorkspaceSetupContract | null {
  const record = readRecord(value)
  if (
    record.schema_version !== 'flow-agent.workspace_setup_contract.v2' ||
    record.pdk !== 'ics55' ||
    record.requires_gui_review !== true ||
    !readEventText(record.title)
  ) {
    return null
  }
  const parameters = readWorkspaceSetupParameters(record.parameters)
  const flowConfig = readWorkspaceSetupFlowConfig(record.flow_config)
  const setupId = readOptionalIdentifier(record.setup_id)
  const directory = readWorkspaceSetupPath(record.directory)
  const pdkRoot = readWorkspaceSetupPath(record.pdk_root)
  const rtlList = readWorkspaceSetupPathList(record.rtl_list)
  const filelist = readOptionalWorkspaceSetupPath(record.filelist)
  const sdc = readOptionalWorkspaceSetupPath(record.sdc)
  const pdkConfig = readWorkspaceSetupPdkConfig(record.pdk_config)
  const projectContext = readWorkspaceSetupProjectContext(record.project_context)
  if (
    !parameters ||
    !flowConfig ||
    !setupId ||
    !directory ||
    !pdkRoot ||
    !rtlList ||
    filelist === null ||
    sdc === null ||
    !pdkConfig ||
    !projectContext ||
    record.design_input_mode !== 'rtl' ||
    record.pdk_config_mode !== 'default'
  )
    return null
  return {
    design_input_mode: 'rtl',
    directory,
    ...(filelist ? { filelist } : {}),
    flow_config: flowConfig,
    parameters,
    pdk: 'ics55',
    pdk_config: pdkConfig,
    pdk_config_mode: 'default',
    pdk_root: pdkRoot,
    project_context: projectContext,
    requires_gui_review: true,
    rtl_list: rtlList,
    schema_version: 'flow-agent.workspace_setup_contract.v2',
    setup_id: setupId,
    ...(sdc ? { sdc } : {}),
    title: readEventText(record.title) as string,
  }
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
  const density = readFiniteNumber(record.target_density, 0.01, 1)
  const overflow = readFiniteNumber(record.target_overflow, 0, 1)
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
  const utilization = readFiniteNumber(record.utilitization, 0.01, 1)
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

function readWorkspaceSetupPath(value: unknown): string | null {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 4096 &&
    !value.includes('\0')
    ? value
    : null
}

function readWorkspaceRerunPath(value: unknown): string | null {
  const path = readWorkspaceSetupPath(value)
  return path && path.startsWith('/') ? path : null
}

function readSha256(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const digest = value.startsWith('sha256:') ? value.slice('sha256:'.length) : value
  return /^[a-f0-9]{64}$/.test(digest) ? digest : null
}

function readWorkspaceRerunArtifactReference(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > 1024) return null
  const segments = value.split('/')
  return segments.every((segment) => segment && segment !== '.' && segment !== '..')
    ? value
    : null
}

function readWorkspaceRerunPatch(
  value: unknown,
): DesktopAgentWorkspaceRerunContract['parameter_patch'] | null {
  if (!Array.isArray(value) || value.length > 16) return null
  const patch = value.map((item) => {
    const record = readRecord(item)
    const knobId = record.knob_id
    const patchValue = record.value
    if (
      typeof knobId !== 'string' ||
      !/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(knobId) ||
      !isWorkspaceRerunParameterValue(patchValue)
    ) {
      return null
    }
    return { knob_id: knobId, value: patchValue }
  })
  if (patch.some((item) => item === null)) return null
  const normalized = patch as DesktopAgentWorkspaceRerunContract['parameter_patch']
  return new Set(normalized.map((item) => item.knob_id)).size === normalized.length
    ? normalized
    : null
}

function isWorkspaceRerunParameterValue(
  value: unknown,
): value is DesktopAgentWorkspaceRerunContract['parameter_patch'][number]['value'] {
  if (typeof value === 'boolean' || typeof value === 'string') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (!Array.isArray(value) || value.length === 0 || value.length > 128) return false
  return value.every(
    (item) =>
      (typeof item === 'number' && Number.isFinite(item)) || typeof item === 'string',
  )
}

function readOptionalWorkspaceSetupPath(value: unknown): string | undefined | null {
  if (value == null) return undefined
  return readWorkspaceSetupPath(value)
}

function readWorkspaceSetupPathList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length !== 1) return null
  const paths = value.map(readWorkspaceSetupPath)
  return paths.every((path): path is string => path !== null) ? paths : null
}

function readWorkspaceSetupPdkConfig(
  value: unknown,
): DesktopAgentWorkspaceSetupContract['pdk_config'] | null {
  const record = readRecord(value)
  if (
    record.mode !== 'default' ||
    !Array.isArray(record.tech_lef) ||
    !Array.isArray(record.cell_lef) ||
    !Array.isArray(record.liberty) ||
    record.tech_lef.length !== 0 ||
    record.cell_lef.length !== 0 ||
    record.liberty.length !== 0
  )
    return null
  return { cell_lef: [], liberty: [], mode: 'default', tech_lef: [] }
}

function readWorkspaceSetupProjectContext(
  value: unknown,
): DesktopAgentWorkspaceSetupContract['project_context'] | null {
  const record = readRecord(value)
  const projectName = readWorkspaceSetupText(record.project_name)
  const projectRoot = readWorkspaceSetupPath(record.project_root)
  const projectJsonPath = readWorkspaceSetupPath(record.project_json_path)
  if (record.mode !== 'create' || !projectName || !projectRoot || !projectJsonPath)
    return null
  return {
    mode: 'create',
    project_json_path: projectJsonPath,
    project_name: projectName,
    project_root: projectRoot,
  }
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

function readWorkspaceContinueContract(
  value: unknown,
): DesktopAgentWorkspaceContinueContract | null {
  const record = readRecord(value)
  const workspace = readEventText(record.workspace)
  const continueId = readOptionalIdentifier(record.continue_id)
  if (
    record.schema_version !== 'flow-agent.workspace_continue_contract.v1' ||
    !workspace ||
    !continueId ||
    record.rerun !== false
  ) {
    return null
  }
  return {
    continue_id: continueId,
    rerun: false,
    schema_version: 'flow-agent.workspace_continue_contract.v1',
    workspace,
  }
}

function readWorkspaceParameterUpdateContract(
  value: unknown,
): DesktopAgentWorkspaceParameterUpdateContract | null {
  const record = readRecord(value)
  const workspace = readEventText(record.workspace)
  const updateId = readOptionalIdentifier(record.update_id)
  const patch = readWorkspaceRerunPatch(record.parameter_patch)
  const writes = readWorkspaceParameterWrites(record.writes)
  if (
    record.schema_version !== 'flow-agent.workspace_parameter_update_contract.v2' ||
    !workspace ||
    !updateId ||
    !patch ||
    !writes ||
    writes.length !== patch.length
  ) {
    return null
  }
  return {
    parameter_patch: patch,
    schema_version: 'flow-agent.workspace_parameter_update_contract.v2',
    update_id: updateId,
    workspace,
    writes,
  }
}

/**
 * Confines Agent-proposed writes to known parameter files. The Agent resolves
 * the target, but the main process decides which targets are legal at all, so a
 * malformed or hostile proposal cannot reach arbitrary project files.
 */
function readWorkspaceParameterWrites(
  value: unknown,
): DesktopAgentWorkspaceParameterWrite[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) return null
  const writes = value.map((item) => {
    const record = readRecord(item)
    const knobId = record.knob_id
    const file = record.file
    const surface = record.surface
    const jsonPath = record.json_path
    if (
      typeof knobId !== 'string' ||
      !/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(knobId) ||
      typeof file !== 'string' ||
      !(desktopAgentParameterWriteFiles as readonly string[]).includes(file) ||
      (surface !== 'parameters' && surface !== 'step_config') ||
      !isWorkspaceRerunParameterValue(record.value) ||
      !Array.isArray(jsonPath) ||
      jsonPath.length === 0 ||
      jsonPath.length > 8 ||
      !jsonPath.every(
        (segment) =>
          (typeof segment === 'string' && segment.length > 0 && segment.length <= 128) ||
          (typeof segment === 'number' && Number.isInteger(segment) && segment >= 0),
      )
    ) {
      return null
    }
    return {
      file: file as DesktopAgentWorkspaceParameterWrite['file'],
      json_path: jsonPath as (string | number)[],
      knob_id: knobId,
      surface,
      value: record.value,
    }
  })
  if (writes.some((item) => item === null)) return null
  const normalized = writes as DesktopAgentWorkspaceParameterWrite[]
  return new Set(normalized.map((item) => item.knob_id)).size === normalized.length
    ? normalized
    : null
}

function readExecutionContract(value: unknown): DesktopAgentExecutionContract | null {
  const record = readRecord(value)
  const presentation =
    record.presentation === undefined
      ? undefined
      : record.presentation === 'workspace_rerun' ||
          record.presentation === 'workspace_continue' ||
          record.presentation === 'workspace_parameter_update'
        ? record.presentation
        : null
  if (
    record.schema_version !== 'flow-agent.resolved_execution_contract.v1' ||
    !readEventText(record.title) ||
    !Array.isArray(record.fields) ||
    record.fields.length === 0 ||
    record.fields.length > 32 ||
    presentation === null
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
    ...(presentation ? { presentation } : {}),
    schema_version: 'flow-agent.resolved_execution_contract.v1',
    title: readEventText(record.title) as string,
  }
}

function readEventText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096
    ? value
    : null
}
