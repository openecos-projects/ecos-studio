import { describe, expect, it } from 'vitest'
import source from './DesignReportExportDialog.vue?raw'

describe('DesignReportExportDialog', () => {
  it('renders format tabs for LaTeX, Markdown, CSV, and Plain Text', () => {
    expect(source).toContain('header="Export Design Summary"')
    expect(source).toContain('LaTeX Paper')
    expect(source).toContain('Markdown Docs')
    expect(source).toContain('CSV Table')
    expect(source).toContain('Plain Text Log')
    expect(source).toContain('.tex')
    expect(source).toContain('.md')
    expect(source).toContain('.csv')
    expect(source).toContain('.txt')
  })

  it('renders configuration options for multi-corner, stage breakdown, and standalone LaTeX without provenance or manual verification toggle', () => {
    expect(source).toContain('Multi-Corner Timing')
    expect(source).toContain('Stage Execution Breakdown')
    expect(source).toContain('Standalone Document (IEEEtran)')
    expect(source).not.toContain('Physical Verification Details')
    expect(source).not.toContain('Provenance Traceability')
  })

  it('provides accessible copy, save single format, and batch export actions', () => {
    expect(source).toContain('Copy to Clipboard')
    expect(source).toContain('Export All Formats (4 Files)')
    expect(source).toContain('Save .{{ formatExt(selectedFormat) }}')
    expect(source).toContain('@click="emit(\'copy\')"')
    expect(source).toContain('@click="emit(\'saveAll\')"')
    expect(source).toContain('@click="emit(\'saveCurrent\')"')
    expect(source).toContain('@click="emit(\'close\')"')
  })

  it('includes preformatted code preview with line and byte counts', () => {
    expect(source).toContain('class="preview-code"')
    expect(source).toContain('preview-lang-tag')
    expect(source).toContain('preview-size-tag')
    expect(source).toContain('lineCount')
    expect(source).toContain('charCount')
  })
})
