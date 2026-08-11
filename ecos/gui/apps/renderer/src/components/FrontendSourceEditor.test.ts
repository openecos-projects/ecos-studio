import { describe, expect, it } from 'vitest'
import sourceEditorSource from './FrontendSourceEditor.vue?raw'
import { frontendSourceLanguageForPath } from './frontendSourceLanguage'

describe('frontendSourceLanguageForPath', () => {
  it.each([
    ['rtl/core.v', 'verilog'],
    ['rtl/defs.VH', 'verilog'],
    ['rtl/core.sv', 'systemverilog'],
    ['rtl/defs.SVH', 'systemverilog'],
    ['src/main.c', 'c'],
    ['include/model.h', 'c'],
    ['src/model.CPP', 'cpp'],
    ['include/model.hpp', 'cpp'],
    ['scripts/check.py', 'python'],
    ['scripts/run.sh', 'shell'],
    ['scripts/setup.tcl', 'tcl'],
    ['firmware/start.S', 'ecos-disassembly'],
    ['firmware/trap.asm', 'ecos-disassembly'],
  ])('maps %s to %s', (path, language) => {
    expect(frontendSourceLanguageForPath(path)).toBe(language)
  })

  it('uses plaintext for file lists and unknown paths', () => {
    expect(frontendSourceLanguageForPath('rtl/files.f')).toBe('plaintext')
    expect(frontendSourceLanguageForPath('README')).toBe('plaintext')
  })

  it('ignores URL query and fragment suffixes', () => {
    expect(frontendSourceLanguageForPath('rtl/core.sv?revision=2#L10')).toBe(
      'systemverilog',
    )
  })
})

describe('FrontendSourceEditor Monaco contract', () => {
  it('uses the shared editable Monaco runtime without CodeMirror', () => {
    expect(sourceEditorSource).toContain("import('./monacoRuntime')")
    expect(sourceEditorSource).toContain('runtime.getMonacoRuntime(editorTheme.value)')
    expect(sourceEditorSource).toContain('readOnly: false')
    expect(sourceEditorSource).toContain('domReadOnly: false')
    expect(sourceEditorSource).toContain('automaticLayout: true')
    expect(sourceEditorSource).toContain("wordWrap: 'on'")
    expect(sourceEditorSource).toContain('frontendSourceLanguageForPath(sourcePath)')
    expect(sourceEditorSource).not.toContain('@codemirror')
    expect(sourceEditorSource).not.toContain('syntaxHighlighter')
  })

  it('owns a file model, tracks edits, supports save, and publishes lint markers', () => {
    expect(sourceEditorSource).toContain("scheme: 'file'")
    expect(sourceEditorSource).toContain('onDidChangeModelContent')
    expect(sourceEditorSource).toContain('monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS')
    expect(sourceEditorSource).toContain('editor.setPosition(position)')
    expect(sourceEditorSource).toContain('editor.revealPositionInCenter(position)')
    expect(sourceEditorSource).toContain('monaco.editor.setModelMarkers')
    expect(sourceEditorSource).toContain('sourceModel?.dispose()')
    expect(sourceEditorSource).toContain('editor?.dispose()')
  })
})
