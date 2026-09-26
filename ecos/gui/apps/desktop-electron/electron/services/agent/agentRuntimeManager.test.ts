import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  DesktopAgentEvent,
  DesktopAgentProviderRequest,
  DesktopAgentStartSessionRequest,
  DesktopAgentStatus,
} from '@ecos-studio/shared'
import { AgentRuntimeManager } from './agentRuntimeManager'
import type { AgentProviderRuntime } from './agentProviderContract'

function createProvider(providerId = 'codex'): AgentProviderRuntime {
  let listener: ((event: DesktopAgentEvent) => void) | undefined
  const status: DesktopAgentStatus = {
    providerId,
    state: 'ready',
  }

  return {
    getStatus: vi.fn(async () => status),
    getModelSettings: vi.fn(async () => ({
      displayName: 'GPT Test',
      model: 'gpt-test',
      models: [
        {
          defaultReasoningEffort: 'medium' as const,
          displayName: 'GPT Test',
          model: 'gpt-test',
          supportedReasoningEfforts: ['low', 'medium', 'high'] as (
            | 'low'
            | 'medium'
            | 'high'
          )[],
        },
      ],
      reasoningEffort: 'medium' as const,
    })),
    interrupt: vi.fn(async () => {}),
    listSessions: vi.fn(async () => ({ sessions: [] })),
    onEvent: vi.fn((nextListener) => {
      listener = nextListener
      return () => {
        listener = undefined
      }
    }),
    resumeSession: vi.fn(async (request) => ({
      sessionId: request.sessionId,
    })),
    resumeOptimizationEpisode: vi.fn(async () => {}),
    stopOptimizationEpisode: vi.fn(async () => {}),
    prepareOptimizationShutdown: vi.fn(async () => {}),
    cancelOptimizationShutdown: vi.fn(async () => {}),
    sendMessage: vi.fn(async (request) => ({
      messageId: 'message-1',
      sessionId: request.sessionId,
    })),
    answerInteraction: vi.fn(async (request) => ({
      accepted: true,
      requestId: request.requestId,
      sessionId: request.sessionId,
    })),
    setMode: vi.fn(async () => status),
    setModelSettings: vi.fn(async () => ({
      displayName: 'GPT Test',
      model: 'gpt-test',
      models: [
        {
          defaultReasoningEffort: 'medium' as const,
          displayName: 'GPT Test',
          model: 'gpt-test',
          supportedReasoningEfforts: ['low', 'medium', 'high'] as (
            | 'low'
            | 'medium'
            | 'high'
          )[],
        },
      ],
      reasoningEffort: 'high' as const,
    })),
    start: vi.fn(async () => {}),
    startSession: vi.fn(async (request) => ({
      sessionId: request.sessionId ?? 'session-1',
    })),
    stop: vi.fn(async () => {}),
    emitForTest: (event: DesktopAgentEvent) => listener?.(event),
  } as AgentProviderRuntime & { emitForTest(event: DesktopAgentEvent): void }
}

function authorizationEvent(sessionId: string, requestId: string): DesktopAgentEvent {
  return {
    sessionId,
    type: 'interaction',
    interaction: {
      kind: 'confirm',
      purpose: 'execution',
      requestId,
      schema_version: 'flow-agent.interaction_request.v1',
      status: 'pending',
      title: 'Confirm optimization',
      interaction: {
        kind: 'confirm',
        confirm: { id: 'confirm', label: 'Start' },
        cancel: { id: 'cancel', label: 'Cancel' },
      },
      optimizationAuthorization: {
        schema_version: 'ecos.optimization_authorization.v2',
        workspace: '/work/demo',
        original_objective: {},
        objective_sha256: 'objective-hash',
        alignment_sha256: 'alignment-hash',
        original_primary_metric: 'route_wirelength',
        active_primary_metric: 'route_wirelength',
        active_preserve_metrics: [],
        recovery_stage: 'original',
        violation_counts: {
          drc_count: 0,
          sta_setup_violation_count: 0,
          sta_hold_violation_count: 0,
        },
        requires_confirmation: true,
        execution: 'fixed candidate.rerun only',
      },
    },
  }
}

function admitFixtureEpisode(manager: AgentRuntimeManager, episodeId: string): void {
  ;(
    manager as unknown as { admittedOptimizationEpisodeIds: Set<string> }
  ).admittedOptimizationEpisodeIds.add(episodeId)
}

describe('AgentRuntimeManager', () => {
  it('expires a legacy unconfirmed optimization on restart without guarding its Parent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecos-agent-unconfirmed-'))
    const projectionPath = join(root, 'episodes.json')
    try {
      const provider = createProvider() as AgentProviderRuntime & {
        emitForTest(event: DesktopAgentEvent): void
      }
      const first = new AgentRuntimeManager({
        defaultProviderId: 'codex',
        optimizationProjectionPath: projectionPath,
        providers: [{ providerId: 'codex', runtime: provider }],
      })
      await first.startSession({
        directory: '/work/demo',
        providerId: 'codex',
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        workspaceRevision: 7,
      })
      provider.emitForTest({
        sessionId: 'session-1',
        type: 'optimization',
        optimization: {
          episode_id: 'episode-unconfirmed',
          phase: 'awaiting_confirmation',
          schema_version: 'ecos.optimization_status.v2',
          state: 'awaiting_confirmation',
          workspace: '/work/demo',
        },
      })

      const restored = new AgentRuntimeManager({
        defaultProviderId: 'codex',
        optimizationProjectionPath: projectionPath,
        providers: [{ providerId: 'codex', runtime: createProvider() }],
      })
      expect(restored.optimizationProjection().episodes).toEqual([])
      expect(restored.isOptimizationParentGuarded('workspace-1')).toBe(false)
      expect(restored.isOptimizationParentDirectoryGuarded('/work/demo')).toBe(false)
      const again = new AgentRuntimeManager({
        defaultProviderId: 'codex',
        optimizationProjectionPath: projectionPath,
        providers: [{ providerId: 'codex', runtime: createProvider() }],
      })
      expect(again.optimizationProjection().episodes).toEqual([])
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('keeps a damaged authorized Episode guarded until ECC verifies safe Stop', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecos-agent-episodes-'))
    const projectionPath = join(root, 'episodes.json')
    try {
      const provider = createProvider() as AgentProviderRuntime & {
        emitForTest(event: DesktopAgentEvent): void
      }
      const manager = new AgentRuntimeManager({
        defaultProviderId: 'codex',
        optimizationProjectionPath: projectionPath,
        providers: [{ providerId: 'codex', runtime: provider }],
      })
      await manager.startSession({
        directory: '/work/demo',
        providerId: 'codex',
        sessionId: 'session-1',
        workspaceId: 'workspace-handle-1',
        workspaceRevision: 7,
      })
      admitFixtureEpisode(manager, 'episode-1')
      provider.emitForTest({
        sessionId: 'session-1',
        type: 'optimization',
        optimization: {
          episode_id: 'episode-1',
          schema_version: 'ecos.optimization_status.v2',
          state: 'running',
          workspace: '/work/demo',
        },
      })

      const restoredProvider = createProvider() as AgentProviderRuntime & {
        emitForTest(event: DesktopAgentEvent): void
      }
      const restored = new AgentRuntimeManager({
        defaultProviderId: 'codex',
        optimizationProjectionPath: projectionPath,
        providers: [{ providerId: 'codex', runtime: restoredProvider }],
      })

      expect(restored.optimizationProjection().episodes).toEqual([
        expect.objectContaining({
          episodeId: 'episode-1',
          parentWorkspaceDirectory: '/work/demo',
          state: 'needs_attention',
        }),
      ])
      expect(restored.isOptimizationParentGuarded('workspace-handle-1')).toBe(true)

      await restored.startSession({
        directory: '/work/demo',
        providerId: 'codex',
        sessionId: 'session-1',
        workspaceId: 'workspace-handle-2',
        workspaceRevision: 7,
      })
      expect(restored.isOptimizationParentGuarded('workspace-handle-1')).toBe(false)
      expect(restored.isOptimizationParentGuarded('workspace-handle-2')).toBe(true)

      await expect(
        restored.controlOptimizationEpisode({
          action: 'retry',
          episodeId: 'episode-1',
          providerId: 'codex',
          sessionId: 'session-1',
        }),
      ).rejects.toThrow('verified recovery source')
      expect(restoredProvider.sendMessage).not.toHaveBeenCalled()
      const unsafe = vi.fn(async () => {
        throw new Error('ECC Operation still running')
      })
      restored.setOptimizationStopReconciler(unsafe)
      await expect(
        restored.controlOptimizationEpisode({
          action: 'stop',
          episodeId: 'episode-1',
          providerId: 'codex',
          sessionId: 'session-1',
        }),
      ).rejects.toThrow('still running')
      expect(restored.isOptimizationParentGuarded('workspace-handle-2')).toBe(true)
      restored.setOptimizationStopReconciler(async () => {})
      await restored.controlOptimizationEpisode({
        action: 'stop',
        episodeId: 'episode-1',
        providerId: 'codex',
        sessionId: 'session-1',
      })
      expect(restored.optimizationProjection().episodes[0]?.state).toBe('stopped')
      expect(restored.isOptimizationParentGuarded('workspace-handle-2')).toBe(false)
      expect(restoredProvider.sendMessage).not.toHaveBeenCalled()
      expect(restoredProvider.stopOptimizationEpisode).not.toHaveBeenCalled()
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('projects a provider optimization episode independently of the active Agent tab', async () => {
    const provider = createProvider() as AgentProviderRuntime & {
      emitForTest(event: DesktopAgentEvent): void
    }
    const manager = new AgentRuntimeManager(provider)
    const invalidated = vi.fn()
    manager.onOptimizationProjectionInvalidated(invalidated)
    await manager.startSession({
      directory: '/work/demo',
      providerId: 'codex',
      sessionId: 'session-1',
      workspaceId: 'workspace-handle-1',
      workspaceRevision: 7,
    })
    admitFixtureEpisode(manager, 'episode-1')

    provider.emitForTest({
      sessionId: 'session-1',
      type: 'optimization',
      optimization: {
        episode_id: 'episode-1',
        in_flight: 1,
        schema_version: 'ecos.optimization_status.v2',
        state: 'running',
        turn_count: 2,
        workspace: '/work/demo',
      },
    })

    expect(manager.optimizationProjection()).toEqual({
      episodes: [
        expect.objectContaining({
          agentSessionId: 'session-1',
          episodeId: 'episode-1',
          inFlightCount: 1,
          parentWorkspaceDirectory: '/work/demo',
          parentWorkspaceId: 'workspace-handle-1',
          parentWorkspaceRevision: 7,
          providerId: 'codex',
          state: 'running',
          turnCount: 2,
        }),
      ],
      generation: 1,
    })
    expect(invalidated).toHaveBeenCalledWith(1)
    expect(manager.isOptimizationParentGuarded('workspace-handle-1')).toBe(true)

    await manager.controlOptimizationEpisode({
      action: 'pause',
      episodeId: 'episode-1',
      providerId: 'codex',
      sessionId: 'session-1',
    })
    expect(provider.sendMessage).toHaveBeenCalledWith({
      message: 'pause',
      providerId: 'codex',
      sessionId: 'session-1',
    })
  })

  it('persists terminal notification acknowledgement across projection reloads', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecos-agent-notifications-'))
    const projectionPath = join(root, 'episodes.json')
    try {
      const provider = createProvider() as AgentProviderRuntime & {
        emitForTest(event: DesktopAgentEvent): void
      }
      const manager = new AgentRuntimeManager({
        defaultProviderId: 'codex',
        optimizationProjectionPath: projectionPath,
        providers: [{ providerId: 'codex', runtime: provider }],
      })
      await manager.startSession({
        directory: '/work/demo',
        providerId: 'codex',
        sessionId: 'session-1',
        workspaceId: 'workspace-handle-1',
        workspaceRevision: 7,
      })
      admitFixtureEpisode(manager, 'episode-1')
      provider.emitForTest({
        sessionId: 'session-1',
        type: 'optimization',
        optimization: {
          episode_id: 'episode-1',
          schema_version: 'ecos.optimization_status.v2',
          state: 'completed',
          workspace: '/work/demo',
        },
      })
      expect(manager.optimizationProjection().episodes[0]?.notificationStates).toEqual([
        'completed',
      ])
      manager.acknowledgeOptimizationEpisodeNotification({
        episodeId: 'episode-1',
        providerId: 'codex',
        sessionId: 'session-1',
        state: 'completed',
      })
      const restored = new AgentRuntimeManager({
        defaultProviderId: 'codex',
        optimizationProjectionPath: projectionPath,
        providers: [{ providerId: 'codex', runtime: createProvider() }],
      })
      expect(restored.optimizationProjection().episodes[0]?.notificationStates).toEqual(
        [],
      )
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('drains and restores running episodes for Safe Shutdown', async () => {
    const provider = createProvider() as AgentProviderRuntime & {
      emitForTest(event: DesktopAgentEvent): void
    }
    const manager = new AgentRuntimeManager(provider)
    await manager.startSession({
      directory: '/work/demo',
      providerId: 'codex',
      sessionId: 'session-1',
      workspaceId: 'workspace-handle-1',
      workspaceRevision: 7,
    })
    admitFixtureEpisode(manager, 'episode-1')
    provider.emitForTest({
      sessionId: 'session-1',
      type: 'optimization',
      optimization: {
        episode_id: 'episode-1',
        schema_version: 'ecos.optimization_status.v2',
        state: 'running',
        workspace: '/work/demo',
      },
    })

    await manager.beginOptimizationShutdownDrain()
    expect(provider.prepareOptimizationShutdown).toHaveBeenCalledWith({
      providerId: 'codex',
      sessionId: 'session-1',
    })
    provider.emitForTest({
      sessionId: 'session-1',
      type: 'optimization',
      optimization: {
        episode_id: 'episode-1',
        schema_version: 'ecos.optimization_status.v2',
        state: 'interrupted',
        workspace: '/work/demo',
      },
    })

    await manager.cancelOptimizationShutdownDrain()
    expect(provider.resumeOptimizationEpisode).toHaveBeenCalledWith({
      directory: '/work/demo',
      episodeId: 'episode-1',
      providerId: 'codex',
      sessionId: 'session-1',
      workspaceId: 'workspace-handle-1',
      workspaceRevision: 7,
    })
  })

  it('admits only one confirmed Episode for a Parent and redirects the loser', async () => {
    const provider = createProvider() as AgentProviderRuntime & {
      emitForTest(event: DesktopAgentEvent): void
    }
    const manager = new AgentRuntimeManager(provider)
    manager.setOptimizationWorkspaceResolver(async () => ({
      workspaceId: 'workspace-handle-1',
      workspaceRevision: 7,
    }))
    for (const sessionId of ['session-1', 'session-2']) {
      await manager.startSession({
        directory: '/work/demo',
        providerId: 'codex',
        sessionId,
        workspaceId: 'workspace-handle-1',
        workspaceRevision: 7,
      })
    }
    provider.emitForTest(authorizationEvent('session-1', 'request-1'))
    provider.emitForTest(authorizationEvent('session-2', 'request-2'))
    expect(manager.optimizationProjection().episodes).toEqual([])
    const answer = (sessionId: string, requestId: string) =>
      manager.answerInteraction({
        kind: 'confirm',
        optionId: 'confirm',
        providerId: 'codex',
        requestId,
        sessionId,
        episodeId: 'episode-forged',
      })
    const [first, second] = await Promise.all([
      answer('session-1', 'request-1'),
      answer('session-2', 'request-2'),
    ])
    const admitted = manager.optimizationProjection().episodes
    expect(admitted).toHaveLength(1)
    expect(admitted[0]?.episodeId).toMatch(/^episode-/)
    expect(admitted[0]?.episodeId).not.toBe('episode-forged')
    expect(first.admissionConflict).toBeUndefined()
    expect(second.admissionConflict).toEqual({ episodeId: admitted[0]?.episodeId })
    expect(provider.answerInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        episodeId: admitted[0]?.episodeId,
        workspaceId: 'workspace-handle-1',
        workspaceRevision: 7,
      }),
    )
    expect(provider.answerInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        optionId: 'cancel',
        requestId: 'request-2',
      }),
    )
  })

  it('rejects a changed Parent Revision before assigning an Episode', async () => {
    const provider = createProvider() as AgentProviderRuntime & {
      emitForTest(event: DesktopAgentEvent): void
    }
    const manager = new AgentRuntimeManager(provider)
    let revision = 7
    manager.setOptimizationWorkspaceResolver(async () => ({
      workspaceId: 'workspace-1',
      workspaceRevision: revision,
    }))
    await manager.startSession({
      directory: '/work/demo',
      providerId: 'codex',
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      workspaceRevision: 7,
    })
    provider.emitForTest(authorizationEvent('session-1', 'request-1'))
    await Promise.resolve()
    revision = 8
    await expect(
      manager.answerInteraction({
        kind: 'confirm',
        optionId: 'confirm',
        requestId: 'request-1',
        sessionId: 'session-1',
      }),
    ).rejects.toThrow('changed')
    expect(manager.optimizationProjection().episodes).toEqual([])
    expect(provider.answerInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ optionId: 'cancel' }),
    )
  })

  it('accepts confirmation when ECC reopens the same Parent with a new runtime handle', async () => {
    const provider = createProvider() as AgentProviderRuntime & {
      emitForTest(event: DesktopAgentEvent): void
    }
    const manager = new AgentRuntimeManager(provider)
    let handle = 'workspace-handle-1'
    manager.setOptimizationWorkspaceResolver(async () => ({
      workspaceId: handle,
      workspaceRevision: 7,
    }))
    await manager.startSession({
      directory: '/work/demo',
      providerId: 'codex',
      sessionId: 'session-1',
      workspaceId: handle,
      workspaceRevision: 7,
    })
    provider.emitForTest(authorizationEvent('session-1', 'request-1'))
    await Promise.resolve()
    handle = 'workspace-handle-2'
    await expect(
      manager.answerInteraction({
        kind: 'confirm',
        optionId: 'confirm',
        requestId: 'request-1',
        sessionId: 'session-1',
      }),
    ).resolves.toMatchObject({ accepted: true })
    expect(provider.answerInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-handle-2',
        workspaceRevision: 7,
      }),
    )
  })

  it('exposes the provider runtime contract without replacing the provider implementation', async () => {
    const provider = createProvider()
    const manager = new AgentRuntimeManager(provider)
    const startRequest: DesktopAgentStartSessionRequest = {
      directory: '/work/demo',
      providerId: 'codex',
    }

    await expect(manager.startSession(startRequest)).resolves.toEqual({
      sessionId: 'session-1',
    })
    expect(provider.startSession).toHaveBeenCalledWith(startRequest)

    await expect(
      manager.sendMessage({
        message: 'route this design',
        providerId: 'codex',
        sessionId: 'session-1',
      }),
    ).resolves.toEqual({
      messageId: 'message-1',
      sessionId: 'session-1',
    })
  })

  it('forwards provider lifecycle calls and typed status responses', async () => {
    const provider = createProvider()
    const manager = new AgentRuntimeManager(provider)
    const request: DesktopAgentProviderRequest = {
      providerId: 'codex',
    }

    await manager.start(request)
    await expect(manager.getStatus(request)).resolves.toEqual({
      providerId: 'codex',
      state: 'ready',
    })
    await manager.interrupt(request)
    await manager.stop(request)

    expect(provider.start).toHaveBeenCalledWith(request)
    expect(provider.getStatus).toHaveBeenCalledWith(request)
    expect(provider.interrupt).toHaveBeenCalledWith(request)
    expect(provider.stop).toHaveBeenCalledWith(request)
  })

  it('fans out provider events through the placeholder manager', () => {
    const provider = createProvider() as AgentProviderRuntime & {
      emitForTest(event: DesktopAgentEvent): void
    }
    const manager = new AgentRuntimeManager(provider)
    const listener = vi.fn()
    const unsubscribe = manager.onEvent(listener)

    provider.emitForTest({
      providerId: 'codex',
      sessionId: 'session-1',
      text: 'working',
      type: 'message',
    })
    expect(listener).toHaveBeenCalledWith({
      providerId: 'codex',
      sessionId: 'session-1',
      text: 'working',
      type: 'message',
    })

    unsubscribe()
    provider.emitForTest({
      providerId: 'codex',
      type: 'status',
    })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('routes provider-scoped lifecycle calls to the requested provider', async () => {
    const codexProvider = createProvider('codex')
    const localProvider = createProvider('local')
    const manager = new AgentRuntimeManager({
      defaultProviderId: 'codex',
      providers: [
        { providerId: 'codex', runtime: codexProvider },
        { providerId: 'local', runtime: localProvider },
      ],
    })

    await manager.startSession({
      directory: '/work/demo',
      providerId: 'local',
    })
    await manager.sendMessage({
      message: 'inspect this step',
      providerId: 'codex',
      sessionId: 'session-1',
    })
    await manager.interrupt({ providerId: 'local' })
    await expect(manager.getStatus({ providerId: 'local' })).resolves.toEqual({
      providerId: 'local',
      state: 'ready',
    })

    expect(localProvider.startSession).toHaveBeenCalledWith({
      directory: '/work/demo',
      providerId: 'local',
    })
    expect(localProvider.interrupt).toHaveBeenCalledWith({ providerId: 'local' })
    expect(codexProvider.sendMessage).toHaveBeenCalledWith({
      message: 'inspect this step',
      providerId: 'codex',
      sessionId: 'session-1',
    })
    expect(codexProvider.startSession).not.toHaveBeenCalled()
    expect(localProvider.sendMessage).not.toHaveBeenCalled()
  })

  it('adds provider identity to events emitted by each provider runtime', () => {
    const codexProvider = createProvider('codex') as AgentProviderRuntime & {
      emitForTest(event: DesktopAgentEvent): void
    }
    const localProvider = createProvider('local') as AgentProviderRuntime & {
      emitForTest(event: DesktopAgentEvent): void
    }
    const manager = new AgentRuntimeManager({
      defaultProviderId: 'codex',
      providers: [
        { providerId: 'codex', runtime: codexProvider },
        { providerId: 'local', runtime: localProvider },
      ],
    })
    const listener = vi.fn()
    const unsubscribe = manager.onEvent(listener)

    localProvider.emitForTest({
      sessionId: 'local-session',
      text: 'local response',
      type: 'message',
    })
    codexProvider.emitForTest({
      providerId: 'codex',
      type: 'status',
    })

    expect(listener).toHaveBeenNthCalledWith(1, {
      providerId: 'local',
      sessionId: 'local-session',
      text: 'local response',
      type: 'message',
    })
    expect(listener).toHaveBeenNthCalledWith(2, {
      providerId: 'codex',
      type: 'status',
    })

    unsubscribe()
    localProvider.emitForTest({
      text: 'after unsubscribe',
      type: 'message',
    })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('attributes provider events to the registered provider runtime', () => {
    const localProvider = createProvider('local') as AgentProviderRuntime & {
      emitForTest(event: DesktopAgentEvent): void
    }
    const manager = new AgentRuntimeManager({
      defaultProviderId: 'local',
      providers: [{ providerId: 'local', runtime: localProvider }],
    })
    const listener = vi.fn()
    manager.onEvent(listener)

    localProvider.emitForTest({
      providerId: 'codex',
      text: 'reported by local provider',
      type: 'message',
    })

    expect(listener).toHaveBeenCalledWith({
      providerId: 'local',
      text: 'reported by local provider',
      type: 'message',
    })
  })

  it('rejects calls for unknown agent providers', async () => {
    const manager = new AgentRuntimeManager({
      providers: [{ providerId: 'codex', runtime: createProvider('codex') }],
    })

    await expect(manager.getStatus({ providerId: 'missing' })).rejects.toThrow(
      'Unknown agent provider: missing',
    )
  })
})
