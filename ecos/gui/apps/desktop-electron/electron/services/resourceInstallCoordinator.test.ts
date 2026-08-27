import { describe, expect, it, vi } from 'vitest'
import { ResourceMetadataRestoreError } from './resourceInstallErrors'
import { ResourceInstallCoordinator } from './resourceInstallCoordinator'

describe('ResourceInstallCoordinator', () => {
  it('keeps shared work alive while another root remains subscribed', async () => {
    const coordinator = new ResourceInstallCoordinator<string, string>()
    const started = deferred()
    const release = deferred()
    let dependencySignal: AbortSignal | undefined
    const dependencyTask = vi.fn(async (context: { signal: AbortSignal }) => {
      dependencySignal = context.signal
      started.resolve()
      await release.promise
      return 'dependency installed'
    })

    const first = coordinator.runRoot('tool:first', undefined, async (root) => {
      return await coordinator.runShared('tool:shared', root, dependencyTask)
    })
    const firstResult = first.catch((error: unknown) => error)
    await started.promise
    const secondSubscribed = deferred()
    const second = coordinator.runRoot('tool:second', undefined, async (root) => {
      const shared = coordinator.runShared('tool:shared', root, dependencyTask)
      secondSubscribed.resolve()
      return await shared
    })
    await secondSubscribed.promise

    await expect(coordinator.cancelAndWait('tool:first')).resolves.toBe('cancelled')
    expect(await firstResult).toMatchObject({ name: 'AbortError' })
    expect(dependencySignal?.aborted).toBe(false)

    release.resolve()
    await expect(second).resolves.toBe('dependency installed')
    expect(dependencyTask).toHaveBeenCalledTimes(1)
  })

  it('waits for exclusively owned work to stop before cancellation completes', async () => {
    const coordinator = new ResourceInstallCoordinator<string, string>()
    const started = deferred()
    const allowCleanup = deferred()
    const stopped = deferred()

    const root = coordinator.runRoot('tool:root', undefined, async (subscriber) => {
      return await coordinator.runShared(
        'tool:dependency',
        subscriber,
        async (context) => {
          started.resolve()
          await new Promise<void>((_resolve, reject) => {
            context.signal.addEventListener(
              'abort',
              async () => {
                await allowCleanup.promise
                stopped.resolve()
                reject(new DOMException('The operation was aborted.', 'AbortError'))
              },
              { once: true },
            )
          })
          return 'unreachable'
        },
      )
    })
    const rootResult = root.catch((error: unknown) => error)
    await started.promise

    let cancellationCompleted = false
    const cancellation = coordinator.cancelAndWait('tool:root').then((result) => {
      cancellationCompleted = true
      return result
    })
    await Promise.resolve()
    expect(cancellationCompleted).toBe(false)

    allowCleanup.resolve()
    await stopped.promise
    await expect(cancellation).resolves.toBe('cancelled')
    expect(await rootResult).toMatchObject({ name: 'AbortError' })
  })

  it('cancels every dependent root when shared work is cancelled directly', async () => {
    const coordinator = new ResourceInstallCoordinator<string, string>()
    const started = deferred()
    const dependencyTask = vi.fn(async (context: { signal: AbortSignal }) => {
      started.resolve()
      await new Promise<void>((_resolve, reject) => {
        context.signal.addEventListener(
          'abort',
          () => reject(new DOMException('The operation was aborted.', 'AbortError')),
          { once: true },
        )
      })
      return 'unreachable'
    })

    const first = coordinator.runRoot('tool:first', undefined, async (root) => {
      return await coordinator.runShared('tool:shared', root, dependencyTask)
    })
    const firstResult = first.catch((error: unknown) => error)
    await started.promise
    const secondSubscribed = deferred()
    const second = coordinator.runRoot('tool:second', undefined, async (root) => {
      const shared = coordinator.runShared('tool:shared', root, dependencyTask)
      secondSubscribed.resolve()
      return await shared
    })
    const secondResult = second.catch((error: unknown) => error)
    await secondSubscribed.promise

    await expect(coordinator.cancelAndWait('tool:shared')).resolves.toBe('cancelled')
    expect(await firstResult).toMatchObject({ name: 'AbortError' })
    expect(await secondResult).toMatchObject({ name: 'AbortError' })
    expect(dependencyTask).toHaveBeenCalledTimes(1)
    expect(coordinator.isActive('tool:first')).toBe(false)
    expect(coordinator.isActive('tool:second')).toBe(false)
  })

  it('cancels an unshared dependency synchronously before it can commit', async () => {
    const coordinator = new ResourceInstallCoordinator<string, string>()
    const dependencyStarted = deferred()
    const allowDependencyCommit = deferred()
    const commitTask = vi.fn(async () => undefined)
    let dependencySignal: AbortSignal | undefined

    const root = coordinator.runRoot('tool:parent', undefined, async (rootSubscriber) => {
      return await coordinator.runShared(
        'tool:parent',
        rootSubscriber,
        async (parentContext) => {
          return await coordinator.runShared(
            'tool:dependency',
            parentContext,
            async (dependencyContext) => {
              dependencySignal = dependencyContext.signal
              dependencyStarted.resolve()
              await allowDependencyCommit.promise
              await dependencyContext.commit(commitTask)
              return 'dependency installed'
            },
          )
        },
      )
    })
    const rootResult = root.catch((error: unknown) => error)
    await dependencyStarted.promise

    const cancellation = coordinator.cancelAndWait('tool:parent')
    expect(dependencySignal?.aborted).toBe(true)
    allowDependencyCommit.resolve()

    await expect(cancellation).resolves.toBe('cancelled')
    expect(await rootResult).toMatchObject({ name: 'AbortError' })
    expect(commitTask).not.toHaveBeenCalled()
  })

  it('reports a metadata restore failure instead of a successful cancellation', async () => {
    const coordinator = new ResourceInstallCoordinator<string, string>()
    const started = deferred()
    const root = coordinator.runRoot('tool:root', undefined, async (subscriber) => {
      return await coordinator.runShared('tool:shared', subscriber, async (context) => {
        started.resolve()
        await new Promise<void>((resolve) => {
          context.signal.addEventListener('abort', () => resolve(), { once: true })
        })
        throw new ResourceMetadataRestoreError(
          [new Error('restore failed')],
          'metadata restore failed',
        )
      })
    })
    const rootResult = root.catch((error: unknown) => error)
    await started.promise

    await expect(coordinator.cancelAndWait('tool:shared')).rejects.toThrow(
      'metadata restore failed',
    )
    await expect(rootResult).resolves.toBeInstanceOf(ResourceMetadataRestoreError)
  })

  it('waits for committed work and reports cancellation as too late', async () => {
    const coordinator = new ResourceInstallCoordinator<string, string>()
    const committed = deferred()
    const allowCompletion = deferred()
    let operationSignal: AbortSignal | undefined

    const root = coordinator.runRoot('tool:root', undefined, async (subscriber) => {
      return await coordinator.runShared('tool:root', subscriber, async (context) => {
        operationSignal = context.signal
        await context.commit(async () => undefined)
        committed.resolve()
        await allowCompletion.promise
        return 'installed'
      })
    })
    await committed.promise

    let cancellationCompleted = false
    const cancellation = coordinator.cancelAndWait('tool:root').then((result) => {
      cancellationCompleted = true
      return result
    })
    await Promise.resolve()

    expect(operationSignal?.aborted).toBe(false)
    expect(cancellationCompleted).toBe(false)

    allowCompletion.resolve()
    await expect(root).resolves.toBe('installed')
    await expect(cancellation).resolves.toBe('too_late')
  })

  it('reports cancellation as too late when an in-flight commit succeeds', async () => {
    const coordinator = new ResourceInstallCoordinator<string, string>()
    const commitStarted = deferred()
    const allowCommit = deferred()
    let operationSignal: AbortSignal | undefined

    const root = coordinator.runRoot('tool:root', undefined, async (subscriber) => {
      return await coordinator.runShared('tool:root', subscriber, async (context) => {
        operationSignal = context.signal
        await context.commit(async () => {
          commitStarted.resolve()
          await allowCommit.promise
        })
        return 'installed'
      })
    })
    await commitStarted.promise

    const cancellation = coordinator.cancelAndWait('tool:root')
    expect(operationSignal?.aborted).toBe(true)
    allowCommit.resolve()

    await expect(root).resolves.toBe('installed')
    await expect(cancellation).resolves.toBe('too_late')
  })
})

function deferred<T = void>(): {
  promise: Promise<T>
  resolve(value?: T | PromiseLike<T>): void
} {
  let resolvePromise!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return {
    promise,
    resolve: resolvePromise as (value?: T | PromiseLike<T>) => void,
  }
}
