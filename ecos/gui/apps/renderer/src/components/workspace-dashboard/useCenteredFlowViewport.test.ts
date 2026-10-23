// @vitest-environment happy-dom
import { effectScope, nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useCenteredFlowViewport } from './useCenteredFlowViewport'

describe('centered flow viewport', () => {
  async function setup(width: number, height: number, contentReady = false) {
    const element = document.createElement('div')
    Object.defineProperties(element, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
    })
    const workspace = ref('first')
    const zoom = ref(0.75)
    const graphWidth = ref(width)
    const graphHeight = ref(height)
    const ready = ref(contentReady)
    const scope = effectScope()
    const result = scope.run(() =>
      useCenteredFlowViewport(
        ref(element),
        graphWidth,
        graphHeight,
        zoom,
        workspace,
        ready,
      ),
    )!
    await nextTick()
    return { element, workspace, zoom, graphWidth, graphHeight, ready, scope, result }
  }

  async function settle(): Promise<void> {
    await nextTick()
    await nextTick()
    await nextTick()
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

  it('does not recenter when zoom changes the scrollbar geometry', async () => {
    const { element, zoom, scope } = await setup(1200, 900)
    element.scrollLeft = 100
    element.scrollTop = 80
    zoom.value = 0.5
    Object.defineProperty(element, 'clientWidth', { configurable: true, value: 500 })
    window.dispatchEvent(new Event('resize'))
    await nextTick()
    expect(element.scrollLeft).toBe(100)
    expect(element.scrollTop).toBe(80)
    scope.stop()
  })

  it('fits a large graph into the viewport with padding and recenters it', async () => {
    const { element, zoom, result, scope } = await setup(1200, 900)

    await result.fitToViewport()

    expect(zoom.value).toBe(0.25)
    expect(element.scrollLeft).toBe(0)
    expect(element.scrollTop).toBe(0)
    expect(result.canvasOffset.value).toEqual({ x: 50, y: 37.5 })
    scope.stop()
  })

  it('fits the first valid layout when workspace content becomes ready', async () => {
    const { element, zoom, ready, scope } = await setup(1200, 900)
    expect(zoom.value).toBe(0.75)

    ready.value = true
    await settle()

    expect(zoom.value).toBe(0.25)
    expect(element.scrollLeft).toBe(0)
    expect(element.scrollTop).toBe(0)
    scope.stop()
  })

  it('does not repeat the initial fit when graph dimensions update later', async () => {
    const { zoom, graphWidth, ready, scope } = await setup(1200, 900)
    ready.value = true
    await settle()
    expect(zoom.value).toBe(0.25)

    zoom.value = 0.5
    graphWidth.value = 800
    await settle()

    expect(zoom.value).toBe(0.5)
    scope.stop()
  })

  it('fits again when the workspace changes', async () => {
    const { zoom, graphWidth, graphHeight, workspace, ready, scope } = await setup(
      1200,
      900,
    )
    ready.value = true
    await settle()
    expect(zoom.value).toBe(0.25)

    graphWidth.value = 200
    graphHeight.value = 100
    workspace.value = 'second'
    await settle()

    expect(zoom.value).toBe(1.5)
    scope.stop()
  })
})
