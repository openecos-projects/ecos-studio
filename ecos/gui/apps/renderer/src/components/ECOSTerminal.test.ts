import { describe, expect, it } from 'vitest'
import appSource from '../App.vue?raw'
import terminalSource from './ECOSTerminal.vue?raw'

describe('ECOSTerminal', () => {
  it('uses xterm with fit, web links, and search addons', () => {
    expect(terminalSource).toContain("from '@xterm/xterm'")
    expect(terminalSource).toContain("from '@xterm/addon-fit'")
    expect(terminalSource).toContain("from '@xterm/addon-web-links'")
    expect(terminalSource).toContain("from '@xterm/addon-search'")
  })

  it('starts as a node-pty shell terminal', () => {
    expect(terminalSource).toContain('startShellSession')
    expect(terminalSource).toContain("desktopApi.shell.createSession")
    expect(terminalSource).toContain("desktopApi.shell.write")
    expect(terminalSource).toContain("desktopApi.shell.resize")
    expect(terminalSource).toContain("desktopApi.shell.kill")
    expect(terminalSource).toContain("desktopApi.shell.onData")
    expect(terminalSource).toContain("desktopApi.shell.onExit")
    expect(terminalSource).not.toContain('desktopApi.cli.execute')
  })

  it('does not expose a terminal mode toggle', () => {
    expect(terminalSource).not.toContain('terminalMode')
    expect(terminalSource).not.toContain('terminal-mode-toggle')
    expect(terminalSource).not.toContain('switchTerminalMode')
  })

  it('starts the shell when the terminal is first expanded', () => {
    expect(terminalSource).toMatch(
      /watch\(\s*\(\) => props\.expanded,[\s\S]*if \(expanded\) \{[\s\S]*await ensureActiveTerminal\(\)/,
    )
  })

  it('is mounted as a VS Code-style bottom panel above the status bar', () => {
    expect(appSource).toMatch(
      /<div\s+class="app-main"[\s\S]*>\s*<div\s+class="app-content"[\s\S]*>\s*<router-view\s*\/>\s*<\/div>\s*<ECOSTerminal[^>]*\/>\s*<\/div>\s*<StatusBar/,
    )
    expect(appSource).toMatch(
      /:style="terminalExpanded \? \{ '--terminal-panel-height': terminalPanelHeight \} : undefined"/,
    )
    expect(appSource).toMatch(/const terminalPanelHeight = ref\('min\(300px, 42vh\)'\)/)
    expect(appSource).toContain(':maximized="terminalPanelMaximized"')
    expect(appSource).toContain('@height-change="handleTerminalHeightChange"')
    expect(appSource).toContain('@toggle-maximize="toggleTerminalMaximized"')
    expect(appSource).toMatch(/\.app-main\s*\{[\s\S]*position:\s*relative;/)
    expect(appSource).not.toContain('app-content--terminal-open')
    expect(appSource).toContain("'app-content--terminal-safe-area': terminalExpanded")
    expect(appSource).not.toMatch(/^\s*padding-bottom:\s*var\(--terminal-panel-height\);/m)
  })

  it('keeps covered app content reachable with a scroll spacer instead of resizing it', () => {
    expect(appSource).toContain("'--terminal-panel-height': terminalPanelHeight")
    expect(appSource).toContain('@height-change="handleTerminalHeightChange"')
    expect(appSource).toMatch(
      /\.app-content--terminal-safe-area::after\s*\{[\s\S]*height:\s*var\(--terminal-panel-height\);/,
    )
    expect(appSource).toMatch(
      /\.app-content--terminal-safe-area\s*\{[\s\S]*scroll-padding-bottom:\s*var\(--terminal-panel-height\);/,
    )
    expect(appSource).not.toMatch(/^\s*padding-bottom:\s*var\(--terminal-panel-height\);/m)
  })

  it('lets the terminal panel height be dragged and maximized like the VS Code panel', () => {
    expect(appSource).toContain('const terminalPanelMaximized = ref(false)')
    expect(appSource).toContain('function handleTerminalHeightChange(height: string)')
    expect(appSource).toContain('function toggleTerminalMaximized()')
    expect(terminalSource).toContain('heightChange: [height: string]')
    expect(terminalSource).toContain('toggleMaximize: []')
    expect(terminalSource).toContain('class="terminal-resize-handle"')
    expect(terminalSource).toContain('@pointerdown="handleResizePointerDown"')
    expect(terminalSource).toContain("document.body.classList.add('terminal-panel-resizing')")
    expect(terminalSource).toContain("document.body.classList.remove('terminal-panel-resizing')")
  })

  it('overlays the app content instead of taking flex layout space', () => {
    expect(terminalSource).toMatch(/\.ecos-terminal-panel\s*\{[\s\S]*position:\s*absolute;/)
    expect(terminalSource).toMatch(/\.ecos-terminal-panel\s*\{[\s\S]*z-index:\s*\d+;/)
    expect(terminalSource).toMatch(/\.ecos-terminal-panel\s*\{[\s\S]*bottom:\s*0;/)
    expect(terminalSource).toMatch(
      /\.ecos-terminal-panel\s*\{[\s\S]*height:\s*var\(--terminal-panel-height,\s*min\(300px,\s*42vh\)\);/,
    )
    expect(terminalSource).not.toContain('bottom: calc(var(--status-bar-height')
    expect(terminalSource).not.toContain('flex: 0 0 260px')
  })

  it('keeps the prompt clear of the bottom status bar', () => {
    expect(terminalSource).toMatch(/<div\s+ref="terminalBody"\s+class="terminal-body">/)
    expect(terminalSource).toMatch(/\.terminal-body\s*\{[\s\S]*padding:\s*8px 10px 0;/)
    expect(terminalSource).toMatch(/\.terminal-surface\s*\{[\s\S]*height:\s*100%;/)
    expect(terminalSource.match(/\.terminal-surface\s*\{[^}]*\}/)?.[0] ?? '').not.toContain(
      'padding:',
    )
  })

  it('keeps xterm internals on the terminal background instead of default black', () => {
    expect(terminalSource).toContain("const terminalBackground = '#1e1e1e'")
    expect(terminalSource).toMatch(/\.ecos-terminal-panel\s*\{[\s\S]*background:\s*#1e1e1e;/)
    expect(terminalSource).toMatch(/\.terminal-body\s*\{[\s\S]*background:\s*#1e1e1e;/)
    expect(terminalSource).toMatch(/\.terminal-surface\s*\{[\s\S]*background:\s*#1e1e1e;/)
    expect(terminalSource).toMatch(
      /:deep\(\.xterm-viewport\),\s*:deep\(\.xterm-screen\)\s*\{[\s\S]*background:\s*#1e1e1e;/,
    )
  })

  it('uses VS Code-style terminal scrollbars instead of the app-wide light scrollbar', () => {
    expect(terminalSource).toMatch(
      /\.terminal-session-list,\s*:deep\(\.xterm-viewport\)\s*\{[\s\S]*scrollbar-color:\s*rgba\(121,\s*121,\s*121,\s*0\.4\)\s*transparent;/,
    )
    expect(terminalSource).toMatch(
      /\.terminal-session-list::-webkit-scrollbar,\s*:deep\(\.xterm-viewport::-webkit-scrollbar\)\s*\{[\s\S]*width:\s*10px;/,
    )
    expect(terminalSource).toMatch(
      /\.terminal-session-list::-webkit-scrollbar-track,\s*:deep\(\.xterm-viewport::-webkit-scrollbar-track\)\s*\{[\s\S]*background:\s*transparent;/,
    )
    expect(terminalSource).toMatch(
      /\.terminal-session-list::-webkit-scrollbar-thumb,\s*:deep\(\.xterm-viewport::-webkit-scrollbar-thumb\)\s*\{[\s\S]*background-color:\s*rgba\(121,\s*121,\s*121,\s*0\.4\);[\s\S]*border:\s*3px solid transparent;/,
    )
    expect(terminalSource).toMatch(
      /\.terminal-session-list::-webkit-scrollbar-thumb:hover,\s*:deep\(\.xterm-viewport::-webkit-scrollbar-thumb:hover\)\s*\{[\s\S]*background-color:\s*rgba\(100,\s*100,\s*100,\s*0\.7\);/,
    )
  })

  it('uses a readable terminal font size and high-contrast prompt colors', () => {
    expect(terminalSource).toContain('fontSize: 13')
    expect(terminalSource).toContain("foreground: '#cccccc'")
    expect(terminalSource).toContain("green: '#23d18b'")
    expect(terminalSource).toContain("brightGreen: '#23d18b'")
    expect(terminalSource).not.toContain("green: '#6a9955'")
  })

  it('uses VS Code terminal colors for prompts, paths, and command output', () => {
    expect(terminalSource).toContain("blue: '#3b8eea'")
    expect(terminalSource).toContain("brightBlue: '#6cb6ff'")
    expect(terminalSource).toContain("green: '#23d18b'")
    expect(terminalSource).toContain("brightGreen: '#23d18b'")
    expect(terminalSource).toContain("red: '#f14c4c'")
    expect(terminalSource).toContain("magenta: '#bc3fbc'")
    expect(terminalSource).toContain("brightMagenta: '#d670d6'")
    expect(terminalSource).toContain("foreground: '#cccccc'")
    expect(terminalSource).not.toContain("blue: '#569cd6'")
  })

  it('refits after the overlay layout settles and keeps the viewport at the bottom', () => {
    expect(terminalSource).toContain('function fitTerminalAfterLayout()')
    expect(terminalSource).toMatch(
      /function fitTerminal\(\)[\s\S]*activeRecord\.fitAddon\.fit\(\)[\s\S]*activeRecord\.terminal\.scrollToBottom\(\)[\s\S]*resizeShellSession\(activeRecord\)/,
    )
    expect(terminalSource).toMatch(
      /new ResizeObserver\(fitTerminal\)[\s\S]*resizeObserver\.observe\(terminalBody\.value\)/,
    )
    expect(terminalSource).toMatch(
      /if \(expanded\) \{[\s\S]*await ensureActiveTerminal\(\)[\s\S]*fitTerminalAfterLayout\(\)/,
    )
  })

  it('forwards all terminal input directly to the active shell session', () => {
    expect(terminalSource).toMatch(
      /function handleData\(record: TerminalRecord, data: string\) \{[\s\S]*void desktopApi\.shell\.write\(record\.sessionId, data\)[\s\S]*\}/,
    )
  })

  it('adds VS Code-style terminal actions for new terminal, maximize, and close', () => {
    expect(terminalSource).toContain('title="New Terminal"')
    expect(terminalSource).toContain('@click="createAndActivateTerminal"')
    expect(terminalSource).toContain("'Maximize Panel'")
    expect(terminalSource).toContain("'Restore Panel'")
    expect(terminalSource).toContain('@click="$emit(\'toggleMaximize\')"')
    expect(terminalSource).toContain('title="Close Panel"')
    expect(terminalSource).toContain('@click="closePanel"')
    expect(terminalSource).toContain('ri-add-line')
    expect(terminalSource).toContain('ri-arrow-down-s-line')
    expect(terminalSource).toContain('ri-more-line')
    expect(terminalSource).toContain('ri-fullscreen-line')
    expect(terminalSource).toContain('ri-fullscreen-exit-line')
    expect(terminalSource).toContain('ri-close-line')
  })

  it('keeps prior VS Code terminal sessions alive when creating another terminal', () => {
    const createAndActivateTerminalBody =
      terminalSource.match(
        /async function createAndActivateTerminal\(\) \{([\s\S]*?)\nasync function activateTerminal/,
      )?.[1] ?? ''

    expect(terminalSource).toContain('interface TerminalRecord')
    expect(terminalSource).toContain('const terminalRecords = shallowRef<TerminalRecord[]>([])')
    expect(terminalSource).toMatch(
      /function createAndActivateTerminal\(\)[\s\S]*createTerminalRecord\(\)[\s\S]*terminalRecords\.value = \[\.\.\.terminalRecords\.value, record\][\s\S]*activeTerminalId\.value = record\.localId[\s\S]*startShellSession\(record\)/,
    )
    expect(terminalSource).toMatch(/function closePanel\(\) \{[\s\S]*emit\('collapse'\)[\s\S]*\}/)
    expect(createAndActivateTerminalBody).not.toContain('stopShellSession(record)')
  })

  it('shows terminal sessions in a right-side list and lets each session be deleted', () => {
    expect(terminalSource).toMatch(
      /<div\s+ref="terminalBody"\s+class="terminal-body">[\s\S]*class="terminal-workspace"[\s\S]*class="terminal-session-list"/,
    )
    expect(terminalSource).toContain('aria-label="Terminal session list"')
    expect(terminalSource).toContain('class="terminal-session-item"')
    expect(terminalSource).toContain('terminal-session-item--active')
    expect(terminalSource).toContain('title="Close Terminal"')
    expect(terminalSource).toContain('aria-label="Close Terminal"')
    expect(terminalSource).toContain('@click.stop="deleteTerminal(record.localId)"')
    expect(terminalSource).toContain('ri-delete-bin-line')
    expect(terminalSource).not.toContain('terminal-session-item--active .terminal-session-delete')
    expect(terminalSource).toMatch(
      /\.terminal-session-item--active::before\s*\{[\s\S]*background:\s*var\(--accent-color\);/,
    )
    expect(terminalSource).toMatch(
      /\.terminal-session-delete\s*\{[^}]*opacity:\s*0;[\s\S]*pointer-events:\s*none;/,
    )
    expect(terminalSource).toMatch(
      /\.terminal-session-item:hover \.terminal-session-delete,\s*\.terminal-session-item:focus-within \.terminal-session-delete\s*\{[^}]*opacity:\s*1;[\s\S]*pointer-events:\s*auto;/,
    )
    expect(terminalSource).toMatch(
      /async function deleteTerminal\(localId: string\)[\s\S]*await stopShellSession\(record\)[\s\S]*record\.terminal\.dispose\(\)[\s\S]*terminalRecords\.value = remainingRecords/,
    )
  })

  it('lets the right-side terminal session list be resized horizontally', () => {
    expect(terminalSource).toContain('const DEFAULT_TERMINAL_SESSION_LIST_WIDTH = 150')
    expect(terminalSource).toContain('const MIN_TERMINAL_SESSION_LIST_WIDTH = 104')
    expect(terminalSource).toContain('const MAX_TERMINAL_SESSION_LIST_WIDTH = 280')
    expect(terminalSource).toContain('ref="terminalWorkspace"')
    expect(terminalSource).toContain('class="terminal-session-resize-handle"')
    expect(terminalSource).toContain('@pointerdown="handleSessionListResizePointerDown"')
    expect(terminalSource).toContain(':style="terminalSessionListStyle"')
    expect(terminalSource).toMatch(
      /const terminalSessionListStyle = computed\(\(\) => \(\{[\s\S]*width: `\$\{terminalSessionListWidth\.value\}px`,[\s\S]*flexBasis: `\$\{terminalSessionListWidth\.value\}px`,/,
    )
    expect(terminalSource).toMatch(
      /function handleSessionListResizePointerMove\(event: PointerEvent\)[\s\S]*workspaceRect\.right - event\.clientX[\s\S]*terminalSessionListWidth\.value = clampTerminalSessionListWidth\(width\)[\s\S]*fitTerminal\(\)/,
    )
    expect(terminalSource).toContain("document.body.classList.add('terminal-session-list-resizing')")
    expect(terminalSource).toContain("document.body.classList.remove('terminal-session-list-resizing')")
    expect(terminalSource).toMatch(
      /\.terminal-session-resize-handle\s*\{[\s\S]*cursor:\s*col-resize;/,
    )
  })

  it('does not render command status decorations before terminal prompts', () => {
    expect(terminalSource).not.toContain('allowProposedApi: true')
    expect(terminalSource).not.toContain('TerminalCommandDecoration')
    expect(terminalSource).not.toContain('commandDecorations')
    expect(terminalSource).not.toContain('handleCommandDecorationInput')
    expect(terminalSource).not.toContain('registerMarker')
    expect(terminalSource).not.toContain('registerDecoration')
    expect(terminalSource).not.toContain('registerOscHandler')
    expect(terminalSource).not.toContain('terminal-command-decoration')
    expect(terminalSource.match(/\.terminal-surface\s*\{[^}]*\}/)?.[0] ?? '').not.toContain(
      'padding-left:',
    )
  })
})
