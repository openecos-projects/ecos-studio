<template>
  <div
    class="monaco-log-viewer monaco-widget-overflow-host"
    role="region"
    :aria-label="ariaLabel"
  >
    <div ref="editorHost" class="monaco-log-editor monaco-widget-overflow-host"></div>
    <div v-if="runtimeLoading || runtimeError" class="monaco-log-overlay">
      <i
        :class="runtimeError ? 'ri-error-warning-line' : 'ri-loader-4-line animate-spin'"
      ></i>
      <span>{{ runtimeError || 'Loading log viewer...' }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useThemeStore } from '@/stores/themeStore'
import { normalizeLogContent, presentLog } from './logPresentation'
import { MONACO_LOG_LANGUAGE_ID } from './monacoLanguageIds'

interface ModelRecord {
  model: Monaco.editor.ITextModel
  decorationIds: string[]
  viewState: Monaco.editor.ICodeEditorViewState | null
}

const props = withDefaults(
  defineProps<{
    content: string
    channelKey?: string
    loading?: boolean
    ariaLabel?: string
  }>(),
  {
    channelKey: 'frontend-step-log',
    loading: false,
    ariaLabel: 'Frontend step log',
  },
)

const themeStore = useThemeStore()
const editorHost = ref<HTMLElement | null>(null)
const runtimeLoading = ref(true)
const runtimeError = ref('')
const editorTheme = computed<'light' | 'dark'>(() =>
  themeStore.themeName === 'dark' ? 'dark' : 'light',
)

let monaco: typeof Monaco | null = null
let editor: Monaco.editor.IStandaloneCodeEditor | null = null
let applyTheme: ((theme: 'light' | 'dark') => void) | null = null
let activeChannelKey = ''
let viewerDisposed = false
let viewerId = 0
let tooltipBoundsObserver: MutationObserver | null = null
let tooltipHostResizeObserver: ResizeObserver | null = null
let tooltipBoundsFrame: number | null = null
const models = new Map<string, ModelRecord>()

onMounted(async () => {
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
      readOnlyMessage: { value: 'Log output is read-only.' },
      ariaLabel: props.ariaLabel,
      automaticLayout: true,
      wordWrap: 'on',
      wrappingIndent: 'same',
      lineNumbers: 'off',
      glyphMargin: false,
      folding: false,
      lineDecorationsWidth: 8,
      lineNumbersMinChars: 0,
      minimap: { enabled: false },
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      renderLineHighlight: 'none',
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      contextmenu: true,
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
      fontSize: 11,
      lineHeight: 17,
      padding: { top: 8, bottom: 8 },
      scrollbar: {
        verticalScrollbarSize: 8,
        horizontalScrollbarSize: 8,
        alwaysConsumeMouseWheel: false,
      },
    })
    observeLogTooltipBounds()
    syncActiveModel()
  } catch (error) {
    runtimeError.value = error instanceof Error ? error.message : String(error)
  } finally {
    runtimeLoading.value = false
  }
})

watch(
  () => [props.channelKey, props.content, props.loading],
  () => syncActiveModel(),
  { flush: 'post' },
)

watch(editorTheme, (theme) => {
  applyTheme?.(theme)
})

onBeforeUnmount(() => {
  viewerDisposed = true
  disposeLogTooltipBounds()
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

function syncActiveModel(): void {
  if (!monaco || !editor) return
  const channelKey = normalizedChannelKey()
  const record = ensureModel(channelKey)
  const content = displayContent()

  if (record.model.getValue() !== content) {
    const activeViewState =
      activeChannelKey === channelKey ? editor.saveViewState() : null
    record.model.setValue(content)
    updateDecorations(record, content)
    if (activeViewState) {
      record.viewState = activeViewState
      editor.restoreViewState(activeViewState)
    }
  }

  if (activeChannelKey === channelKey && editor.getModel() === record.model) return
  saveActiveViewState()
  editor.setModel(record.model)
  activeChannelKey = channelKey
  if (record.viewState) {
    editor.restoreViewState(record.viewState)
  } else {
    editor.setScrollPosition({ scrollTop: 0, scrollLeft: 0 })
  }
}

function ensureModel(channelKey: string): ModelRecord {
  const existing = models.get(channelKey)
  if (existing) return existing
  if (!monaco) throw new Error('Monaco log runtime is not ready.')

  const model = monaco.editor.createModel(
    '',
    MONACO_LOG_LANGUAGE_ID,
    monaco.Uri.from({
      scheme: 'output',
      authority: `ecos-studio-${viewerId}`,
      path: `/${encodeURIComponent(channelKey)}.log`,
    }),
  )
  const record: ModelRecord = {
    model,
    decorationIds: [],
    viewState: null,
  }
  models.set(channelKey, record)
  return record
}

function updateDecorations(record: ModelRecord, content: string): void {
  const api = monaco
  if (!api) return
  const decorations = presentLog(content)
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

function observeLogTooltipBounds(): void {
  const host = editorHost.value
  if (!host) return

  tooltipBoundsObserver = new MutationObserver(() => scheduleLogTooltipBounds())
  tooltipBoundsObserver.observe(host, {
    attributes: true,
    attributeFilter: ['class', 'style'],
    childList: true,
    subtree: true,
  })
  tooltipHostResizeObserver = new ResizeObserver(() => scheduleLogTooltipBounds())
  tooltipHostResizeObserver.observe(host)
}

function disposeLogTooltipBounds(): void {
  tooltipBoundsObserver?.disconnect()
  tooltipBoundsObserver = null
  tooltipHostResizeObserver?.disconnect()
  tooltipHostResizeObserver = null
  if (tooltipBoundsFrame !== null) {
    cancelAnimationFrame(tooltipBoundsFrame)
    tooltipBoundsFrame = null
  }
}

function scheduleLogTooltipBounds(): void {
  if (tooltipBoundsFrame !== null) return
  tooltipBoundsFrame = requestAnimationFrame(() => {
    tooltipBoundsFrame = null
    clampLogTooltipsToEditorBounds()
  })
}

function clampLogTooltipsToEditorBounds(): void {
  const host = editorHost.value
  if (!host) return

  const hostBounds = host.getBoundingClientRect()
  const minimumLeft = hostBounds.left + 4
  const maximumRight = hostBounds.right - 4
  for (const contextView of host.querySelectorAll<HTMLElement>('.context-view')) {
    if (!contextView.querySelector(".monaco-hover[role='tooltip']")) continue
    const bounds = contextView.getBoundingClientRect()
    if (!bounds.width || !bounds.height) continue

    const currentShift =
      Number.parseFloat(
        contextView.style.getPropertyValue('--ecos-log-tooltip-shift-x'),
      ) || 0
    const unshiftedLeft = bounds.left - currentShift
    const maximumLeft = Math.max(minimumLeft, maximumRight - bounds.width)
    const desiredLeft = Math.min(Math.max(unshiftedLeft, minimumLeft), maximumLeft)
    const nextShift = Math.round(desiredLeft - unshiftedLeft)
    if (nextShift === currentShift) continue
    contextView.style.setProperty('--ecos-log-tooltip-shift-x', `${nextShift}px`)
  }
}

function normalizedChannelKey(): string {
  return props.channelKey.trim() || 'frontend-step-log'
}

function displayContent(): string {
  const content = normalizeLogContent(props.content)
  if (content) return content
  return props.loading ? 'Loading log content...' : 'No log content.'
}
</script>

<style scoped>
.monaco-log-viewer,
.monaco-log-editor {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.monaco-log-viewer {
  position: relative;
  overflow: hidden;
  background: var(--bg-primary);
}

.monaco-log-editor {
  overflow: hidden;
}

.monaco-log-overlay {
  position: absolute;
  inset: 0;
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
</style>
