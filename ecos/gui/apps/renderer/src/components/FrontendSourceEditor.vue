<template>
  <div class="source-editor">
    <div v-if="!source?.path" class="source-empty">
      <i class="ri-file-code-line"></i>
      <span>Select a source file from Src.</span>
    </div>

    <template v-else>
      <header class="source-toolbar">
        <div class="source-title">
          <strong :title="source.path">{{
            source.label || fileName(source.path)
          }}</strong>
          <span :title="source.path">{{ source.path }}</span>
        </div>
        <div class="source-actions">
          <span class="source-state" :class="{ dirty: isDirty, saving }">{{
            sourceStateText
          }}</span>
          <button
            type="button"
            class="icon-action"
            title="Reload"
            :disabled="busy"
            @click="void loadSource()"
          >
            <i :class="loading ? 'ri-loader-4-line spin' : 'ri-refresh-line'"></i>
          </button>
          <button
            type="button"
            class="icon-action"
            title="Save"
            :disabled="!canSave"
            @click="void saveSource()"
          >
            <i :class="saving ? 'ri-loader-4-line spin' : 'ri-save-3-line'"></i>
          </button>
          <button
            type="button"
            class="text-action"
            :disabled="!canLint"
            @click="void runLint()"
          >
            <i
              :class="lintRunning ? 'ri-loader-4-line spin' : 'ri-shield-check-line'"
            ></i>
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
            <i
              :class="
                diagnostic.severity === 'error' ? 'ri-close-circle-line' : 'ri-alert-line'
              "
            ></i>
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
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CMDEnum, InfoEnum, ResponseEnum, StateEnum } from '@/api/type'
import { getInfoApi, runStepApi } from '@/api/flow'
import { useWorkspace } from '@/composables/useWorkspace'
import { useThemeStore } from '@/stores/themeStore'
import { frontendSourceLanguageForPath } from './frontendSourceLanguage'
import {
  readOptionalProjectTextFileTail,
  writeProjectTextFile,
} from '@/utils/projectFiles'
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
const DIAGNOSTIC_MARKER_OWNER = 'ecos-verilator-lint'

const { currentProject, showToast, invalidateWorkspaceResources, workspaceSession } =
  useWorkspace()
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

let monaco: typeof Monaco | null = null
let editor: Monaco.editor.IStandaloneCodeEditor | null = null
let sourceModel: Monaco.editor.ITextModel | null = null
let modelChangeSubscription: Monaco.IDisposable | null = null
let applyTheme: ((theme: 'light' | 'dark') => void) | null = null
let initializePromise: Promise<void> | null = null
let editorId = 0
let activeModelPath = ''
let savedContent = ''
let loadToken = 0
let applyingContent = false
let componentDisposed = false

const editorTheme = computed<'dark' | 'light'>(() =>
  themeStore.themeName === 'dark' ? 'dark' : 'light',
)
const busy = computed(() => loading.value || saving.value || lintRunning.value)
const canSave = computed(() =>
  Boolean(
    props.source?.path &&
    sourceModel &&
    isDirty.value &&
    !busy.value &&
    !sourceTruncated.value,
  ),
)
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

onMounted(() => void loadSource())

onBeforeUnmount(() => {
  componentDisposed = true
  loadToken += 1
  disposeEditor()
  monaco = null
  applyTheme = null
})

watch(
  () => props.source?.path,
  () => {
    resetLint()
    void loadSource()
  },
  { flush: 'post' },
)

watch(
  () => props.focusTarget?.token,
  () => {
    focusExternalTarget()
  },
)

watch(editorTheme, (theme) => {
  applyTheme?.(theme)
})

async function ensureEditor(): Promise<void> {
  if (editor || componentDisposed || !props.source?.path) return
  if (initializePromise) {
    await initializePromise
    return
  }

  initializePromise = initializeEditor()
  try {
    await initializePromise
  } finally {
    initializePromise = null
  }
}

async function initializeEditor(): Promise<void> {
  const runtime = await import('./monacoRuntime')
  if (componentDisposed || !props.source?.path || !editorHost.value) return

  editorId ||= runtime.nextMonacoEditorId()
  monaco = runtime.getMonacoRuntime(editorTheme.value)
  applyTheme = runtime.setMonacoTheme
  editor = monaco.editor.create(editorHost.value, {
    model: null,
    readOnly: false,
    domReadOnly: false,
    ariaLabel: 'Source code editor',
    automaticLayout: true,
    wordWrap: 'on',
    wrappingIndent: 'same',
    lineNumbers: 'on',
    glyphMargin: true,
    folding: true,
    minimap: { enabled: false },
    renderLineHighlight: 'all',
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    contextmenu: true,
    links: true,
    stickyScroll: { enabled: false },
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
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void saveSource())
}

async function loadSource(): Promise<void> {
  const token = ++loadToken
  const source = props.source
  if (!source?.path) {
    loading.value = false
    disposeEditor()
    savedContent = ''
    isDirty.value = false
    sourceTruncated.value = false
    return
  }

  loading.value = true
  error.value = ''
  try {
    await ensureEditor()
    if (token !== loadToken || !editor || !monaco) return
    const targetModel = activateSourceModel(source.path)
    const result = await readOptionalProjectTextFileTail(source.path, SOURCE_CHAR_LIMIT, {
      projectPath: currentProject.value?.path,
    })
    if (token !== loadToken || targetModel !== sourceModel) return
    if (!result) {
      throw new Error('Source file is not readable in current workspace scope.')
    }
    const content = result.truncated
      ? `/* File is too large; showing tail only. */\n${result.content}`
      : result.content
    sourceTruncated.value = result.truncated
    savedContent = content
    setEditorContent(content)
    isDirty.value = false
    updateDiagnosticMarkers()
    focusExternalTarget()
  } catch (err) {
    if (token === loadToken) {
      error.value = err instanceof Error ? err.message : String(err)
      savedContent = ''
      setEditorContent('')
      isDirty.value = false
      sourceTruncated.value = false
      updateDiagnosticMarkers()
    }
  } finally {
    if (token === loadToken) loading.value = false
  }
}

async function saveSource(): Promise<void> {
  const sourcePath = props.source?.path
  const targetModel = sourceModel
  if (!sourcePath || !targetModel || activeModelPath !== sourcePath) return
  if (sourceTruncated.value) {
    error.value =
      'This source file is displayed as a truncated tail and cannot be saved safely.'
    showToast({
      severity: 'warn',
      summary: 'Save Blocked',
      detail: error.value,
      life: 5000,
    })
    return
  }
  if (!isDirty.value || busy.value) return

  saving.value = true
  error.value = ''
  const content = targetModel.getValue()
  const projectPath = currentProject.value?.path
  try {
    await writeProjectTextFile(sourcePath, content, { projectPath })
    if (
      sourceModel === targetModel &&
      props.source?.path === sourcePath &&
      activeModelPath === sourcePath
    ) {
      savedContent = content
      isDirty.value = currentContent() !== savedContent
    }
    emit('saved')
    showToast({
      severity: 'success',
      summary: 'Source Saved',
      detail: fileName(sourcePath),
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
  setDiagnostics([])
  try {
    const result = await runStepApi({
      cmd: CMDEnum.run_step,
      data: {
        designTool: 'frontend',
        directory,
        workspaceHandle: workspaceSession.value.workspaceId,
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
      workspaceHandle: workspaceSession.value.workspaceId,
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
  const logPath = logs.find(
    (item) => /log/i.test(item.label) || /\.log(\.txt)?$/i.test(item.path),
  )?.path
  if (!logPath) {
    lintLog.value = JSON.stringify(detail, null, 2)
    setDiagnostics(parseCurrentDiagnostics(lintLog.value))
    return
  }

  const log = await readOptionalProjectTextFileTail(logPath, LINT_LOG_CHAR_LIMIT, {
    projectPath: currentProject.value?.path,
  })
  lintLog.value = log?.content || ''
  setDiagnostics(parseCurrentDiagnostics(lintLog.value))
}

function parseCurrentDiagnostics(text: string): VerilatorDiagnostic[] {
  const sourcePath = props.source?.path || ''
  return parseVerilatorDiagnostics(text).filter(
    (diagnostic) => !sourcePath || diagnosticMatchesPath(diagnostic.file, sourcePath),
  )
}

function activateSourceModel(sourcePath: string): Monaco.editor.ITextModel {
  if (!monaco || !editor) throw new Error('Monaco source editor is not ready.')
  if (sourceModel && activeModelPath === sourcePath) return sourceModel

  disposeSourceModel()
  const normalizedPath = sourcePath.replace(/\\/g, '/')
  const modelPath = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`
  sourceModel = monaco.editor.createModel(
    '',
    frontendSourceLanguageForPath(sourcePath),
    monaco.Uri.from({
      scheme: 'file',
      authority: `ecos-studio-source-${editorId}`,
      path: modelPath,
    }),
  )
  activeModelPath = sourcePath
  savedContent = ''
  isDirty.value = false
  editor.setModel(sourceModel)
  modelChangeSubscription = editor.onDidChangeModelContent(() => {
    if (applyingContent || loading.value) return
    isDirty.value = currentContent() !== savedContent
  })
  return sourceModel
}

function setEditorContent(content: string): void {
  if (!sourceModel) return
  applyingContent = true
  try {
    sourceModel.setValue(content)
  } finally {
    applyingContent = false
  }
}

function currentContent(): string {
  return sourceModel?.getValue() ?? ''
}

function setDiagnostics(nextDiagnostics: VerilatorDiagnostic[]): void {
  diagnostics.value = nextDiagnostics
  updateDiagnosticMarkers()
}

function updateDiagnosticMarkers(): void {
  if (!monaco || !sourceModel) return
  const markers: Monaco.editor.IMarkerData[] = sourceTruncated.value
    ? []
    : diagnostics.value.map((diagnostic) => {
        const lineNumber = clampLineNumber(diagnostic.line)
        const maxColumn = sourceModel?.getLineMaxColumn(lineNumber) || 1
        const startColumn = Math.min(
          maxColumn,
          Math.max(1, Math.trunc(diagnostic.column || 1)),
        )
        return {
          severity:
            diagnostic.severity === 'error'
              ? monaco?.MarkerSeverity.Error || 8
              : monaco?.MarkerSeverity.Warning || 4,
          code: diagnostic.code,
          message: diagnostic.message || diagnostic.raw,
          source: 'Verilator',
          startLineNumber: lineNumber,
          startColumn,
          endLineNumber: lineNumber,
          endColumn: Math.min(maxColumn, startColumn + 1),
        }
      })
  monaco.editor.setModelMarkers(sourceModel, DIAGNOSTIC_MARKER_OWNER, markers)
}

function jumpToDiagnostic(diagnostic: VerilatorDiagnostic): void {
  jumpToPosition(diagnostic.line, diagnostic.column)
}

function focusExternalTarget(): void {
  const target = props.focusTarget
  if (!target?.line) return
  if (
    target.path &&
    props.source?.path &&
    !diagnosticMatchesPath(target.path, props.source.path)
  )
    return
  jumpToPosition(target.line, target.column || 1)
}

function jumpToPosition(lineNumber: number, columnNumber = 1): void {
  if (!editor || !sourceModel) return
  const targetLine = clampLineNumber(lineNumber)
  const position = {
    lineNumber: targetLine,
    column: Math.min(
      sourceModel.getLineMaxColumn(targetLine),
      Math.max(1, Math.trunc(columnNumber || 1)),
    ),
  }
  editor.setPosition(position)
  editor.revealPositionInCenter(position)
  editor.focus()
}

function clampLineNumber(lineNumber: number): number {
  const normalized = Number.isFinite(lineNumber) ? Math.trunc(lineNumber) : 1
  return Math.min(Math.max(1, normalized), sourceModel?.getLineCount() || 1)
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
  setDiagnostics([])
}

function disposeSourceModel(): void {
  modelChangeSubscription?.dispose()
  modelChangeSubscription = null
  if (monaco && sourceModel) {
    monaco.editor.setModelMarkers(sourceModel, DIAGNOSTIC_MARKER_OWNER, [])
  }
  editor?.setModel(null)
  sourceModel?.dispose()
  sourceModel = null
  activeModelPath = ''
}

function disposeEditor(): void {
  disposeSourceModel()
  editor?.dispose()
  editor = null
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
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

:deep(.monaco-editor),
:deep(.monaco-editor .overflow-guard) {
  border-radius: 0;
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
