import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import flowLogViewerSource from './FlowLogCodeViewer.vue?raw'
import sourceEditorSource from './FrontendSourceEditor.vue?raw'
import viewerSource from './MonacoLogViewer.vue?raw'
import disassemblyViewerSource from './frontend/FrontendDisassemblyViewer.vue?raw'
import runtimeSource from './monacoRuntime.ts?raw'
import flowLogPanelSource from './workbench/FlowLogPanel.vue?raw'

const widgetLayerSource = readFileSync(
  new URL('./monacoWidgetLayer.css', import.meta.url),
  'utf8',
)

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
    expect(viewerSource).toContain('observeLogTooltipBounds()')
    expect(viewerSource).toContain('new MutationObserver')
    expect(viewerSource).toContain('clampLogTooltipsToEditorBounds()')
  })

  it('loads only the editor worker and registers semantic log highlighting', () => {
    expect(runtimeSource).toContain('editor.worker?worker')
    expect(runtimeSource).toContain('MONACO_LOG_LANGUAGE_ID')
    expect(runtimeSource).toContain('setMonarchTokensProvider')
    expect(viewerSource).toContain('updateDecorations(record, content)')
    expect(viewerSource).toContain('ecos-log-line-${line.tone}')
  })

  it('lets find-widget tooltips escape every clipped editor boundary', () => {
    expect(runtimeSource).toContain("import './monacoWidgetLayer.css'")
    expect(widgetLayerSource).toMatch(
      /\.monaco-widget-overflow-host\s*{[^}]*overflow:\s*visible\s*!important;/s,
    )
    expect(viewerSource.match(/monaco-widget-overflow-host/g)).toHaveLength(2)
    expect(sourceEditorSource.match(/monaco-widget-overflow-host/g)).toHaveLength(2)
    expect(flowLogViewerSource.match(/monaco-widget-overflow-host/g)).toHaveLength(3)
    expect(flowLogPanelSource.match(/monaco-widget-overflow-host/g)).toHaveLength(3)
    expect(disassemblyViewerSource.match(/monaco-widget-overflow-host/g)).toHaveLength(2)
  })

  it('keeps find controls stable and compact while hovered', () => {
    expect(widgetLayerSource).toMatch(
      /\.monaco-editor \.find-widget\s*{[^}]*transition:\s*none !important;/s,
    )
    expect(widgetLayerSource).toMatch(
      /\.monaco-editor \.find-widget > \.button\.codicon-widget-close\s*{[^}]*width:\s*16px;[^}]*height:\s*16px;[^}]*padding:\s*3px;[^}]*top:\s*9px;/s,
    )
    expect(widgetLayerSource).toContain('overflow: hidden !important')
    expect(widgetLayerSource).toContain(
      ".monaco-log-editor .monaco-hover[role='tooltip']",
    )
    expect(widgetLayerSource).toContain(
      ".context-view:has(.monaco-hover[role='tooltip'])",
    )
    expect(widgetLayerSource).toContain('white-space: nowrap !important')
    expect(widgetLayerSource).toContain('--ecos-log-tooltip-shift-x')
    expect(widgetLayerSource).toContain('.button:focus')
    expect(widgetLayerSource).toContain('outline: none !important')
  })
})
