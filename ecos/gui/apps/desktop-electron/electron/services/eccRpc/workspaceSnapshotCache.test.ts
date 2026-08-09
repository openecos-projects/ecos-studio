import { describe, expect, it, vi } from 'vitest'

import {
  WorkspaceSnapshotCache,
  type DetachedWorkspaceSnapshot,
} from './workspaceSnapshotCache'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

describe('WorkspaceSnapshotCache', () => {
  it('coalesces concurrent idle loads into one bounded loader request', async () => {
    const cache = new WorkspaceSnapshotCache()
    const pending = deferred<DetachedWorkspaceSnapshot>()
    const loader = vi.fn<(directory: string) => Promise<DetachedWorkspaceSnapshot>>(
      () => pending.promise,
    )

    const first = cache.loadIdle('/nfs/workspace', loader)
    const second = cache.loadIdle('/nfs/workspace', loader)

    expect(loader).toHaveBeenCalledOnce()
    pending.resolve({
      directory: '/nfs/workspace',
      flow: { steps: [] },
      home: {},
      lastEventId: 'disk:1',
      operations: [],
      parameters: {},
    })
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ lastEventId: 'disk:1' }),
      expect.objectContaining({ lastEventId: 'disk:1' }),
    ])
  })
})
