import { describe, expect, it } from 'vitest'
import panelSource from './FlowInsightsPanel.vue?raw'

describe('FlowInsightsPanel data snapshot entry', () => {
  it('shows a five-tile Data Snapshot grid and opens modules in a dialog', () => {
    expect(panelSource).toContain('<h2>Data Snapshot</h2>')
    expect(panelSource).toContain('class="data-snapshot-grid"')
    expect(panelSource).toContain('class="data-snapshot-tile"')
    expect(panelSource).toContain('openModule(cell.id)')
    expect(panelSource).toContain('<Dialog')
    expect(panelSource).not.toContain('flow-insights-timeline')
    expect(panelSource).not.toContain('role="tablist"')
    expect(panelSource).not.toContain('More analysis modules coming soon')
  })

  it('lays Data Snapshot out as a four-by-five grid', () => {
    expect(panelSource).toContain('const DATA_SNAPSHOT_ROWS = 4')
    expect(panelSource).toContain('const DATA_SNAPSHOT_COLUMNS = 5')
    expect(panelSource).toContain('class="data-snapshot-cell"')
    expect(panelSource).toContain('grid-template-columns: repeat(5, minmax(0, 1fr))')
    expect(panelSource).toContain('grid-template-rows: repeat(4, minmax(0, 1fr))')
    expect(panelSource).toContain('snapshot-empty-')
  })
})
