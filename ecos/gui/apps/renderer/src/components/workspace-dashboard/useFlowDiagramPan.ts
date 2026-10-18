import { onMounted, onScopeDispose, ref, watch, type Ref } from 'vue'

export function useFlowDiagramPan(viewport: Ref<HTMLElement | null>) {
  const isPanning = ref(false)
  let gesture: {
    pointerId: number
    element: HTMLElement
    x: number
    y: number
    left: number
    top: number
  } | null = null
  let suppressClick = false
  let clickTimer: ReturnType<typeof setTimeout> | undefined

  function stopPan(): void {
    const previous = gesture
    gesture = null
    isPanning.value = false
    if (previous?.element.hasPointerCapture?.(previous.pointerId)) {
      previous.element.releasePointerCapture(previous.pointerId)
    }
  }

  function cancelPan(): void {
    stopPan()
    suppressClick = false
    clearTimeout(clickTimer)
  }

  function startPan(event: PointerEvent): void {
    if (
      event.button !== 0 ||
      event.isPrimary === false ||
      (event.pointerType && event.pointerType !== 'mouse')
    )
      return
    const element = viewport.value
    const target = event.target
    if (!element || !(target instanceof Element)) return
    if (
      target.closest(
        'button, a, input, select, textarea, [role="button"], [contenteditable]:not([contenteditable="false"])',
      )
    )
      return
    if (target === element) {
      const bounds = element.getBoundingClientRect()
      if (
        event.clientX >= bounds.left + element.clientLeft + element.clientWidth ||
        event.clientY >= bounds.top + element.clientTop + element.clientHeight
      )
        return
    }
    cancelPan()
    gesture = {
      pointerId: event.pointerId,
      element,
      x: event.clientX,
      y: event.clientY,
      left: element.scrollLeft,
      top: element.scrollTop,
    }
    element.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }

  function movePan(event: PointerEvent): void {
    if (!gesture || event.pointerId !== gesture.pointerId) return
    if (!(event.buttons & 1)) {
      cancelPan()
      return
    }
    const deltaX = event.clientX - gesture.x
    const deltaY = event.clientY - gesture.y
    if (!isPanning.value && Math.hypot(deltaX, deltaY) < 4) return
    isPanning.value = true
    gesture.element.scrollLeft = Math.max(0, gesture.left - deltaX)
    gesture.element.scrollTop = Math.max(0, gesture.top - deltaY)
    event.preventDefault()
  }

  function endPan(event: PointerEvent): void {
    if (!gesture || event.pointerId !== gesture.pointerId) return
    const dragged = isPanning.value
    stopPan()
    suppressClick = dragged
    clickTimer = setTimeout(() => {
      suppressClick = false
    }, 0)
  }

  function preventDragClick(event: MouseEvent): void {
    if (!suppressClick) return
    event.preventDefault()
    event.stopPropagation()
    suppressClick = false
  }

  function lostPanCapture(event: PointerEvent): void {
    if (gesture?.pointerId === event.pointerId) cancelPan()
  }

  watch(viewport, cancelPan)
  onMounted(() => window.addEventListener('blur', cancelPan))
  onScopeDispose(() => {
    cancelPan()
    window.removeEventListener('blur', cancelPan)
  })
  return {
    isPanning,
    startPan,
    movePan,
    endPan,
    cancelPan,
    lostPanCapture,
    preventDragClick,
  }
}
