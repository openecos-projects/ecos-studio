import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EccRuntimeEvent } from '@ecos-studio/shared'

// Companion to runtimeEvents.desktop-rpc.test.ts (which stays byte-for-byte
// stable as the contract regression net). These cases pin the shape of the
// Electron-synthesized step.log events against the live mapping.

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')

function setWindow(value: unknown) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value,
    writable: true,
  })
}

function restoreWindow() {
  if (originalWindow) {
    Object.defineProperty(globalThis, 'window', originalWindow)
    return
  }

  delete (globalThis as { window?: unknown }).window
}

describe('synthesized step.log events (Electron archiver producer)', () => {
  afterEach(() => {
    restoreWindow()
    vi.resetModules()
  })

  it('maps synthesized step.log events from a full flow onto rtl2gds', async () => {
    const listeners: Array<(event: EccRuntimeEvent) => void> = []
    setWindow({
      ecosDesktop: {
        ecc: {
          events: {
            onEvent: (listener: (event: EccRuntimeEvent) => void) => {
              listeners.push(listener)
              return () => undefined
            },
          },
        },
      },
    })

    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('workspace-handle-1')
    const logHandler = vi.fn()
    client.on('log', logHandler)
    client.connect()

    // The Electron event bridge synthesizes step.log with a minted uuid
    // eventId and the most recently observed ecc sequence (repeated values).
    listeners[0]({
      event: {
        eventId: '2f3b6f42-8d3c-4f1e-9c4a-1f0c2b7a9d01',
        kind: 'flow',
        operationId: 'operation-1',
        origin: 'gui',
        payload: {
          chunk: 'synthesized chunk one\n',
          cursor: 23,
          step: 'Synthesis',
          tool: 'yosys',
        },
        sequence: 7,
        timestamp: 1,
        type: 'step.log',
        workspaceId: 'workspace-1',
      },
      type: 'runtime.protocol',
      workspaceHandle: 'workspace-handle-1',
    })

    expect(logHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cmd: 'rtl2gds',
          logChunk: 'synthesized chunk one\n',
          logCursor: 23,
          runtimeProtocolType: 'step.log',
          step: 'Synthesis',
          tool: 'yosys',
          type: 'log',
        }),
      }),
    )
  })

  it('accepts repeated sequence values on synthesized step.log events', async () => {
    const listeners: Array<(event: EccRuntimeEvent) => void> = []
    setWindow({
      ecosDesktop: {
        ecc: {
          events: {
            onEvent: (listener: (event: EccRuntimeEvent) => void) => {
              listeners.push(listener)
              return () => undefined
            },
          },
        },
      },
    })

    const { createRuntimeEventClient } = await import('./runtimeEvents')
    const client = createRuntimeEventClient('workspace-handle-1')
    const logHandler = vi.fn()
    client.on('log', logHandler)
    client.connect()

    for (const [chunk, cursor] of [
      ['first\n', 6],
      ['second\n', 13],
    ] as const) {
      listeners[0]({
        event: {
          eventId: `synthesized-${cursor}`,
          kind: 'flow',
          operationId: 'operation-1',
          origin: 'gui',
          payload: { chunk, cursor, step: 'Synthesis', tool: 'yosys' },
          sequence: 7,
          timestamp: 1,
          type: 'step.log',
          workspaceId: 'workspace-1',
        },
        type: 'runtime.protocol',
        workspaceHandle: 'workspace-handle-1',
      })
    }

    expect(logHandler).toHaveBeenCalledTimes(2)
    expect(logHandler.mock.calls[0]![0].data.logChunk).toBe('first\n')
    expect(logHandler.mock.calls[1]![0].data.logChunk).toBe('second\n')
  })
})
