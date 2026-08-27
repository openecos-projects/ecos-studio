import { ResourceMetadataRestoreError } from './resourceInstallErrors'

export interface ResourceInstallSubscriber<TEvent> {
  readonly signal: AbortSignal
  cancel(): Promise<ResourceCancellationOutcome>
  publish(event: TEvent): void
}

export interface ResourceInstallContext<
  TEvent,
> extends ResourceInstallSubscriber<TEvent> {
  commit<TResult>(task: () => Promise<TResult>): Promise<TResult>
}

export type ResourceCancellationOutcome = 'cancelled' | 'not_found' | 'too_late'

interface RootInstall<TEvent, TResult> {
  cancellation?: Promise<ResourceCancellationOutcome>
  controller: AbortController
  completion?: Promise<TResult>
  subscriber: ResourceInstallSubscriber<TEvent>
}

type SharedInstallState = 'cancelling' | 'committed' | 'running' | 'settled'

interface SharedInstall<TEvent, TResult> {
  acceptingSubscribers: boolean
  context: ResourceInstallContext<TEvent>
  controller: AbortController
  promise: Promise<TResult>
  resourceId: string
  state: SharedInstallState
  subscribers: Set<ResourceInstallSubscriber<TEvent>>
}

/** Owns cancellation and subscriber lifetimes for resource installation work. */
export class ResourceInstallCoordinator<TEvent, TResult> {
  private readonly operations = new Map<string, SharedInstall<TEvent, TResult>>()
  private readonly rootOperations = new WeakMap<
    ResourceInstallSubscriber<TEvent>,
    SharedInstall<TEvent, TResult>
  >()
  private readonly rootSubscribers = new WeakSet<ResourceInstallSubscriber<TEvent>>()
  private readonly roots = new Map<string, RootInstall<TEvent, TResult>>()

  runRoot(
    resourceId: string,
    listener: ((event: TEvent) => void) | undefined,
    task: (subscriber: ResourceInstallSubscriber<TEvent>) => Promise<TResult>,
  ): Promise<TResult> {
    const existingRoot = this.roots.get(resourceId)
    if (existingRoot?.completion) return existingRoot.completion

    const controller = new AbortController()
    let root!: RootInstall<TEvent, TResult>
    const subscriber: ResourceInstallSubscriber<TEvent> = {
      signal: controller.signal,
      cancel: async () => await this.cancelRootAndWait(root),
      publish(event) {
        listener?.(event)
      },
    }
    root = {
      controller,
      subscriber,
    }
    this.rootSubscribers.add(subscriber)
    this.roots.set(resourceId, root)

    const completion = startAsyncTask(async () => await task(subscriber)).finally(() => {
      if (this.roots.get(resourceId) === root) {
        this.roots.delete(resourceId)
      }
    })
    root.completion = completion
    return completion
  }

  hasActiveOperation(resourceId: string): boolean {
    const operation = this.operations.get(resourceId)
    return Boolean(operation?.acceptingSubscribers)
  }

  hasActiveRoot(resourceId: string): boolean {
    return this.roots.has(resourceId)
  }

  isActive(resourceId: string): boolean {
    return this.roots.has(resourceId) || this.operations.has(resourceId)
  }

  async runShared(
    resourceId: string,
    subscriber: ResourceInstallSubscriber<TEvent>,
    task: (context: ResourceInstallContext<TEvent>) => Promise<TResult>,
  ): Promise<TResult> {
    throwIfAborted(subscriber.signal)

    let operation = this.operations.get(resourceId)
    if (operation && !operation.acceptingSubscribers) {
      await operation.promise.catch(() => undefined)
      throwIfAborted(subscriber.signal)
      operation = this.operations.get(resourceId)
    }
    if (!operation) {
      operation = this.createOperation(resourceId, task)
    }

    operation.subscribers.add(subscriber)
    const cancelUnownedOperation = (): void => {
      if (!this.hasOtherLiveSubscriber(operation, subscriber)) {
        this.requestOperationCancellation(operation)
      }
    }
    subscriber.signal.addEventListener('abort', cancelUnownedOperation)
    if (subscriber.signal.aborted) cancelUnownedOperation()
    if (this.rootSubscribers.has(subscriber)) {
      this.rootOperations.set(subscriber, operation)
    }
    try {
      let result: TResult | undefined
      let waitError: unknown
      try {
        result = await waitForOperationWithAbort(operation.promise, subscriber.signal)
      } catch (error) {
        waitError = error
      }

      if (
        subscriber.signal.aborted &&
        !this.hasOtherLiveSubscriber(operation, subscriber)
      ) {
        this.requestOperationCancellation(operation)
        try {
          result = await operation.promise
          waitError = undefined
        } catch (error) {
          waitError = error
        }
      }

      if (waitError !== undefined) throw waitError
      return result as TResult
    } finally {
      subscriber.signal.removeEventListener('abort', cancelUnownedOperation)
      operation.subscribers.delete(subscriber)
      if (this.rootOperations.get(subscriber) === operation) {
        this.rootOperations.delete(subscriber)
      }
    }
  }

  async cancelAndWait(resourceId: string): Promise<ResourceCancellationOutcome> {
    const root = this.roots.get(resourceId)
    if (root) {
      return await root.subscriber.cancel()
    }

    const operation = this.operations.get(resourceId)
    if (!operation) return 'not_found'
    return await this.cancelOperationAndWait(operation)
  }

  private createOperation(
    resourceId: string,
    task: (context: ResourceInstallContext<TEvent>) => Promise<TResult>,
  ): SharedInstall<TEvent, TResult> {
    const controller = new AbortController()
    const subscribers = new Set<ResourceInstallSubscriber<TEvent>>()
    let operation!: SharedInstall<TEvent, TResult>
    operation = {
      acceptingSubscribers: true,
      controller,
      context: {
        signal: controller.signal,
        cancel: async () => await this.cancelOperationAndWait(operation),
        commit: async <T>(commitTask: () => Promise<T>) => {
          this.assertCommitCanStart(operation)
          const result = await commitTask()
          this.markCommitted(operation)
          return result
        },
        publish(event: TEvent) {
          for (const subscriber of subscribers) {
            subscriber.publish(event)
          }
        },
      },
      promise: Promise.resolve(undefined as TResult),
      resourceId,
      state: 'running',
      subscribers,
    }

    this.operations.set(resourceId, operation)
    operation.promise = startAsyncTask(async () => await task(operation.context))
    void operation.promise.then(
      () => this.finishOperation(operation),
      () => this.finishOperation(operation),
    )
    return operation
  }

  private async cancelOperationAndWait(
    operation: SharedInstall<TEvent, TResult>,
  ): Promise<ResourceCancellationOutcome> {
    const outcome = this.requestOperationCancellation(operation)
    if (outcome === 'too_late') {
      await operation.promise
      return outcome
    }
    const results = await Promise.allSettled([
      operation.promise,
      ...Array.from(operation.subscribers, async (subscriber) => {
        await subscriber.cancel()
      }),
    ])
    const metadataRestoreFailure = results.find(
      (result): result is PromiseRejectedResult =>
        result.status === 'rejected' &&
        result.reason instanceof ResourceMetadataRestoreError,
    )
    if (metadataRestoreFailure) throw metadataRestoreFailure.reason
    return results[0]?.status === 'fulfilled' ? 'too_late' : outcome
  }

  private cancelRootAndWait(
    root: RootInstall<TEvent, TResult>,
  ): Promise<ResourceCancellationOutcome> {
    root.cancellation ??= this.performRootCancellation(root)
    return root.cancellation
  }

  private async performRootCancellation(
    root: RootInstall<TEvent, TResult>,
  ): Promise<ResourceCancellationOutcome> {
    const operation = this.rootOperations.get(root.subscriber)
    if (operation?.state === 'committed' || operation?.state === 'settled') {
      await root.completion
      return 'too_late'
    }

    if (
      operation?.state === 'running' &&
      operation.subscribers.has(root.subscriber) &&
      !this.hasOtherLiveSubscriber(operation, root.subscriber)
    ) {
      this.requestOperationCancellation(operation)
    }
    root.controller.abort()
    try {
      await root.completion
      return 'too_late'
    } catch (error) {
      if (error instanceof ResourceMetadataRestoreError) throw error
      return 'cancelled'
    }
  }

  private assertCommitCanStart(operation: SharedInstall<TEvent, TResult>): void {
    if (operation.state === 'cancelling' || operation.controller.signal.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError')
    }
    if (operation.state !== 'running') {
      throw new Error(`Commit has already completed for ${operation.resourceId}`)
    }
  }

  private markCommitted(operation: SharedInstall<TEvent, TResult>): void {
    if (operation.state !== 'running' && operation.state !== 'cancelling') {
      throw new Error(`Commit has already completed for ${operation.resourceId}`)
    }
    operation.state = 'committed'
  }

  private hasOtherLiveSubscriber(
    operation: SharedInstall<TEvent, TResult>,
    subscriber: ResourceInstallSubscriber<TEvent>,
  ): boolean {
    return Array.from(operation.subscribers).some(
      (candidate) => candidate !== subscriber && !candidate.signal.aborted,
    )
  }

  private requestOperationCancellation(
    operation: SharedInstall<TEvent, TResult>,
  ): Exclude<ResourceCancellationOutcome, 'not_found'> {
    if (operation.state === 'committed' || operation.state === 'settled') {
      return 'too_late'
    }
    if (operation.state === 'running') {
      operation.state = 'cancelling'
      operation.acceptingSubscribers = false
      operation.controller.abort()
    }
    return 'cancelled'
  }

  private finishOperation(operation: SharedInstall<TEvent, TResult>): void {
    operation.state = 'settled'
    operation.acceptingSubscribers = false
    if (this.operations.get(operation.resourceId) === operation) {
      this.operations.delete(operation.resourceId)
    }
  }
}

function startAsyncTask<TResult>(task: () => Promise<TResult>): Promise<TResult> {
  return new Promise<TResult>((resolve, reject) => {
    queueMicrotask(() => {
      try {
        void task().then(resolve, reject)
      } catch (error) {
        reject(error)
      }
    })
  })
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw new DOMException('The operation was aborted.', 'AbortError')
}

async function waitForOperationWithAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  throwIfAborted(signal)
  return await new Promise<T>((resolve, reject) => {
    let completed = false
    const finish = (callback: () => void): void => {
      if (completed) return
      completed = true
      signal.removeEventListener('abort', abort)
      callback()
    }
    const abort = (): void => {
      finish(() => reject(new DOMException('The operation was aborted.', 'AbortError')))
    }

    signal.addEventListener('abort', abort, { once: true })
    void operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    )
  })
}
