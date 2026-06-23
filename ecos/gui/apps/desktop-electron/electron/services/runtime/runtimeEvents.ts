export type RuntimeEventListener<TEvent> = (event: TEvent) => void

export class RuntimeEventFanout<TEvent> {
  private readonly listeners = new Set<RuntimeEventListener<TEvent>>()

  onEvent(listener: RuntimeEventListener<TEvent>): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  emit(event: TEvent, listener?: RuntimeEventListener<TEvent>): void {
    listener?.(event)
    for (const registeredListener of this.listeners) {
      registeredListener(event)
    }
  }
}
