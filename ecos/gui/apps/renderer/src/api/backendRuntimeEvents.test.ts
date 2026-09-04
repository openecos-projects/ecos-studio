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

import { createBackendRuntimeEventClient } from './backendRuntimeEvents'

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
})
