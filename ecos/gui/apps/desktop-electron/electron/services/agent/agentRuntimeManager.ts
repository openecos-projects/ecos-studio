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
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
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

type OptimizationParent = { workspaceId: string; workspaceRevision: number }
type PendingAuthorization = {
  requestId: string
  confirmOptionId: string
  cancelOptionId: string
  directory: string
  objectiveSha256: string
  alignmentSha256: string
  observed: Promise<{ parent?: OptimizationParent; error?: unknown }>
}

export class AgentRuntimeManager implements AgentProviderRuntime {
  private readonly defaultProviderId: string
  private readonly eventFanout = new RuntimeEventFanout<DesktopAgentEvent>()
  private readonly optimizationEpisodes = new Map<
    string,
    DesktopAgentOptimizationEpisodeSummary
  >()
  private readonly admittedOptimizationEpisodeIds = new Set<string>()
  private readonly pendingAuthorizations = new Map<string, PendingAuthorization>()
  private resolveOptimizationWorkspace?: (
    directory: string,
  ) => Promise<OptimizationParent>
  private reconcileOptimizationStop?: (
    episode: DesktopAgentOptimizationEpisodeSummary,
  ) => Promise<void>
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
    this.updateSessionContext(request)
    return await this.providerForRequest(request).sendMessage(request)
  }

  setOptimizationWorkspaceResolver(
    resolver: (directory: string) => Promise<OptimizationParent>,
  ): void {
    this.resolveOptimizationWorkspace = resolver
  }

  setOptimizationStopReconciler(
    reconcile: (episode: DesktopAgentOptimizationEpisodeSummary) => Promise<void>,
  ): void {
    this.reconcileOptimizationStop = reconcile
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
    const providerId = request.providerId ?? this.defaultProviderId
    const key = this.sessionKey(providerId, request.sessionId)
    const pending = this.pendingAuthorizations.get(key)
    const answer = { ...request, episodeId: undefined }
    if (
      !pending ||
      pending.requestId !== request.requestId ||
      !('optionId' in request) ||
      request.kind !== 'confirm'
    ) {
      return await this.providerForRequest(request).answerInteraction(answer)
    }
    if (request.optionId !== pending.confirmOptionId) {
      const result = await this.providerForRequest(request).answerInteraction(answer)
      this.pendingAuthorizations.delete(key)
      return result
    }
    const resolveParent = this.resolveOptimizationWorkspace
    if (!resolveParent)
      throw new Error('Optimization Workspace verification is unavailable.')
    const observedResult = await pending.observed
    if (!observedResult.parent)
      throw observedResult.error ?? new Error('Optimization Parent is unavailable.')
    const observed = observedResult.parent
    const current = await resolveParent(pending.directory)
    const decline: DesktopAgentInteractionAnswerRequest = {
      kind: 'confirm',
      optionId: pending.cancelOptionId,
      providerId,
      requestId: request.requestId,
      sessionId: request.sessionId,
    }
    // workspaceId is an ECC runtime handle and may be recreated after idle
    // release. The canonical directory plus committed Revision is the Parent
    // identity used for authorization; the current handle is used for dispatch.
    if (observed.workspaceRevision !== current.workspaceRevision) {
      await this.providerForRequest(request).answerInteraction(decline)
      this.pendingAuthorizations.delete(key)
      throw new Error(
        `Optimization Parent Workspace Revision changed (${observed.workspaceRevision} -> ${current.workspaceRevision}). Please propose a new objective.`,
      )
    }
    const conflict = [...this.optimizationEpisodes.values()].find(
      (episode) =>
        !TERMINAL_OPTIMIZATION_STATES.has(episode.state) &&
        (episode.parentWorkspaceId === current.workspaceId ||
          resolve(episode.parentWorkspaceDirectory) === resolve(pending.directory)),
    )
    if (conflict) {
      await this.providerForRequest(request).answerInteraction(decline)
      this.pendingAuthorizations.delete(key)
      return {
        accepted: true,
        requestId: request.requestId,
        sessionId: request.sessionId,
        admissionConflict: { episodeId: conflict.episodeId },
      }
    }
    const episodeId = `episode-${randomUUID().replaceAll('-', '')}`
    const now = Date.now()
    const episode: DesktopAgentOptimizationEpisodeSummary = {
      agentSessionId: request.sessionId,
      episodeId,
      inFlightCount: 0,
      optimization: {
        schema_version: 'ecos.optimization_status.v2',
        episode_id: episodeId,
        workspace: pending.directory,
        objective_sha256: pending.objectiveSha256,
        alignment_sha256: pending.alignmentSha256,
        state: 'starting',
      },
      parentWorkspaceDirectory: pending.directory,
      parentWorkspaceId: current.workspaceId,
      parentWorkspaceRevision: current.workspaceRevision,
      providerId,
      startedAt: now,
      state: 'starting',
      turnCount: 0,
      updatedAt: now,
    }
    this.optimizationEpisodes.set(episodeId, episode)
    this.admittedOptimizationEpisodeIds.add(episodeId)
    if (!this.persistOptimizationProjection()) {
      this.optimizationEpisodes.delete(episodeId)
      throw new Error('Unable to persist Optimization Episode admission.')
    }
    this.optimizationGeneration += 1
    this.sessionContexts.set(key, {
      directory: pending.directory,
      workspaceId: current.workspaceId,
      workspaceRevision: current.workspaceRevision,
    })
    for (const listener of this.optimizationInvalidationListeners)
      listener(this.optimizationGeneration)
    this.pendingAuthorizations.delete(key)
    try {
      return await this.providerForRequest(request).answerInteraction({
        ...answer,
        directory: pending.directory,
        workspaceId: current.workspaceId,
        workspaceRevision: current.workspaceRevision,
        episodeId,
      })
    } catch (error) {
      this.publishOptimizationEpisode({
        ...episode,
        state: 'needs_attention',
        optimization: { ...episode.optimization, state: 'needs_attention' },
        updatedAt: Date.now(),
      })
      throw error
    }
  }

  private updateSessionContext(request: DesktopAgentSendMessageRequest): void {
    const providerId = request.providerId ?? this.defaultProviderId
    const key = this.sessionKey(providerId, request.sessionId)
    const previous = this.sessionContexts.get(key)
    if (previous)
      this.sessionContexts.set(key, {
        directory: request.directory ?? previous.directory,
        workspaceId: request.workspaceId ?? previous.workspaceId,
        workspaceRevision: request.workspaceRevision ?? previous.workspaceRevision,
      })
  }

  async interrupt(request?: DesktopAgentProviderRequest): Promise<void> {
    const sessionId = request && 'sessionId' in request ? request.sessionId : undefined
    if (typeof sessionId === 'string' && sessionId)
      this.pendingAuthorizations.delete(
        this.sessionKey(request?.providerId ?? this.defaultProviderId, sessionId),
      )
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

  async beginOptimizationShutdownDrain(
    workspaceHandles?: readonly string[],
  ): Promise<void> {
    if (this.optimizationShutdownStates.size > 0) return
    const handles = workspaceHandles ? new Set(workspaceHandles) : undefined
    const episodes = [...this.optimizationEpisodes.values()].filter(
      (episode) =>
        DRAINABLE_OPTIMIZATION_STATES.has(episode.state) &&
        (!handles || handles.has(episode.parentWorkspaceId ?? '')),
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
    this.optimizationShutdownStates.clear()
  }

  async stop(request?: DesktopAgentProviderRequest): Promise<void> {
    const sessionId = request && 'sessionId' in request ? request.sessionId : undefined
    if (typeof sessionId === 'string' && sessionId)
      this.pendingAuthorizations.delete(
        this.sessionKey(request?.providerId ?? this.defaultProviderId, sessionId),
      )
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

  isOptimizationParentDirectoryGuarded(directory: string): boolean {
    const target = resolve(directory)
    return [...this.optimizationEpisodes.values()].some(
      (episode) =>
        resolve(episode.parentWorkspaceDirectory) === target &&
        !TERMINAL_OPTIMIZATION_STATES.has(episode.state),
    )
  }

  rebindOptimizationEpisode(
    episodeId: string,
    workspaceId: string,
    workspaceRevision: number,
    directory: string,
  ): void {
    const episode = this.optimizationEpisodes.get(episodeId)
    if (!episode || TERMINAL_OPTIMIZATION_STATES.has(episode.state)) return
    this.publishOptimizationEpisode({
      ...episode,
      parentWorkspaceDirectory: directory,
      parentWorkspaceId: workspaceId,
      parentWorkspaceRevision: workspaceRevision,
      updatedAt: Date.now(),
    })
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
    if (request.action === 'resume' && episode.state === 'interrupted') {
      if (
        !this.optimizationShutdownStates.has(episode.episodeId) &&
        !this.hasOptimizationRecoveryContext(episode)
      ) {
        throw new Error(
          'Optimization Episode recovery context is missing or incompatible.',
        )
      }
      if (
        !episode.parentWorkspaceId ||
        episode.parentWorkspaceRevision === undefined ||
        !episode.parentWorkspaceDirectory
      ) {
        throw new Error('Optimization Episode recovery context is incomplete.')
      }
      if (this.resolveOptimizationWorkspace) {
        const current = await this.resolveOptimizationWorkspace(
          episode.parentWorkspaceDirectory,
        )
        if (current.workspaceRevision !== episode.parentWorkspaceRevision) {
          throw new Error(
            'Optimization Parent Workspace changed; Resume requires a fresh recovery context.',
          )
        }
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
    if (request.action === 'stop' && !TERMINAL_OPTIMIZATION_STATES.has(episode.state)) {
      if (
        episode.state !== 'interrupted' &&
        episode.state !== 'needs_attention' &&
        episode.parentWorkspaceId &&
        episode.parentWorkspaceRevision !== undefined &&
        episode.parentWorkspaceDirectory
      ) {
        try {
          await provider.stopOptimizationEpisode({
            directory: episode.parentWorkspaceDirectory,
            episodeId: episode.episodeId,
            providerId,
            sessionId: episode.agentSessionId,
            workspaceId: episode.parentWorkspaceId,
            workspaceRevision: episode.parentWorkspaceRevision,
          })
          return
        } catch {
          // A dead provider falls through to ECC evidence reconciliation.
        }
      }
      if (!this.reconcileOptimizationStop) {
        throw new Error(
          'ECC Operation reconciliation is unavailable; Parent remains guarded.',
        )
      }
      try {
        await this.reconcileOptimizationStop(episode)
      } catch (error) {
        this.publishOptimizationEpisode({
          ...episode,
          state: 'needs_attention',
          optimization: { ...episode.optimization, state: 'needs_attention' },
          updatedAt: Date.now(),
        })
        throw error
      }
      this.publishOptimizationEpisode(
        {
          ...episode,
          state: 'stopped',
          optimization: { ...episode.optimization, state: 'stopped' },
          notificationStates: [
            ...new Set([...(episode.notificationStates ?? []), 'stopped' as const]),
          ],
          cleanupState: 'available',
          updatedAt: Date.now(),
        },
        true,
      )
      return
    }
    if (request.action === 'retry') {
      throw new Error(
        'No independently verified recovery source exists for this Episode; Parent remains guarded.',
      )
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
    if (
      event.type === 'interaction' &&
      event.interaction?.optimizationAuthorization &&
      event.interaction.status === 'pending' &&
      event.sessionId &&
      event.providerId
    ) {
      const authorization = event.interaction.optimizationAuthorization
      const choice = event.interaction.interaction
      const resolver = this.resolveOptimizationWorkspace
      if (choice.kind === 'confirm' && resolver && authorization.workspace) {
        const key = this.sessionKey(event.providerId, event.sessionId)
        this.pendingAuthorizations.set(key, {
          requestId: event.interaction.requestId,
          confirmOptionId: choice.confirm.id,
          cancelOptionId: choice.cancel.id,
          directory: authorization.workspace,
          objectiveSha256: authorization.objective_sha256,
          alignmentSha256: authorization.alignment_sha256,
          observed: resolver(authorization.workspace).then(
            (parent) => ({ parent }),
            (error: unknown) => ({ error }),
          ),
        })
      }
    }
    const payload = event.optimization
    const providerId = event.providerId
    const sessionId = event.sessionId
    if (event.type !== 'optimization' || !payload || !providerId || !sessionId)
      return true
    if (payload.state === 'awaiting_confirmation') return false
    const context = this.sessionContexts.get(this.sessionKey(providerId, sessionId))
    const previous = this.optimizationEpisodes.get(payload.episode_id)
    if (!previous && !this.admittedOptimizationEpisodeIds.has(payload.episode_id))
      return false
    if (
      previous &&
      (previous.providerId !== providerId || previous.agentSessionId !== sessionId)
    )
      return false
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
    requirePersistence = false,
  ): void {
    const previous = this.optimizationEpisodes.get(episode.episodeId)
    this.optimizationEpisodes.set(episode.episodeId, episode)
    if (!this.persistOptimizationProjection() && requirePersistence) {
      if (previous) this.optimizationEpisodes.set(episode.episodeId, previous)
      else this.optimizationEpisodes.delete(episode.episodeId)
      throw new Error(
        'Unable to persist Optimization Episode outcome; Parent remains guarded.',
      )
    }
    this.optimizationGeneration += 1
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
      let discardedLegacyConfirmation = false
      for (const candidate of value.episodes.slice(-MAX_OPTIMIZATION_EPISODES)) {
        if (
          isRecord(candidate) &&
          isRecord(candidate.optimization) &&
          candidate.optimization.phase === 'awaiting_confirmation'
        ) {
          discardedLegacyConfirmation = true
          continue
        }
        const episode = readOptimizationEpisodeSummary(candidate)
        if (!episode) continue
        const state = TERMINAL_OPTIMIZATION_STATES.has(episode.state)
          ? episode.state
          : this.hasOptimizationRecoveryContext(episode)
            ? 'interrupted'
            : 'needs_attention'
        this.optimizationEpisodes.set(episode.episodeId, {
          ...episode,
          optimization: { ...episode.optimization, state },
          state,
        })
        this.admittedOptimizationEpisodeIds.add(episode.episodeId)
      }
      if (this.optimizationEpisodes.size > 0 || discardedLegacyConfirmation) {
        this.optimizationGeneration = 1
        this.persistOptimizationProjection()
      }
    } catch {
      // A missing or invalid UI projection never overrides the optimization ledger.
    }
  }

  private hasOptimizationRecoveryContext(
    episode: DesktopAgentOptimizationEpisodeSummary,
  ): boolean {
    if (!/^episode-[a-zA-Z0-9_-]{1,120}$/.test(episode.episodeId)) return false
    try {
      const path = resolve(
        episode.parentWorkspaceDirectory,
        '.agent',
        'optimization',
        episode.episodeId,
        'provider-resume-context.v1.json',
      )
      if (statSync(path).size > MAX_OPTIMIZATION_PROJECTION_BYTES) return false
      const context = JSON.parse(readFileSync(path, 'utf8')) as unknown
      return (
        isRecord(context) &&
        context.schema_version === 'ecos.optimization_provider_resume.v1' &&
        context.session_id === episode.agentSessionId &&
        context.episode_id === episode.episodeId &&
        context.workspace === resolve(episode.parentWorkspaceDirectory) &&
        context.workspace_revision === episode.parentWorkspaceRevision &&
        isRecord(context.objective) &&
        isRecord(context.objective_alignment) &&
        context.objective_sha256 === episode.optimization.objective_sha256 &&
        typeof context.parameter_policy_sha256 === 'string' &&
        typeof context.ecc_revision === 'string' &&
        Boolean(context.ecc_revision)
      )
    } catch {
      return false
    }
  }

  private persistOptimizationProjection(): boolean {
    const path = this.optimizationProjectionPath
    if (!path) return true
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
      return true
    } catch {
      // Projection persistence failure cannot change Runtime or ledger outcomes.
      return false
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
