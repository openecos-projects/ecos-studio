import { EventEmitter } from 'node:events'
import type { spawn as spawnChild } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { AgentRuntimeManager } from './agentRuntimeManager'
import {
  AgentProviderProcessRuntime,
  type AgentProviderProtocolRequest,
} from './agentProviderProcessRuntime'
import { supportedAgentProviderProtocolVersion } from './agentProviderPlugin'

class FakeStdin extends EventEmitter {
  readonly write = vi.fn()
}

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()
  readonly stdin = new FakeStdin()
  readonly kill = vi.fn()
}

function createSpawnHarness() {
  const children: FakeChild[] = []
  const spawn = vi.fn((command: string, args: string[], options: unknown) => {
    const child = new FakeChild()
    children.push(child)
    return child as never
  })

  return {
    children,
    spawn: spawn as unknown as typeof spawnChild,
  }
}

function readProtocolRequest(child: FakeChild, callIndex = 0): AgentProviderProtocolRequest {
  const raw = String(child.stdin.write.mock.calls[callIndex][0]).trim()
  return JSON.parse(raw) as AgentProviderProtocolRequest
}

describe('AgentProviderProcessRuntime', () => {
  it('uses stdio JSON-RPC requests and resolves provider responses', async () => {
    const harness = createSpawnHarness()
    const runtime = new AgentProviderProcessRuntime({
      manifest: {
        args: ['--stdio'],
        command: 'codex-provider',
        manifestPath: '/plugins/codex/agent-provider.json',
        pluginRoot: '/plugins/codex',
        providerId: 'codex',
        protocolVersion: supportedAgentProviderProtocolVersion,
      },
      spawn: harness.spawn,
    })

    const response = runtime.startSession({
      directory: '/work/demo',
      providerId: 'codex',
    })
    const child = harness.children[0]
    const request = readProtocolRequest(child)

    expect(harness.spawn).toHaveBeenCalledWith('codex-provider', ['--stdio'], {
      cwd: '/plugins/codex',
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    expect(request).toEqual({
      id: expect.any(String),
      method: 'startSession',
      params: {
        directory: '/work/demo',
        providerId: 'codex',
      },
    })

    child.stdout.emit('data', `${JSON.stringify({
      id: request.id,
      result: { sessionId: 'session-1' },
    })}\n`)

    await expect(response).resolves.toEqual({
      sessionId: 'session-1',
    })
  })

  it('forwards provider events from process stdout through AgentRuntimeManager', () => {
    const harness = createSpawnHarness()
    const runtime = new AgentProviderProcessRuntime({
      manifest: {
        command: 'local-provider',
        manifestPath: '/plugins/local/agent-provider.json',
        pluginRoot: '/plugins/local',
        providerId: 'local',
        protocolVersion: supportedAgentProviderProtocolVersion,
      },
      spawn: harness.spawn,
    })
    const manager = new AgentRuntimeManager({
      providers: [
        { providerId: 'local', runtime },
      ],
    })
    const listener = vi.fn()
    manager.onEvent(listener)

    void runtime.getStatus({ providerId: 'local' })
    const child = harness.children[0]
    child.stdout.emit('data', `${JSON.stringify({
      event: {
        text: 'working',
        type: 'message',
      },
      type: 'event',
    })}\n`)

    expect(listener).toHaveBeenCalledWith({
      providerId: 'local',
      text: 'working',
      type: 'message',
    })
  })

  it('rejects pending requests when the provider process exits', async () => {
    const harness = createSpawnHarness()
    const runtime = new AgentProviderProcessRuntime({
      manifest: {
        command: 'codex-provider',
        manifestPath: '/plugins/codex/agent-provider.json',
        pluginRoot: '/plugins/codex',
        providerId: 'codex',
        protocolVersion: supportedAgentProviderProtocolVersion,
      },
      spawn: harness.spawn,
    })

    const response = runtime.getStatus({ providerId: 'codex' })
    harness.children[0].emit('close', 1, null)

    await expect(response).rejects.toThrow(
      'Agent provider codex exited with code 1',
    )
  })

  it('rejects pending requests when provider stdin writes fail', async () => {
    const harness = createSpawnHarness()
    const runtime = new AgentProviderProcessRuntime({
      manifest: {
        command: 'codex-provider',
        manifestPath: '/plugins/codex/agent-provider.json',
        pluginRoot: '/plugins/codex',
        providerId: 'codex',
        protocolVersion: supportedAgentProviderProtocolVersion,
      },
      spawn: harness.spawn,
    })

    const response = runtime.getStatus({ providerId: 'codex' })
    const error = new Error('write EPIPE') as NodeJS.ErrnoException
    error.code = 'EPIPE'

    expect(() => {
      harness.children[0].stdin.emit('error', error)
    }).not.toThrow()

    await expect(response).rejects.toThrow('write EPIPE')
    expect(harness.children[0].kill).toHaveBeenCalled()
  })

  it('kills the provider when stdin write callbacks fail', async () => {
    const harness = createSpawnHarness()
    const runtime = new AgentProviderProcessRuntime({
      manifest: {
        command: 'codex-provider',
        manifestPath: '/plugins/codex/agent-provider.json',
        pluginRoot: '/plugins/codex',
        providerId: 'codex',
        protocolVersion: supportedAgentProviderProtocolVersion,
      },
      spawn: harness.spawn,
    })
    const error = new Error('write EPIPE') as NodeJS.ErrnoException
    error.code = 'EPIPE'

    const response = runtime.getStatus({ providerId: 'codex' })
    harness.children[0].stdin.write.mock.calls[0][1]?.(error)

    await expect(response).rejects.toThrow('write EPIPE')
    expect(harness.children[0].kill).toHaveBeenCalled()

    const nextResponse = runtime.getStatus({ providerId: 'codex' })
    expect(harness.children).toHaveLength(2)
    const secondRequest = readProtocolRequest(harness.children[1])
    harness.children[1].stdout.emit('data', `${JSON.stringify({
      id: secondRequest.id,
      result: {
        providerId: 'codex',
        state: 'ready',
      },
    })}\n`)

    await expect(nextResponse).resolves.toEqual({
      providerId: 'codex',
      state: 'ready',
    })
  })

  it('ignores stdout from failed providers after respawning', async () => {
    const harness = createSpawnHarness()
    const runtime = new AgentProviderProcessRuntime({
      manifest: {
        command: 'codex-provider',
        manifestPath: '/plugins/codex/agent-provider.json',
        pluginRoot: '/plugins/codex',
        providerId: 'codex',
        protocolVersion: supportedAgentProviderProtocolVersion,
      },
      spawn: harness.spawn,
    })
    const error = new Error('write EPIPE') as NodeJS.ErrnoException
    error.code = 'EPIPE'

    const firstResponse = runtime.getStatus({ providerId: 'codex' })
    harness.children[0].stdin.write.mock.calls[0][1]?.(error)
    await expect(firstResponse).rejects.toThrow('write EPIPE')

    const secondResponse = runtime.getStatus({ providerId: 'codex' })
    const secondRequest = readProtocolRequest(harness.children[1])

    expect(() => {
      harness.children[0].stdout.emit('data', 'not json\n')
    }).not.toThrow()

    harness.children[1].stdout.emit('data', `${JSON.stringify({
      id: secondRequest.id,
      result: {
        providerId: 'codex',
        state: 'ready',
      },
    })}\n`)

    await expect(secondResponse).resolves.toEqual({
      providerId: 'codex',
      state: 'ready',
    })
  })

  it('drops partial stdout from a crashed provider before respawning', async () => {
    const harness = createSpawnHarness()
    const runtime = new AgentProviderProcessRuntime({
      manifest: {
        command: 'codex-provider',
        manifestPath: '/plugins/codex/agent-provider.json',
        pluginRoot: '/plugins/codex',
        providerId: 'codex',
        protocolVersion: supportedAgentProviderProtocolVersion,
      },
      spawn: harness.spawn,
    })

    const firstResponse = runtime.getStatus({ providerId: 'codex' })
    harness.children[0].stdout.emit('data', '{"id":')
    harness.children[0].emit('close', 1, null)
    await expect(firstResponse).rejects.toThrow(
      'Agent provider codex exited with code 1',
    )

    const secondResponse = runtime.getStatus({ providerId: 'codex' })
    const secondChild = harness.children[1]
    const secondRequest = readProtocolRequest(secondChild)
    secondChild.stdout.emit('data', `${JSON.stringify({
      id: secondRequest.id,
      result: {
        providerId: 'codex',
        state: 'ready',
      },
    })}\n`)

    await expect(secondResponse).resolves.toEqual({
      providerId: 'codex',
      state: 'ready',
    })
  })

  it('drains provider stderr so diagnostics cannot block the child process', () => {
    const harness = createSpawnHarness()
    const runtime = new AgentProviderProcessRuntime({
      manifest: {
        command: 'codex-provider',
        manifestPath: '/plugins/codex/agent-provider.json',
        pluginRoot: '/plugins/codex',
        providerId: 'codex',
        protocolVersion: supportedAgentProviderProtocolVersion,
      },
      spawn: harness.spawn,
    })

    void runtime.getStatus({ providerId: 'codex' })
    expect(harness.children[0].stderr.listenerCount('data')).toBe(1)
  })

  it('rejects pending requests instead of throwing on malformed provider stdout', async () => {
    const harness = createSpawnHarness()
    const runtime = new AgentProviderProcessRuntime({
      manifest: {
        command: 'codex-provider',
        manifestPath: '/plugins/codex/agent-provider.json',
        pluginRoot: '/plugins/codex',
        providerId: 'codex',
        protocolVersion: supportedAgentProviderProtocolVersion,
      },
      spawn: harness.spawn,
    })

    const response = runtime.getStatus({ providerId: 'codex' })
    expect(() => {
      harness.children[0].stdout.emit('data', 'not json\n')
    }).not.toThrow()

    await expect(response).rejects.toThrow(
      'Invalid JSON from agent provider codex',
    )
  })

  it('does not reject pending requests when a provider event listener throws', async () => {
    const harness = createSpawnHarness()
    const runtime = new AgentProviderProcessRuntime({
      manifest: {
        command: 'codex-provider',
        manifestPath: '/plugins/codex/agent-provider.json',
        pluginRoot: '/plugins/codex',
        providerId: 'codex',
        protocolVersion: supportedAgentProviderProtocolVersion,
      },
      spawn: harness.spawn,
    })
    const manager = new AgentRuntimeManager({
      providers: [
        { providerId: 'codex', runtime },
      ],
    })
    manager.onEvent(() => {
      throw new Error('listener failed')
    })

    const response = runtime.getStatus({ providerId: 'codex' })
    const child = harness.children[0]
    const request = readProtocolRequest(child)

    expect(() => {
      child.stdout.emit('data', `${JSON.stringify({
        event: {
          text: 'working',
          type: 'message',
        },
        type: 'event',
      })}\n`)
    }).toThrow('listener failed')

    child.stdout.emit('data', `${JSON.stringify({
      id: request.id,
      result: {
        providerId: 'codex',
        state: 'ready',
      },
    })}\n`)

    await expect(response).resolves.toEqual({
      providerId: 'codex',
      state: 'ready',
    })
  })

  it('continues parsing batched stdout after a provider event listener throws', async () => {
    const harness = createSpawnHarness()
    const runtime = new AgentProviderProcessRuntime({
      manifest: {
        command: 'codex-provider',
        manifestPath: '/plugins/codex/agent-provider.json',
        pluginRoot: '/plugins/codex',
        providerId: 'codex',
        protocolVersion: supportedAgentProviderProtocolVersion,
      },
      spawn: harness.spawn,
    })
    const manager = new AgentRuntimeManager({
      providers: [
        { providerId: 'codex', runtime },
      ],
    })
    manager.onEvent(() => {
      throw new Error('listener failed')
    })

    const response = runtime.getStatus({ providerId: 'codex' })
    const child = harness.children[0]
    const request = readProtocolRequest(child)

    expect(() => {
      child.stdout.emit('data', `${JSON.stringify({
        event: {
          text: 'working',
          type: 'message',
        },
        type: 'event',
      })}\n${JSON.stringify({
        id: request.id,
        result: {
          providerId: 'codex',
          state: 'ready',
        },
      })}\n`)
    }).toThrow('listener failed')

    await expect(Promise.race([
      response,
      new Promise((resolve) => {
        setTimeout(() => resolve({ timedOut: true }), 25)
      }),
    ])).resolves.toEqual({
      providerId: 'codex',
      state: 'ready',
    })
  })
})
