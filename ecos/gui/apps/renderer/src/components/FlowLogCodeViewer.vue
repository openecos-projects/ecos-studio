<script setup lang="ts">
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useThemeStore } from '@/stores/themeStore'
import {
  computeFlowLogContextMenuStyle,
  FLOW_LOG_VIEWER_TAIL_THRESHOLD_PX,
  flowLogContentUpdate,
  isFlowLogViewerNearTail,
} from './flowLogCodeViewer'
import { copyFlowLogText } from './flowLogCopy'
import { normalizeLogContent, presentLog } from './logPresentation'
import { MONACO_LOG_LANGUAGE_ID } from './monacoLanguageIds'

interface ModelRecord {
  content: string
  decorationIds: string[]
  model: Monaco.editor.ITextModel
  viewState: Monaco.editor.ICodeEditorViewState | null
}

const props = withDefaults(
  defineProps<{
    content: string
    channelKey?: string
    live?: boolean
    missing?: boolean
    loading?: boolean
    ariaLabel?: string
  }>(),
  {
    channelKey: 'flow-step-log',
    live: false,
    missing: false,
    loading: false,
    ariaLabel: 'Flow step log',
  },
)

const themeStore = useThemeStore()
const editorHost = ref<HTMLElement | null>(null)
const flowLogContextMenuRef = ref<HTMLElement | null>(null)
const flowLogContextMenuCopyButtonRef = ref<HTMLButtonElement | null>(null)
const runtimeLoading = ref(true)
const runtimeError = ref('')
const isViewerEmpty = computed(() => !props.content)
const editorTheme = computed<'light' | 'dark'>(() =>
  themeStore.themeName === 'dark' ? 'dark' : 'light',
)
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

let monaco: typeof Monaco | null = null
let editor: Monaco.editor.IStandaloneCodeEditor | null = null
let applyTheme: ((theme: 'light' | 'dark') => void) | null = null
let activeChannelKey = ''
let viewerId = 0
let viewerDisposed = false
let pendingSyncRaf: number | null = null
let pendingTailScrollRaf: number | null = null
let flowLogContextMenuFeedbackTimer: ReturnType<typeof setTimeout> | null = null
const models = new Map<string, ModelRecord>()

onMounted(async () => {
  document.addEventListener?.('pointerdown', onFlowLogContextMenuPointerDown)
  document.addEventListener?.('keydown', onFlowLogContextMenuKeydown)
  window.addEventListener?.('resize', closeFlowLogContextMenu)
  document.addEventListener?.('scroll', closeFlowLogContextMenu, true)

  try {
    const runtime = await import('./monacoRuntime')
    if (viewerDisposed || !editorHost.value) return
    viewerId = runtime.nextMonacoEditorId()
    monaco = runtime.getMonacoRuntime(editorTheme.value)
    applyTheme = runtime.setMonacoTheme
    editor = monaco.editor.create(editorHost.value, {
      model: null,
      readOnly: true,
      domReadOnly: true,
      readOnlyMessage: { value: 'Flow log output is read-only.' },
      ariaLabel: props.ariaLabel,
      automaticLayout: true,
      wordWrap: 'on',
      wrappingIndent: 'same',
      lineNumbers: 'on',
      lineNumbersMinChars: 3,
      glyphMargin: false,
      folding: false,
      lineDecorationsWidth: 8,
      minimap: { enabled: false },
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      renderLineHighlight: 'none',
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      contextmenu: false,
      links: true,
      occurrencesHighlight: 'off',
      selectionHighlight: false,
      stickyScroll: { enabled: false },
      guides: { indentation: false, bracketPairs: false },
      bracketPairColorization: { enabled: false },
      unicodeHighlight: {
        ambiguousCharacters: false,
        invisibleCharacters: false,
        nonBasicASCII: false,
      },
      fontFamily: "'JetBrains Mono', 'SF Mono', ui-monospace, monospace",
      fontSize: 12,
      lineHeight: 19,
      padding: { top: 12, bottom: 16 },
      scrollbar: {
        verticalScrollbarSize: 8,
        horizontalScrollbarSize: 8,
        alwaysConsumeMouseWheel: false,
      },
    })
    syncActiveModel()
  } catch (error) {
    runtimeError.value = error instanceof Error ? error.message : String(error)
  } finally {
    runtimeLoading.value = false
  }
})

watch(
  () => [props.channelKey, props.content, props.loading, props.missing],
  () => scheduleActiveModelSync(),
  { flush: 'post' },
)

watch(
  () => props.live,
  (live) => {
    if (live && props.content) scheduleScrollViewerToTail()
  },
  { flush: 'post' },
)

watch(editorTheme, (theme) => {
  applyTheme?.(theme)
})

onBeforeUnmount(() => {
  viewerDisposed = true
  document.removeEventListener?.('pointerdown', onFlowLogContextMenuPointerDown)
  document.removeEventListener?.('keydown', onFlowLogContextMenuKeydown)
  window.removeEventListener?.('resize', closeFlowLogContextMenu)
  document.removeEventListener?.('scroll', closeFlowLogContextMenu, true)
  closeFlowLogContextMenu()
  cancelPendingAnimationFrames()
  saveActiveViewState()
  editor?.dispose()
  editor = null
  for (const record of models.values()) {
    record.model.deltaDecorations(record.decorationIds, [])
    record.model.dispose()
  }
  models.clear()
  monaco = null
})

function scheduleActiveModelSync(): void {
  if (pendingSyncRaf !== null) return
  pendingSyncRaf = requestAnimationFrame(() => {
    pendingSyncRaf = null
    syncActiveModel()
  })
}

function syncActiveModel(): void {
  if (!monaco || !editor) return
  const channelKey = normalizedChannelKey()
  const content = normalizeLogContent(props.content)
  if (!content && !models.has(channelKey)) {
    if (activeChannelKey !== channelKey) {
      saveActiveViewState()
      editor.setModel(null)
      activeChannelKey = channelKey
    }
    return
  }

  const record = ensureModel(channelKey)
  const isActive = activeChannelKey === channelKey && editor.getModel() === record.model
  const shouldFollowTail = isActive && props.live && viewerIsNearTail()
  const activeViewState = isActive ? editor.saveViewState() : null
  const update = flowLogContentUpdate(record.content, content)

  if (update.kind === 'append') {
    const end = record.model.getFullModelRange().getEndPosition()
    record.model.applyEdits([
      {
        range: new monaco.Range(end.lineNumber, end.column, end.lineNumber, end.column),
        text: update.text,
        forceMoveMarkers: true,
      },
    ])
  } else if (update.kind === 'replace') {
    record.model.applyEdits([
      {
        range: record.model.getFullModelRange(),
        text: update.text,
        forceMoveMarkers: true,
      },
    ])
  }

  if (update.kind !== 'none') {
    record.content = content
    updateDecorations(record)
    if (activeViewState) {
      record.viewState = activeViewState
      editor.restoreViewState(activeViewState)
    }
  }

  if (!isActive) {
    saveActiveViewState()
    editor.setModel(record.model)
    activeChannelKey = channelKey
    if (record.viewState) {
      editor.restoreViewState(record.viewState)
    } else if (props.live) {
      scheduleScrollViewerToTail()
    } else {
      editor.setScrollPosition({ scrollTop: 0, scrollLeft: 0 })
    }
  } else if (shouldFollowTail && update.kind !== 'none') {
    scheduleScrollViewerToTail()
  }
}

function ensureModel(channelKey: string): ModelRecord {
  const existing = models.get(channelKey)
  if (existing) return existing
  if (!monaco) throw new Error('Monaco runtime is not ready.')

  const model = monaco.editor.createModel(
    '',
    MONACO_LOG_LANGUAGE_ID,
    monaco.Uri.from({
      scheme: 'output',
      authority: `ecos-studio-flow-${viewerId}`,
      path: `/${encodeURIComponent(channelKey)}.log`,
    }),
  )
  const record: ModelRecord = {
    content: '',
    decorationIds: [],
    model,
    viewState: null,
  }
  models.set(channelKey, record)
  return record
}

function updateDecorations(record: ModelRecord): void {
  const api = monaco
  if (!api) return
  const decorations = presentLog(record.content)
    .filter((line) => line.tone !== 'plain')
    .map((line) => ({
      range: new api.Range(line.number, 1, line.number, 1),
      options: {
        isWholeLine: true,
        className: `ecos-log-line-${line.tone}`,
      },
    }))
  record.decorationIds = record.model.deltaDecorations(record.decorationIds, decorations)
}

function saveActiveViewState(): void {
  if (!editor || !activeChannelKey) return
  const record = models.get(activeChannelKey)
  if (record) record.viewState = editor.saveViewState()
}

function normalizedChannelKey(): string {
  return props.channelKey.trim() || 'flow-step-log'
}

function viewerIsNearTail(): boolean {
  if (!editor) return false
  return isFlowLogViewerNearTail(
    {
      scrollHeight: editor.getScrollHeight(),
      scrollTop: editor.getScrollTop(),
      clientHeight: editor.getLayoutInfo().height,
    },
    FLOW_LOG_VIEWER_TAIL_THRESHOLD_PX,
  )
}

function scheduleScrollViewerToTail(): void {
  if (!editor) return
  if (pendingTailScrollRaf !== null) cancelAnimationFrame(pendingTailScrollRaf)
  pendingTailScrollRaf = requestAnimationFrame(() => {
    pendingTailScrollRaf = null
    editor?.setScrollTop(editor.getScrollHeight())
  })
}

function cancelPendingAnimationFrames(): void {
  if (pendingSyncRaf !== null) cancelAnimationFrame(pendingSyncRaf)
  if (pendingTailScrollRaf !== null) cancelAnimationFrame(pendingTailScrollRaf)
  pendingSyncRaf = null
  pendingTailScrollRaf = null
}

function selectedText(): string {
  const selection = editor?.getSelection()
  const model = editor?.getModel()
  if (!selection || selection.isEmpty() || !model) return ''
  return model.getValueInRange(selection)
}

function clearFlowLogContextMenuFeedbackTimer(): void {
  if (!flowLogContextMenuFeedbackTimer) return
  clearTimeout(flowLogContextMenuFeedbackTimer)
  flowLogContextMenuFeedbackTimer = null
}

function closeFlowLogContextMenu(): void {
  clearFlowLogContextMenuFeedbackTimer()
  flowLogContextMenu.value = null
  flowLogContextMenuFeedback.value = null
  flowLogContextMenuCopying.value = false
}

function onViewerContextMenu(event: MouseEvent): void {
  const text = selectedText()
  if (!text) return
  event.preventDefault()
  clearFlowLogContextMenuFeedbackTimer()
  flowLogContextMenuFeedback.value = null
  flowLogContextMenuCopying.value = false
  flowLogContextMenu.value = {
    text,
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
    flowLogContextMenuFeedbackTimer = setTimeout(closeFlowLogContextMenu, 900)
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
</script>

<template>
  <div
    class="flow-log-viewer-shell monaco-widget-overflow-host"
    role="region"
    :aria-label="ariaLabel"
  >
    <div
      v-show="!isViewerEmpty"
      class="flow-log-viewer-editor-wrap monaco-widget-overflow-host"
      :class="{ 'is-live': live }"
      @contextmenu="onViewerContextMenu"
    >
      <div
        ref="editorHost"
        class="flow-log-viewer-editor monaco-widget-overflow-host"
      ></div>
      <span v-if="live" class="flow-log-terminal-cursor" aria-hidden="true"></span>
    </div>

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
      v-if="runtimeError || (runtimeLoading && !isViewerEmpty)"
      class="flow-log-overlay"
    >
      <i
        :class="runtimeError ? 'ri-error-warning-line' : 'ri-loader-4-line animate-spin'"
      ></i>
      <span>{{ runtimeError || 'Loading log viewer...' }}</span>
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
.flow-log-viewer-shell,
.flow-log-viewer-editor-wrap,
.flow-log-viewer-editor {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.flow-log-viewer-shell,
.flow-log-viewer-editor-wrap {
  position: relative;
  display: flex;
  overflow: hidden;
  background: var(--bg-primary);
}

.flow-log-viewer-editor {
  overflow: hidden;
}

.flow-log-overlay {
  position: absolute;
  inset: 0;
  z-index: 6;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-secondary);
  background: var(--bg-primary);
  font-size: 11px;
}

:deep(.monaco-editor),
:deep(.monaco-editor .overflow-guard) {
  border-radius: 0;
}

:deep(.monaco-editor .view-line) {
  user-select: text;
}

:deep(.ecos-log-line-info) {
  background: color-mix(in srgb, var(--info-bg) 38%, transparent);
}

:deep(.ecos-log-line-phase) {
  background: color-mix(in srgb, var(--accent-color) 5%, transparent);
}

:deep(.ecos-log-line-success) {
  background: var(--success-bg);
}

:deep(.ecos-log-line-warning) {
  background: var(--warn-bg);
}

:deep(.ecos-log-line-error) {
  background: var(--danger-bg);
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
  max-width: 320px;
  font-size: 10px;
  line-height: 1.45;
  opacity: 0.7;
}
</style>
