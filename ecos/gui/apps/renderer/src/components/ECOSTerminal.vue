<template>
  <section
    v-show="expanded"
    ref="terminalPanel"
    class="ecos-terminal-panel"
    aria-label="Terminal"
  >
    <div
      class="terminal-resize-handle"
      aria-hidden="true"
      @pointerdown="handleResizePointerDown"
    ></div>
    <div class="terminal-header">
      <div class="terminal-title">
        <i class="ri-terminal-box-line" aria-hidden="true"></i>
        <span>Terminal</span>
      </div>
      <div ref="terminalActions" class="terminal-actions" aria-label="Terminal actions">
        <button
          class="terminal-icon-button"
          type="button"
          title="New Terminal"
          aria-label="New Terminal"
          @click="createAndActivateTerminal"
        >
          <i class="ri-add-line" aria-hidden="true"></i>
        </button>
        <button
          class="terminal-icon-button terminal-icon-button--compact"
          type="button"
          title="Terminal Profiles"
          aria-label="Terminal Profiles"
          @click.stop="toggleProfilesMenu"
        >
          <i class="ri-arrow-down-s-line" aria-hidden="true"></i>
        </button>
        <button
          class="terminal-icon-button"
          type="button"
          title="More Actions"
          aria-label="More Actions"
          @click.stop="toggleMoreMenu"
        >
          <i class="ri-more-line" aria-hidden="true"></i>
        </button>
        <span class="terminal-action-separator" aria-hidden="true"></span>
        <button
          class="terminal-icon-button"
          type="button"
          :title="maximized ? 'Restore Panel' : 'Maximize Panel'"
          :aria-label="maximized ? 'Restore Panel' : 'Maximize Panel'"
          @click="$emit('toggleMaximize')"
        >
          <i :class="maximized ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line'" aria-hidden="true"></i>
        </button>
        <button
          class="terminal-icon-button"
          type="button"
          title="Close Panel"
          aria-label="Close Panel"
          @click="closePanel"
        >
          <i class="ri-close-line" aria-hidden="true"></i>
        </button>
        <div v-if="showProfilesMenu" class="terminal-menu terminal-profile-menu">
          <button type="button" class="terminal-menu-item" @click="createAndActivateTerminal">
            Default shell
          </button>
        </div>
        <div v-if="showMoreMenu" class="terminal-menu terminal-more-menu">
          <button type="button" class="terminal-menu-item" @click="toggleMaximizeFromMenu">
            {{ maximized ? 'Restore Panel' : 'Maximize Panel' }}
          </button>
          <button type="button" class="terminal-menu-item" @click="closePanel">Close Panel</button>
        </div>
      </div>
    </div>
    <div ref="terminalBody" class="terminal-body">
      <div ref="terminalWorkspace" class="terminal-workspace">
        <div class="terminal-surfaces">
          <div
            v-for="record in terminalRecords"
            :key="record.localId"
            :ref="(element) => setTerminalSurface(record, element)"
            v-show="record.localId === activeTerminalId"
            class="terminal-surface"
            :class="{ 'terminal-surface--active': record.localId === activeTerminalId }"
          ></div>
        </div>
        <div
          v-if="terminalRecords.length > 0"
          class="terminal-session-resize-handle"
          aria-hidden="true"
          @pointerdown="handleSessionListResizePointerDown"
        ></div>
        <div
          v-if="terminalRecords.length > 0"
          class="terminal-session-list"
          role="tablist"
          aria-label="Terminal session list"
          :style="terminalSessionListStyle"
        >
          <div
            v-for="record in terminalRecords"
            :key="record.localId"
            class="terminal-session-item"
            :class="{ 'terminal-session-item--active': record.localId === activeTerminalId }"
          >
            <button
              class="terminal-session-activate"
              type="button"
              role="tab"
              :aria-selected="record.localId === activeTerminalId"
              :title="record.label"
              @click="activateTerminal(record.localId)"
            >
              <i class="ri-terminal-box-line" aria-hidden="true"></i>
              <span>{{ record.label }}</span>
              <i
                v-if="record.exitCode !== null"
                class="ri-alert-line terminal-session-warning"
                aria-hidden="true"
              ></i>
            </button>
            <button
              class="terminal-session-delete"
              type="button"
              title="Close Terminal"
              aria-label="Close Terminal"
              @click.stop="deleteTerminal(record.localId)"
            >
              <i class="ri-delete-bin-line" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { getOptionalDesktopApi } from '@/platform/desktop'
import '@xterm/xterm/css/xterm.css'

const props = defineProps<{
  expanded: boolean
  maximized: boolean
}>()

const emit = defineEmits<{
  collapse: []
  heightChange: [height: string]
  toggleMaximize: []
}>()

const terminalBackground = '#1e1e1e'
const MIN_TERMINAL_PANEL_HEIGHT = 160
const TERMINAL_PANEL_MARGIN = 56
const DEFAULT_TERMINAL_SESSION_LIST_WIDTH = 150
const MIN_TERMINAL_SESSION_LIST_WIDTH = 104
const MAX_TERMINAL_SESSION_LIST_WIDTH = 280

interface TerminalRecord {
  fitAddon: FitAddon
  label: string
  localId: string
  exitCode: number | null
  opened: boolean
  sessionId: string | null
  shellStartPromise: Promise<void> | null
  surfaceElement: HTMLElement | null
  terminal: Terminal
}

const terminalPanel = ref<HTMLElement | null>(null)
const terminalBody = ref<HTMLElement | null>(null)
const terminalWorkspace = ref<HTMLElement | null>(null)
const terminalActions = ref<HTMLElement | null>(null)
const terminalRecords = shallowRef<TerminalRecord[]>([])
const activeTerminalId = ref<string | null>(null)
const showProfilesMenu = ref(false)
const showMoreMenu = ref(false)
const terminalSessionListWidth = ref(DEFAULT_TERMINAL_SESSION_LIST_WIDTH)
const activeTerminalRecord = computed(() =>
  terminalRecords.value.find((record) => record.localId === activeTerminalId.value) ?? null,
)
const terminalSessionListStyle = computed(() => ({
  width: `${terminalSessionListWidth.value}px`,
  flexBasis: `${terminalSessionListWidth.value}px`,
}))

let terminalSequence = 0
let unsubscribeShellData: (() => void) | undefined
let unsubscribeShellExit: (() => void) | undefined
let resizeObserver: ResizeObserver | undefined
let resizePointerTarget: HTMLElement | null = null
let resizePointerId: number | null = null
let sessionListResizePointerTarget: HTMLElement | null = null
let sessionListResizePointerId: number | null = null
const pendingShellData = new Map<string, string[]>()

function createTerminalRecord(): TerminalRecord {
  terminalSequence += 1
  const terminal = new Terminal({
    convertEol: true,
    cursorBlink: true,
    fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.4,
    theme: {
      background: terminalBackground,
      black: terminalBackground,
      blue: '#3b8eea',
      brightBlack: '#9a9a9a',
      brightBlue: '#6cb6ff',
      brightCyan: '#4ec9b0',
      brightGreen: '#23d18b',
      brightMagenta: '#d670d6',
      brightRed: '#f14c4c',
      brightWhite: '#f2f2f2',
      brightYellow: '#dcdcaa',
      cursor: '#cccccc',
      cyan: '#4ec9b0',
      foreground: '#cccccc',
      green: '#23d18b',
      magenta: '#bc3fbc',
      red: '#f14c4c',
      selectionBackground: '#264f78',
      white: '#cccccc',
      yellow: '#dcdcaa',
    },
  })
  const fitAddon = new FitAddon()
  const record: TerminalRecord = {
    fitAddon,
    label: `Terminal ${terminalSequence}`,
    localId: `terminal-${terminalSequence}`,
    exitCode: null,
    opened: false,
    sessionId: null,
    shellStartPromise: null,
    surfaceElement: null,
    terminal,
  }

  terminal.loadAddon(fitAddon)
  terminal.loadAddon(new WebLinksAddon())
  terminal.loadAddon(new SearchAddon())
  terminal.onData((data) => {
    handleData(record, data)
  })

  return record
}

function setTerminalSurface(
  record: TerminalRecord,
  element: Element | ComponentPublicInstance | null,
) {
  if (!(element instanceof HTMLElement)) return
  if (record.surfaceElement === element) return

  record.surfaceElement = element
  if (!record.opened) {
    record.terminal.open(element)
    record.opened = true
    fitTerminalAfterLayout()
  }
}

function findRecordBySessionId(sessionId: string) {
  return terminalRecords.value.find((record) => record.sessionId === sessionId)
}

function getShellDisplayName(shellPath: string) {
  return shellPath.split(/[\\/]/).filter(Boolean).pop() || shellPath
}

function clampTerminalSessionListWidth(width: number) {
  return Math.max(
    MIN_TERMINAL_SESSION_LIST_WIDTH,
    Math.min(MAX_TERMINAL_SESSION_LIST_WIDTH, Math.round(width)),
  )
}

function fitTerminal() {
  if (!props.expanded) return
  const activeRecord = activeTerminalRecord.value
  if (!activeRecord?.opened) return

  requestAnimationFrame(() => {
    try {
      activeRecord.fitAddon.fit()
      activeRecord.terminal.scrollToBottom()
      resizeShellSession(activeRecord)
    } catch {
      /* xterm may not be measurable while the panel is animating */
    }
  })
}

function fitTerminalAfterLayout() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      fitTerminal()
    })
  })
}

function resizeShellSession(record: TerminalRecord) {
  if (!record.sessionId) return
  const desktopApi = getOptionalDesktopApi()
  if (!desktopApi?.shell) return

  void desktopApi.shell.resize(record.sessionId, record.terminal.cols, record.terminal.rows)
}

function writeLine(record: TerminalRecord, value = '') {
  record.terminal.writeln(value)
}

async function stopShellSession(record: TerminalRecord) {
  if (record.shellStartPromise) {
    try {
      await record.shellStartPromise
    } catch {
      /* The start failure will already be printed in the terminal. */
    }
  }

  if (!record.sessionId) return
  const sessionId = record.sessionId
  record.sessionId = null
  const desktopApi = getOptionalDesktopApi()

  try {
    if (desktopApi?.shell) {
      await desktopApi.shell.kill(sessionId)
    }
  } catch {
    /* Session may already have exited. */
  }
}

async function startShellSession(record: TerminalRecord) {
  if (record.sessionId) return
  if (record.shellStartPromise) return record.shellStartPromise

  record.shellStartPromise = createShellSession(record)
  await record.shellStartPromise
}

async function createShellSession(record: TerminalRecord) {
  const desktopApi = getOptionalDesktopApi()

  if (!desktopApi?.shell) {
    writeLine(record, 'ECOS desktop shell bridge is not available.')
    record.shellStartPromise = null
    return
  }

  try {
    const session = await desktopApi.shell.createSession({
      cols: record.terminal.cols || 80,
      rows: record.terminal.rows || 24,
    })
    record.sessionId = session.sessionId
    record.label = getShellDisplayName(session.shell)
    record.exitCode = null
    terminalRecords.value = [...terminalRecords.value]
    const pendingData = pendingShellData.get(session.sessionId) ?? []
    pendingShellData.delete(session.sessionId)
    for (const chunk of pendingData) {
      record.terminal.write(chunk, () => {
        record.terminal.scrollToBottom()
      })
    }
  } catch (error) {
    writeLine(record, `[error] ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    record.shellStartPromise = null
  }
}

async function ensureActiveTerminal() {
  if (!activeTerminalRecord.value) {
    await createAndActivateTerminal()
    return
  }

  await nextTick()
  fitTerminalAfterLayout()
  await startShellSession(activeTerminalRecord.value)
  fitTerminalAfterLayout()
  activeTerminalRecord.value.terminal.focus()
}

async function createAndActivateTerminal() {
  closeTerminalMenus()
  const record = createTerminalRecord()
  terminalRecords.value = [...terminalRecords.value, record]
  activeTerminalId.value = record.localId

  await nextTick()
  fitTerminalAfterLayout()
  if (props.expanded) {
    await startShellSession(record)
    fitTerminalAfterLayout()
    record.terminal.focus()
  }
}

async function activateTerminal(localId: string) {
  const record = terminalRecords.value.find((terminalRecord) => terminalRecord.localId === localId)
  if (!record) return

  activeTerminalId.value = record.localId
  await nextTick()
  fitTerminalAfterLayout()
  if (props.expanded) {
    await startShellSession(record)
    record.terminal.focus()
  }
}

async function deleteTerminal(localId: string) {
  closeTerminalMenus()
  const recordIndex = terminalRecords.value.findIndex((record) => record.localId === localId)
  if (recordIndex === -1) return

  const record = terminalRecords.value[recordIndex]
  const wasActive = record.localId === activeTerminalId.value
  const remainingRecords = terminalRecords.value.filter(
    (terminalRecord) => terminalRecord.localId !== localId,
  )

  await stopShellSession(record)
  record.terminal.dispose()
  record.surfaceElement = null
  terminalRecords.value = remainingRecords

  if (!wasActive) {
    fitTerminalAfterLayout()
    return
  }

  const replacementRecord =
    remainingRecords[Math.min(recordIndex, remainingRecords.length - 1)] ?? null

  if (!replacementRecord) {
    activeTerminalId.value = null
    await createAndActivateTerminal()
    return
  }

  activeTerminalId.value = replacementRecord.localId
  await nextTick()
  fitTerminalAfterLayout()
  if (props.expanded) {
    await startShellSession(replacementRecord)
    replacementRecord.terminal.focus()
  }
}

function closePanel() {
  closeTerminalMenus()
  emit('collapse')
}

function closeTerminalMenus() {
  showProfilesMenu.value = false
  showMoreMenu.value = false
}

function closeTerminalMenusOutside(event: PointerEvent) {
  if (terminalActions.value?.contains(event.target as Node)) return
  closeTerminalMenus()
}

function toggleProfilesMenu() {
  showProfilesMenu.value = !showProfilesMenu.value
  showMoreMenu.value = false
}

function toggleMoreMenu() {
  showMoreMenu.value = !showMoreMenu.value
  showProfilesMenu.value = false
}

function toggleMaximizeFromMenu() {
  closeTerminalMenus()
  emit('toggleMaximize')
}

function handleShellData(event: { data: string; sessionId: string }) {
  const record = findRecordBySessionId(event.sessionId)
  if (!record) {
    pendingShellData.set(event.sessionId, [
      ...(pendingShellData.get(event.sessionId) ?? []),
      event.data,
    ])
    return
  }
  record.terminal.write(event.data, () => {
    record.terminal.scrollToBottom()
  })
}

function handleShellExit(event: { exitCode: number; sessionId: string }) {
  const record = findRecordBySessionId(event.sessionId)
  if (!record) return
  record.sessionId = null
  record.exitCode = event.exitCode
  terminalRecords.value = [...terminalRecords.value]

  writeLine(record)
  writeLine(record, `[shell exited with code ${event.exitCode}]`)
}

function handleData(record: TerminalRecord, data: string) {
  if (!record.sessionId) return
  const desktopApi = getOptionalDesktopApi()
  if (!desktopApi?.shell) return
  void desktopApi.shell.write(record.sessionId, data)
}

function handleResizePointerDown(event: PointerEvent) {
  if (event.button !== 0 || props.maximized) return
  event.preventDefault()

  resizePointerTarget = event.currentTarget as HTMLElement
  resizePointerId = event.pointerId
  resizePointerTarget.setPointerCapture?.(resizePointerId)
  document.body.classList.add('terminal-panel-resizing')
  window.addEventListener('pointermove', handleResizePointerMove)
  window.addEventListener('pointerup', stopTerminalPanelResize)
  window.addEventListener('pointercancel', stopTerminalPanelResize)
  window.addEventListener('blur', stopTerminalPanelResize)
  handleResizePointerMove(event)
}

function handleResizePointerMove(event: PointerEvent) {
  const panel = terminalPanel.value
  const parent = panel?.parentElement
  if (!parent) return

  const parentRect = parent.getBoundingClientRect()
  const maxHeight = Math.max(
    MIN_TERMINAL_PANEL_HEIGHT,
    Math.floor(parentRect.height - TERMINAL_PANEL_MARGIN),
  )
  const height = Math.max(
    MIN_TERMINAL_PANEL_HEIGHT,
    Math.min(maxHeight, Math.round(parentRect.bottom - event.clientY)),
  )
  emit('heightChange', `${height}px`)
  fitTerminal()
}

function stopTerminalPanelResize() {
  if (resizePointerTarget && resizePointerId !== null) {
    try {
      resizePointerTarget.releasePointerCapture?.(resizePointerId)
    } catch {
      /* Pointer capture may already be released by the browser. */
    }
  }
  resizePointerTarget = null
  resizePointerId = null
  document.body.classList.remove('terminal-panel-resizing')
  window.removeEventListener('pointermove', handleResizePointerMove)
  window.removeEventListener('pointerup', stopTerminalPanelResize)
  window.removeEventListener('pointercancel', stopTerminalPanelResize)
  window.removeEventListener('blur', stopTerminalPanelResize)
  fitTerminalAfterLayout()
}

function handleSessionListResizePointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  event.preventDefault()

  sessionListResizePointerTarget = event.currentTarget as HTMLElement
  sessionListResizePointerId = event.pointerId
  sessionListResizePointerTarget.setPointerCapture?.(sessionListResizePointerId)
  document.body.classList.add('terminal-session-list-resizing')
  window.addEventListener('pointermove', handleSessionListResizePointerMove)
  window.addEventListener('pointerup', stopSessionListResize)
  window.addEventListener('pointercancel', stopSessionListResize)
  window.addEventListener('blur', stopSessionListResize)
  handleSessionListResizePointerMove(event)
}

function handleSessionListResizePointerMove(event: PointerEvent) {
  const workspaceRect = terminalWorkspace.value?.getBoundingClientRect()
  if (!workspaceRect) return

  const width = workspaceRect.right - event.clientX
  terminalSessionListWidth.value = clampTerminalSessionListWidth(width)
  fitTerminal()
}

function stopSessionListResize() {
  if (sessionListResizePointerTarget && sessionListResizePointerId !== null) {
    try {
      sessionListResizePointerTarget.releasePointerCapture?.(sessionListResizePointerId)
    } catch {
      /* Pointer capture may already be released by the browser. */
    }
  }
  sessionListResizePointerTarget = null
  sessionListResizePointerId = null
  document.body.classList.remove('terminal-session-list-resizing')
  window.removeEventListener('pointermove', handleSessionListResizePointerMove)
  window.removeEventListener('pointerup', stopSessionListResize)
  window.removeEventListener('pointercancel', stopSessionListResize)
  window.removeEventListener('blur', stopSessionListResize)
  fitTerminalAfterLayout()
}

onMounted(() => {
  document.addEventListener('pointerdown', closeTerminalMenusOutside)

  const desktopApi = getOptionalDesktopApi()
  if (desktopApi?.shell) {
    unsubscribeShellData = desktopApi.shell.onData(handleShellData)
    unsubscribeShellExit = desktopApi.shell.onExit(handleShellExit)
  }

  if (terminalBody.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(fitTerminal)
    resizeObserver.observe(terminalBody.value)
  }

  void createAndActivateTerminal()
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeTerminalMenusOutside)
  unsubscribeShellData?.()
  unsubscribeShellExit?.()
  stopTerminalPanelResize()
  stopSessionListResize()
  resizeObserver?.disconnect()
  for (const record of terminalRecords.value) {
    void stopShellSession(record)
    record.terminal.dispose()
  }
})

watch(
  () => props.expanded,
  async (expanded) => {
    if (expanded) {
      await ensureActiveTerminal()
      fitTerminalAfterLayout()
    }
  },
)

watch(
  () => props.maximized,
  async () => {
    await nextTick()
    fitTerminalAfterLayout()
  },
)
</script>

<style scoped>
.ecos-terminal-panel {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 80;
  height: var(--terminal-panel-height, min(300px, 42vh));
  min-height: 160px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #1e1e1e;
  border-top: 1px solid #2b2b2b;
  box-shadow: 0 -12px 28px rgba(0, 0, 0, 0.24);
}

.terminal-resize-handle {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 5px;
  z-index: 2;
  cursor: row-resize;
  background: transparent;
}

.terminal-resize-handle:hover {
  background: rgba(0, 122, 204, 0.56);
}

.terminal-header {
  height: 34px;
  flex: 0 0 34px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 8px 0 12px;
  background: #181818;
  border-bottom: 1px solid #2b2b2b;
}

.terminal-title {
  min-width: 0;
  flex: 1 1 auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #cccccc;
  font-size: 11px;
  font-weight: 600;
}

.terminal-title i {
  font-size: 14px;
}

.terminal-actions {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}

.terminal-action-separator {
  width: 1px;
  height: 20px;
  margin: 0 4px;
  background: #3a3a3a;
}

.terminal-icon-button {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 4px;
  color: #cccccc;
  background: transparent;
  cursor: pointer;
}

.terminal-icon-button:hover {
  color: #f2f2f2;
  background: #2a2d2e;
}

.terminal-icon-button:focus-visible,
.terminal-session-activate:focus-visible,
.terminal-session-delete:focus-visible {
  outline: 1px solid #007acc;
  outline-offset: -1px;
}

.terminal-icon-button i {
  font-size: 16px;
}

.terminal-icon-button--compact {
  width: 18px;
  margin-left: -6px;
}

.terminal-icon-button--compact i {
  font-size: 15px;
}

.terminal-menu {
  position: absolute;
  top: 30px;
  right: 0;
  z-index: 5;
  min-width: 156px;
  padding: 4px;
  border: 1px solid #3c3c3c;
  border-radius: 4px;
  background: #252526;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.32);
}

.terminal-profile-menu {
  right: 78px;
}

.terminal-menu-item {
  width: 100%;
  height: 26px;
  display: flex;
  align-items: center;
  border: none;
  border-radius: 3px;
  padding: 0 10px;
  color: #cccccc;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  text-align: left;
}

.terminal-menu-item:hover,
.terminal-menu-item:focus-visible {
  outline: none;
  background: #04395e;
  color: #ffffff;
}

.terminal-body {
  flex: 1;
  min-height: 0;
  padding: 8px 10px 0;
  background: #1e1e1e;
}

.terminal-workspace {
  height: 100%;
  min-height: 0;
  display: flex;
  overflow: hidden;
  background: #1e1e1e;
}

.terminal-surfaces {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.terminal-surface {
  height: 100%;
  min-height: 0;
  background: #1e1e1e;
}

.terminal-session-list {
  width: 150px;
  flex: 0 0 150px;
  padding: 3px 3px 0 0;
  overflow-y: auto;
  border-left: 1px solid #2b2b2b;
}

.terminal-session-list,
:deep(.xterm-viewport) {
  scrollbar-width: thin;
  scrollbar-color: rgba(121, 121, 121, 0.4) transparent;
}

.terminal-session-list::-webkit-scrollbar,
:deep(.xterm-viewport::-webkit-scrollbar) {
  width: 10px;
  height: 10px;
}

.terminal-session-list::-webkit-scrollbar-track,
:deep(.xterm-viewport::-webkit-scrollbar-track) {
  background: transparent;
}

.terminal-session-list::-webkit-scrollbar-thumb,
:deep(.xterm-viewport::-webkit-scrollbar-thumb) {
  min-height: 20px;
  background-clip: padding-box;
  background-color: rgba(121, 121, 121, 0.4);
  border: 3px solid transparent;
}

.terminal-session-list::-webkit-scrollbar-thumb:hover,
:deep(.xterm-viewport::-webkit-scrollbar-thumb:hover) {
  background-color: rgba(100, 100, 100, 0.7);
}

.terminal-session-list::-webkit-scrollbar-thumb:active,
:deep(.xterm-viewport::-webkit-scrollbar-thumb:active) {
  background-color: rgba(191, 191, 191, 0.4);
}

.terminal-session-list::-webkit-scrollbar-corner,
:deep(.xterm-viewport::-webkit-scrollbar-corner) {
  background: transparent;
}

.terminal-session-resize-handle {
  width: 10px;
  align-self: stretch;
  flex: 0 0 10px;
  cursor: col-resize;
  position: relative;
}

.terminal-session-resize-handle::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 4px;
  width: 1px;
  background: #2b2b2b;
}

.terminal-session-resize-handle:hover::before,
:global(body.terminal-session-list-resizing) .terminal-session-resize-handle::before {
  left: 3px;
  width: 2px;
  background: #007acc;
}

.terminal-session-item {
  position: relative;
  min-width: 0;
  height: 26px;
  display: flex;
  align-items: center;
  background: transparent;
  color: #cccccc;
}

.terminal-session-item::before {
  content: '';
  width: 2px;
  align-self: stretch;
  flex: 0 0 2px;
  background: transparent;
}

.terminal-session-item--active {
  background: #37373d;
}

.terminal-session-item--active::before {
  background: var(--accent-color);
}

.terminal-session-activate,
.terminal-session-delete {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.terminal-session-activate {
  min-width: 0;
  height: 100%;
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 6px 0 8px;
  overflow: hidden;
  color: #d4d4d4;
  font-family: inherit;
  font-size: 12px;
  line-height: 26px;
  text-align: left;
}

.terminal-session-activate span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-session-activate i {
  flex: 0 0 auto;
  font-size: 15px;
}

.terminal-session-warning {
  margin-left: auto;
  color: #cca700;
}

.terminal-session-delete {
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-right: 2px;
  border-radius: 3px;
  color: #cccccc;
  opacity: 0;
  pointer-events: none;
}

.terminal-session-item:hover,
.terminal-session-item:focus-within {
  background: #2a2d2e;
}

.terminal-session-item:hover .terminal-session-delete,
.terminal-session-item:focus-within .terminal-session-delete {
  opacity: 1;
  pointer-events: auto;
}

.terminal-session-delete:hover {
  color: #f2f2f2;
  background: #4a4a4a;
}

:deep(.xterm) {
  height: 100%;
}

:deep(.xterm-viewport),
:deep(.xterm-screen) {
  background: #1e1e1e;
}

:global(body.terminal-panel-resizing),
:global(body.terminal-panel-resizing *) {
  cursor: row-resize !important;
  user-select: none !important;
  -webkit-user-select: none !important;
}

:global(body.terminal-session-list-resizing),
:global(body.terminal-session-list-resizing *) {
  cursor: col-resize !important;
  user-select: none !important;
  -webkit-user-select: none !important;
}
</style>
