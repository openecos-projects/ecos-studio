import { describe, expect, it } from 'vitest'
import homeViewSource from './HomeView.vue?raw'

describe('HomeView summary typography', () => {
  it('uses one typography treatment for every chip information value', () => {
    const infoGrid = homeViewSource.slice(
      homeViewSource.indexOf('class="info-grid"'),
      homeViewSource.indexOf(
        '</div>\n              </div>',
        homeViewSource.indexOf('class="info-grid"'),
      ),
    )
    const valueRule = homeViewSource.match(/\.info-value\s*\{([^}]*)\}/)?.[1]

    expect(infoGrid.match(/class="info-value/g)).toHaveLength(8)
    expect(infoGrid).not.toContain('info-value mono')
    expect(valueRule).toContain('font-family: inherit;')
    expect(valueRule).toContain('font-size: 13px;')
    expect(valueRule).toContain('font-weight: 600;')
    expect(valueRule).toContain('font-variant-numeric: tabular-nums;')
    expect(valueRule).toContain('letter-spacing: 0;')
    expect(homeViewSource).not.toContain('.info-value.mono')
  })
})
