import { computed, onUnmounted, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import {
  USER_GUIDE_PANEL_MAX_WIDTH,
  USER_GUIDE_PANEL_MIN_WIDTH,
  clampUserGuidePanelWidth,
} from '@/stores/userGuideStore'
import { useUserGuideStore } from '@/stores/userGuideStore'

/**
 * Drag the right edge of a left-docked User Guide panel to resize width.
 * `containerRef` is the horizontal parent used to compute available room.
 * `onResizeEnd` fires once per drag with the final width.
 */
export function useUserGuidePanelResize(
  containerRef: Ref<HTMLElement | null>,
  options: { onResizeEnd?: (widthPx: number) => void } = {},
) {
  const userGuide = useUserGuideStore()
  const { panelWidthPx } = storeToRefs(userGuide)

  const panelWidthStyle = computed(() => `${panelWidthPx.value}px`)

  let pointerTarget: HTMLElement | null = null
  let pointerId: number | null = null

  function maxWidthForContainer(): number {
    const container = containerRef.value
    if (!container) return USER_GUIDE_PANEL_MAX_WIDTH
    const rect = container.getBoundingClientRect()
    // Keep enough room for the main content beside the panel.
    const room = Math.floor(rect.width - 320)
    return Math.min(
      USER_GUIDE_PANEL_MAX_WIDTH,
      Math.max(USER_GUIDE_PANEL_MIN_WIDTH, room),
    )
  }

  function handlePointerMove(event: PointerEvent): void {
    const container = containerRef.value
    if (!container) return
    const rect = container.getBoundingClientRect()
    const next = clampUserGuidePanelWidth(event.clientX - rect.left, {
      maxWidth: maxWidthForContainer(),
    })
    userGuide.setPanelWidthPx(next)
  }

  function stopResize(): void {
    if (pointerTarget && pointerId !== null) {
      try {
        pointerTarget.releasePointerCapture?.(pointerId)
      } catch {
        /* already released */
      }
    }
    const wasDragging = pointerTarget !== null
    pointerTarget = null
    pointerId = null
    document.body.classList.remove('user-guide-panel-resizing')
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', stopResize)
    window.removeEventListener('pointercancel', stopResize)
    window.removeEventListener('blur', stopResize)
    if (wasDragging) options.onResizeEnd?.(panelWidthPx.value)
  }

  function onResizePointerDown(event: PointerEvent): void {
    if (event.button !== 0) return
    event.preventDefault()
    pointerTarget = event.currentTarget as HTMLElement
    pointerId = event.pointerId
    pointerTarget.setPointerCapture?.(pointerId)
    document.body.classList.add('user-guide-panel-resizing')
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
    window.addEventListener('blur', stopResize)
    handlePointerMove(event)
  }

  onUnmounted(() => {
    stopResize()
  })

  return {
    panelWidthPx,
    panelWidthStyle,
    onResizePointerDown,
  }
}
