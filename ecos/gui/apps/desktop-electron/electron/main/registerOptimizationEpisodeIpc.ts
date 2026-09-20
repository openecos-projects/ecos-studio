import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import {
  desktopApiEventChannels,
  desktopApiIpcChannels,
  type DesktopAgentOptimizationEpisodeControlRequest,
  type DesktopAgentOptimizationEpisodeNotificationAckRequest,
  type DesktopAgentOptimizationEpisodeProjection,
  type DesktopAgentStartSessionRequest,
  type ProductCommandRequest,
} from '@ecos-studio/shared'
import type { AgentProviderRuntime } from '../services/agent/agentProviderContract'
import { normalizeWorkspacePath } from '../services/workspacePath'

type Sender = IpcMainInvokeEvent['sender']
type EpisodeControlRequest = DesktopAgentOptimizationEpisodeControlRequest
type EpisodeAckRequest = DesktopAgentOptimizationEpisodeNotificationAckRequest
type EpisodePayload = Extract<
  ProductCommandRequest,
  { command: 'optimization.adoptCandidate' }
>['payload']
type CleanupPayload = Extract<
  ProductCommandRequest,
  { command: 'optimization.cleanup' }
>['payload']

interface EpisodeRuntime extends AgentProviderRuntime {
  controlOptimizationEpisode?(request: EpisodeControlRequest): Promise<void>
  acknowledgeOptimizationEpisodeNotification?(request: EpisodeAckRequest): void
  optimizationProjection?(): DesktopAgentOptimizationEpisodeProjection
  onOptimizationProjectionInvalidated?(listener: (generation: number) => void): () => void
  rebindOptimizationEpisode?(
    episodeId: string,
    workspaceId: string,
    workspaceRevision: number,
    directory: string,
  ): void
  markOptimizationEpisodeCleaned?(episodeId: string): void
}

interface WorkspaceContext {
  workspaceHandle: string
  workspaceRevision: number
}

interface EpisodeIpcContext {
  handle(
    channel: string,
    handler: (event: IpcMainInvokeEvent, value?: unknown) => unknown,
  ): void
  runtime?: EpisodeRuntime
  updateWorkspaceStepConfiguration(request: {
    commandId: string
    expectedWorkspaceRevision: number
    parameters: Record<string, unknown>
    stepId: string
    workspaceHandle: string
  }): Promise<{ workspaceRevision: number }>
  getWindowDirectory(sender: Sender): string | null
  getSessionOwner(providerId: string, sessionId: string): Sender | undefined
  getSessionSenders(): Iterable<Sender>
  trackAgentSession(sender: Sender, request: DesktopAgentStartSessionRequest): void
  requireAgentSessionOwner(
    sender: Sender,
    request: EpisodeControlRequest | EpisodeAckRequest,
  ): void
  resolveAgentWorkspaceContext(directory: string): Promise<WorkspaceContext>
}

export interface OptimizationEpisodeProductCommands {
  adoptOptimizationCandidate(payload: EpisodePayload): Promise<unknown>
  cleanupOptimizationEpisode(payload: CleanupPayload): Promise<unknown>
}

export function registerOptimizationEpisodeIpc(
  context: EpisodeIpcContext,
): OptimizationEpisodeProductCommands {
  context.handle(desktopApiIpcChannels.agentOptimizationProjection, async (event) => {
    const runtime = requireRuntime(context.runtime)
    if (!runtime.optimizationProjection) return { episodes: [], generation: 0 }
    const projection = runtime.optimizationProjection()
    const windowDirectory = context.getWindowDirectory(event.sender)
    const episodes: typeof projection.episodes = []
    for (const episode of projection.episodes) {
      const sessionOwner = context.getSessionOwner(
        episode.providerId,
        episode.agentSessionId,
      )
      if (sessionOwner) {
        if (sessionOwner === event.sender) episodes.push(episode)
        continue
      }
      if (
        !windowDirectory ||
        normalizeWorkspacePath(windowDirectory) !==
          normalizeWorkspacePath(episode.parentWorkspaceDirectory)
      ) {
        continue
      }
      try {
        const workspace = await context.resolveAgentWorkspaceContext(
          episode.parentWorkspaceDirectory,
        )
        context.trackAgentSession(event.sender, {
          directory: episode.parentWorkspaceDirectory,
          providerId: episode.providerId,
          sessionId: episode.agentSessionId,
          workspaceId: workspace.workspaceHandle,
          workspaceRevision: workspace.workspaceRevision,
        })
        const sameRevision =
          episode.parentWorkspaceRevision === undefined ||
          episode.parentWorkspaceRevision === workspace.workspaceRevision
        if (sameRevision)
          runtime.rebindOptimizationEpisode?.(
            episode.episodeId,
            workspace.workspaceHandle,
            workspace.workspaceRevision,
            episode.parentWorkspaceDirectory,
          )
        episodes.push({
          ...episode,
          ...(sameRevision
            ? {
                parentWorkspaceId: workspace.workspaceHandle,
                parentWorkspaceRevision: workspace.workspaceRevision,
              }
            : {}),
        })
      } catch {
        // A closed or invalid Workspace is not safe to claim for control.
      }
    }
    return { ...projection, episodes }
  })

  context.handle(desktopApiIpcChannels.agentOptimizationControl, async (event, value) => {
    const request = readAgentOptimizationEpisodeControlRequest(value)
    context.requireAgentSessionOwner(event.sender, request)
    const runtime = requireRuntime(context.runtime)
    if (!runtime.controlOptimizationEpisode) {
      throw new Error('Agent Optimization Episode control is unavailable.')
    }
    await runtime.controlOptimizationEpisode(request)
  })

  context.handle(
    desktopApiIpcChannels.agentOptimizationNotificationAck,
    async (event, value) => {
      const request = readAgentOptimizationEpisodeNotificationAckRequest(value)
      context.requireAgentSessionOwner(event.sender, request)
      const runtime = requireRuntime(context.runtime)
      if (!runtime.acknowledgeOptimizationEpisodeNotification) {
        throw new Error(
          'Agent Optimization Episode notification acknowledgement is unavailable.',
        )
      }
      runtime.acknowledgeOptimizationEpisodeNotification(request)
    },
  )

  context.runtime?.onOptimizationProjectionInvalidated?.((generation) => {
    const senders = new Set(context.getSessionSenders())
    for (const sender of senders) {
      if (typeof sender.isDestroyed === 'function' && sender.isDestroyed()) continue
      sender.send(desktopApiEventChannels.agentOptimizationProjectionInvalidated, {
        generation,
      })
    }
  })

  return {
    adoptOptimizationCandidate: (payload) => adoptOptimizationCandidate(context, payload),
    cleanupOptimizationEpisode: (payload) => cleanupOptimizationEpisode(context, payload),
  }
}

async function adoptOptimizationCandidate(
  context: EpisodeIpcContext,
  payload: EpisodePayload,
): Promise<unknown> {
  const projection = requireRuntime(context.runtime).optimizationProjection?.()
  const episode = projection?.episodes.find(
    (candidate) => candidate.episodeId === payload.episodeId,
  )
  if (!episode || !['completed', 'stopped', 'failed'].includes(episode.state)) {
    throw new Error('Parent Adoption requires a terminal Optimization Episode.')
  }
  if (
    episode.parentWorkspaceId !== payload.workspaceHandle ||
    episode.parentWorkspaceRevision !== payload.expectedWorkspaceRevision
  ) {
    throw new Error('Parent Adoption authorization is stale.')
  }
  if (episode.optimization.incumbent_candidate_root_ref !== payload.candidateRootRef) {
    throw new Error('Parent Adoption candidate is not the Episode incumbent.')
  }
  const byStep = new Map<string, Record<string, unknown>>()
  for (const step of payload.affectedFlowSteps) {
    const parameters = Object.fromEntries(
      payload.parameterPatch
        .filter(({ knob_id }) =>
          knob_id.toLowerCase().startsWith(`${step.toLowerCase()}.`),
        )
        .map(({ knob_id, value }) => [knob_id, value]),
    )
    if (Object.keys(parameters).length > 0) byStep.set(step, parameters)
  }
  if (byStep.size === 0) {
    throw new Error('Parent Adoption patch does not affect a Flow Step.')
  }
  let workspaceRevision = payload.expectedWorkspaceRevision
  for (const [stepId, parameters] of byStep) {
    const result = await context.updateWorkspaceStepConfiguration({
      commandId: `${payload.idempotencyKey}:${stepId}`,
      expectedWorkspaceRevision: workspaceRevision,
      parameters,
      stepId,
      workspaceHandle: payload.workspaceHandle,
    })
    workspaceRevision = result.workspaceRevision
  }
  const marker = optimizationEpisodeMarkerPath(
    episode.parentWorkspaceDirectory,
    episode.episodeId,
    'parent-adoption.v1.json',
  )
  await mkdir(dirname(marker), { recursive: true })
  await writeFile(
    marker,
    `${JSON.stringify({ ...payload, workspaceRevision, adoptedAt: Date.now() })}\n`,
    'utf8',
  )
  return { adopted: true, workspaceRevision }
}

async function cleanupOptimizationEpisode(
  context: EpisodeIpcContext,
  payload: CleanupPayload,
): Promise<unknown> {
  const runtime = requireRuntime(context.runtime)
  const episode = runtime
    .optimizationProjection?.()
    ?.episodes.find((candidate) => candidate.episodeId === payload.episodeId)
  if (!episode || !['completed', 'stopped', 'failed'].includes(episode.state)) {
    throw new Error('Optimization cleanup requires a terminal Episode.')
  }
  if (
    normalizeWorkspacePath(episode.parentWorkspaceDirectory) !==
    normalizeWorkspacePath(payload.parentWorkspaceDirectory)
  ) {
    throw new Error('Optimization cleanup Parent Workspace does not match the Episode.')
  }
  if (episode.parentWorkspaceId !== payload.workspaceHandle) {
    throw new Error(
      'Optimization cleanup Workspace ownership does not match the Episode.',
    )
  }
  const adoptionMarker = optimizationEpisodeMarkerPath(
    payload.parentWorkspaceDirectory,
    payload.episodeId,
    'parent-adoption.v1.json',
  )
  await stat(adoptionMarker).catch(() => {
    throw new Error('Optimization cleanup requires Parent Adoption first.')
  })
  const episodeRoot = resolve(
    optimizationEpisodeMarkerPath(
      payload.parentWorkspaceDirectory,
      payload.episodeId,
      '',
    ),
  )
  for (const directory of payload.executionWorkspaceDirectories) {
    const target = resolve(directory)
    const rel = relative(episodeRoot, target)
    if (!rel || rel.startsWith('..') || resolve(episodeRoot, rel) !== target) {
      throw new Error('Optimization cleanup path is outside the Episode.')
    }
    await rm(target, { force: true, recursive: true })
  }
  const marker = optimizationEpisodeMarkerPath(
    payload.parentWorkspaceDirectory,
    payload.episodeId,
    'cleanup.v1.json',
  )
  await writeFile(
    marker,
    `${JSON.stringify({ cleanedAt: Date.now(), directories: payload.executionWorkspaceDirectories })}\n`,
    'utf8',
  )
  runtime.markOptimizationEpisodeCleaned?.(episode.episodeId)
  return { cleaned: true }
}

function optimizationEpisodeMarkerPath(
  parentWorkspaceDirectory: string,
  episodeId: string,
  filename: string,
): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(episodeId)) {
    throw new Error('Optimization Episode identity is invalid.')
  }
  const parent = resolve(parentWorkspaceDirectory)
  const episodeRoot = resolve(join(parent, '.agent', 'optimization', episodeId))
  if (relative(parent, episodeRoot).startsWith('..')) {
    throw new Error('Optimization Episode path is outside the Parent Workspace.')
  }
  return resolve(join(episodeRoot, filename))
}

function readAgentOptimizationEpisodeControlRequest(
  value: unknown,
): EpisodeControlRequest {
  const record = readAgentRecord(value)
  if (
    record.action !== 'pause' &&
    record.action !== 'resume' &&
    record.action !== 'retry' &&
    record.action !== 'stop'
  ) {
    throw new Error('Agent Optimization Episode action is invalid.')
  }
  return {
    action: record.action,
    episodeId: readAgentSessionId(record.episodeId),
    providerId: readAgentProviderId(record),
    sessionId: readAgentSessionId(record.sessionId),
  }
}

function readAgentOptimizationEpisodeNotificationAckRequest(
  value: unknown,
): EpisodeAckRequest {
  const record = readAgentRecord(value)
  if (
    record.state !== 'completed' &&
    record.state !== 'needs_attention' &&
    record.state !== 'interrupted' &&
    record.state !== 'stopped'
  ) {
    throw new Error('Agent Optimization Episode notification state is invalid.')
  }
  return {
    episodeId: readAgentSessionId(record.episodeId),
    providerId: readAgentProviderId(record),
    sessionId: readAgentSessionId(record.sessionId),
    state: record.state,
  }
}

function requireRuntime(runtime: EpisodeRuntime | undefined): EpisodeRuntime {
  if (!runtime) {
    throw new Error(
      'No ECOS Agent provider is available. Check the in-tree agent or ECOS_AGENT_PROVIDER_ROOTS.',
    )
  }
  return runtime
}

function readAgentRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Agent request must be an object.')
  }
  return value as Record<string, unknown>
}

function readAgentProviderId(value: unknown): string {
  const providerId = readAgentRecord(value).providerId
  if (
    typeof providerId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(providerId)
  ) {
    throw new Error('Agent providerId is invalid.')
  }
  return providerId
}

function readAgentSessionId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    throw new Error('Agent sessionId is invalid.')
  }
  return value
}
