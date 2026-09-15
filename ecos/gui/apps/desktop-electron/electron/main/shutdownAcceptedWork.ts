import type { ShutdownScope } from './shutdownBlockers'

interface Waiter {
  resolve(): void
  scope: ShutdownScope
}

export class ShutdownAcceptedWork {
  readonly counts = new Map<number, number>()
  private readonly waiters = new Set<Waiter>()

  begin(windowId: number, onChange: () => void): () => void {
    this.counts.set(windowId, (this.counts.get(windowId) ?? 0) + 1)
    onChange()
    let ended = false
    return () => {
      if (ended) return
      ended = true
      const remaining = (this.counts.get(windowId) ?? 1) - 1
      if (remaining > 0) this.counts.set(windowId, remaining)
      else this.counts.delete(windowId)
      this.resolveWaiters()
      onChange()
    }
  }

  wait(scope: ShutdownScope): Promise<void> {
    if (!this.count(scope)) return Promise.resolve()
    return new Promise((resolve) => this.waiters.add({ resolve, scope }))
  }

  private count(scope: ShutdownScope): number {
    return [...this.counts].reduce(
      (total, [windowId, count]) =>
        total + (scope.kind === 'application' || scope.windowId === windowId ? count : 0),
      0,
    )
  }

  private resolveWaiters(): void {
    for (const waiter of this.waiters) {
      if (this.count(waiter.scope)) continue
      this.waiters.delete(waiter)
      waiter.resolve()
    }
  }
}
