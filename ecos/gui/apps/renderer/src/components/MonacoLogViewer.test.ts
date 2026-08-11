import { describe, expect, it } from 'vitest'
import viewerSource from './MonacoLogViewer.vue?raw'
import runtimeSource from './monacoRuntime.ts?raw'

describe('MonacoLogViewer contract', () => {
  it('uses a read-only Monaco editor with output-oriented navigation', () => {
    expect(viewerSource).toContain('readOnly: true')
    expect(viewerSource).toContain('domReadOnly: true')
    expect(viewerSource).toContain("wordWrap: 'on'")
    expect(viewerSource).toContain('minimap: { enabled: false }')
    expect(runtimeSource).toContain('findController')
  })

  it('keeps one output model and view state per channel', () => {
    expect(viewerSource).toContain('const models = new Map<string, ModelRecord>()')
    expect(viewerSource).toContain("scheme: 'output'")
    expect(viewerSource).toContain('editor.saveViewState()')
    expect(viewerSource).toContain('editor.restoreViewState(record.viewState)')
    expect(viewerSource).toContain('record.model.dispose()')
  })

  it('loads only the editor worker and registers semantic log highlighting', () => {
    expect(runtimeSource).toContain('editor.worker?worker')
    expect(runtimeSource).toContain('MONACO_LOG_LANGUAGE_ID')
    expect(runtimeSource).toContain('setMonarchTokensProvider')
    expect(viewerSource).toContain('updateDecorations(record, content)')
    expect(viewerSource).toContain('ecos-log-line-${line.tone}')
  })
})
