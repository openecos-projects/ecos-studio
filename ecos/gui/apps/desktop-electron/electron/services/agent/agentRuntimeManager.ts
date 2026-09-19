import type {
  DesktopAgentEvent,
  DesktopAgentInteractionAnswerRequest,
  DesktopAgentInteractionAnswerResponse,
  DesktopAgentInterruptRequest,
  DesktopAgentListSessionsRequest,
  DesktopAgentListSessionsResponse,
  DesktopAgentModelSettings,
  DesktopAgentModelSettingsRequest,
  DesktopAgentProviderRequest,
  DesktopAgentResumeSessionRequest,
  DesktopAgentResumeSessionResponse,
  DesktopAgentSendMessageRequest,
  DesktopAgentSendMessageResponse,
  DesktopAgentSetModelSettingsRequest,
  DesktopAgentSetModeRequest,
  DesktopAgentStartRequest,
  DesktopAgentStartSessionRequest,
  DesktopAgentStartSessionResponse,
  DesktopAgentStatus,
  DesktopAgentOptimizationEpisodeControlRequest,
  DesktopAgentOptimizationEpisodeNotificationAckRequest,
  DesktopAgentOptimizationEpisodeNotificationState,
  DesktopAgentOptimizationEpisodeResumeRequest,
  DesktopAgentOptimizationEpisodeProjection,
  DesktopAgentOptimizationEpisodeState,
  DesktopAgentOptimizationEpisodeSummary,
} from '@ecos-studio/shared'
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AgentProviderRuntime } from './agentProviderContract'
import { RuntimeEventFanout } from '../runtime/runtimeEvents'

export interface AgentRuntimeProviderRegistration {
  providerId: string
  runtime: AgentProviderRuntime
}

export interface AgentRuntimeManagerOptions {
  defaultProviderId?: string
  optimizationProjectionPath?: string
  providers: AgentRuntimeProviderRegistration[]
}

export class AgentRuntimeManager implements AgentProviderRuntime {
  private readonly defaultProviderId: string
  private readonly eventFanout = new RuntimeEventFanout<DesktopAgentEvent>()
  private readonly optimizationEpisodes = new Map<
    string,
    DesktopAgentOptimizationEpisodeSummary
  >()
  private readonly optimizationInvalidationListeners = new Set<
    (generation: number) => void
  >()
  private readonly optimizationAdmissionConflicts = new Map<
    string,
    DesktopAgentOptimizationEpisodeSummary
  >()
  private readonly optimizationShutdownStates = new Map<
    string,
    DesktopAgentOptimizationEpisodeState
  >()
  private optimizationGeneration = 0
  private readonly optimizationProjectionPath?: string
  private readonly providers = new Map<string, AgentProviderRuntime>()
  private readonly sessionContexts = new Map<
    string,
    {
      directory: string
      workspaceId?: string
      workspaceRevision?: number
    }
  >()

  constructor(provider: AgentProviderRuntime)
  constructor(options: AgentRuntimeManagerOptions)
  constructor(input: AgentProviderRuntime | AgentRuntimeManagerOptions) {
    const options = isAgentRuntimeManagerOptions(input)
      ? input
      : {
          defaultProviderId: 'codex',
          providers: [
            {
              providerId: 'codex',
              runtime: input,
            },
          ],
        }
    if (options.providers.length === 0) {
      throw new Error('AgentRuntimeManager requires at least one provider')
    }
    this.optimizationProjectionPath = options.optimizationProjectionPath
    this.restoreOptimizationProjection()

    for (const { providerId, runtime } of options.providers) {
      if (this.providers.has(providerId)) {
        throw new Error(`Duplicate agent provider: ${providerId}`)
      }
      this.providers.set(providerId, runtime)
    }

    this.defaultProviderId = options.defaultProviderId ?? options.providers[0].providerId
    if (!this.providers.has(this.defaultProviderId)) {
      throw new Error(`Unknown default agent provider: ${this.defaultProviderId}`)
    }

    for (const { providerId, runtime } of options.providers) {
      runtime.onEvent((event) => {
        const attributed = {
          ...event,
          providerId,
        }
        if (!this.observeOptimizationEvent(attributed)) return
        if (this.cancelConflictingOptimizationInteraction(attributed)) return
        this.eventFanout.emit(attributed)
      })
    }
  }

  async start(request?: DesktopAgentStartRequest): Promise<void> {
    return await this.providerForRequest(request).start(request)
  }

  async startSession(
    request: DesktopAgentStartSessionRequest,
  ): Promise<DesktopAgentStartSessionResponse> {
    const providerId = request.providerId ?? this.defaultProviderId
    const result = await this.providerForRequest(request).startSession(request)
    const context = {
      directory: request.directory ?? '',
      ...(request.workspaceId ? { workspaceId: request.workspaceId } : {}),
      ...(request.workspaceRevision !== undefined
        ? { workspaceRevision: request.workspaceRevision }
        : {}),
    }
    this.sessionContexts.set(this.sessionKey(providerId, result.sessionId), context)
    const recoveredEpisode = [...this.optimizationEpisodes.values()].find(
      (episode) =>
        episode.providerId === providerId &&
        episode.agentSessionId === result.sessionId &&
        !TERMINAL_OPTIMIZATION_STATES.has(episode.state),
    )
    if (recoveredEpisode) {
      this.publishOptimizationEpisode({
        ...recoveredEpisode,
        parentWorkspaceDirectory:
          context.directory || recoveredEpisode.parentWorkspaceDirectory,
        ...(context.workspaceId ? { parentWorkspaceId: context.workspaceId } : {}),
        ...(context.workspaceRevision !== undefined
          ? { parentWorkspaceRevision: context.workspaceRevision }
          : {}),
        updatedAt: Date.now(),
      })
    }
    return result
  }

  async sendMessage(
    request: DesktopAgentSendMessageRequest,
  ): Promise<DesktopAgentSendMessageResponse> {
    return await this.providerForRequest(request).sendMessage(request)
  }

  async getModelSettings(
    request: DesktopAgentModelSettingsRequest,
  ): Promise<DesktopAgentModelSettings> {
    return await this.providerForRequest(request).getModelSettings(request)
  }

  async setModelSettings(
    request: DesktopAgentSetModelSettingsRequest,
  ): Promise<DesktopAgentModelSettings> {
    return await this.providerForRequest(request).setModelSettings(request)
  }

  async answerInteraction(
    request: DesktopAgentInteractionAnswerRequest,
  ): Promise<DesktopAgentInteractionAnswerResponse> {
    return await this.providerForRequest(request).answerInteraction(request)
  }

  async interrupt(request?: DesktopAgentProviderRequest): Promise<void> {
    return await this.providerForRequest(request).interrupt(request)
  }

  async getStatus(request?: DesktopAgentProviderRequest): Promise<DesktopAgentStatus> {
    return await this.providerForRequest(request).getStatus(request)
  }

  async setMode(request: DesktopAgentSetModeRequest): Promise<DesktopAgentStatus> {
    return await this.providerForRequest(request).setMode(request)
  }

  async listSessions(
    request: DesktopAgentListSessionsRequest,
  ): Promise<DesktopAgentListSessionsResponse> {
    return await this.providerForRequest(request).listSessions(request)
  }

  async resumeSession(
    request: DesktopAgentResumeSessionRequest,
  ): Promise<DesktopAgentResumeSessionResponse> {
    return await this.providerForRequest(request).resumeSession(request)
  }

  async resumeOptimizationEpisode(
    request: DesktopAgentOptimizationEpisodeResumeRequest,
  ): Promise<void> {
    return await this.providerForRequest(request).resumeOptimizationEpisode(request)
  }

  async stopOptimizationEpisode(
    request: DesktopAgentOptimizationEpisodeResumeRequest,
  ): Promise<void> {
    return await this.providerForRequest(request).stopOptimizationEpisode(request)
  }

  acknowledgeOptimizationEpisodeNotification(
    request: DesktopAgentOptimizationEpisodeNotificationAckRequest,
  ): void {
    const episode = this.optimizationEpisodes.get(request.episodeId)
    if (
      !episode ||
      episode.providerId !== (request.providerId ?? this.defaultProviderId) ||
      episode.agentSessionId !== request.sessionId
    ) {
      throw new Error('Optimization Episode is unavailable for this Agent Session.')
    }
    const previous = episode.notificationStates ?? []
    const notificationStates = previous.filter((state) => state !== request.state)
    if (notificationStates.length === previous.length) return
    this.publishOptimizationEpisode({
      ...episode,
      notificationStates,
      updatedAt: Date.now(),
    })
  }

  markOptimizationEpisodeCleaned(episodeId: string): void {
    const episode = this.optimizationEpisodes.get(episodeId)
    if (!episode || !TERMINAL_OPTIMIZATION_STATES.has(episode.state)) {
      throw new Error('Optimization cleanup requires a terminal Episode.')
    }
    if (episode.cleanupState === 'completed') return
    this.publishOptimizationEpisode({
      ...episode,
      cleanupState: 'completed',
      updatedAt: Date.now(),
    })
  }

  async prepareOptimizationShutdown(
    request: DesktopAgentInterruptRequest,
  ): Promise<void> {
    return await this.providerForRequest(request).prepareOptimizationShutdown(request)
  }

  async cancelOptimizationShutdown(request: DesktopAgentInterruptRequest): Promise<void> {
    return await this.providerForRequest(request).cancelOptimizationShutdown(request)
  }

  async beginOptimizationShutdownDrain(): Promise<void> {
    if (this.optimizationShutdownStates.size > 0) return
    const episodes = [...this.optimizationEpisodes.values()].filter((episode) =>
      DRAINABLE_OPTIMIZATION_STATES.has(episode.state),
    )
    for (const episode of episodes) {
      this.optimizationShutdownStates.set(episode.episodeId, episode.state)
    }
    await Promise.all(
      episodes.map((episode) =>
        this.providerForRequest({
          providerId: episode.providerId,
        }).prepareOptimizationShutdown({
          providerId: episode.providerId,
          sessionId: episode.agentSessionId,
        }),
      ),
    )
  }

  async cancelOptimizationShutdownDrain(): Promise<void> {
    const previousStates = [...this.optimizationShutdownStates]
    this.optimizationShutdownStates.clear()
    await Promise.all(
      previousStates.map(async ([episodeId, previousState]) => {
        const episode = this.optimizationEpisodes.get(episodeId)
        if (!episode || TERMINAL_OPTIMIZATION_STATES.has(episode.state)) return
        if (episode.state === 'interrupted') {
          await this.controlOptimizationEpisode({
            action: 'resume',
            episodeId,
            providerId: episode.providerId,
            sessionId: episode.agentSessionId,
          })
          if (previousState === 'paused') {
            await this.providerForRequest({ providerId: episode.providerId }).sendMessage(
              {
                message: 'pause',
                providerId: episode.providerId,
                sessionId: episode.agentSessionId,
              },
            )
          }
          return
        }
        await this.providerForRequest({
          providerId: episode.providerId,
        }).cancelOptimizationShutdown({
          providerId: episode.providerId,
          sessionId: episode.agentSessionId,
        })
      }),
    )
  }

  async stop(request?: DesktopAgentProviderRequest): Promise<void> {
    return await this.providerForRequest(request).stop(request)
  }

  onEvent(listener: (event: DesktopAgentEvent) => void): () => void {
    return this.eventFanout.onEvent(listener)
  }

  optimizationProjection(): DesktopAgentOptimizationEpisodeProjection {
    return {
      episodes: [...this.optimizationEpisodes.values()]
        .sort((left, right) => left.startedAt - right.startedAt)
        .map((episode) => ({
          ...episode,
          optimization: { ...episode.optimization },
        })),
      generation: this.optimizationGeneration,
    }
  }

  onOptimizationProjectionInvalidated(
    listener: (generation: number) => void,
  ): () => void {
    this.optimizationInvalidationListeners.add(listener)
    return () => this.optimizationInvalidationListeners.delete(listener)
  }

  isOptimizationParentGuarded(workspaceId: string): boolean {
    return [...this.optimizationEpisodes.values()].some(
      (episode) =>
        episode.parentWorkspaceId === workspaceId &&
        !TERMINAL_OPTIMIZATION_STATES.has(episode.state),
    )
  }

  async controlOptimizationEpisode(
    request: DesktopAgentOptimizationEpisodeControlRequest,
  ): Promise<void> {
    const providerId = request.providerId ?? this.defaultProviderId
    const episode = this.optimizationEpisodes.get(request.episodeId)
    if (
      !episode ||
      episode.providerId !== providerId ||
      episode.agentSessionId !== request.sessionId
    ) {
      throw new Error('Optimization Episode is unavailable for this Agent Session.')
    }
    const provider = this.providerForRequest(request)
    if (
      (request.action === 'resume' && episode.state === 'interrupted') ||
      (request.action === 'retry' && episode.state === 'needs_attention')
    ) {
      if (
        !episode.parentWorkspaceId ||
        episode.parentWorkspaceRevision === undefined ||
        !episode.parentWorkspaceDirectory
      ) {
        throw new Error('Optimization Episode recovery context is incomplete.')
      }
      await provider.resumeOptimizationEpisode({
        directory: episode.parentWorkspaceDirectory,
        episodeId: episode.episodeId,
        providerId,
        sessionId: episode.agentSessionId,
        workspaceId: episode.parentWorkspaceId,
        workspaceRevision: episode.parentWorkspaceRevision,
      })
      this.sessionContexts.set(this.sessionKey(providerId, episode.agentSessionId), {
        directory: episode.parentWorkspaceDirectory,
        workspaceId: episode.parentWorkspaceId,
        workspaceRevision: episode.parentWorkspaceRevision,
      })
      return
    }
    if (
      request.action === 'stop' &&
      (episode.state === 'interrupted' || episode.state === 'needs_attention')
    ) {
      if (
        !episode.parentWorkspaceId ||
        episode.parentWorkspaceRevision === undefined ||
        !episode.parentWorkspaceDirectory
      ) {
        throw new Error('Optimization Episode recovery context is incomplete.')
      }
      await provider.stopOptimizationEpisode({
        directory: episode.parentWorkspaceDirectory,
        episodeId: episode.episodeId,
        providerId,
        sessionId: episode.agentSessionId,
        workspaceId: episode.parentWorkspaceId,
        workspaceRevision: episode.parentWorkspaceRevision,
      })
      return
    }
    if (request.action === 'retry') {
      throw new Error('Optimization Retry is unavailable in the current Episode state.')
    }
    await provider.sendMessage({
      message: request.action,
      providerId,
      sessionId: request.sessionId,
    })
  }

  syncEnvironmentOverrides(
    overrides: Record<string, string | undefined>,
    request?: DesktopAgentProviderRequest,
  ): void {
    const provider = this.providerForRequest(request)
    if (
      'syncEnvironmentOverrides' in provider &&
      typeof provider.syncEnvironmentOverrides === 'function'
    ) {
      provider.syncEnvironmentOverrides(overrides)
    }
  }

  private providerForRequest(
    request?: DesktopAgentProviderRequest,
  ): AgentProviderRuntime {
    const providerId = request?.providerId ?? this.defaultProviderId
    const provider = this.providers.get(providerId)
    if (!provider) {
      throw new Error(`Unknown agent provider: ${providerId}`)
    }
    return provider
  }

  private observeOptimizationEvent(event: DesktopAgentEvent): boolean {
    const payload = event.optimization
    const providerId = event.providerId
    const sessionId = event.sessionId
    if (event.type !== 'optimization' || !payload || !providerId || !sessionId)
      return true
    const context = this.sessionContexts.get(this.sessionKey(providerId, sessionId))
    const previous = this.optimizationEpisodes.get(payload.episode_id)
    const parentWorkspaceId = context?.workspaceId ?? previous?.parentWorkspaceId
    const parentWorkspaceDirectory =
      payload.workspace ?? context?.directory ?? previous?.parentWorkspaceDirectory ?? ''
    const conflict = [...this.optimizationEpisodes.values()].find(
      (episode) =>
        episode.episodeId !== payload.episode_id &&
        !TERMINAL_OPTIMIZATION_STATES.has(episode.state) &&
        ((parentWorkspaceId !== undefined &&
          episode.parentWorkspaceId === parentWorkspaceId) ||
          (parentWorkspaceDirectory !== '' &&
            episode.parentWorkspaceDirectory === parentWorkspaceDirectory)),
    )
    if (conflict) {
      this.optimizationAdmissionConflicts.set(
        this.sessionKey(providerId, sessionId),
        conflict,
      )
      this.eventFanout.emit({
        providerId,
        sessionId,
        text: `Parent Workspace already has active Optimization Episode ${conflict.episodeId}. Open Agent Progress from Background Tasks.`,
        type: 'error',
      })
      return false
    }
    this.optimizationAdmissionConflicts.delete(this.sessionKey(providerId, sessionId))
    const now = Date.now()
    const state = optimizationEpisodeState(payload.state, previous?.state)
    const notificationStates =
      previous?.state === state
        ? previous.notificationStates
        : NOTIFICATION_OPTIMIZATION_STATES.has(state)
          ? [
              ...new Set([
                ...(previous?.notificationStates ?? []),
                state as DesktopAgentOptimizationEpisodeNotificationState,
              ]),
            ]
          : previous?.notificationStates
    this.publishOptimizationEpisode({
      agentSessionId: sessionId,
      episodeId: payload.episode_id,
      inFlightCount: payload.in_flight ?? previous?.inFlightCount ?? 0,
      optimization: payload,
      parentWorkspaceDirectory,
      ...(context?.workspaceId || previous?.parentWorkspaceId
        ? { parentWorkspaceId: context?.workspaceId ?? previous?.parentWorkspaceId }
        : {}),
      ...(context?.workspaceRevision !== undefined ||
      previous?.parentWorkspaceRevision !== undefined
        ? {
            parentWorkspaceRevision:
              context?.workspaceRevision ?? previous?.parentWorkspaceRevision,
          }
        : {}),
      providerId,
      startedAt: previous?.startedAt ?? now,
      state,
      turnCount: Math.max(
        payload.turn_count ?? payload.turn ?? 0,
        previous?.turnCount ?? 0,
      ),
      updatedAt: now,
      ...(notificationStates ? { notificationStates } : {}),
      ...(TERMINAL_OPTIMIZATION_STATES.has(state)
        ? { cleanupState: previous?.cleanupState ?? 'available' }
        : {}),
    })
    return true
  }

  private cancelConflictingOptimizationInteraction(event: DesktopAgentEvent): boolean {
    const providerId = event.providerId
    const sessionId = event.sessionId
    if (event.type !== 'interaction' || !event.interaction || !providerId || !sessionId) {
      return false
    }
    const key = this.sessionKey(providerId, sessionId)
    if (!this.optimizationAdmissionConflicts.has(key)) return false
    const interaction = event.interaction
    const cancelOptionId =
      interaction.interaction.kind === 'confirm'
        ? interaction.interaction.cancel.id
        : interaction.interaction.kind === 'choice'
          ? interaction.interaction.options.find((option) =>
              /^(cancel|取消)$/i.test(option.label.trim()),
            )?.id
          : undefined
    if (!cancelOptionId) return false
    void this.providerForRequest({ providerId })
      .answerInteraction({
        kind: interaction.kind as 'choice' | 'confirm',
        optionId: cancelOptionId,
        providerId,
        requestId: interaction.requestId,
        sessionId,
      })
      .then(() => this.optimizationAdmissionConflicts.delete(key))
      .catch(() => undefined)
    return true
  }

  private publishOptimizationEpisode(
    episode: DesktopAgentOptimizationEpisodeSummary,
  ): void {
    this.optimizationEpisodes.set(episode.episodeId, episode)
    this.optimizationGeneration += 1
    this.persistOptimizationProjection()
    for (const listener of this.optimizationInvalidationListeners) {
      listener(this.optimizationGeneration)
    }
  }

  private sessionKey(providerId: string, sessionId: string): string {
    return `${providerId}\u0000${sessionId}`
  }

  private restoreOptimizationProjection(): void {
    const path = this.optimizationProjectionPath
    if (!path) return
    try {
      if (statSync(path).size > MAX_OPTIMIZATION_PROJECTION_BYTES) return
      const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
      if (!isRecord(value) || value.schemaVersion !== OPTIMIZATION_PROJECTION_SCHEMA)
        return
      if (!Array.isArray(value.episodes)) return
      for (const candidate of value.episodes.slice(-MAX_OPTIMIZATION_EPISODES)) {
        const episode = readOptimizationEpisodeSummary(candidate)
        if (!episode) continue
        const state = TERMINAL_OPTIMIZATION_STATES.has(episode.state)
          ? episode.state
          : 'interrupted'
        this.optimizationEpisodes.set(episode.episodeId, {
          ...episode,
          optimization: { ...episode.optimization, state },
          state,
        })
      }
      if (this.optimizationEpisodes.size > 0) {
        this.optimizationGeneration = 1
        this.persistOptimizationProjection()
      }
    } catch {
      // A missing or invalid UI projection never overrides the optimization ledger.
    }
  }

  private persistOptimizationProjection(): void {
    const path = this.optimizationProjectionPath
    if (!path) return
    const episodes = [...this.optimizationEpisodes.values()]
    const active = episodes.filter(
      (episode) => !TERMINAL_OPTIMIZATION_STATES.has(episode.state),
    )
    const terminal = episodes
      .filter((episode) => TERMINAL_OPTIMIZATION_STATES.has(episode.state))
      .sort((left, right) => left.updatedAt - right.updatedAt)
      .slice(-(MAX_OPTIMIZATION_EPISODES - active.length))
    try {
      mkdirSync(dirname(path), { recursive: true })
      const temporaryPath = `${path}.tmp`
      writeFileSync(
        temporaryPath,
        `${JSON.stringify({
          episodes: [...active, ...terminal],
          schemaVersion: OPTIMIZATION_PROJECTION_SCHEMA,
        })}\n`,
        'utf8',
      )
      renameSync(temporaryPath, path)
    } catch {
      // Projection persistence failure cannot change Runtime or ledger outcomes.
    }
  }
}

const OPTIMIZATION_PROJECTION_SCHEMA = 'ecos.agent_optimization_projection.v1'
const MAX_OPTIMIZATION_EPISODES = 64
const MAX_OPTIMIZATION_PROJECTION_BYTES = 1024 * 1024
const TERMINAL_OPTIMIZATION_STATES = new Set<DesktopAgentOptimizationEpisodeState>([
  'completed',
  'stopped',
  'failed',
])
const DRAINABLE_OPTIMIZATION_STATES = new Set<DesktopAgentOptimizationEpisodeState>([
  'starting',
  'calibrating',
  'running',
  'paused',
])
const NOTIFICATION_OPTIMIZATION_STATES = new Set<DesktopAgentOptimizationEpisodeState>([
  'completed',
  'needs_attention',
  'interrupted',
  'stopped',
])

function optimizationEpisodeState(
  value: string | undefined,
  fallback: DesktopAgentOptimizationEpisodeState | undefined,
): DesktopAgentOptimizationEpisodeState {
  switch (value) {
    case 'awaiting_confirmation':
    case 'starting':
    case 'calibrating':
    case 'running':
    case 'paused':
    case 'stopping':
    case 'needs_attention':
    case 'interrupted':
    case 'completed':
    case 'stopped':
      return value
    case 'error':
    case 'escalated':
    case 'quarantined':
    case 'unavailable':
      return 'failed'
    default:
      return fallback ?? 'starting'
  }
}

function readOptimizationEpisodeSummary(
  value: unknown,
): DesktopAgentOptimizationEpisodeSummary | null {
  if (!isRecord(value) || !isRecord(value.optimization)) return null
  const state = optimizationEpisodeState(
    typeof value.state === 'string' ? value.state : undefined,
    undefined,
  )
  if (
    typeof value.agentSessionId !== 'string' ||
    !value.agentSessionId ||
    typeof value.episodeId !== 'string' ||
    !value.episodeId ||
    typeof value.providerId !== 'string' ||
    !value.providerId ||
    typeof value.parentWorkspaceDirectory !== 'string' ||
    typeof value.startedAt !== 'number' ||
    !Number.isFinite(value.startedAt) ||
    typeof value.updatedAt !== 'number' ||
    !Number.isFinite(value.updatedAt) ||
    typeof value.inFlightCount !== 'number' ||
    !Number.isSafeInteger(value.inFlightCount) ||
    value.inFlightCount < 0 ||
    typeof value.turnCount !== 'number' ||
    !Number.isSafeInteger(value.turnCount) ||
    value.turnCount < 0 ||
    typeof value.optimization.episode_id !== 'string' ||
    value.optimization.episode_id !== value.episodeId ||
    typeof value.optimization.schema_version !== 'string'
  ) {
    return null
  }
  if (
    value.cleanupState !== undefined &&
    value.cleanupState !== 'available' &&
    value.cleanupState !== 'completed'
  ) {
    return null
  }
  if (
    value.notificationStates !== undefined &&
    (!Array.isArray(value.notificationStates) ||
      value.notificationStates.some(
        (state) =>
          typeof state !== 'string' ||
          !NOTIFICATION_OPTIMIZATION_STATES.has(
            state as DesktopAgentOptimizationEpisodeState,
          ),
      ))
  ) {
    return null
  }
  if (
    value.parentWorkspaceId !== undefined &&
    typeof value.parentWorkspaceId !== 'string'
  ) {
    return null
  }
  if (
    value.parentWorkspaceRevision !== undefined &&
    (!Number.isSafeInteger(value.parentWorkspaceRevision) ||
      Number(value.parentWorkspaceRevision) < 1)
  ) {
    return null
  }
  return {
    agentSessionId: value.agentSessionId,
    episodeId: value.episodeId,
    inFlightCount: value.inFlightCount,
    optimization:
      value.optimization as unknown as DesktopAgentOptimizationEpisodeSummary['optimization'],
    parentWorkspaceDirectory: value.parentWorkspaceDirectory,
    ...(value.parentWorkspaceId ? { parentWorkspaceId: value.parentWorkspaceId } : {}),
    ...(value.parentWorkspaceRevision !== undefined
      ? { parentWorkspaceRevision: Number(value.parentWorkspaceRevision) }
      : {}),
    ...(Array.isArray(value.notificationStates)
      ? {
          notificationStates: [...value.notificationStates] as NonNullable<
            DesktopAgentOptimizationEpisodeSummary['notificationStates']
          >,
        }
      : {}),
    ...(value.cleanupState ? { cleanupState: value.cleanupState } : {}),
    providerId: value.providerId,
    startedAt: value.startedAt,
    state,
    turnCount: value.turnCount,
    updatedAt: value.updatedAt,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isAgentRuntimeManagerOptions(
  input: AgentProviderRuntime | AgentRuntimeManagerOptions,
): input is AgentRuntimeManagerOptions {
  return Array.isArray((input as AgentRuntimeManagerOptions).providers)
}
