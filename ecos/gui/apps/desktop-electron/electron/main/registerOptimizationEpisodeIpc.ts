import type { IpcMainInvokeEvent } from 'electron'
import {
  desktopApiEventChannels,
  desktopApiIpcChannels,
  type DesktopAgentOptimizationEpisodeControlRequest,
  type DesktopAgentOptimizationEpisodeNotificationAckRequest,
  type DesktopAgentOptimizationEpisodeProjection,
  type DesktopAgentStartSessionRequest,
} from '@ecos-studio/shared'
import type { AgentProviderRuntime } from '../services/agent/agentProviderContract'
import { normalizeWorkspacePath } from '../services/workspacePath'

type Sender = IpcMainInvokeEvent['sender']
type EpisodeControlRequest = DesktopAgentOptimizationEpisodeControlRequest
type EpisodeAckRequest = DesktopAgentOptimizationEpisodeNotificationAckRequest
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

export function registerOptimizationEpisodeIpc(context: EpisodeIpcContext): void {
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
