export interface ResourceInstallSubscriber<TEvent> {
  readonly signal: AbortSignal
  cancel(): Promise<void>
  publish(event: TEvent): void
}

interface RootInstall<TEvent, TResult> {
  controller: AbortController
  completion?: Promise<TResult>
  subscriber: ResourceInstallSubscriber<TEvent>
}

interface SharedInstall<TEvent, TResult> {
  acceptingSubscribers: boolean
  context: ResourceInstallSubscriber<TEvent>
  controller: AbortController
  promise: Promise<TResult>
  resourceId: string
  settled: boolean
  subscribers: Set<ResourceInstallSubscriber<TEvent>>
}

/** Owns cancellation and subscriber lifetimes for resource installation work. */
export class ResourceInstallCoordinator<TEvent, TResult> {
  private readonly operations = new Map<string, SharedInstall<TEvent, TResult>>()
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
      async cancel() {
        controller.abort()
        await root.completion?.catch(() => undefined)
      },
      publish(event) {
        listener?.(event)
      },
    }
    root = {
      controller,
      subscriber,
    }
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
    task: (context: ResourceInstallSubscriber<TEvent>) => Promise<TResult>,
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
    let result: TResult | undefined
    let waitError: unknown
    try {
      result = await waitForOperationWithAbort(operation.promise, subscriber.signal)
    } catch (error) {
      waitError = error
    }

    const isLastSubscriber =
      operation.subscribers.size === 1 && operation.subscribers.has(subscriber)
    if (isLastSubscriber && !operation.settled) {
      operation.acceptingSubscribers = false
      operation.controller.abort()
      try {
        await operation.promise
      } catch (error) {
        if (subscriber.signal.aborted) waitError = error
      }
    }
    operation.subscribers.delete(subscriber)

    if (waitError !== undefined) throw waitError
    return result as TResult
  }

  async cancelAndWait(resourceId: string): Promise<boolean> {
    const root = this.roots.get(resourceId)
    if (root) {
      await root.subscriber.cancel()
      return true
    }

    const operation = this.operations.get(resourceId)
    if (!operation) return false
    await this.cancelOperationAndWait(operation)
    return true
  }

  private createOperation(
    resourceId: string,
    task: (context: ResourceInstallSubscriber<TEvent>) => Promise<TResult>,
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
        publish(event: TEvent) {
          for (const subscriber of subscribers) {
            subscriber.publish(event)
          }
        },
      },
      promise: Promise.resolve(undefined as TResult),
      resourceId,
      settled: false,
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
  ): Promise<void> {
    operation.acceptingSubscribers = false
    operation.controller.abort()
    await Promise.all([
      operation.promise.catch(() => undefined),
      ...Array.from(operation.subscribers, async (subscriber) => {
        await subscriber.cancel()
      }),
    ])
  }

  private finishOperation(operation: SharedInstall<TEvent, TResult>): void {
    operation.settled = true
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
