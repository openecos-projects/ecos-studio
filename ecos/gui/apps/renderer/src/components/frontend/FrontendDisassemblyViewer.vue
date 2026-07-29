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
import type { Extension } from '@codemirror/state'
import { EditorState, StateEffect, StateField } from '@codemirror/state'
import { search, searchKeymap } from '@codemirror/search'
import {
  Decoration,
  EditorView,
  keymap,
  lineNumbers,
  type DecorationSet,
} from '@codemirror/view'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useWorkspace } from '@/composables/useWorkspace'
import { readOptionalProjectTextFile } from '@/utils/projectFiles'
import {
  findDisassemblyAddressLine,
  normalizeDisassemblyAddress,
} from '@/utils/disassembly'

const props = defineProps<{
  path: string
  targetAddress?: string
  targetToken?: number
  closable?: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const { currentProject } = useWorkspace()
const editorHost = ref<HTMLElement | null>(null)
const loading = ref(false)
const error = ref('')
const navigationMessage = ref('')
const addressInput = ref('')
const content = ref('')
const message = computed(() => error.value || navigationMessage.value)

let view: EditorView | null = null
let loadToken = 0

const setHighlightedLine = StateEffect.define<number | null>()
const highlightedLine = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(setHighlightedLine)) continue
      if (effect.value === null) return Decoration.none
      const line = transaction.state.doc.line(effect.value)
      return Decoration.set([Decoration.line({ class: 'cm-pc-line' }).range(line.from)])
    }
    return value.map(transaction.changes)
  },
  provide: (field) => EditorView.decorations.from(field),
})

onMounted(() => {
  ensureEditor()
  void loadDisassembly()
})

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})

watch(
  () => props.path,
  () => void loadDisassembly(),
)

watch(
  () => props.targetToken,
  () => applyExternalTarget(),
)

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path
}

function ensureEditor(): void {
  if (view || !editorHost.value) return
  view = new EditorView({
    parent: editorHost.value,
    state: EditorState.create({
      doc: '',
      extensions: editorExtensions(),
    }),
  })
}

function editorExtensions(): Extension[] {
  return [
    lineNumbers(),
    search({ top: true }),
    keymap.of(searchKeymap),
    EditorState.readOnly.of(true),
    highlightedLine,
    EditorView.theme({
      '&': {
        height: '100%',
        color: 'var(--text-primary)',
        backgroundColor: 'var(--bg-primary)',
        fontSize: '11px',
      },
      '.cm-scroller': {
        fontFamily: "'JetBrains Mono', 'SF Mono', ui-monospace, monospace",
        lineHeight: '1.55',
      },
      '.cm-content': { padding: '10px 0 16px' },
      '.cm-line': { padding: '0 12px' },
      '.cm-gutters': {
        backgroundColor: 'var(--bg-secondary)',
        color: 'var(--text-secondary)',
        borderRight: '1px solid var(--border-color)',
        fontSize: '10px',
      },
      '.cm-pc-line': {
        backgroundColor: 'rgba(var(--accent-rgb, 59, 130, 246), 0.18)',
        boxShadow: 'inset 3px 0 0 var(--accent-color)',
      },
      '&.cm-focused': { outline: 'none' },
      '.cm-selectionBackground': {
        backgroundColor: 'rgba(var(--accent-rgb, 59, 130, 246), 0.24) !important',
      },
      '.cm-panels': {
        backgroundColor: 'var(--bg-secondary)',
        color: 'var(--text-primary)',
      },
    }),
  ]
}

async function loadDisassembly(): Promise<void> {
  ensureEditor()
  const path = props.path
  const token = ++loadToken
  error.value = ''
  navigationMessage.value = ''
  content.value = ''
  setEditorContent('')
  if (!path || !view) return

  loading.value = true
  try {
    const result = await readOptionalProjectTextFile(path, {
      projectPath: currentProject.value?.path,
    })
    if (token !== loadToken) return
    if (result === null) throw new Error('Disassembly file is not readable.')
    content.value = result
    setEditorContent(result)
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
  if (!view) return
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: nextContent },
    effects: setHighlightedLine.of(null),
  })
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
  if (!view || !content.value) return
  const normalized = normalizeDisassemblyAddress(address)
  if (!normalized) {
    navigationMessage.value = 'Enter a hexadecimal instruction address.'
    return
  }
  addressInput.value = `0x${normalized}`
  const lineNumber = findDisassemblyAddressLine(content.value, normalized)
  if (lineNumber === null) {
    view.dispatch({ effects: setHighlightedLine.of(null) })
    navigationMessage.value = `Address 0x${normalized} is not present in this file.`
    return
  }

  const line = view.state.doc.line(lineNumber)
  view.dispatch({
    selection: { anchor: line.from },
    effects: [
      setHighlightedLine.of(lineNumber),
      EditorView.scrollIntoView(line.from, { y: 'center' }),
    ],
  })
  navigationMessage.value = `PC 0x${normalized} · line ${lineNumber}`
  view.focus()
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
  overflow: hidden;
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
