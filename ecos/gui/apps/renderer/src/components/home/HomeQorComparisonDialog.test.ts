import { describe, expect, it } from 'vitest'
import componentSource from './HomeQorComparisonDialog.vue?raw'

describe('HomeQorComparisonDialog', () => {
  it('fills the teleported dialog when maximized instead of keeping the compact height', () => {
    expect(componentSource).toContain('maximizable')
    expect(componentSource).toContain(
      '<!-- Dialog teleports to body; keep maximize layout rules unscoped. -->',
    )
    expect(componentSource).toContain('.qor-detail-dialog.p-dialog-maximized')
    expect(componentSource).toContain('height: 100vh')
    expect(componentSource).toContain(
      '.qor-detail-dialog.p-dialog-maximized .qor-detail-waterfall',
    )
    expect(componentSource).toContain('flex: 1 1 auto')
    expect(componentSource).toContain('height: auto !important')
    expect(componentSource).toContain('max-height: none')
  })
})
