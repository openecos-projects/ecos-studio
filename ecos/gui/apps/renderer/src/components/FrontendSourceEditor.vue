<template>
  <div class="source-editor">
    <div v-if="!source?.path" class="source-empty">
      <i class="ri-file-code-line"></i>
      <span>Select a source file from Src.</span>
    </div>

    <template v-else>
      <header class="source-toolbar">
        <div class="source-title">
          <strong :title="source.path">{{ source.label || fileName(source.path) }}</strong>
          <span :title="source.path">{{ source.path }}</span>
        </div>
        <div class="source-actions">
          <span class="source-state" :class="{ dirty: isDirty, saving }">{{ sourceStateText }}</span>
          <button type="button" class="icon-action" title="Reload" :disabled="busy" @click="void loadSource()">
            <i :class="loading ? 'ri-loader-4-line spin' : 'ri-refresh-line'"></i>
          </button>
          <button type="button" class="icon-action" title="Save" :disabled="!canSave" @click="void saveSource()">
            <i :class="saving ? 'ri-loader-4-line spin' : 'ri-save-3-line'"></i>
          </button>
          <button type="button" class="text-action" :disabled="!canLint" @click="void runLint()">
            <i :class="lintRunning ? 'ri-loader-4-line spin' : 'ri-shield-check-line'"></i>
            <span>Lint</span>
          </button>
        </div>
      </header>

      <div v-if="error" class="source-error">
        <i class="ri-error-warning-line"></i>
        <span>{{ error }}</span>
      </div>

      <div class="editor-wrap" :class="`theme-${editorTheme}`">
        <div ref="editorHost" class="editor-host"></div>
        <div v-if="loading" class="editor-overlay">
          <i class="ri-loader-4-line spin"></i>
          <span>Loading</span>
        </div>
      </div>

      <section class="lint-panel">
        <div class="lint-head">
          <div>
            <strong :class="lintStatus">{{ lintTitle }}</strong>
            <span>{{ lintSubtitle }}</span>
          </div>
          <button
            type="button"
            class="icon-action compact"
            :disabled="!diagnostics.length && !lintLog"
            :title="showLintLog ? 'Hide log' : 'Show log'"
            @click="showLintLog = !showLintLog"
          >
            <i :class="showLintLog ? 'ri-list-check' : 'ri-terminal-box-line'"></i>
          </button>
        </div>

        <div v-if="diagnostics.length" class="diagnostics">
          <button
            v-for="diagnostic in diagnostics"
            :key="diagnosticKey(diagnostic)"
            type="button"
            class="diagnostic-row"
            :class="diagnostic.severity"
            @click="jumpToDiagnostic(diagnostic)"
          >
            <i :class="diagnostic.severity === 'error' ? 'ri-close-circle-line' : 'ri-alert-line'"></i>
            <span>
              <strong>{{ diagnostic.code }}</strong>
              <small>{{ diagnosticLocation(diagnostic) }}</small>
              <em>{{ diagnostic.message || diagnostic.raw }}</em>
            </span>
          </button>
        </div>

        <pre v-if="showLintLog && lintLog" class="lint-log">{{ lintLog }}</pre>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Extension } from '@codemirror/state'
import { Compartment, EditorState } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import { search, searchKeymap } from '@codemirror/search'
import { CMDEnum, InfoEnum, ResponseEnum, StateEnum } from '@/api/type'
import { getInfoApi, runStepApi } from '@/api/flow'
import { useWorkspace } from '@/composables/useWorkspace'
import { useThemeStore } from '@/stores/themeStore'
import { readOptionalProjectTextFileTail, writeProjectTextFile } from '@/utils/projectFiles'
import {
  countVerilatorDiagnostics,
  diagnosticMatchesPath,
  fileName,
  parseVerilatorDiagnostics,
  type VerilatorDiagnostic,
} from '@/utils/verilatorDiagnostics'

interface FrontendSourceSelection {
  label: string
  path: string
}

interface PathItem {
  label: string
  path: string
}

interface FrontendStepDetail {
  state?: string
  logs?: PathItem[]
  reports?: PathItem[]
}

const props = defineProps<{
  source: FrontendSourceSelection | null
  focusTarget?: {
    path?: string
    line?: number
    column?: number
    token?: number
  } | null
}>()

const emit = defineEmits<{
  saved: []
  linted: []
}>()

const SOURCE_CHAR_LIMIT = 4_000_000
const LINT_LOG_CHAR_LIMIT = 300_000

const { currentProject, showToast, invalidateWorkspaceResources } = useWorkspace()
const themeStore = useThemeStore()
const editorHost = ref<HTMLElement | null>(null)
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const isDirty = ref(false)
const lintRunning = ref(false)
const lintStatus = ref<'idle' | 'running' | 'success' | 'failed' | 'error'>('idle')
const lintLog = ref('')
const showLintLog = ref(false)
const diagnostics = ref<VerilatorDiagnostic[]>([])
const sourceTruncated = ref(false)

let view: EditorView | null = null
let savedContent = ''
let loadToken = 0
const themeCompartment = new Compartment()

const editorTheme = computed<'dark' | 'light'>(() => themeStore.themeName === 'dark' ? 'dark' : 'light')
const busy = computed(() => loading.value || saving.value || lintRunning.value)
const canSave = computed(() => Boolean(props.source?.path && view && isDirty.value && !busy.value && !sourceTruncated.value))
const canLint = computed(() => Boolean(props.source?.path && !busy.value))
const sourceStateText = computed(() => {
  if (saving.value) return 'Saving'
  if (loading.value) return 'Loading'
  return isDirty.value ? 'Unsaved' : 'Saved'
})
const lintCounts = computed(() => countVerilatorDiagnostics(diagnostics.value))
const lintTitle = computed(() => {
  if (lintStatus.value === 'running') return 'Lint running'
  if (lintStatus.value === 'success') return 'Lint passed'
  if (lintStatus.value === 'failed') return 'Lint failed'
  if (lintStatus.value === 'error') return 'Lint error'
  return 'Verilator lint'
})
const lintSubtitle = computed(() => {
  if (lintRunning.value) return 'waiting for CLI result'
  if (lintCounts.value.errors || lintCounts.value.warnings) {
    return `${lintCounts.value.errors} errors / ${lintCounts.value.warnings} warnings`
  }
  return lintLog.value ? 'no diagnostics parsed' : 'not run yet'
})

onMounted(() => {
  ensureEditor()
  void loadSource()
})

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})

watch(() => props.source?.path, () => {
  resetLint()
  void loadSource()
})

watch(() => props.focusTarget?.token, () => {
  focusExternalTarget()
})

watch(editorTheme, (theme) => {
  view?.dispatch({ effects: themeCompartment.reconfigure(editorThemeExtension(theme)) })
})

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
    EditorView.lineWrapping,
    syntaxHighlighter(),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged || loading.value) return
      isDirty.value = currentContent() !== savedContent
    }),
    themeCompartment.of(editorThemeExtension(editorTheme.value)),
  ]
}

async function loadSource(): Promise<void> {
  ensureEditor()
  const source = props.source
  if (!source?.path || !view) {
    setEditorContent('')
    savedContent = ''
    isDirty.value = false
    sourceTruncated.value = false
    return
  }
  const token = ++loadToken
  loading.value = true
  error.value = ''
  try {
    const result = await readOptionalProjectTextFileTail(source.path, SOURCE_CHAR_LIMIT, {
      projectPath: currentProject.value?.path,
    })
    if (token !== loadToken) return
    if (!result) {
      throw new Error('Source file is not readable in current workspace scope.')
    }
    const content = result.truncated
      ? `/* File is too large; showing tail only. */\n${result.content}`
      : result.content
    sourceTruncated.value = result.truncated
    setEditorContent(content)
    savedContent = content
    isDirty.value = false
    focusExternalTarget()
  } catch (err) {
    if (token === loadToken) {
      error.value = err instanceof Error ? err.message : String(err)
      setEditorContent('')
      savedContent = ''
      isDirty.value = false
      sourceTruncated.value = false
    }
  } finally {
    if (token === loadToken) loading.value = false
  }
}

async function saveSource(): Promise<void> {
  if (!props.source?.path || !view) return
  if (sourceTruncated.value) {
    error.value = 'This source file is displayed as a truncated tail and cannot be saved safely.'
    showToast({
      severity: 'warn',
      summary: 'Save Blocked',
      detail: error.value,
      life: 5000,
    })
    return
  }
  saving.value = true
  error.value = ''
  try {
    const content = currentContent()
    await writeProjectTextFile(props.source.path, content, {
      projectPath: currentProject.value?.path,
    })
    savedContent = content
    isDirty.value = false
    emit('saved')
    showToast({
      severity: 'success',
      summary: 'Source Saved',
      detail: fileName(props.source.path),
      life: 3000,
    })
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    showToast({
      severity: 'error',
      summary: 'Save Failed',
      detail: error.value,
      life: 6000,
    })
  } finally {
    saving.value = false
  }
}

async function runLint(): Promise<void> {
  const directory = currentProject.value?.path
  if (!directory) return
  lintRunning.value = true
  lintStatus.value = 'running'
  lintLog.value = ''
  diagnostics.value = []
  try {
    const result = await runStepApi({
      cmd: CMDEnum.run_step,
      data: {
        designTool: 'frontend',
        directory,
        step: 'lint',
        rerun: true,
      },
    })
    lintStatus.value = result.data?.state === StateEnum.Success ? 'success' : 'failed'
    await loadLintDetail()
    invalidateWorkspaceResources(['flow', 'step', 'logs'])
    emit('linted')
  } catch (err) {
    lintStatus.value = 'error'
    lintLog.value = err instanceof Error ? err.message : String(err)
  } finally {
    lintRunning.value = false
  }
}

async function loadLintDetail(): Promise<void> {
  const response = await getInfoApi({
    cmd: CMDEnum.get_info,
    data: {
      designTool: 'frontend',
      directory: currentProject.value?.path,
      step: 'lint',
      id: InfoEnum.frontend_detail,
    },
  })
  if (response.response !== ResponseEnum.success) {
    lintLog.value = response.message?.join('\n') || 'Unable to load lint log.'
    return
  }

  const detail = response.data.info as FrontendStepDetail
  const logs = [...(detail.logs || []), ...(detail.reports || [])]
  const logPath = logs.find((item) => /log/i.test(item.label) || /\.log(\.txt)?$/i.test(item.path))?.path
  if (!logPath) {
    lintLog.value = JSON.stringify(detail, null, 2)
    diagnostics.value = parseCurrentDiagnostics(lintLog.value)
    return
  }

  const log = await readOptionalProjectTextFileTail(logPath, LINT_LOG_CHAR_LIMIT, {
    projectPath: currentProject.value?.path,
  })
  lintLog.value = log?.content || ''
  diagnostics.value = parseCurrentDiagnostics(lintLog.value)
}

function parseCurrentDiagnostics(text: string): VerilatorDiagnostic[] {
  const sourcePath = props.source?.path || ''
  return parseVerilatorDiagnostics(text).filter((diagnostic) =>
    !sourcePath || diagnosticMatchesPath(diagnostic.file, sourcePath),
  )
}

function setEditorContent(content: string): void {
  if (!view) return
  view.dispatch({
    changes: {
      from: 0,
      to: view.state.doc.length,
      insert: content,
    },
  })
}

function currentContent(): string {
  return view?.state.doc.toString() ?? ''
}

function jumpToDiagnostic(diagnostic: VerilatorDiagnostic): void {
  jumpToPosition(diagnostic.line, diagnostic.column)
}

function focusExternalTarget(): void {
  const target = props.focusTarget
  if (!target?.line) return
  if (target.path && props.source?.path && !diagnosticMatchesPath(target.path, props.source.path)) return
  jumpToPosition(target.line, target.column || 1)
}

function jumpToPosition(lineNumber: number, columnNumber = 1): void {
  if (!view) return
  const line = view.state.doc.line(Math.min(Math.max(1, lineNumber), view.state.doc.lines))
  const pos = Math.min(line.to, line.from + Math.max(0, columnNumber - 1))
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: 'center' }),
  })
  view.focus()
}

function diagnosticKey(diagnostic: VerilatorDiagnostic): string {
  return `${diagnostic.severity}:${diagnostic.code}:${diagnostic.file}:${diagnostic.line}:${diagnostic.column}`
}

function diagnosticLocation(diagnostic: VerilatorDiagnostic): string {
  return `${fileName(diagnostic.file)}:${diagnostic.line}:${diagnostic.column}`
}

function resetLint(): void {
  lintStatus.value = 'idle'
  lintLog.value = ''
  showLintLog.value = false
  diagnostics.value = []
}

function editorThemeExtension(theme: 'dark' | 'light'): Extension {
  const dark = theme === 'dark'
  return EditorView.theme({
    '&': {
      height: '100%',
      color: dark ? '#d4d4d4' : '#1f2937',
      backgroundColor: dark ? '#1e1e1e' : '#ffffff',
      fontSize: '12px',
    },
    '.cm-scroller': {
      fontFamily: "'JetBrains Mono', 'SF Mono', ui-monospace, monospace",
      lineHeight: '1.55',
    },
    '.cm-content': {
      caretColor: dark ? '#38bdf8' : '#2563eb',
      padding: '12px 0 16px',
    },
    '.cm-line': {
      padding: '0 12px',
    },
    '.cm-gutters': {
      backgroundColor: dark ? '#252526' : '#f6f8fa',
      color: dark ? '#858585' : '#64748b',
      borderRight: `1px solid ${dark ? '#3c3c3c' : '#d9e2ec'}`,
    },
    '.cm-activeLine': {
      backgroundColor: dark ? '#2a2d2e' : '#f1f5f9',
    },
    '.cm-activeLineGutter': {
      backgroundColor: dark ? '#2a2d2e' : '#eef2ff',
      color: dark ? '#cbd5e1' : '#1e40af',
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '.cm-selectionBackground': {
      backgroundColor: `${dark ? '#2563eb88' : '#93c5fd80'} !important`,
    },
    '.cm-keyword': { color: dark ? '#569cd6' : '#1d4ed8', fontWeight: '700' },
    '.cm-type': { color: dark ? '#4ec9b0' : '#0f766e' },
    '.cm-number': { color: dark ? '#b5cea8' : '#a16207' },
    '.cm-string': { color: dark ? '#ce9178' : '#047857' },
    '.cm-comment': { color: dark ? '#6a9955' : '#64748b', fontStyle: 'italic' },
    '.cm-directive': { color: dark ? '#c586c0' : '#9333ea', fontWeight: '700' },
    '.cm-operator': { color: dark ? '#d4d4d4' : '#334155' },
  }, { dark })
}

function syntaxHighlighter(): Extension {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildSyntaxDecorations(view)
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildSyntaxDecorations(update.view)
      }
    }
  }, {
    decorations: (plugin) => plugin.decorations,
  })
}

function buildSyntaxDecorations(view: EditorView): DecorationSet {
  const builder: { from: number; to: number; value: Decoration }[] = []
  for (const range of view.visibleRanges) {
    const fromLine = view.state.doc.lineAt(range.from).number
    const toLine = view.state.doc.lineAt(range.to).number
    for (let lineNo = fromLine; lineNo <= toLine; lineNo += 1) {
      const line = view.state.doc.line(lineNo)
      decorateLine(line.text, line.from, builder)
    }
  }
  return Decoration.set(builder, true)
}

const KEYWORDS = new Set([
  'always',
  'always_comb',
  'always_ff',
  'assign',
  'begin',
  'case',
  'default',
  'else',
  'end',
  'endcase',
  'endfunction',
  'endmodule',
  'endtask',
  'for',
  'forever',
  'function',
  'generate',
  'genvar',
  'if',
  'initial',
  'localparam',
  'module',
  'negedge',
  'package',
  'parameter',
  'posedge',
  'return',
  'task',
  'typedef',
  'while',
])
const TYPES = new Set([
  'bit',
  'byte',
  'enum',
  'input',
  'int',
  'integer',
  'logic',
  'output',
  'reg',
  'signed',
  'string',
  'struct',
  'time',
  'wire',
])
const TOKEN_RE = /`[A-Za-z_][\w$]*|\/\/.*|\/\*.*?\*\/|"([^"\\]|\\.)*"|\b\d+'[bhd][0-9a-fA-F_xzXZ]+\b|\b\d+\b|\b[A-Za-z_][\w$]*\b|[+\-*/%=<>!&|^~?:]+/g

function decorateLine(
  text: string,
  lineStart: number,
  builder: { from: number; to: number; value: Decoration }[],
): void {
  for (const match of text.matchAll(TOKEN_RE)) {
    const token = match[0]
    const index = match.index ?? 0
    const className = tokenClass(token)
    if (!className) continue
    builder.push({
      from: lineStart + index,
      to: lineStart + index + token.length,
      value: Decoration.mark({ class: className }),
    })
  }
}

function tokenClass(token: string): string {
  if (token.startsWith('//') || token.startsWith('/*')) return 'cm-comment'
  if (token.startsWith('"')) return 'cm-string'
  if (token.startsWith('`')) return 'cm-directive'
  if (/^\d/.test(token)) return 'cm-number'
  if (KEYWORDS.has(token)) return 'cm-keyword'
  if (TYPES.has(token)) return 'cm-type'
  if (/^[+\-*/%=<>!&|^~?:]+$/.test(token)) return 'cm-operator'
  return ''
}
</script>

<style scoped>
.source-editor {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.source-toolbar,
.source-actions,
.lint-head,
.diagnostic-row {
  display: flex;
  align-items: center;
}

.source-toolbar {
  justify-content: space-between;
  gap: 12px;
  padding: 9px 10px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.source-title {
  min-width: 0;
}

.source-title strong,
.source-title span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-title strong {
  font-size: 12px;
}

.source-title span {
  margin-top: 2px;
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 10px;
}

.source-actions {
  gap: 6px;
  flex-shrink: 0;
}

.source-state {
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 700;
}

.source-state.dirty {
  color: #f59e0b;
}

.source-state.saving {
  color: #60a5fa;
}

.icon-action,
.text-action {
  border: 0;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
}

.icon-action:focus,
.text-action:focus {
  outline: none;
}

.icon-action {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 7px;
}

.icon-action.compact {
  width: 24px;
  height: 24px;
}

.text-action {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 9px;
  border-radius: 7px;
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.1);
  color: var(--accent-color);
  font-size: 11px;
  font-weight: 700;
}

.icon-action:hover,
.text-action:hover {
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.12);
  color: var(--text-primary);
}

button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.source-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  color: #ef4444;
  background: rgba(239, 68, 68, 0.08);
  font-size: 11px;
}

.editor-wrap {
  position: relative;
  flex: 1;
  min-height: 220px;
  overflow: hidden;
}

.editor-host {
  height: 100%;
}

.editor-overlay,
.source-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-secondary);
}

.editor-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.1);
}

.source-empty {
  height: 100%;
  min-height: 220px;
}

.lint-panel {
  flex-shrink: 0;
  max-height: 220px;
  overflow: auto;
  border-top: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.lint-head {
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
}

.lint-head strong,
.lint-head span {
  display: block;
}

.lint-head strong {
  font-size: 12px;
}

.lint-head strong.success {
  color: #10b981;
}

.lint-head strong.failed,
.lint-head strong.error {
  color: #ef4444;
}

.lint-head strong.running {
  color: #60a5fa;
}

.lint-head span {
  color: var(--text-secondary);
  font-size: 10px;
}

.diagnostics {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 8px 8px;
}

.diagnostic-row {
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  background: var(--bg-primary);
  color: var(--text-primary);
  text-align: left;
}

.diagnostic-row.error {
  border-color: rgba(239, 68, 68, 0.35);
}

.diagnostic-row.warning {
  border-color: rgba(245, 158, 11, 0.35);
}

.diagnostic-row > span {
  min-width: 0;
}

.diagnostic-row strong,
.diagnostic-row small,
.diagnostic-row em {
  display: block;
}

.diagnostic-row small {
  color: var(--text-secondary);
  font-size: 10px;
}

.diagnostic-row em {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-style: normal;
}

.lint-log {
  margin: 0 8px 8px;
  max-height: 120px;
  overflow: auto;
  padding: 8px;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 10px;
  line-height: 1.5;
}

.spin {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
