import { describe, expect, it } from 'vitest'

import { WorkspaceStepConfigurationCache } from './workspaceStepConfigurationCache'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, reject, resolve }
}

describe('WorkspaceStepConfigurationCache', () => {
  it('reuses a committed value for the same key', async () => {
    const cache = new WorkspaceStepConfigurationCache<string>()
    let loads = 0

    await expect(
      cache.load('workspace-1:4:CTS', async () => {
        loads += 1
        return 'first'
      }),
    ).resolves.toBe('first')
    await expect(
      cache.load('workspace-1:4:CTS', async () => {
        loads += 1
        return 'second'
      }),
    ).resolves.toBe('first')

    expect(loads).toBe(1)
  })

  it('coalesces in-flight loads for the same key', async () => {
    const cache = new WorkspaceStepConfigurationCache<string>()
    const pending = deferred<string>()
    let loads = 0

    const first = cache.load('workspace-1:4:CTS', () => {
      loads += 1
      return pending.promise
    })
    const second = cache.load('workspace-1:4:CTS', () => {
      loads += 1
      return Promise.resolve('ignored')
    })
    pending.resolve('shared')

    await expect(Promise.all([first, second])).resolves.toEqual(['shared', 'shared'])
    expect(loads).toBe(1)
  })

  it('loads again after clear', async () => {
    const cache = new WorkspaceStepConfigurationCache<string>()
    let loads = 0
    await cache.load('workspace-1:4:CTS', async () => {
      loads += 1
      return 'first'
    })
    cache.clear()

    await expect(
      cache.load('workspace-1:4:CTS', async () => {
        loads += 1
        return 'second'
      }),
    ).resolves.toBe('second')
    expect(loads).toBe(2)
  })

  it('does not cache a rejected load', async () => {
    const cache = new WorkspaceStepConfigurationCache<string>()
    await expect(
      cache.load('workspace-1:4:CTS', async () => {
        throw new Error('unavailable')
      }),
    ).rejects.toThrow('unavailable')

    await expect(cache.load('workspace-1:4:CTS', async () => 'recovered')).resolves.toBe(
      'recovered',
    )
  })
})
