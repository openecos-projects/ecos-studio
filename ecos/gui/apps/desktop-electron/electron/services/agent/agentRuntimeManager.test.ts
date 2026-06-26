import { describe, expect, it, vi } from 'vitest'
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
    sendMessage: vi.fn(async (request) => ({
      messageId: 'message-1',
      sessionId: request.sessionId,
    })),
    setMode: vi.fn(async () => status),
    start: vi.fn(async () => {}),
    startSession: vi.fn(async () => ({
      sessionId: 'session-1',
    })),
    stop: vi.fn(async () => {}),
    emitForTest: (event: DesktopAgentEvent) => listener?.(event),
  } as AgentProviderRuntime & { emitForTest(event: DesktopAgentEvent): void }
}

describe('AgentRuntimeManager', () => {
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

    await expect(manager.sendMessage({
      message: 'route this design',
      providerId: 'codex',
      sessionId: 'session-1',
    })).resolves.toEqual({
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
      providers: [
        { providerId: 'local', runtime: localProvider },
      ],
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
      providers: [
        { providerId: 'codex', runtime: createProvider('codex') },
      ],
    })

    await expect(manager.getStatus({ providerId: 'missing' })).rejects.toThrow(
      'Unknown agent provider: missing',
    )
  })
})
