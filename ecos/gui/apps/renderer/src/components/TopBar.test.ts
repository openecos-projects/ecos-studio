import { describe, expect, it } from 'vitest'
import topBarSource from './TopBar.vue?raw'

describe('TopBar drag region layout', () => {
  it('offers a home button that routes back to ECOSView', () => {
    expect(topBarSource).toContain('class="home-btn"')
    expect(topBarSource).toContain("router.push({ name: 'ECOS' })")
  })

  it('uses a dedicated drag spacer instead of making the centered overlay draggable', () => {
    expect(topBarSource).toContain('class="topbar-drag-spacer" data-window-drag-region')
    expect(topBarSource).not.toContain('<div class="topbar-center" data-window-drag-region>')
  })

  it('keeps the centered title overlay pointer-transparent', () => {
    expect(topBarSource).toMatch(/\.topbar-center\s*\{[\s\S]*pointer-events:\s*none;/)
  })
})
