<template>
  <section class="disassembly-viewer">
    <div v-if="!path" class="disassembly-empty">
      <i class="ri-code-s-slash-line"></i>
      <span>This case has no disassembly artifact.</span>
    </div>
    <template v-else>
      <header class="disassembly-toolbar">
        <div class="disassembly-title">
          <strong :title="path">{{ fileName(path) }}</strong>
          <span :title="path">{{ path }}</span>
        </div>
        <div class="disassembly-actions">
          <label class="address-field" title="Instruction address">
            <i class="ri-map-pin-line"></i>
            <input
              v-model="addressInput"
              type="text"
              spellcheck="false"
              placeholder="0x80000000"
              aria-label="Instruction address"
              @keydown.enter="jumpToInputAddress"
            />
          </label>
          <button
            type="button"
            class="icon-action"
            title="Jump to address"
            :disabled="loading || !addressInput.trim()"
            @click="jumpToInputAddress"
          >
            <i class="ri-focus-3-line"></i>
          </button>
          <button
            type="button"
            class="icon-action"
            title="Reload disassembly"
            :disabled="loading"
            @click="void loadDisassembly()"
          >
            <i :class="loading ? 'ri-loader-4-line spin' : 'ri-refresh-line'"></i>
          </button>
          <button
            v-if="closable"
            type="button"
            class="icon-action"
            title="Close disassembly"
            @click="emit('close')"
          >
            <i class="ri-close-line"></i>
          </button>
        </div>
      </header>
      <div v-if="message" class="disassembly-message" :class="{ error: Boolean(error) }">
        <i :class="error ? 'ri-error-warning-line' : 'ri-focus-3-line'"></i>
        <span>{{ message }}</span>
      </div>
      <div class="disassembly-editor-wrap">
        <div ref="editorHost" class="disassembly-editor"></div>
        <div v-if="loading" class="disassembly-overlay">
          <i class="ri-loader-4-line spin"></i>
          <span>Loading disassembly</span>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useWorkspace } from '@/composables/useWorkspace'
import { useThemeStore } from '@/stores/themeStore'
import { readOptionalProjectTextFile } from '@/utils/projectFiles'
import {
  findDisassemblyAddressLine,
  normalizeDisassemblyAddress,
  stripSourceFromDisassembly,
} from '@/utils/disassembly'

const props = defineProps<{
  path: string
  targetAddress?: string
  targetToken?: number
  reloadToken?: number
  closable?: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const { currentProject } = useWorkspace()
const themeStore = useThemeStore()
const editorHost = ref<HTMLElement | null>(null)
const loading = ref(false)
const error = ref('')
const navigationMessage = ref('')
const addressInput = ref('')
const content = ref('')
const message = computed(() => error.value || navigationMessage.value)
const editorTheme = computed<'dark' | 'light'>(() =>
  themeStore.themeName === 'dark' ? 'dark' : 'light',
)

let monaco: typeof Monaco | null = null
let editor: Monaco.editor.IStandaloneCodeEditor | null = null
let model: Monaco.editor.ITextModel | null = null
let pcDecorations: Monaco.editor.IEditorDecorationsCollection | null = null
let applyTheme: ((theme: 'light' | 'dark') => void) | null = null
let runtimeDisposed = false
let editorId = 0
let disassemblyLanguageId = ''
let loadToken = 0

onMounted(async () => {
  loading.value = Boolean(props.path)
  try {
    const runtime = await import('../monacoRuntime')
    if (runtimeDisposed) return
    monaco = runtime.getMonacoRuntime(editorTheme.value)
    applyTheme = runtime.setMonacoTheme
    editorId = runtime.nextMonacoEditorId()
    disassemblyLanguageId = runtime.MONACO_DISASSEMBLY_LANGUAGE_ID
    await nextTick()
    ensureEditor()
    await loadDisassembly()
  } catch (err) {
    if (!runtimeDisposed) {
      error.value = err instanceof Error ? err.message : String(err)
      loading.value = false
    }
  }
})

onBeforeUnmount(() => {
  runtimeDisposed = true
  loadToken += 1
  disposeEditor()
  monaco = null
})

watch(
  () => [props.path, props.reloadToken],
  async () => {
    await nextTick()
    if (props.path) ensureEditor()
    else disposeEditor()
    void loadDisassembly()
  },
)

watch(
  () => props.targetToken,
  () => applyExternalTarget(),
)

watch(editorTheme, (theme) => {
  applyTheme?.(theme)
})

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path
}

function ensureEditor(): void {
  if (editor || !monaco || !disassemblyLanguageId || !editorHost.value) return
  model = monaco.editor.createModel(
    '',
    disassemblyLanguageId,
    monaco.Uri.from({
      scheme: 'disassembly',
      authority: `ecos-studio-${editorId}`,
      path: '/artifact.asm',
    }),
  )
  editor = monaco.editor.create(editorHost.value, {
    model,
    readOnly: true,
    domReadOnly: true,
    readOnlyMessage: { value: 'Disassembly is read-only.' },
    ariaLabel: 'Disassembly',
    automaticLayout: true,
    wordWrap: 'off',
    lineNumbers: 'on',
    glyphMargin: false,
    folding: false,
    lineDecorationsWidth: 8,
    minimap: { enabled: false },
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    renderLineHighlight: 'none',
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    contextmenu: true,
    links: false,
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
    padding: { top: 10, bottom: 16 },
    scrollbar: {
      verticalScrollbarSize: 8,
      horizontalScrollbarSize: 8,
      alwaysConsumeMouseWheel: false,
    },
  })
  pcDecorations = editor.createDecorationsCollection()
}

function disposeEditor(): void {
  pcDecorations?.clear()
  pcDecorations = null
  editor?.dispose()
  editor = null
  model?.dispose()
  model = null
}

async function loadDisassembly(): Promise<void> {
  const path = props.path
  const token = ++loadToken
  error.value = ''
  navigationMessage.value = ''
  content.value = ''
  setEditorContent('')
  if (!path) {
    loading.value = false
    return
  }
  if (!editor || !model) {
    loading.value = true
    return
  }

  loading.value = true
  try {
    const result = await readOptionalProjectTextFile(path, {
      projectPath: currentProject.value?.path,
    })
    if (token !== loadToken) return
    if (result === null) throw new Error('Disassembly file is not readable.')
    const pureDisassembly = stripSourceFromDisassembly(result)
    content.value = pureDisassembly
    setEditorContent(pureDisassembly)
    await nextTick()
    applyExternalTarget()
  } catch (err) {
    if (token === loadToken) {
      error.value = err instanceof Error ? err.message : String(err)
    }
  } finally {
    if (token === loadToken) loading.value = false
  }
}

function setEditorContent(nextContent: string): void {
  if (!model) return
  setHighlightedLine(null)
  if (model.getValue() !== nextContent) model.setValue(nextContent)
}

function applyExternalTarget(): void {
  const target = normalizeDisassemblyAddress(props.targetAddress)
  if (!target) return
  addressInput.value = `0x${target}`
  jumpToAddress(target)
}

function jumpToInputAddress(): void {
  jumpToAddress(addressInput.value)
}

function jumpToAddress(address: string): void {
  if (!editor || !model || !content.value) return
  const normalized = normalizeDisassemblyAddress(address)
  if (!normalized) {
    navigationMessage.value = 'Enter a hexadecimal instruction address.'
    return
  }
  addressInput.value = `0x${normalized}`
  const lineNumber = findDisassemblyAddressLine(content.value, normalized)
  if (lineNumber === null) {
    setHighlightedLine(null)
    navigationMessage.value = `Address 0x${normalized} is not present in this file.`
    return
  }

  editor.setPosition({ lineNumber, column: 1 })
  setHighlightedLine(lineNumber)
  editor.revealLineInCenter(lineNumber)
  navigationMessage.value = `PC 0x${normalized} · line ${lineNumber}`
  editor.focus()
}

function setHighlightedLine(lineNumber: number | null): void {
  if (!monaco || !pcDecorations) return
  if (lineNumber === null) {
    pcDecorations.clear()
    return
  }
  pcDecorations.set([
    {
      range: new monaco.Range(lineNumber, 1, lineNumber, 1),
      options: {
        isWholeLine: true,
        className: 'monaco-pc-line',
      },
    },
  ])
}
</script>

<style scoped>
.disassembly-viewer {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  background: var(--bg-primary);
}

.disassembly-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-shrink: 0;
  min-height: 40px;
  padding: 6px 8px 6px 10px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.disassembly-title {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.disassembly-title strong,
.disassembly-title span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.disassembly-title strong {
  color: var(--text-primary);
  font-size: 11px;
}
.disassembly-title span {
  color: var(--text-secondary);
  font-size: 9px;
}

.disassembly-actions {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}

.address-field {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 142px;
  height: 28px;
  padding: 0 7px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-secondary);
}

.address-field input {
  min-width: 0;
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font:
    10px 'JetBrains Mono',
    'SF Mono',
    ui-monospace,
    monospace;
}

.icon-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-secondary);
  cursor: pointer;
}

.icon-action:hover:not(:disabled) {
  color: var(--accent-color);
}
.icon-action:disabled {
  cursor: default;
  opacity: 0.45;
}

.disassembly-message {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 5px 10px;
  border-bottom: 1px solid rgba(var(--accent-rgb, 59, 130, 246), 0.24);
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.08);
  color: var(--accent-color);
  font-size: 10px;
}

.disassembly-message.error {
  border-bottom-color: rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.08);
  color: #ef4444;
}

.disassembly-editor-wrap,
.disassembly-editor {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.disassembly-editor-wrap {
  position: relative;
  display: flex;
}
.disassembly-editor {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

:deep(.monaco-editor),
:deep(.monaco-editor .overflow-guard) {
  border-radius: 0;
}

:deep(.monaco-editor .view-line) {
  user-select: text;
}

:deep(.monaco-editor .monaco-pc-line) {
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.18);
  box-shadow: inset 3px 0 0 var(--accent-color);
}

.disassembly-overlay,
.disassembly-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: var(--text-secondary);
  font-size: 11px;
}

.disassembly-overlay {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--bg-primary) 82%, transparent);
}

.disassembly-empty {
  flex: 1;
  flex-direction: column;
}
.disassembly-empty i {
  font-size: 30px;
  opacity: 0.4;
}

.spin {
  animation: disassembly-spin 0.8s linear infinite;
}
@keyframes disassembly-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
