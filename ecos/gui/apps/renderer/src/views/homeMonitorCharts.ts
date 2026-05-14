export interface MonitorChartInstance {
  getDom: () => HTMLElement | null
  dispose: () => void
}

export function ensureMonitorChartInstance<T extends MonitorChartInstance>(
  key: string,
  el: HTMLDivElement,
  instances: Map<string, T>,
  init: (el: HTMLDivElement) => T,
  bind: (instance: T) => void,
): { instance: T; created: boolean } {
  let instance = instances.get(key)

  if (instance && instance.getDom() !== el) {
    instance.dispose()
    instances.delete(key)
    instance = undefined
  }

  if (!instance) {
    instance = init(el)
    instances.set(key, instance)
    bind(instance)
    return { instance, created: true }
  }

  return { instance, created: false }
}
