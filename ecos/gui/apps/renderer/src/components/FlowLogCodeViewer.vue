<script setup lang="ts">
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  buildFlowLogViewerExtensions,
  computeFlowLogContextMenuStyle,
  FLOW_LOG_VIEWER_TAIL_THRESHOLD_PX,
  flowLogVerticalScrollbarGeometry,
  flowLogWheelDeltaPx,
  getFlowLogViewerSelectedText,
  isFlowLogViewerNearTail,
} from './flowLogCodeViewer'
import { copyFlowLogText } from './flowLogCopy'

const props = withDefaults(
  defineProps<{
    content: string
    live?: boolean
    missing?: boolean
    loading?: boolean
  }>(),
  {
    live: false,
    missing: false,
    loading: false,
  },
)

const rootRef = ref<HTMLElement | null>(null)
const flowLogContextMenuRef = ref<HTMLElement | null>(null)
const flowLogContextMenuCopyButtonRef = ref<HTMLButtonElement | null>(null)
const flowLogVerticalScrollbarRef = ref<HTMLElement | null>(null)
const isViewerEmpty = computed(() => !props.content)
const flowLogContextMenu = ref<{
  text: string
  style: { left: string; top: string }
} | null>(null)
const flowLogContextMenuFeedback = ref<'copied' | 'failed' | null>(null)
const flowLogContextMenuCopying = ref(false)
const flowLogContextMenuCopyLabel = computed(() => {
  if (flowLogContextMenuCopying.value) return 'Copying...'
  if (flowLogContextMenuFeedback.value === 'copied') return 'Copied'
  if (flowLogContextMenuFeedback.value === 'failed') return 'Copy failed'
  return 'Copy'
})

let view: EditorView | null = null
let lastSyncedContent = ''
let pendingContent: string | null = null
let pendingSyncRaf: number | null = null
let pendingTailScrollRaf: number | null = null
let flowLogContextMenuFeedbackTimer: ReturnType<typeof setTimeout> | null = null
let flowLogScrollbarResizeObserver: ResizeObserver | null = null
let flowLogScrollbarDrag: { pointerId: number; pointerOffsetY: number } | null = null
const flowLogVerticalScrollbar = ref({
  maxScrollTop: 0,
  thumbHeight: 0,
  thumbOffset: 0,
})
const isFlowLogScrollbarDragging = ref(false)

function clearFlowLogContextMenuFeedbackTimer(): void {
  if (flowLogContextMenuFeedbackTimer) {
    clearTimeout(flowLogContextMenuFeedbackTimer)
    flowLogContextMenuFeedbackTimer = null
  }
}

function closeFlowLogContextMenu(): void {
  clearFlowLogContextMenuFeedbackTimer()
  flowLogContextMenu.value = null
  flowLogContextMenuFeedback.value = null
  flowLogContextMenuCopying.value = false
}

function onViewerContextMenu(event: MouseEvent): void {
  if (!view) return

  const selectedText = getFlowLogViewerSelectedText(view.state)
  if (!selectedText) return

  event.preventDefault()
  clearFlowLogContextMenuFeedbackTimer()
  flowLogContextMenuFeedback.value = null
  flowLogContextMenuCopying.value = false
  flowLogContextMenu.value = {
    text: selectedText,
    style: computeFlowLogContextMenuStyle(
      { x: event.clientX, y: event.clientY },
      { width: window.innerWidth, height: window.innerHeight },
    ),
  }
  void nextTick(() => flowLogContextMenuCopyButtonRef.value?.focus())
}

async function copyFlowLogSelection(): Promise<void> {
  const contextMenu = flowLogContextMenu.value
  if (!contextMenu || flowLogContextMenuCopying.value) return

  flowLogContextMenuCopying.value = true
  const result = await copyFlowLogText(contextMenu.text)
  flowLogContextMenuCopying.value = false
  flowLogContextMenuFeedback.value = result.ok ? 'copied' : 'failed'

  if (result.ok) {
    clearFlowLogContextMenuFeedbackTimer()
    flowLogContextMenuFeedbackTimer = setTimeout(() => {
      closeFlowLogContextMenu()
    }, 900)
  }
}

function onFlowLogContextMenuPointerDown(event: PointerEvent): void {
  if (!flowLogContextMenu.value) return
  const target = event.target
  if (target instanceof Node && flowLogContextMenuRef.value?.contains(target)) return
  closeFlowLogContextMenu()
}

function onFlowLogContextMenuKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !flowLogContextMenu.value) return
  event.preventDefault()
  closeFlowLogContextMenu()
}

function syncFlowLogVerticalScrollbar(): void {
  if (!view) return
  flowLogVerticalScrollbar.value = flowLogVerticalScrollbarGeometry(view.scrollDOM)
}

function clearFlowLogScrollbarBindings(): void {
  if (view) {
    view.scrollDOM.removeEventListener?.('scroll', syncFlowLogVerticalScrollbar)
  }
  flowLogScrollbarResizeObserver?.disconnect()
  flowLogScrollbarResizeObserver = null
  stopFlowLogScrollbarDrag()
  flowLogVerticalScrollbar.value = {
    maxScrollTop: 0,
    thumbHeight: 0,
    thumbOffset: 0,
  }
}

function bindFlowLogScrollbar(): void {
  if (!view) return
  const scrollDOM = view.scrollDOM
  scrollDOM.addEventListener?.('scroll', syncFlowLogVerticalScrollbar, { passive: true })
  if (typeof ResizeObserver !== 'undefined') {
    flowLogScrollbarResizeObserver = new ResizeObserver(syncFlowLogVerticalScrollbar)
    flowLogScrollbarResizeObserver.observe(scrollDOM)
  }
  syncFlowLogVerticalScrollbar()
}

function setFlowLogScrollFromPointer(event: PointerEvent): void {
  const scrollDOM = view?.scrollDOM
  const scrollbar = flowLogVerticalScrollbarRef.value
  const drag = flowLogScrollbarDrag
  if (!scrollDOM || !scrollbar || !drag) return

  const bounds = scrollbar.getBoundingClientRect()
  const thumbTravel = Math.max(
    0,
    bounds.height - flowLogVerticalScrollbar.value.thumbHeight,
  )
  if (thumbTravel === 0 || flowLogVerticalScrollbar.value.maxScrollTop === 0) return

  const thumbOffset = Math.max(
    0,
    Math.min(thumbTravel, event.clientY - bounds.top - drag.pointerOffsetY),
  )
  scrollDOM.scrollTop =
    (thumbOffset / thumbTravel) * flowLogVerticalScrollbar.value.maxScrollTop
  syncFlowLogVerticalScrollbar()
}

function onFlowLogWheel(event: WheelEvent): void {
  const scrollDOM = view?.scrollDOM
  if (!scrollDOM) return

  const delta = flowLogWheelDeltaPx({
    deltaY: event.deltaY,
    deltaMode: event.deltaMode,
    clientHeight: scrollDOM.clientHeight,
  })
  if (delta === 0) return

  const maxScrollTop = Math.max(0, scrollDOM.scrollHeight - scrollDOM.clientHeight)
  const nextScrollTop = Math.max(0, Math.min(maxScrollTop, scrollDOM.scrollTop + delta))
  if (nextScrollTop === scrollDOM.scrollTop) return

  event.preventDefault()
  scrollDOM.scrollTop = nextScrollTop
  syncFlowLogVerticalScrollbar()
}

function onFlowLogScrollbarPointerDown(event: PointerEvent): void {
  const scrollbar = flowLogVerticalScrollbarRef.value
  if (!view || !scrollbar || flowLogVerticalScrollbar.value.thumbHeight === 0) return

  event.preventDefault()
  const bounds = scrollbar.getBoundingClientRect()
  const position = event.clientY - bounds.top
  const thumbStart = flowLogVerticalScrollbar.value.thumbOffset
  const thumbEnd = thumbStart + flowLogVerticalScrollbar.value.thumbHeight
  flowLogScrollbarDrag = {
    pointerId: event.pointerId,
    pointerOffsetY:
      position >= thumbStart && position <= thumbEnd
        ? position - thumbStart
        : flowLogVerticalScrollbar.value.thumbHeight / 2,
  }
  isFlowLogScrollbarDragging.value = true
  scrollbar.setPointerCapture?.(event.pointerId)
  window.addEventListener?.('pointermove', onFlowLogScrollbarPointerMove)
  window.addEventListener?.('pointerup', stopFlowLogScrollbarDrag)
  window.addEventListener?.('pointercancel', stopFlowLogScrollbarDrag)
  setFlowLogScrollFromPointer(event)
}

function onFlowLogScrollbarPointerMove(event: PointerEvent): void {
  if (flowLogScrollbarDrag?.pointerId !== event.pointerId) return
  setFlowLogScrollFromPointer(event)
}

function stopFlowLogScrollbarDrag(event?: PointerEvent): void {
  if (event && flowLogScrollbarDrag?.pointerId !== event.pointerId) return
  const scrollbar = flowLogVerticalScrollbarRef.value
  if (event && scrollbar?.hasPointerCapture?.(event.pointerId)) {
    scrollbar.releasePointerCapture?.(event.pointerId)
  }
  window.removeEventListener?.('pointermove', onFlowLogScrollbarPointerMove)
  window.removeEventListener?.('pointerup', stopFlowLogScrollbarDrag)
  window.removeEventListener?.('pointercancel', stopFlowLogScrollbarDrag)
  flowLogScrollbarDrag = null
  isFlowLogScrollbarDragging.value = false
}

function destroyViewer(): void {
  closeFlowLogContextMenu()
  if (pendingSyncRaf !== null) {
    cancelAnimationFrame(pendingSyncRaf)
    pendingSyncRaf = null
  }
  if (pendingTailScrollRaf !== null) {
    cancelAnimationFrame(pendingTailScrollRaf)
    pendingTailScrollRaf = null
  }
  clearFlowLogScrollbarBindings()
  view?.destroy()
  view = null
  lastSyncedContent = ''
}

function scrollViewerToTail(): void {
  if (!view) return
  const scrollDOM = view.scrollDOM
  scrollDOM.scrollTop = Math.max(0, scrollDOM.scrollHeight - scrollDOM.clientHeight)
  syncFlowLogVerticalScrollbar()
}

function scheduleScrollViewerToTail(): void {
  if (pendingTailScrollRaf !== null) {
    cancelAnimationFrame(pendingTailScrollRaf)
  }
  pendingTailScrollRaf = requestAnimationFrame(() => {
    pendingTailScrollRaf = null
    scrollViewerToTail()
  })
}

function ensureViewerState(): void {
  if (isViewerEmpty.value || !rootRef.value) {
    if (view) destroyViewer()
    return
  }

  if (view) return

  view = new EditorView({
    parent: rootRef.value,
    state: EditorState.create({
      doc: props.content,
      extensions: buildFlowLogViewerExtensions(),
    }),
  })
  lastSyncedContent = props.content
  bindFlowLogScrollbar()
  if (props.live) {
    scheduleScrollViewerToTail()
  }
}

function syncViewerContent(nextContent: string): void {
  if (!view) return

  if (lastSyncedContent === nextContent) return

  const scrollDOM = view.scrollDOM
  const shouldFollowTail =
    props.live &&
    isFlowLogViewerNearTail(
      {
        scrollHeight: scrollDOM.scrollHeight,
        scrollTop: scrollDOM.scrollTop,
        clientHeight: scrollDOM.clientHeight,
      },
      FLOW_LOG_VIEWER_TAIL_THRESHOLD_PX,
    )

  const docLength = view.state.doc.length
  const changes = nextContent.startsWith(lastSyncedContent)
    ? { from: docLength, insert: nextContent.slice(lastSyncedContent.length) }
    : { from: 0, to: docLength, insert: nextContent }

  view.dispatch({ changes })
  lastSyncedContent = nextContent
  syncFlowLogVerticalScrollbar()

  if (shouldFollowTail) {
    scheduleScrollViewerToTail()
  }
}

function scheduleViewerContentSync(nextContent: string): void {
  pendingContent = nextContent
  if (pendingSyncRaf !== null) return
  pendingSyncRaf = requestAnimationFrame(() => {
    pendingSyncRaf = null
    const content = pendingContent
    pendingContent = null
    if (content === null) return
    ensureViewerState()
    syncViewerContent(content)
  })
}

onMounted(() => {
  ensureViewerState()
  document.addEventListener?.('pointerdown', onFlowLogContextMenuPointerDown)
  document.addEventListener?.('keydown', onFlowLogContextMenuKeydown)
  window.addEventListener?.('resize', closeFlowLogContextMenu)
  document.addEventListener?.('scroll', closeFlowLogContextMenu, true)
})

watch(
  () => props.content,
  (nextContent) => {
    scheduleViewerContentSync(nextContent)
  },
  { flush: 'post' },
)

watch(
  [rootRef, isViewerEmpty],
  () => {
    ensureViewerState()
  },
  { flush: 'post' },
)

watch(
  () => props.live,
  (isLive) => {
    if (isLive) {
      scheduleScrollViewerToTail()
    }
  },
  { flush: 'post' },
)

onUnmounted(() => {
  document.removeEventListener?.('pointerdown', onFlowLogContextMenuPointerDown)
  document.removeEventListener?.('keydown', onFlowLogContextMenuKeydown)
  window.removeEventListener?.('resize', closeFlowLogContextMenu)
  document.removeEventListener?.('scroll', closeFlowLogContextMenu, true)
  destroyViewer()
})
</script>

<template>
  <div class="flow-log-viewer-shell">
    <div v-if="isViewerEmpty" class="flow-log-viewer-empty">
      <i class="ri-file-list-3-line"></i>
      <p>
        {{
          loading
            ? 'Loading log content…'
            : missing
              ? 'Log file not found'
              : 'No log content yet'
        }}
      </p>
      <span v-if="loading">Reading the selected step log on demand.</span>
      <span v-else-if="missing"
        >The selected step did not produce a readable log file.</span
      >
      <span v-else>Select a started step or wait for the current step to emit logs.</span>
    </div>
    <div
      v-else
      class="flow-log-viewer-editor-wrap"
      :class="{ 'is-live': live }"
      @contextmenu="onViewerContextMenu"
      @wheel="onFlowLogWheel"
    >
      <div ref="rootRef" class="flow-log-viewer-editor"></div>
      <div
        ref="flowLogVerticalScrollbarRef"
        class="flow-log-vertical-scrollbar"
        :class="{ 'is-dragging': isFlowLogScrollbarDragging }"
        @pointerdown.stop.prevent="onFlowLogScrollbarPointerDown"
      >
        <span
          class="flow-log-vertical-scrollbar-thumb"
          :style="{
            height: `${flowLogVerticalScrollbar.thumbHeight}px`,
            transform: `translateY(${flowLogVerticalScrollbar.thumbOffset}px)`,
          }"
        ></span>
      </div>
      <span v-if="live" class="flow-log-terminal-cursor" aria-hidden="true"></span>
    </div>
    <Teleport to="body">
      <div
        v-if="flowLogContextMenu"
        ref="flowLogContextMenuRef"
        class="flow-log-context-menu"
        :style="flowLogContextMenu.style"
        role="menu"
        aria-label="Selected log text actions"
      >
        <button
          ref="flowLogContextMenuCopyButtonRef"
          type="button"
          class="flow-log-context-menu-action"
          role="menuitem"
          :disabled="flowLogContextMenuCopying"
          @click="copyFlowLogSelection"
        >
          <i
            :class="
              flowLogContextMenuFeedback === 'copied'
                ? 'ri-check-line'
                : flowLogContextMenuFeedback === 'failed'
                  ? 'ri-error-warning-line'
                  : 'ri-file-copy-line'
            "
          ></i>
          <span>{{ flowLogContextMenuCopyLabel }}</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.flow-log-viewer-shell {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  background: var(--bg-primary);
}

.flow-log-viewer-editor-wrap,
.flow-log-viewer-editor {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.flow-log-viewer-editor-wrap {
  position: relative;
  display: flex;
  overflow: hidden;
}

.flow-log-viewer-editor {
  overflow: hidden;
}

.flow-log-vertical-scrollbar {
  position: absolute;
  z-index: 5;
  top: 0;
  right: 0;
  bottom: 0;
  width: 20px;
  border-left: 1px solid color-mix(in srgb, var(--border-color) 82%, transparent);
  background: color-mix(in srgb, var(--bg-secondary) 72%, transparent);
  cursor: grab;
  pointer-events: auto;
  touch-action: none;
  user-select: none;
}

.flow-log-vertical-scrollbar.is-dragging {
  cursor: grabbing;
}

.flow-log-vertical-scrollbar-thumb {
  position: absolute;
  top: 0;
  right: 4px;
  left: 4px;
  min-height: 32px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(166, 166, 176, 0.66);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.36);
}

.flow-log-vertical-scrollbar:hover .flow-log-vertical-scrollbar-thumb,
.flow-log-vertical-scrollbar.is-dragging .flow-log-vertical-scrollbar-thumb {
  background: rgba(196, 196, 208, 0.88);
}

:deep(.cm-scroller) {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: scroll;
  overscroll-behavior: contain;
  /* Keep the log position discoverable even when Chromium uses overlay scrollbars. */
  scrollbar-color: rgba(190, 196, 207, 0.86) var(--bg-secondary);
  scrollbar-gutter: stable;
  scrollbar-width: auto;
}

:deep(.cm-editor) {
  height: 100%;
  min-height: 0;
}

:deep(.cm-scroller::-webkit-scrollbar) {
  width: 12px;
}

:deep(.cm-scroller::-webkit-scrollbar-track) {
  background: var(--bg-secondary);
  border-left: 1px solid var(--border-color);
}

:deep(.cm-scroller::-webkit-scrollbar-thumb) {
  min-height: 32px;
  background-color: rgba(190, 196, 207, 0.86);
  border: 2px solid var(--bg-secondary);
  border-radius: 6px;
  background-clip: padding-box;
}

:deep(.cm-scroller::-webkit-scrollbar-thumb:hover) {
  background-color: var(--accent-color);
}

:deep(.cm-scroller::-webkit-scrollbar-corner) {
  background: var(--bg-secondary);
}

.flow-log-context-menu {
  position: fixed;
  z-index: 20020;
  min-width: 124px;
  padding: 4px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-primary);
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.22);
}

.flow-log-context-menu-action {
  width: 100%;
  min-height: 28px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 8px;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 11px;
  text-align: left;
  cursor: pointer;
}

.flow-log-context-menu-action:hover:not(:disabled),
.flow-log-context-menu-action:focus-visible {
  outline: none;
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.12);
}

.flow-log-context-menu-action:disabled {
  cursor: wait;
  opacity: 0.7;
}

.flow-log-context-menu-action i {
  width: 14px;
  color: var(--accent-color);
  font-size: 14px;
  text-align: center;
}

.flow-log-terminal-cursor {
  position: absolute;
  right: 28px;
  bottom: 14px;
  width: 7px;
  height: 15px;
  border-radius: 1px;
  background: var(--accent-color);
  box-shadow: 0 0 10px rgba(var(--accent-rgb, 59, 130, 246), 0.55);
  pointer-events: none;
  animation: flow-log-cursor-blink 1s steps(1, end) infinite;
}

@keyframes flow-log-cursor-blink {
  0%,
  49% {
    opacity: 0.95;
  }

  50%,
  100% {
    opacity: 0;
  }
}

.flow-log-viewer-empty {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-secondary);
  background: var(--bg-primary);
  text-align: center;
}

.flow-log-viewer-empty i {
  font-size: 28px;
  opacity: 0.35;
}

.flow-log-viewer-empty p {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
}

.flow-log-viewer-empty span {
  font-size: 10px;
  opacity: 0.7;
  max-width: 320px;
  line-height: 1.45;
}
</style>
