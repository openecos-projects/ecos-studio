import { EventEmitter } from 'node:events'
import type { spawn as spawnChild } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { AgentRuntimeManager } from './agentRuntimeManager'
import {
  AgentProviderProcessRuntime,
  type AgentProviderProtocolRequest,
} from './agentProviderProcessRuntime'
import { supportedAgentProviderProtocolVersion } from './agentProviderPlugin'
import {
  getAgentOperationAssociation,
  resetAgentOperationAssociations,
} from './agentOperationAssociations'

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
  const spawn = vi.fn((_command: string, _args: string[], _options: unknown) => {
    const child = new FakeChild()
    children.push(child)
    return child as never
  })

  return {
    children,
    spawn: spawn as unknown as typeof spawnChild,
  }
}

function readProtocolRequest(
  child: FakeChild,
  callIndex = 0,
): AgentProviderProtocolRequest {
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
      knownProjects: [{ name: 'work', path: '/work' }],
      projectRoot: '/work',
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
        knownProjects: [{ name: 'work', path: '/work' }],
        projectRoot: '/work',
        providerId: 'codex',
      },
    })

    child.stdout.emit(
      'data',
      `${JSON.stringify({
        id: request.id,
        result: { sessionId: 'session-1' },
      })}\n`,
    )

    await expect(response).resolves.toEqual({
      sessionId: 'session-1',
    })
  })

  it('answers inbound host Product Commands from the agent child', async () => {
    const harness = createSpawnHarness()
    const host = {
      candidateCapabilities: vi.fn().mockResolvedValue({
        schema: 'ecc.candidate_capabilities.v1',
        schemaVersion: 1,
        targets: [],
      }),
      candidateRerun: vi.fn(),
      candidateResume: vi.fn(),
      cancelOperation: vi.fn(),
      openWorkspace: vi.fn(),
      operationStatus: vi.fn(),
      startFlowOperation: vi.fn(),
      waitForOperation: vi.fn(),
      workspaceSession: vi.fn().mockResolvedValue({ workspaceHandle: 'handle-1' }),
    }
    const runtime = new AgentProviderProcessRuntime({
      host,
      manifest: {
        command: 'codex-provider',
        manifestPath: '/plugins/codex/agent-provider.json',
        pluginRoot: '/plugins/codex',
        providerId: 'codex',
        protocolVersion: supportedAgentProviderProtocolVersion,
      },
      spawn: harness.spawn,
    })

    const started = runtime.startSession({
      directory: '/work/demo',
      providerId: 'codex',
      sessionId: 'session-1',
      workspaceId: 'handle-1',
    })
    const child = harness.children[0]
    const startRequest = readProtocolRequest(child)
    child.stdout.emit(
      'data',
      `${JSON.stringify({ id: startRequest.id, result: { sessionId: 'session-1' } })}\n`,
    )
    await started

    child.stdout.emit(
      'data',
      `${JSON.stringify({
        id: 'host-1',
        method: 'candidate.capabilities',
        params: { workspaceHandle: 'handle-1' },
      })}\n`,
    )
    await vi.waitFor(() => {
      expect(host.candidateCapabilities).toHaveBeenCalledWith({
        workspaceHandle: 'handle-1',
      })
    })
    const reply = JSON.parse(
      String(child.stdin.write.mock.calls.at(-1)?.[0]).trim(),
    ) as { id: string; result: unknown }
    expect(reply).toEqual({
      id: 'host-1',
      result: {
        schema: 'ecc.candidate_capabilities.v1',
        schemaVersion: 1,
        targets: [],
      },
    })
  })

  it('opens a calibration replay Workspace through the Product Command host', async () => {
    const harness = createSpawnHarness()
    const host = {
      candidateCapabilities: vi.fn(),
      candidateRerun: vi.fn(),
      candidateResume: vi.fn(),
      cancelOperation: vi.fn(),
      openWorkspace: vi.fn().mockResolvedValue({
        directory: '/work/demo/.agent/optimization/noise-calibration/default-replay-1/workspace',
        workspaceHandle: 'handle-replay',
        workspaceRevision: 1,
      }),
      operationStatus: vi.fn(),
      startFlowOperation: vi.fn(),
      waitForOperation: vi.fn(),
    }
    const runtime = new AgentProviderProcessRuntime({
      host,
      manifest: {
        command: 'codex-provider',
        manifestPath: '/plugins/codex/agent-provider.json',
        pluginRoot: '/plugins/codex',
        providerId: 'codex',
        protocolVersion: supportedAgentProviderProtocolVersion,
      },
      spawn: harness.spawn,
    })
    const started = runtime.startSession({
      directory: '/work/demo',
      providerId: 'codex',
      sessionId: 'session-1',
    })
    const child = harness.children[0]
    const startRequest = readProtocolRequest(child)
    child.stdout.emit(
      'data',
      `${JSON.stringify({ id: startRequest.id, result: { sessionId: 'session-1' } })}\n`,
    )
    await started

    child.stdout.emit(
      'data',
      `${JSON.stringify({
        id: 'host-open',
        method: 'workspace.open',
        params: {
          directory:
            '/work/demo/.agent/optimization/noise-calibration/default-replay-1/workspace',
        },
      })}\n`,
    )
    await vi.waitFor(() => {
      expect(host.openWorkspace).toHaveBeenCalledWith({
        directory:
          '/work/demo/.agent/optimization/noise-calibration/default-replay-1/workspace',
      })
    })
  })

  it('passes workspaceRevision through sendMessage so the provider refreshes its session', async () => {
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

    const started = runtime.startSession({
      providerId: 'codex',
      sessionId: 'session-1',
      workspaceRevision: 4,
    })
    const child = harness.children[0]
    const startRequest = readProtocolRequest(child)
    child.stdout.emit(
      'data',
      `${JSON.stringify({ id: startRequest.id, result: { sessionId: 'session-1' } })}\n`,
    )
    await started

    const response = runtime.sendMessage({
      message: 'lower target density',
      providerId: 'codex',
      sessionId: 'session-1',
      workspaceRevision: 5,
    })
    const messageRequest = readProtocolRequest(child, 1)
    expect(messageRequest).toEqual({
      id: expect.any(String),
      method: 'sendMessage',
      params: expect.objectContaining({ workspaceRevision: 5 }),
    })
    child.stdout.emit(
      'data',
      `${JSON.stringify({
        id: messageRequest.id,
        result: { messageId: 'message-1', sessionId: 'session-1', turnId: 'turn-1' },
      })}\n`,
    )
    await expect(response).resolves.toEqual({
      messageId: 'message-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
    })
  })

  it('records operation associations for host execution commands', async () => {
    resetAgentOperationAssociations()
    const harness = createSpawnHarness()
    const host = {
      candidateCapabilities: vi.fn(),
      candidateRerun: vi.fn().mockResolvedValue({ operationId: 'op-rerun' }),
      candidateResume: vi.fn().mockResolvedValue({ operationId: 'op-resume' }),
      cancelOperation: vi.fn(),
      openWorkspace: vi.fn(),
      operationStatus: vi.fn(),
      startFlowOperation: vi.fn().mockResolvedValue({ operationId: 'op-run' }),
      waitForOperation: vi.fn(),
      workspaceSession: vi.fn().mockResolvedValue({ workspaceHandle: 'handle-1' }),
    }
    const runtime = new AgentProviderProcessRuntime({
      host,
      manifest: {
        command: 'codex-provider',
        manifestPath: '/plugins/codex/agent-provider.json',
        pluginRoot: '/plugins/codex',
        providerId: 'codex',
        protocolVersion: supportedAgentProviderProtocolVersion,
      },
      spawn: harness.spawn,
    })
    const started = runtime.startSession({
      providerId: 'codex',
      sessionId: 'session-1',
    })
    const child = harness.children[0]
    const startRequest = readProtocolRequest(child)
    child.stdout.emit(
      'data',
      `${JSON.stringify({ id: startRequest.id, result: { sessionId: 'session-1' } })}\n`,
    )
    await started

    for (const [id, method] of [
      ['host-run', 'workspace.run'],
      ['host-rerun', 'candidate.rerun'],
      ['host-resume', 'candidate.resume'],
    ] as const) {
      child.stdout.emit(
        'data',
        `${JSON.stringify({
          id,
          method,
          params: { workspaceHandle: 'handle-1' },
        })}\n`,
      )
    }

    await vi.waitFor(() => {
      expect(getAgentOperationAssociation('codex', 'op-run')).toMatchObject({
        command: 'workspace.run',
      })
      expect(getAgentOperationAssociation('codex', 'op-rerun')).toMatchObject({
        command: 'candidate.rerun',
      })
      expect(getAgentOperationAssociation('codex', 'op-resume')).toMatchObject({
        command: 'candidate.resume',
      })
    })
  })

  it('round-trips validated session model settings', async () => {
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
    const response = runtime.setModelSettings({
      providerId: 'codex',
      reasoningEffort: 'high',
      sessionId: 'session-1',
    })
    const child = harness.children[0]
    const request = readProtocolRequest(child)
    expect(request).toMatchObject({
      method: 'setModelSettings',
      params: { reasoningEffort: 'high', sessionId: 'session-1' },
    })

    child.stdout.emit(
      'data',
      `${JSON.stringify({
        id: request.id,
        result: {
          displayName: 'GPT Test',
          model: 'gpt-test',
          models: [
            {
              defaultReasoningEffort: 'medium',
              displayName: 'GPT Test',
              model: 'gpt-test',
              supportedReasoningEfforts: ['low', 'medium', 'high'],
            },
          ],
          reasoningEffort: 'high',
        },
      })}\n`,
    )

    await expect(response).resolves.toMatchObject({
      model: 'gpt-test',
      reasoningEffort: 'high',
    })
  })

  it('passes trusted manifest environment to the provider process', () => {
    const harness = createSpawnHarness()
    const env = { HOME: '/home/tester', PATH: '/tools/bin' }
    const runtime = new AgentProviderProcessRuntime({
      env,
      manifest: {
        command: 'ecos-agent-provider',
        environment: { ECOS_AGENT_CODEX_BIN: '~/.nvm/versions/node/v20.20.2/bin/codex' },
        manifestPath: '/plugins/ecos-agent/agent-provider.json',
        pluginRoot: '/plugins/ecos-agent',
        providerId: 'ecos_agent',
        protocolVersion: supportedAgentProviderProtocolVersion,
      },
      spawn: harness.spawn,
    })

    void runtime.getStatus({ providerId: 'ecos_agent' })

    expect(harness.spawn).toHaveBeenCalledWith('ecos-agent-provider', [], {
      cwd: '/plugins/ecos-agent',
      env: { ...env, ECOS_AGENT_CODEX_BIN: '~/.nvm/versions/node/v20.20.2/bin/codex' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  })

  it('reloads the provider child when Codex bin override changes', async () => {
    const harness = createSpawnHarness()
    const env = { HOME: '/home/tester', PATH: '/tools/bin' }
    const runtime = new AgentProviderProcessRuntime({
      env,
      manifest: {
        command: 'ecos-agent-provider',
        manifestPath: '/plugins/ecos-agent/agent-provider.json',
        pluginRoot: '/plugins/ecos-agent',
        providerId: 'ecos_agent',
        protocolVersion: supportedAgentProviderProtocolVersion,
      },
      spawn: harness.spawn,
    })

    const pending = runtime.getStatus({ providerId: 'ecos_agent' })
    expect(harness.children).toHaveLength(1)

    runtime.syncEnvironmentOverrides({
      ECOS_AGENT_CODEX_BIN: '/managed/bin/codex',
    })
    await expect(pending).rejects.toThrow('restarted to apply Codex CLI path')
    expect(harness.children[0].kill).toHaveBeenCalled()

    void runtime.getStatus({ providerId: 'ecos_agent' })
    expect(harness.spawn).toHaveBeenLastCalledWith('ecos-agent-provider', [], {
      cwd: '/plugins/ecos-agent',
      env: { ...env, ECOS_AGENT_CODEX_BIN: '/managed/bin/codex' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  })

  it('reloads the provider child when the model-source environment changes', async () => {
    const harness = createSpawnHarness()
    const env = { HOME: '/home/tester', PATH: '/tools/bin' }
    const runtime = new AgentProviderProcessRuntime({
      env,
      manifest: {
        command: 'ecos-agent-provider',
        manifestPath: '/plugins/ecos-agent/agent-provider.json',
        pluginRoot: '/plugins/ecos-agent',
        providerId: 'ecos_agent',
        protocolVersion: supportedAgentProviderProtocolVersion,
      },
      spawn: harness.spawn,
    })

    const stale = runtime.getStatus({ providerId: 'ecos_agent' })
    expect(harness.children).toHaveLength(1)

    // GLM -> codex source switch: same binary, different CODEX_HOME/API keys.
    runtime.syncEnvironmentOverrides({
      ECOS_AGENT_CODEX_BIN: '/usr/bin/codex',
      CODEX_HOME: undefined,
      ZAI_API_KEY: undefined,
      OPENAI_API_KEY: 'sk-test',
      PATH: '/tools/bin:/usr/bin',
    })
    await expect(stale).rejects.toThrow('restarted')
    expect(harness.children[0].kill).toHaveBeenCalled()

    void runtime.getStatus({ providerId: 'ecos_agent' })
    expect(harness.spawn).toHaveBeenLastCalledWith('ecos-agent-provider', [], {
      cwd: '/plugins/ecos-agent',
      env: {
        ...env,
        ECOS_AGENT_CODEX_BIN: '/usr/bin/codex',
        OPENAI_API_KEY: 'sk-test',
        PATH: '/tools/bin:/usr/bin',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  })

  it('includes a bounded provider stderr diagnostic when the process exits', async () => {
    const harness = createSpawnHarness()
    const runtime = new AgentProviderProcessRuntime({
      manifest: {
        command: 'ecos-agent',
        manifestPath: '/plugins/ecos-agent/agent-provider.json',
        pluginRoot: '/plugins/ecos-agent',
        providerId: 'ecos_agent',
        protocolVersion: supportedAgentProviderProtocolVersion,
      },
      spawn: harness.spawn,
    })

    const response = runtime.getStatus({ providerId: 'ecos_agent' })
    const child = harness.children[0]
    child.stderr.emit('data', 'Codex CLI is required for ECOS Agent\n')
    child.emit('close', 127, null)

    await expect(response).rejects.toThrow('Codex CLI is required for ECOS Agent')
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
      providers: [{ providerId: 'local', runtime }],
    })
    const listener = vi.fn()
    manager.onEvent(listener)

    void runtime.getStatus({ providerId: 'local' })
    const child = harness.children[0]
    child.stdout.emit(
      'data',
      `${JSON.stringify({
        event: {
          text: 'working',
          type: 'message',
        },
        type: 'event',
      })}\n`,
    )

    expect(listener).toHaveBeenCalledWith({
      providerId: 'local',
      text: 'working',
      type: 'message',
    })
  })

  it('forwards optimization decision and incumbent evidence fields', () => {
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
    const listener = vi.fn()
    runtime.onEvent(listener)

    void runtime.getStatus({ providerId: 'local' })
    harness.children[0].stdout.emit(
      'data',
      `${JSON.stringify({
        event: {
          optimization: {
            action: { direction: 'increase', knob_id: 'place.cell_padding_x' },
            episode_id: 'episode-1',
            in_flight: 1,
            incumbent_candidate_root_ref: '.agent/candidates/winner',
            objective_sha256: `sha256:${'a'.repeat(64)}`,
            primary_metric: 'route_wirelength',
            proposal_decision: 'propose',
            proposal_reason: 'observation',
            rejection_reason: null,
            requested: { knob_id: 'place.cell_padding_x', value: 3 },
            schema_version: 'ecos.optimization_progress.v1',
          },
          type: 'optimization',
        },
        type: 'event',
      })}\n`,
    )

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        optimization: expect.objectContaining({
          action: { direction: 'increase', knob_id: 'place.cell_padding_x' },
          in_flight: 1,
          incumbent_candidate_root_ref: '.agent/candidates/winner',
          objective_sha256: `sha256:${'a'.repeat(64)}`,
          primary_metric: 'route_wirelength',
          proposal_decision: 'propose',
          proposal_reason: 'observation',
          rejection_reason: null,
          requested: { knob_id: 'place.cell_padding_x', value: 3 },
        }),
      }),
    )
  })

  it('forwards validated objective-alignment progress', () => {
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
    const listener = vi.fn()
    runtime.onEvent(listener)
    const objectiveHash = `sha256:${'a'.repeat(64)}`

    void runtime.getStatus({ providerId: 'local' })
    harness.children[0].stdout.emit(
      'data',
      `${JSON.stringify({
        event: {
          optimization: {
            active_preserve_metrics: [
              'sta_setup_violation_count',
              'sta_hold_violation_count',
            ],
            active_primary_metric: 'drc_count',
            alignment_sha256: `sha256:${'b'.repeat(64)}`,
            episode_id: 'episode-1',
            objective_sha256: objectiveHash,
            original_objective: { contract_sha256: objectiveHash },
            original_primary_metric: 'route_wirelength',
            recovery_incomplete: true,
            recovery_stage: 'drc',
            recovery_transition: null,
            schema_version: 'ecos.optimization_progress.v2',
            violation_counts: {
              drc_count: 4,
              sta_hold_violation_count: 0,
              sta_setup_violation_count: 2,
            },
          },
          type: 'optimization',
        },
        type: 'event',
      })}\n`,
    )

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        optimization: expect.objectContaining({
          active_primary_metric: 'drc_count',
          alignment_sha256: `sha256:${'b'.repeat(64)}`,
          recovery_incomplete: true,
          recovery_stage: 'drc',
          violation_counts: {
            drc_count: 4,
            sta_hold_violation_count: 0,
            sta_setup_violation_count: 2,
          },
        }),
      }),
    )
  })

  it.each([
    { active_preserve_metrics: ['drc_count', 'setup', 'hold'] },
    {
      violation_counts: {
        drc_count: -1,
        sta_hold_violation_count: 0,
        sta_setup_violation_count: 0,
      },
    },
  ])('drops malformed objective-alignment progress', (override) => {
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
    const listener = vi.fn()
    runtime.onEvent(listener)
    const objectiveHash = `sha256:${'a'.repeat(64)}`
    const payload = {
      active_preserve_metrics: ['sta_setup_violation_count', 'sta_hold_violation_count'],
      active_primary_metric: 'drc_count',
      alignment_sha256: `sha256:${'b'.repeat(64)}`,
      episode_id: 'episode-1',
      objective_sha256: objectiveHash,
      original_objective: { contract_sha256: objectiveHash },
      original_primary_metric: 'route_wirelength',
      recovery_stage: 'drc',
      schema_version: 'ecos.optimization_progress.v2',
      violation_counts: {
        drc_count: 4,
        sta_hold_violation_count: 0,
        sta_setup_violation_count: 2,
      },
      ...override,
    }

    void runtime.getStatus({ providerId: 'local' })
    harness.children[0].stdout.emit(
      'data',
      `${JSON.stringify({ event: { optimization: payload, type: 'optimization' }, type: 'event' })}\n`,
    )

    expect(listener).not.toHaveBeenCalled()
  })

  it('forwards optimization turn events with proposal rationale', () => {
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
    const listener = vi.fn()
    runtime.onEvent(listener)

    void runtime.getStatus({ providerId: 'local' })
    harness.children[0].stdout.emit(
      'data',
      `${JSON.stringify({
        event: {
          optimization: {
            active_primary_metric: 'drc_count',
            episode_id: 'episode-1',
            kind: 'proposal',
            proposal_decision: 'propose',
            proposal_reason: 'observation',
            rationale_summary: 'Increase padding to absorb DRC hotspots.',
            action: { direction: 'increase', knob_id: 'place.cell_padding_x' },
            requested: { knob_id: 'place.cell_padding_x', value: 3 },
            recovery_stage: 'drc',
            schema_version: 'ecos.optimization_turn_event.v1',
          },
          type: 'optimization',
        },
        type: 'event',
      })}\n`,
    )

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        optimization: expect.objectContaining({
          kind: 'proposal',
          proposal_decision: 'propose',
          proposal_reason: 'observation',
          rationale_summary: 'Increase padding to absorb DRC hotspots.',
          action: { direction: 'increase', knob_id: 'place.cell_padding_x' },
          requested: { knob_id: 'place.cell_padding_x', value: 3 },
        }),
      }),
    )
  })

  it('forwards structured interactions, status, and streaming fields', () => {
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
    const listener = vi.fn()
    runtime.onEvent(listener)

    void runtime.getStatus({ providerId: 'local' })
    harness.children[0].stdout.emit(
      'data',
      `${JSON.stringify({
        event: {
          interaction: {
            interaction: {
              kind: 'choice',
              options: [
                { id: 'confirm-yes', label: 'Confirm' },
                { id: 'confirm-no', label: 'Cancel' },
              ],
              variant: 'buttons',
            },
            kind: 'choice',
            purpose: 'execution',
            requestId: 'confirm-1',
            schema_version: 'flow-agent.interaction_request.v1',
            status: 'pending',
            title: 'Confirm execution',
          },
          delta: 'working',
          messageId: 'message-1',
          sessionId: 'session-1',
          status: 'awaiting_interaction',
          type: 'interaction',
        },
        type: 'event',
      })}\n`,
    )

    expect(listener).toHaveBeenCalledWith({
      interaction: expect.objectContaining({
        interaction: expect.objectContaining({
          options: expect.arrayContaining([{ id: 'confirm-yes', label: 'Confirm' }]),
          variant: 'buttons',
        }),
        kind: 'choice',
        purpose: 'execution',
        requestId: 'confirm-1',
        status: 'pending',
      }),
      delta: 'working',
      messageId: 'message-1',
      providerId: 'local',
      sessionId: 'session-1',
      status: 'awaiting_interaction',
      type: 'interaction',
    })
  })

  it('drops malformed execution contracts from provider stdout', () => {
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
    const listener = vi.fn()
    runtime.onEvent(listener)

    void runtime.getStatus({ providerId: 'local' })
    harness.children[0].stdout.emit(
      'data',
      `${JSON.stringify({
        event: {
          contract: { fields: [], title: 'Unvalidated contract' },
          type: 'contract',
        },
        type: 'event',
      })}\n`,
    )

    expect(listener).not.toHaveBeenCalled()
  })

  it('validates structured Agent activity before forwarding it', () => {
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
    const listener = vi.fn()
    runtime.onEvent(listener)

    void runtime.getStatus({ providerId: 'local' })
    harness.children[0].stdout.emit(
      'data',
      `${JSON.stringify({
        event: {
          activity: {
            itemId: 'reasoning-1',
            kind: 'reasoning_summary',
            schema_version: 'flow-agent.activity.v1',
            startedAt: 1000,
            status: 'running',
            summary: ['Inspecting the flow inputs.'],
            turnId: 'turn-1',
            turnStartedAt: 900,
          },
          sessionId: 'session-1',
          type: 'activity',
        },
        type: 'event',
      })}\n`,
    )

    expect(listener).toHaveBeenCalledWith({
      activity: expect.objectContaining({
        itemId: 'reasoning-1',
        kind: 'reasoning_summary',
        summary: ['Inspecting the flow inputs.'],
        turnId: 'turn-1',
      }),
      providerId: 'local',
      sessionId: 'session-1',
      type: 'activity',
    })
  })

  it('accepts ECOS local activity identifiers at the process boundary', () => {
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
    const listener = vi.fn()
    runtime.onEvent(listener)

    void runtime.getStatus({ providerId: 'local' })
    harness.children[0].stdout.emit(
      'data',
      `${JSON.stringify({
        event: {
          activity: {
            arguments: '{"candidate_stages":["cts"]}',
            itemId: 'local-knowledge-search',
            kind: 'tool_call',
            result: '{"match_count":3}',
            schema_version: 'flow-agent.activity.v1',
            startedAt: 1000,
            status: 'completed',
            tool: 'Searched ECOS knowledge',
            turnId: 'turn-1',
            turnStartedAt: 900,
          },
          sessionId: 'session-1',
          type: 'activity',
        },
        type: 'event',
      })}\n`,
    )

    expect(listener).toHaveBeenCalledWith({
      activity: expect.objectContaining({
        itemId: 'local-knowledge-search',
        kind: 'tool_call',
        tool: 'Searched ECOS knowledge',
        turnId: 'turn-1',
      }),
      providerId: 'local',
      sessionId: 'session-1',
      type: 'activity',
    })
  })

  it('replaces malformed activity with a non-blocking notice', () => {
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
    const listener = vi.fn()
    runtime.onEvent(listener)

    void runtime.getStatus({ providerId: 'local' })
    harness.children[0].stdout.emit(
      'data',
      `${JSON.stringify({
        event: {
          activity: {
            itemId: 'reasoning-1',
            kind: 'reasoning_summary',
            schema_version: 'flow-agent.activity.v1',
            status: 'running',
            summary: [],
            turnId: 'turn-1',
          },
          sessionId: 'session-1',
          type: 'activity',
        },
        type: 'event',
      })}\n`,
    )

    expect(listener).toHaveBeenCalledWith({
      activityNotice: {
        message: 'Some activity details are unavailable.',
        schema_version: 'flow-agent.activity_notice.v1',
        turnId: 'turn-1',
      },
      providerId: 'local',
      sessionId: 'session-1',
      type: 'activity',
    })
  })

  it('preserves select defaults and required state in interaction forms', () => {
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
    const listener = vi.fn()
    runtime.onEvent(listener)

    void runtime.getStatus({ providerId: 'local' })
    const child = harness.children[0]
    child.stdout.emit(
      'data',
      `${JSON.stringify({
        event: {
          interaction: {
            interaction: {
              fields: [
                {
                  defaultValue: 'project-b',
                  id: 'project',
                  kind: 'select',
                  label: 'Project',
                  options: [
                    { id: 'project-a', label: 'Project A' },
                    { id: 'project-b', label: 'Project B' },
                  ],
                  required: true,
                },
              ],
              kind: 'form',
            },
            kind: 'form',
            purpose: 'execution',
            requestId: 'form-1',
            schema_version: 'flow-agent.interaction_request.v1',
            status: 'pending',
            title: 'Choose a project',
          },
          type: 'interaction',
        },
        type: 'event',
      })}\n`,
    )

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        interaction: expect.objectContaining({
          interaction: expect.objectContaining({
            fields: [
              expect.objectContaining({
                defaultValue: 'project-b',
                required: true,
              }),
            ],
          }),
        }),
      }),
    )
  })

  it('rebuilds rerun confirmation fields from the frozen execution payload', () => {
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
    const listener = vi.fn()
    runtime.onEvent(listener)

    void runtime.getStatus({ providerId: 'local' })
    harness.children[0].stdout.emit(
      'data',
      `${JSON.stringify({
        event: {
          contract: {
            fields: [{ label: 'untrusted', value: 'untrusted' }],
            presentation: 'workspace_rerun',
            schema_version: 'flow-agent.resolved_execution_contract.v1',
            title: 'Workspace rerun plan',
            workspace_rerun: {
              design_id: 'gcd',
              end_step: 'place',
              execution_scope: 'single_step',
              parameter_patch: [{ knob_id: 'place.target_density', value: 0.55 }],
              requires_gui_review: true,
              rerun_id: 'gcd_rerun_place',
              schema_version: 'flow-agent.workspace_rerun_contract.v1',
              source_stage_artifact: 'place_dreamplace/output/gcd_place.def.gz',
              source_flow_json_sha256: `sha256:${'a'.repeat(64)}`,
              source_stage_artifact_sha256: `sha256:${'b'.repeat(64)}`,
              source_workspace: '/runs/gcd',
              target_step: 'place',
              target_workspace: '/runs/gcd_rerun_place',
            },
          },
          sessionId: 'session-1',
          type: 'contract',
        },
        type: 'event',
      })}\n`,
    )

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        contract: expect.objectContaining({
          confirmation_token: expect.any(String),
          fields: expect.arrayContaining([
            { label: 'place.target_density', value: '0.55' },
          ]),
          presentation: 'workspace_rerun',
        }),
        type: 'contract',
      }),
    )
  })

  it('forwards validated workspace setup contracts from provider stdout', () => {
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
    const listener = vi.fn()
    runtime.onEvent(listener)

    void runtime.getStatus({ providerId: 'local' })
    harness.children[0].stdout.emit(
      'data',
      `${JSON.stringify({
        event: {
          type: 'workspace_setup',
          workspaceSetup: {
            schema_version: 'flow-agent.workspace_setup_contract.v2',
            setup_id: 'setup-1',
            title: 'Workspace run plan',
            directory: '/runs/gcd_trial',
            pdk: 'ics55',
            pdk_root: '/pdk/ics55',
            rtl_list: ['/rtl/gcd.v'],
            design_input_mode: 'rtl',
            pdk_config_mode: 'default',
            pdk_config: { mode: 'default', tech_lef: [], cell_lef: [], liberty: [] },
            project_context: {
              mode: 'create',
              project_name: 'runs',
              project_root: '/runs',
              project_json_path: '/runs/project.json',
            },
            parameters: {
              design: 'gcd',
              top_module: 'gcd',
              clock: 'clk',
              description: '',
              frequency_max: 50,
              die_area_mode: 'utilitization_margin',
              utilitization: 0.4,
              margin: 0,
              max_fanout: 32,
              target_density: 0.2,
              target_overflow: 0,
            },
            flow_config: {
              start_step: 'Synthesis',
              end_step: 'Harden',
              steps: [
                'Synthesis',
                'lec',
                'preFloorplan',
                'macroPlacement',
                'postFloorplan',
                'place',
                'CTS',
                'legalization',
                'Timing optimization',
                'route',
                'filler',
                'RCX',
                'sta',
                'lvs',
                'postRouteLec',
                'drc',
                'Harden',
              ],
            },
            requires_gui_review: true,
          },
        },
        type: 'event',
      })}\n`,
    )

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workspace_setup',
        workspaceSetup: expect.objectContaining({ pdk: 'ics55' }),
      }),
    )
  })

  it('forwards only validated workspace signoff contracts', () => {
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
    const listener = vi.fn()
    runtime.onEvent(listener)
    void runtime.getStatus({ providerId: 'local' })
    harness.children[0].stdout.emit(
      'data',
      `${JSON.stringify({
        event: {
          type: 'workspace_signoff',
          workspaceSignoff: {
            action: 'inspect',
            schema_version: 'flow-agent.workspace_signoff_contract.v1',
            signoff_id: 'signoff-1',
            workspace: '/runs/gcd',
          },
        },
        type: 'event',
      })}\n`,
    )
    expect(listener).toHaveBeenCalledWith({
      providerId: 'local',
      type: 'workspace_signoff',
      workspaceSignoff: {
        action: 'inspect',
        schema_version: 'flow-agent.workspace_signoff_contract.v1',
        signoff_id: 'signoff-1',
        workspace: '/runs/gcd',
      },
    })

    listener.mockClear()
    harness.children[0].stdout.emit(
      'data',
      `${JSON.stringify({
        event: {
          type: 'workspace_signoff',
          workspaceSignoff: {
            action: 'export',
            schema_version: 'flow-agent.workspace_signoff_contract.v1',
            signoff_id: 'signoff-2',
            workspace: 'relative/path',
          },
        },
        type: 'event',
      })}\n`,
    )
    expect(listener).not.toHaveBeenCalled()
  })

  it('drops workspace setup contracts with an invalid MPC snapshot', () => {
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
    const listener = vi.fn()
    runtime.onEvent(listener)
    void runtime.getStatus({ providerId: 'local' })
    harness.children[0].stdout.emit(
      'data',
      `${JSON.stringify({
        event: {
          type: 'workspace_setup',
          workspaceSetup: {
            schema_version: 'flow-agent.workspace_setup_contract.v2',
            setup_id: 'setup-invalid-mpc',
            title: 'Workspace run plan',
            directory: '/runs/gcd_trial',
            pdk: 'ics55',
            pdk_root: '/pdk/ics55',
            rtl_list: ['/rtl/gcd.v'],
            design_input_mode: 'rtl',
            pdk_config_mode: 'default',
            pdk_config: { mode: 'default', tech_lef: [], cell_lef: [], liberty: [] },
            project_context: {
              mode: 'create',
              project_name: 'runs',
              project_root: '/runs',
              project_json_path: '/runs/project.json',
            },
            parameters: {
              design: 'gcd',
              top_module: 'gcd',
              clock: 'clk',
              description: '',
              frequency_max: 50,
              die_area_mode: 'utilitization_margin',
              utilitization: 0.4,
              margin: 0,
              max_fanout: 32,
              target_density: 0.2,
              target_overflow: 0,
            },
            flow_config: {
              start_step: 'Synthesis',
              end_step: 'Harden',
              steps: ['Synthesis', 'Harden'],
            },
            requires_gui_review: true,
            mpc: { resource_id: 'mpc:bad', path: 'relative/path' },
          },
        },
        type: 'event',
      })}\n`,
    )

    expect(listener).not.toHaveBeenCalled()
  })

  it('forwards a validated workspace rerun only after the user confirms it', () => {
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
    const listener = vi.fn()
    runtime.onEvent(listener)

    void runtime.startSession({ providerId: 'local', sessionId: 'session-1' })
    const workspaceRerun = {
      design_id: 'gcd',
      end_step: 'place',
      execution_scope: 'single_step',
      parameter_patch: [{ knob_id: 'place.target_density', value: 0.55 }],
      requires_gui_review: true,
      rerun_id: 'gcd_rerun_place',
      schema_version: 'flow-agent.workspace_rerun_contract.v1',
      source_stage_artifact: 'place_dreamplace/output/gcd_place.def.gz',
      source_flow_json_sha256: `sha256:${'a'.repeat(64)}`,
      source_stage_artifact_sha256: `sha256:${'b'.repeat(64)}`,
      source_workspace: '/runs/gcd',
      target_step: 'place',
      target_workspace: '/runs/gcd_rerun_place',
    }
    harness.children[0].stdout.emit(
      'data',
      `${JSON.stringify({
        event: {
          contract: {
            fields: [{ label: 'ignored', value: 'ignored' }],
            presentation: 'workspace_rerun',
            schema_version: 'flow-agent.resolved_execution_contract.v1',
            title: 'Workspace rerun plan',
            workspace_rerun: workspaceRerun,
          },
          sessionId: 'session-1',
          type: 'contract',
        },
        type: 'event',
      })}\n`,
    )
    const confirmationToken = listener.mock.calls[0][0].contract.confirmation_token
    listener.mockClear()
    void runtime.sendMessage({
      confirmationToken,
      message: '1',
      providerId: 'local',
      sessionId: 'session-1',
    })
    harness.children[0].stdout.emit(
      'data',
      `${JSON.stringify({
        event: {
          sessionId: 'session-1',
          type: 'workspace_rerun',
          workspaceRerun,
        },
        type: 'event',
      })}\n`,
    )

    expect(listener).toHaveBeenCalledWith({
      providerId: 'local',
      sessionId: 'session-1',
      type: 'workspace_rerun',
      workspaceRerun: expect.objectContaining({
        rerun_id: 'gcd_rerun_place',
        end_step: 'place',
        source_flow_json_sha256: 'a'.repeat(64),
        source_stage_artifact_sha256: 'b'.repeat(64),
        workspace_parameters: { 'place.target_density': 0.55 },
        step_configurations: [],
      }),
    })
  })

  const parameterUpdateEvent = (overrides: Record<string, unknown> = {}): string =>
    `${JSON.stringify({
      event: {
        sessionId: 'session-1',
        type: 'workspace_parameter_update',
        workspaceParameterUpdate: {
          parameter_patch: [{ knob_id: 'floorplan.utilitization', value: 0.7 }],
          schema_version: 'flow-agent.workspace_parameter_update_contract.v3',
          update_id: 'update_1',
          workspace: '/runs/gcd',
          ...overrides,
        },
      },
      type: 'event',
    })}\n`

  const emitParameterUpdate = (
    overrides: Record<string, unknown> = {},
    action: 'confirm' | 'cancel' | 'none' = 'confirm',
  ) => {
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
    const listener = vi.fn()
    runtime.onEvent(listener)
    void runtime.startSession({
      providerId: 'local',
      sessionId: 'session-1',
      workspaceRevision: 4,
    })
    const patch =
      (overrides.confirmation_patch as unknown[]) ??
      (overrides.parameter_patch as unknown[]) ?? [
        { knob_id: 'floorplan.utilitization', value: 0.7 },
      ]
    harness.children[0].stdout.emit(
      'data',
      `${JSON.stringify({
        event: {
          contract: {
            fields: [{ label: 'ignored', value: 'ignored' }],
            parameter_patch: patch,
            presentation: 'workspace_parameter_update',
            schema_version: 'flow-agent.resolved_execution_contract.v1',
            title: 'Confirm parameter update',
            update_id: 'update_1',
            workspace: '/runs/gcd',
          },
          sessionId: 'session-1',
          type: 'contract',
        },
        type: 'event',
      })}\n`,
    )
    const confirmationToken = listener.mock.calls[0]?.[0].contract?.confirmation_token
    if (confirmationToken && action !== 'none') {
      void runtime.sendMessage({
        ...(action === 'confirm' ? { confirmationToken } : {}),
        message: action === 'confirm' ? '1' : '2',
        providerId: 'local',
        sessionId: 'session-1',
      })
    }
    listener.mockClear()
    harness.children[0].stdout.emit('data', parameterUpdateEvent(overrides))
    return listener
  }

  it('derives canonical domain updates from the confirmed logical patch', () => {
    const listener = emitParameterUpdate({
      parameter_patch: [
        { knob_id: 'floorplan.utilitization', value: 0.7 },
        { knob_id: 'cts.skew_bound', value: 0.08 },
      ],
    })

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workspace_parameter_update',
        workspaceParameterUpdate: expect.objectContaining({
          schema_version: 'flow-agent.workspace_parameter_update_contract.v3',
          workspace_parameters: {
            'floorplan.core_util': 0.7,
            'cts.skew_bound': '0.08',
          },
          step_configurations: [],
          workspace_revision: 4,
        }),
      }),
    )
  })

  it('drops parameter updates that were not confirmed or were cancelled', () => {
    expect(emitParameterUpdate({}, 'none')).not.toHaveBeenCalled()
    expect(emitParameterUpdate({}, 'cancel')).not.toHaveBeenCalled()
  })

  it('drops obsolete provider-supplied domain updates', () => {
    expect(
      emitParameterUpdate({ workspace_parameters: { core_utilization: 0.8 } }),
    ).not.toHaveBeenCalled()
    expect(
      emitParameterUpdate({
        workspace_parameters: { core_utilization: 0.7 },
        step_configurations: [{ step_id: 'CTS', options: { skew_bound: 0.08 } }],
      }),
    ).not.toHaveBeenCalled()
  })

  it('drops an update whose patch differs from the confirmed card', () => {
    expect(
      emitParameterUpdate({
        confirmation_patch: [{ knob_id: 'floorplan.utilitization', value: 0.6 }],
        parameter_patch: [{ knob_id: 'floorplan.utilitization', value: 0.7 }],
      }),
    ).not.toHaveBeenCalled()
  })

  it('drops legacy file-write contracts', () => {
    expect(
      emitParameterUpdate({
        schema_version: 'flow-agent.workspace_parameter_update_contract.v2',
        writes: [{ file: 'home/parameters.json', json_path: ['Core'] }],
      }),
    ).not.toHaveBeenCalled()
  })

  it('drops invalid Workspace Parameter identities', () => {
    expect(
      emitParameterUpdate({
        parameter_patch: [{ knob_id: 'Core.Utilitization', value: 0.7 }],
      }),
    ).not.toHaveBeenCalled()
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

    await expect(response).rejects.toThrow('Agent provider codex exited with code 1')
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
    harness.children[1].stdout.emit(
      'data',
      `${JSON.stringify({
        id: secondRequest.id,
        result: {
          providerId: 'codex',
          state: 'ready',
        },
      })}\n`,
    )

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

    harness.children[1].stdout.emit(
      'data',
      `${JSON.stringify({
        id: secondRequest.id,
        result: {
          providerId: 'codex',
          state: 'ready',
        },
      })}\n`,
    )

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
    await expect(firstResponse).rejects.toThrow('Agent provider codex exited with code 1')

    const secondResponse = runtime.getStatus({ providerId: 'codex' })
    const secondChild = harness.children[1]
    const secondRequest = readProtocolRequest(secondChild)
    secondChild.stdout.emit(
      'data',
      `${JSON.stringify({
        id: secondRequest.id,
        result: {
          providerId: 'codex',
          state: 'ready',
        },
      })}\n`,
    )

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

    await expect(response).rejects.toThrow('Invalid JSON from agent provider codex')
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
      providers: [{ providerId: 'codex', runtime }],
    })
    manager.onEvent(() => {
      throw new Error('listener failed')
    })

    const response = runtime.getStatus({ providerId: 'codex' })
    const child = harness.children[0]
    const request = readProtocolRequest(child)

    expect(() => {
      child.stdout.emit(
        'data',
        `${JSON.stringify({
          event: {
            text: 'working',
            type: 'message',
          },
          type: 'event',
        })}\n`,
      )
    }).toThrow('listener failed')

    child.stdout.emit(
      'data',
      `${JSON.stringify({
        id: request.id,
        result: {
          providerId: 'codex',
          state: 'ready',
        },
      })}\n`,
    )

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
      providers: [{ providerId: 'codex', runtime }],
    })
    manager.onEvent(() => {
      throw new Error('listener failed')
    })

    const response = runtime.getStatus({ providerId: 'codex' })
    const child = harness.children[0]
    const request = readProtocolRequest(child)

    expect(() => {
      child.stdout.emit(
        'data',
        `${JSON.stringify({
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
        })}\n`,
      )
    }).toThrow('listener failed')

    await expect(
      Promise.race([
        response,
        new Promise((resolve) => {
          setTimeout(() => resolve({ timedOut: true }), 25)
        }),
      ]),
    ).resolves.toEqual({
      providerId: 'codex',
      state: 'ready',
    })
  })
})
