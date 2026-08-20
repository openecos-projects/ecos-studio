import { describe, expect, it } from 'vitest'
import componentSource from './StepDataSummaryDialog.vue?raw'
import barsSource from './StepSnapshotBars.vue?raw'

describe('StepDataSummaryDialog', () => {
  it('gives every snapshot a rail entry and focuses the requested one on open', () => {
    expect(componentSource).toContain('data-summary-rail')
    expect(componentSource).toContain('aria-current')
    expect(componentSource).toContain('focusId')
    expect(componentSource).toContain('activeId')
    expect(componentSource).toContain('props.focusId : (models.value[0]?.id ?? null)')
  })

  it('draws compositions as a single stacked proportion bar with a value legend', () => {
    expect(componentSource).toContain("active.kind === 'composition'")
    expect(componentSource).toContain('data-summary-composition-bar')
    expect(componentSource).toContain('snapshot-slot')
    expect(componentSource).toContain('gap: 2px')
    expect(componentSource).toContain('Composition')
    expect(componentSource).toContain('row.percentLabel')
  })

  it('draws distributions as single-hue horizontal bars plus the full bin table', () => {
    expect(componentSource).toContain('StepSnapshotBars')
    expect(componentSource).toContain(':rows="active.chartRows"')
    expect(componentSource).toContain('No non-zero bins')
    expect(componentSource).toContain('Distribution')
    expect(componentSource).toContain('{{ active.rows.length }} bins')

    // One series, one hue; the table is the always-readable twin of the chart.
    expect(barsSource).toContain('itemStyle: { color: tokens.accent')
    expect(barsSource).toContain('borderRadius: [0, 4, 4, 0]')
    expect(barsSource).toContain('barMaxWidth: 16')
  })

  it('re-renders charts when the theme switches and cleans up on unmount', () => {
    expect(barsSource).toContain('watch(themeName')
    expect(barsSource).toContain('onBeforeUnmount(disposeChart)')
    expect(barsSource).toContain('ResizeObserver')
  })

  it('supports maximize and collapses to a single column on narrow widths', () => {
    expect(componentSource).toContain('maximizable')
    expect(componentSource).toContain('p-dialog-maximized')
    expect(componentSource).toContain('@media (max-width: 720px)')
  })
})
