import { computed, nextTick, ref, watch, type Ref } from 'vue'

export function useCenteredFlowViewport(
  viewport: Ref<HTMLElement | null>,
  graphWidth: Readonly<Ref<number>>,
  graphHeight: Readonly<Ref<number>>,
  zoom: Readonly<Ref<number>>,
  workspaceKey: Readonly<Ref<unknown>>,
) {
  const size = ref({ width: 0, height: 0 })
  let updateVersion = 0
  let observedElement: HTMLElement | null = null
  let lastCenteredSize = { width: 0, height: 0 }
  let lastMeasuredZoom = zoom.value
  const surfaceSize = computed(() => ({
    width: Math.max(size.value.width, graphWidth.value * zoom.value),
    height: Math.max(size.value.height, graphHeight.value * zoom.value),
  }))
  const canvasOffset = computed(() => ({
    x: (surfaceSize.value.width - graphWidth.value * zoom.value) / 2,
    y: (surfaceSize.value.height - graphHeight.value * zoom.value) / 2,
  }))

  async function positionCenter(element: HTMLElement, center: { x: number; y: number }) {
    const version = ++updateVersion
    await nextTick()
    if (version !== updateVersion || viewport.value !== element) return
    element.scrollLeft = Math.max(
      0,
      center.x * zoom.value + canvasOffset.value.x - size.value.width / 2,
    )
    element.scrollTop = Math.max(
      0,
      center.y * zoom.value + canvasOffset.value.y - size.value.height / 2,
    )
  }

  function measure(element: HTMLElement): void {
    const width = element.clientWidth
    const height = element.clientHeight
    const zoomChanged = zoom.value !== lastMeasuredZoom
    lastMeasuredZoom = zoom.value
    if (!width || !height || (width === size.value.width && height === size.value.height))
      return
    const center =
      size.value.width && size.value.height
        ? {
            x:
              (element.scrollLeft + size.value.width / 2 - canvasOffset.value.x) /
              zoom.value,
            y:
              (element.scrollTop + size.value.height / 2 - canvasOffset.value.y) /
              zoom.value,
          }
        : { x: graphWidth.value / 2, y: graphHeight.value / 2 }
    const sizeChanged = width !== size.value.width || height !== size.value.height
    size.value = { width, height }
    // Zoom owns the scroll anchor while a scale transition is settling. The
    // resize observer still records the new viewport size, but must not issue
    // a second center operation based on stale scrollbar geometry.
    if (zoomChanged) return
    if (
      sizeChanged &&
      (width !== lastCenteredSize.width || height !== lastCenteredSize.height)
    ) {
      lastCenteredSize = { width, height }
      void positionCenter(element, center)
    }
  }

  watch(
    viewport,
    (element, _previous, onCleanup) => {
      if (element === observedElement) return
      ++updateVersion
      lastCenteredSize = { width: 0, height: 0 }
      lastMeasuredZoom = zoom.value
      if (size.value.width || size.value.height) size.value = { width: 0, height: 0 }
      observedElement = element
      if (!element) return
      const resize = () => measure(element)
      const observer =
        typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
      observer?.observe(element)
      window.addEventListener('resize', resize)
      resize()
      onCleanup(() => {
        ++updateVersion
        observedElement = null
        observer?.disconnect()
        window.removeEventListener('resize', resize)
      })
    },
    { flush: 'post', immediate: true },
  )

  watch(
    [graphWidth, graphHeight, workspaceKey],
    () => {
      const element = viewport.value
      if (element && size.value.width && size.value.height) {
        lastCenteredSize = { width: size.value.width, height: size.value.height }
        void positionCenter(element, {
          x: graphWidth.value / 2,
          y: graphHeight.value / 2,
        })
      }
    },
    { flush: 'post' },
  )

  return { surfaceSize, canvasOffset }
}
