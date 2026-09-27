export class WorkspaceStepConfigurationCache<T> {
  private readonly inFlight = new Map<string, Promise<T>>()
  private readonly values = new Map<string, T>()

  clear(): void {
    this.inFlight.clear()
    this.values.clear()
  }

  load(key: string, loader: () => Promise<T>): Promise<T> {
    const cached = this.values.get(key)
    if (cached !== undefined) return Promise.resolve(cached)
    const pending = this.inFlight.get(key)
    if (pending) return pending
    const request = loader().then(
      (value) => {
        if (this.inFlight.get(key) === request) {
          this.inFlight.delete(key)
          this.values.set(key, value)
        }
        return value
      },
      (error: unknown) => {
        if (this.inFlight.get(key) === request) this.inFlight.delete(key)
        throw error
      },
    )
    this.inFlight.set(key, request)
    return request
  }
}
