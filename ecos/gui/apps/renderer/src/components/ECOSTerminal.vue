<template>
  <section v-show="expanded" class="ecos-terminal-panel" aria-label="ECOS terminal">
    <div class="terminal-header">
      <div class="terminal-title">
        <i class="ri-terminal-box-line" aria-hidden="true"></i>
        <span>ECOS Terminal</span>
      </div>
      <div class="terminal-actions">
        <button
          class="terminal-icon-button"
          type="button"
          title="Collapse terminal"
          @click="$emit('collapse')"
        >
          <i class="ri-arrow-down-s-line" aria-hidden="true"></i>
        </button>
      </div>
    </div>
    <div class="terminal-body">
      <div ref="terminalElement" class="terminal-surface"></div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { getOptionalDesktopApi } from '@/platform/desktop'
import '@xterm/xterm/css/xterm.css'

const props = defineProps<{
  expanded: boolean
}>()

defineEmits<{
  collapse: []
}>()

const terminalElement = ref<HTMLElement | null>(null)
const fitAddon = new FitAddon()
const terminal = new Terminal({
  allowProposedApi: false,
  convertEol: true,
  cursorBlink: true,
  fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
  fontSize: 12,
  lineHeight: 1.35,
  theme: {
    background: '#101418',
    black: '#101418',
    blue: '#4a9eff',
    brightBlack: '#6b7280',
    brightBlue: '#72b7ff',
    brightCyan: '#6ee7e7',
    brightGreen: '#8bd17c',
    brightMagenta: '#d2a8ff',
    brightRed: '#ff8a8a',
    brightWhite: '#f3f4f6',
    brightYellow: '#f6d365',
    cursor: '#c8d3df',
    cyan: '#52c7c7',
    foreground: '#d5dde6',
    green: '#7ac66f',
    magenta: '#c79bff',
    red: '#ff6b6b',
    selectionBackground: '#2e465c',
    white: '#d5dde6',
    yellow: '#e8c15c',
  },
})

let unsubscribeShellData: (() => void) | undefined
let unsubscribeShellExit: (() => void) | undefined
let resizeObserver: ResizeObserver | undefined
let shellSessionId: string | null = null
let shellStartPromise: Promise<void> | null = null
const pendingShellData = new Map<string, string[]>()

function fitTerminal() {
  if (!props.expanded) return
  requestAnimationFrame(() => {
    try {
      fitAddon.fit()
      terminal.scrollToBottom()
      resizeShellSession()
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

function resizeShellSession() {
  if (!shellSessionId) return
  const desktopApi = getOptionalDesktopApi()
  if (!desktopApi?.shell) return

  void desktopApi.shell.resize(shellSessionId, terminal.cols, terminal.rows)
}

function writeLine(value = '') {
  terminal.writeln(value)
}

async function stopShellSession() {
  if (!shellSessionId) return
  const sessionId = shellSessionId
  shellSessionId = null
  const desktopApi = getOptionalDesktopApi()

  try {
    if (desktopApi?.shell) {
      await desktopApi.shell.kill(sessionId)
    }
  } catch {
    /* Session may already have exited. */
  }
}

async function startShellSession() {
  if (shellSessionId) return
  if (shellStartPromise) return shellStartPromise

  shellStartPromise = createShellSession()
  await shellStartPromise
}

async function createShellSession() {
  const desktopApi = getOptionalDesktopApi()

  if (!desktopApi?.shell) {
    writeLine('ECOS desktop shell bridge is not available.')
    shellStartPromise = null
    return
  }

  try {
    const session = await desktopApi.shell.createSession({
      cols: terminal.cols || 80,
      rows: terminal.rows || 24,
    })
    shellSessionId = session.sessionId
    const pendingData = pendingShellData.get(session.sessionId) ?? []
    pendingShellData.delete(session.sessionId)
    for (const chunk of pendingData) {
      terminal.write(chunk, () => {
        terminal.scrollToBottom()
      })
    }
  } catch (error) {
    writeLine(`[error] ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    shellStartPromise = null
  }
}

function handleShellData(event: { data: string; sessionId: string }) {
  if (!shellSessionId) {
    pendingShellData.set(event.sessionId, [
      ...(pendingShellData.get(event.sessionId) ?? []),
      event.data,
    ])
    return
  }
  if (event.sessionId !== shellSessionId) return
  terminal.write(event.data, () => {
    terminal.scrollToBottom()
  })
}

function handleShellExit(event: { exitCode: number; sessionId: string }) {
  if (event.sessionId !== shellSessionId) return
  shellSessionId = null

  writeLine()
  writeLine(`[shell exited with code ${event.exitCode}]`)
}

function handleData(data: string) {
  if (!shellSessionId) return
  const desktopApi = getOptionalDesktopApi()
  if (!desktopApi?.shell) return
  void desktopApi.shell.write(shellSessionId, data)
}

onMounted(() => {
  terminal.loadAddon(fitAddon)
  terminal.loadAddon(new WebLinksAddon())
  terminal.loadAddon(new SearchAddon())
  terminal.open(terminalElement.value!)
  terminal.onData(handleData)
  fitTerminal()

  const desktopApi = getOptionalDesktopApi()
  if (desktopApi?.shell) {
    unsubscribeShellData = desktopApi.shell.onData(handleShellData)
    unsubscribeShellExit = desktopApi.shell.onExit(handleShellExit)
  }

  if (terminalElement.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(fitTerminal)
    resizeObserver.observe(terminalElement.value.parentElement ?? terminalElement.value)
  }

  if (props.expanded) {
    void startShellSession()
  }
})

onBeforeUnmount(() => {
  unsubscribeShellData?.()
  unsubscribeShellExit?.()
  void stopShellSession()
  resizeObserver?.disconnect()
  terminal.dispose()
})

watch(
  () => props.expanded,
  async (expanded) => {
    if (expanded) {
      await nextTick()
      fitTerminalAfterLayout()
      await startShellSession()
      fitTerminalAfterLayout()
      terminal.focus()
    }
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
  min-height: 180px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #101418;
  border-top: 1px solid var(--border-color);
  box-shadow: 0 -12px 28px rgba(0, 0, 0, 0.28);
}

.terminal-header {
  height: 30px;
  flex: 0 0 30px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 8px 0 12px;
  background: var(--bg-secondary);
  border-bottom: 1px solid rgba(128, 128, 128, 0.22);
}

.terminal-title {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
}

.terminal-title i {
  font-size: 14px;
}

.terminal-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.terminal-icon-button {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 4px;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
}

.terminal-icon-button:hover {
  color: var(--text-primary);
  background: var(--hover-bg);
}

.terminal-body {
  flex: 1;
  min-height: 0;
  padding: 8px 10px 0;
  background: #101418;
}

.terminal-surface {
  height: 100%;
  min-height: 0;
  background: #101418;
}

:deep(.xterm) {
  height: 100%;
}

:deep(.xterm-viewport),
:deep(.xterm-screen) {
  background: #101418;
}

:deep(.xterm-viewport) {
  scrollbar-width: thin;
}
</style>
