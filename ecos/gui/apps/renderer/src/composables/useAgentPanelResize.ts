import { computed, onUnmounted, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import {
  AGENT_PANEL_MAX_WIDTH,
  AGENT_PANEL_MIN_WIDTH,
  clampAgentPanelWidth,
} from './agentPanelWidth'
import { useAgentShellStore } from '@/stores/agentShellStore'

/**
 * Drag the left edge of a right-docked Agent panel to resize width.
 * `containerRef` is the horizontal parent used to compute available room.
 */
export function useAgentPanelResize(containerRef: Ref<HTMLElement | null>) {
  const agentShell = useAgentShellStore()
  const { panelWidthPx } = storeToRefs(agentShell)

  const panelWidthStyle = computed(() => `${panelWidthPx.value}px`)

  let pointerTarget: HTMLElement | null = null
  let pointerId: number | null = null

  function maxWidthForContainer(): number {
    const container = containerRef.value
    if (!container) return AGENT_PANEL_MAX_WIDTH
    const rect = container.getBoundingClientRect()
    // Keep enough room for the editor / home content.
    const room = Math.floor(rect.width - 320)
    return Math.min(AGENT_PANEL_MAX_WIDTH, Math.max(AGENT_PANEL_MIN_WIDTH, room))
  }

  function handlePointerMove(event: PointerEvent): void {
    const container = containerRef.value
    if (!container) return
    const rect = container.getBoundingClientRect()
    const next = clampAgentPanelWidth(rect.right - event.clientX, {
      maxWidth: maxWidthForContainer(),
    })
    agentShell.setPanelWidthPx(next)
  }

  function stopResize(): void {
    if (pointerTarget && pointerId !== null) {
      try {
        pointerTarget.releasePointerCapture?.(pointerId)
      } catch {
        /* already released */
      }
    }
    pointerTarget = null
    pointerId = null
    document.body.classList.remove('agent-panel-resizing')
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', stopResize)
    window.removeEventListener('pointercancel', stopResize)
    window.removeEventListener('blur', stopResize)
  }

  function onResizePointerDown(event: PointerEvent): void {
    if (event.button !== 0) return
    event.preventDefault()
    pointerTarget = event.currentTarget as HTMLElement
    pointerId = event.pointerId
    pointerTarget.setPointerCapture?.(pointerId)
    document.body.classList.add('agent-panel-resizing')
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
