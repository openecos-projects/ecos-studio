import { describe, expect, it, vi } from 'vitest'

import { runAfterAppReady } from './appReady'

describe('runAfterAppReady', () => {
  it('waits for whenReady before running the operation', async () => {
    const order: string[] = []
    let resolveReady!: () => void
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve
    })

    const operation = vi.fn(async () => {
      order.push('operation')
    })

    const pending = runAfterAppReady(async () => {
      order.push('ready-wait')
      await ready
      order.push('ready')
    }, operation)

    expect(operation).not.toHaveBeenCalled()
    resolveReady()
    await pending

    expect(operation).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['ready-wait', 'ready', 'operation'])
  })

  it('propagates operation failures', async () => {
    await expect(
      runAfterAppReady(
        async () => undefined,
        async () => {
          throw new Error('launch failed')
        },
      ),
    ).rejects.toThrow('launch failed')
  })
})
