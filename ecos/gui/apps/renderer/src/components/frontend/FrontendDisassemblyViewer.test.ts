import { describe, expect, it } from 'vitest'
import viewerSource from './FrontendDisassemblyViewer.vue?raw'

describe('FrontendDisassemblyViewer Monaco contract', () => {
  it('uses the shared read-only disassembly runtime without CodeMirror', () => {
    expect(viewerSource).toContain("import('../monacoRuntime')")
    expect(viewerSource).toContain('runtime.getMonacoRuntime(editorTheme.value)')
    expect(viewerSource).toContain('runtime.MONACO_DISASSEMBLY_LANGUAGE_ID')
    expect(viewerSource).toContain('runtime.nextMonacoEditorId()')
    expect(viewerSource).toContain('readOnly: true')
    expect(viewerSource).toContain('domReadOnly: true')
    expect(viewerSource).toContain('automaticLayout: true')
    expect(viewerSource).toContain("wordWrap: 'off'")
    expect(viewerSource).not.toContain('@codemirror')
  })

  it('owns and disposes a unique disassembly model and PC decorations', () => {
    expect(viewerSource).toContain("scheme: 'disassembly'")
    expect(viewerSource).toContain('editor.createDecorationsCollection()')
    expect(viewerSource).toContain("className: 'monaco-pc-line'")
    expect(viewerSource).toContain('pcDecorations?.clear()')
    expect(viewerSource).toContain('editor?.dispose()')
    expect(viewerSource).toContain('model?.dispose()')
  })

  it('preserves filtered loading, address navigation, and stale-load protection', () => {
    expect(viewerSource).toContain('const token = ++loadToken')
    expect(viewerSource).toContain('if (token !== loadToken) return')
    expect(viewerSource).toContain('stripSourceFromDisassembly(result)')
    expect(viewerSource).toContain(
      'findDisassemblyAddressLine(content.value, normalized)',
    )
    expect(viewerSource).toContain('editor.setPosition({ lineNumber, column: 1 })')
    expect(viewerSource).toContain('editor.revealLineInCenter(lineNumber)')
    expect(viewerSource).toContain('setHighlightedLine(null)')
  })

  it('keeps the existing invalid-address and missing-address highlight behavior distinct', () => {
    const invalidBranch = viewerSource.slice(
      viewerSource.indexOf('if (!normalized) {'),
      viewerSource.indexOf('addressInput.value = `0x${normalized}`'),
    )
    const missingBranch = viewerSource.slice(
      viewerSource.indexOf('if (lineNumber === null) {'),
      viewerSource.indexOf('editor.setPosition({ lineNumber, column: 1 })'),
    )

    expect(invalidBranch).toContain('Enter a hexadecimal instruction address.')
    expect(invalidBranch).not.toContain('setHighlightedLine(null)')
    expect(missingBranch).toContain('setHighlightedLine(null)')
    expect(missingBranch).toContain('is not present in this file.')
  })

  it('tracks the shared theme and preserves the close and empty states', () => {
    expect(viewerSource).toContain('watch(editorTheme')
    expect(viewerSource).toContain('applyTheme?.(theme)')
    expect(viewerSource).toContain("emit('close')")
    expect(viewerSource).toContain('This case has no disassembly artifact.')
    expect(viewerSource).toContain('Loading disassembly')
  })
})
