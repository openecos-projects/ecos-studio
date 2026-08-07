import { describe, expect, it } from 'vitest'
import homeViewSource from './HomeView.vue?raw'

describe('HomeView summary typography', () => {
  it('uses one typography treatment for every dashboard parameter value', () => {
    const chipInfoGrid = homeViewSource.slice(
      homeViewSource.indexOf('class="dashboard-parameter-grid chip-info-grid"'),
      homeViewSource.indexOf(
        '</dl>',
        homeViewSource.indexOf('class="dashboard-parameter-grid chip-info-grid"'),
      ),
    )
    const valueRule = homeViewSource.match(
      /\.chip-info-grid dd,\s*\.key-metrics-grid dd,\s*\.constraint-list dd\s*\{([^}]*)\}/,
    )?.[1]

    expect(chipInfoGrid.match(/<dd>/g)).toHaveLength(10)
    expect(chipInfoGrid).not.toContain('mono')
    expect(valueRule).toContain('font-family: inherit;')
    expect(valueRule).toContain('font-size: 13px;')
    expect(valueRule).toContain('font-weight: 600;')
    expect(valueRule).toContain('font-variant-numeric: tabular-nums;')
    expect(valueRule).toContain('letter-spacing: 0;')
  })
})
