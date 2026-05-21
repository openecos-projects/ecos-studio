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
      /watch\(\s*\(\) => props\.expanded,[\s\S]*if \(expanded\) \{[\s\S]*await startShellSession\(\)/,
    )
  })

  it('is mounted as a VS Code-style bottom panel above the status bar', () => {
    expect(appSource).toMatch(
      /<div\s+class="app-main"[\s\S]*>\s*<div\s+class="app-content"[\s\S]*>\s*<router-view\s*\/>\s*<\/div>\s*<ECOSTerminal[^>]*\/>\s*<\/div>\s*<StatusBar/,
    )
    expect(appSource).toMatch(/:class="\{ 'app-content--terminal-open': terminalExpanded \}"/)
    expect(appSource).toMatch(
      /:style="terminalExpanded \? \{ '--terminal-panel-height': terminalPanelHeight \} : undefined"/,
    )
    expect(appSource).toMatch(/const terminalPanelHeight = 'min\(300px, 42vh\)'/)
    expect(appSource).toMatch(/\.app-main\s*\{[\s\S]*position:\s*relative;/)
    expect(appSource).toMatch(
      /\.app-content--terminal-open\s*\{[\s\S]*padding-bottom:\s*var\(--terminal-panel-height\);/,
    )
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
    expect(terminalSource).toContain('<div class="terminal-body">')
    expect(terminalSource).toMatch(/\.terminal-body\s*\{[\s\S]*padding:\s*8px 10px 0;/)
    expect(terminalSource).toMatch(/\.terminal-surface\s*\{[\s\S]*height:\s*100%;/)
    expect(terminalSource).not.toMatch(/\.terminal-surface\s*\{[\s\S]*padding:/)
  })

  it('keeps xterm internals on the terminal background instead of default black', () => {
    expect(terminalSource).toMatch(/\.terminal-body\s*\{[\s\S]*background:\s*#101418;/)
    expect(terminalSource).toMatch(/\.terminal-surface\s*\{[\s\S]*background:\s*#101418;/)
    expect(terminalSource).toMatch(
      /:deep\(\.xterm-viewport\),\s*:deep\(\.xterm-screen\)\s*\{[\s\S]*background:\s*#101418;/,
    )
  })

  it('refits after the overlay layout settles and keeps the viewport at the bottom', () => {
    expect(terminalSource).toContain('function fitTerminalAfterLayout()')
    expect(terminalSource).toMatch(
      /function fitTerminal\(\)[\s\S]*fitAddon\.fit\(\)[\s\S]*terminal\.scrollToBottom\(\)[\s\S]*resizeShellSession\(\)/,
    )
    expect(terminalSource).toMatch(
      /new ResizeObserver\(fitTerminal\)[\s\S]*resizeObserver\.observe\(terminalElement\.value\.parentElement \?\? terminalElement\.value\)/,
    )
    expect(terminalSource).toMatch(
      /if \(expanded\) \{[\s\S]*fitTerminalAfterLayout\(\)[\s\S]*await startShellSession\(\)[\s\S]*fitTerminalAfterLayout\(\)/,
    )
  })

  it('forwards all terminal input directly to the active shell session', () => {
    expect(terminalSource).toMatch(
      /function handleData\(data: string\) \{[\s\S]*void desktopApi\.shell\.write\(shellSessionId, data\)[\s\S]*\}/,
    )
  })
})
