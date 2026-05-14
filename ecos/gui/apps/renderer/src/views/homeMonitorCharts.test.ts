import { describe, expect, it, vi } from 'vitest'
import { ensureMonitorChartInstance } from './homeMonitorCharts'

describe('ensureMonitorChartInstance', () => {
  it('recreates the chart when Vue replaces the DOM element for the same metric key', () => {
    const firstEl = { id: 'first' } as unknown as HTMLDivElement
    const secondEl = { id: 'second' } as unknown as HTMLDivElement
    const firstInstance = {
      getDom: vi.fn(() => firstEl),
      dispose: vi.fn(),
    }
    const secondInstance = {
      getDom: vi.fn(() => secondEl),
      dispose: vi.fn(),
    }
    const init = vi.fn()
      .mockReturnValueOnce(firstInstance)
      .mockReturnValueOnce(secondInstance)
    const instances = new Map<string, any>()
    const bind = vi.fn()

    const first = ensureMonitorChartInstance('memory', firstEl, instances, init, bind)
    const second = ensureMonitorChartInstance('memory', secondEl, instances, init, bind)

    expect(first.instance).toBe(firstInstance)
    expect(first.created).toBe(true)
    expect(second.instance).toBe(secondInstance)
    expect(second.created).toBe(true)
    expect(firstInstance.dispose).toHaveBeenCalledTimes(1)
    expect(init).toHaveBeenNthCalledWith(1, firstEl)
    expect(init).toHaveBeenNthCalledWith(2, secondEl)
    expect(instances.get('memory')).toBe(secondInstance)
    expect(bind).toHaveBeenCalledTimes(2)
  })
})
