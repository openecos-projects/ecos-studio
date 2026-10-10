// @vitest-environment happy-dom
import { effectScope, nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useCenteredFlowViewport } from './useCenteredFlowViewport'

describe('centered flow viewport', () => {
  async function setup(width: number, height: number) {
    const element = document.createElement('div')
    Object.defineProperties(element, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
    })
    const workspace = ref('first')
    const scope = effectScope()
    const result = scope.run(() =>
      useCenteredFlowViewport(
        ref(element),
        ref(width),
        ref(height),
        ref(0.75),
        workspace,
      ),
    )!
    await nextTick()
    return { element, workspace, scope, result }
  }

  it('initializes a large graph at its center', async () => {
    const { element, scope } = await setup(1200, 900)
    expect(element.scrollLeft).toBe(250)
    expect(element.scrollTop).toBe(187.5)
    scope.stop()
  })

  it('centers a small graph without requiring scroll space', async () => {
    const { element, result, scope } = await setup(200, 100)
    expect(result.surfaceSize.value).toEqual({ width: 400, height: 300 })
    expect(result.canvasOffset.value).toEqual({ x: 125, y: 112.5 })
    expect(element.scrollLeft).toBe(0)
    expect(element.scrollTop).toBe(0)
    scope.stop()
  })

  it('preserves a panned center on resize and recenters for a new workspace', async () => {
    const { element, workspace, scope } = await setup(1200, 900)
    element.scrollLeft = 100
    element.scrollTop = 80
    Object.defineProperty(element, 'clientWidth', { configurable: true, value: 500 })
    window.dispatchEvent(new Event('resize'))
    await nextTick()
    expect(element.scrollLeft).toBe(50)
    expect(element.scrollTop).toBe(80)
    workspace.value = 'second'
    await nextTick()
    await nextTick()
    expect(element.scrollLeft).toBe(200)
    expect(element.scrollTop).toBe(187.5)
    scope.stop()
  })
})
