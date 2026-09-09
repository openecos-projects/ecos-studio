import type { DesignRuntimeEvent } from '@ecos-studio/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => {
  let listener: ((event: DesignRuntimeEvent) => void) | null = null
  return {
    emit: (event: DesignRuntimeEvent) => listener?.(event),
    onEvent: vi.fn((next: (event: DesignRuntimeEvent) => void) => {
      listener = next
      return vi.fn()
    }),
    reset: () => {
      listener = null
    },
  }
})

vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({ runtime: { events: { onEvent: bridge.onEvent } } }),
}))

import {
  connectBackendRuntimeEventSession,
  createBackendRuntimeEventClient,
  type BackendRuntimeEventSink,
} from './backendRuntimeEvents'

describe('createBackendRuntimeEventClient', () => {
  afterEach(() => {
    bridge.reset()
    vi.clearAllMocks()
  })

  it('delivers the canonical Backend event unchanged and filters other runtimes', () => {
    const client = createBackendRuntimeEventClient('workspace-handle', '/work/gcd')
    const handler = vi.fn()
    client.onAll(handler)
    client.connect()
    const event: DesignRuntimeEvent = {
      designTool: 'backend',
      event: {
        eventId: 'engineering-workspace:7',
        kind: 'flow',
        operationId: 'operation-1',
        origin: 'gui',
        payload: { sourceType: 'step.started', step: 'Place', tool: 'dreamplace' },
        sequence: 7,
        timestamp: 1,
        type: 'execution.progress',
        workspaceId: 'engineering-workspace',
        workspaceRevision: 4,
      },
      type: 'runtime.protocol',
      workspaceDirectory: '/work/gcd',
      workspaceHandle: 'workspace-handle',
    }

    bridge.emit({ ...event, designTool: 'frontend' })
    bridge.emit({
      ...event,
      workspaceDirectory: '/work/other',
      workspaceHandle: 'other-workspace',
    })
    bridge.emit(event)

    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith(event)
  })

  it('can reject stale handles that share the replacement directory', () => {
    const createClient = createBackendRuntimeEventClient as unknown as (
      workspaceHandle: string,
      workspaceDirectory: string,
      options?: { allowDirectoryFallback?: boolean },
    ) => ReturnType<typeof createBackendRuntimeEventClient>
    const client = createClient('new-workspace', '/work/gcd', {
      allowDirectoryFallback: false,
    })
    const handler = vi.fn()
    client.onAll(handler)
    client.connect()

    bridge.emit({
      designTool: 'backend',
      event: {
        eventId: 'engineering-workspace:8',
        kind: 'flow',
        operationId: 'old-operation',
        origin: 'gui',
        payload: { sourceType: 'step.completed', state: 'Skipped', step: 'Synthesis' },
        sequence: 8,
        timestamp: 1,
        type: 'execution.progress',
        workspaceId: 'old-engineering-workspace',
      },
      type: 'runtime.protocol',
      workspaceDirectory: '/work/gcd',
      workspaceHandle: 'old-workspace',
    })

    expect(handler).not.toHaveBeenCalled()
  })

  it('uses the directory only when a Backend event has no handle', () => {
    const client = createBackendRuntimeEventClient('workspace-handle', '/work/gcd')
    const handler = vi.fn()
    client.onAll(handler)
    client.connect()

    bridge.emit({
      designTool: 'backend',
      event: {
        eventId: 'engineering-workspace:9',
        kind: 'flow',
        operationId: 'operation-1',
        origin: 'gui',
        payload: { sourceType: 'step.started', step: 'Synthesis' },
        sequence: 9,
        timestamp: 1,
        type: 'execution.progress',
        workspaceId: 'engineering-workspace',
      },
      workspaceDirectory: '/work/gcd',
      type: 'runtime.protocol',
    } as DesignRuntimeEvent)

    expect(handler).toHaveBeenCalledOnce()
  })

  it('rejects a Backend event without a handle when its directory differs', () => {
    const client = createBackendRuntimeEventClient('workspace-handle', '/work/gcd')
    const handler = vi.fn()
    client.onAll(handler)
    client.connect()

    bridge.emit({
      designTool: 'backend',
      event: {
        eventId: 'engineering-workspace:10',
        kind: 'flow',
        operationId: 'operation-1',
        origin: 'gui',
        payload: { sourceType: 'step.started', step: 'Synthesis' },
        sequence: 10,
        timestamp: 1,
        type: 'execution.progress',
        workspaceId: 'engineering-workspace',
      },
      workspaceDirectory: '/work/other',
      type: 'runtime.protocol',
    } as DesignRuntimeEvent)

    expect(handler).not.toHaveBeenCalled()
  })
})

function createSink(): BackendRuntimeEventSink & {
  failures: unknown[]
  invalidations: Array<string | undefined>
} {
  const failures: unknown[] = []
  const invalidations: Array<string | undefined> = []
  return {
    failures,
    invalidations,
    isCurrent: () => true,
    onEvent: vi.fn(),
    onFailure: (failure) => {
      failures.push(failure)
    },
    onInvalidate: (step) => {
      invalidations.push(step)
    },
    onRevision: vi.fn(),
    onRerunPrepared: vi.fn(),
    onStepCommit: vi.fn(),
    onTerminal: vi.fn(),
  }
}

describe('connectBackendRuntimeEventSession', () => {
  afterEach(() => {
    bridge.reset()
    vi.clearAllMocks()
  })

  it('does not treat a configuration-update failure as a Flow failure', () => {
    const sink = createSink()
    connectBackendRuntimeEventSession('workspace-handle', '/work/gcd', sink)

    bridge.emit({
      code: 'invalid_request',
      designTool: 'backend',
      message: 'value 1.3 out of range [0.01, 1.0] for floorplan.core_util',
      method: 'workspace.configuration.update',
      operationId: 'operation-config',
      type: 'operation.failed',
      workspaceDirectory: '/work/gcd',
      workspaceHandle: 'workspace-handle',
    })

    expect(sink.failures).toEqual([])
    expect(sink.invalidations).toEqual([])
  })

  it('still reports a flow.run failure as a Flow failure', () => {
    const sink = createSink()
    connectBackendRuntimeEventSession('workspace-handle', '/work/gcd', sink)

    bridge.emit({
      code: 'command_failed',
      designTool: 'backend',
      message: 'Floorplan failed',
      method: 'flow.run',
      operationId: 'operation-flow',
      type: 'operation.failed',
      workspaceDirectory: '/work/gcd',
      workspaceHandle: 'workspace-handle',
    })

    expect(sink.failures).toEqual([
      expect.objectContaining({
        message: 'Floorplan failed',
        operationId: 'operation-flow',
        terminalState: 'failed',
      }),
    ])
    expect(sink.invalidations).toEqual([undefined])
  })
})
