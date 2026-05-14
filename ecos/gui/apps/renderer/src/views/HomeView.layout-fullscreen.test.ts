import { describe, expect, it } from 'vitest'
import homeViewSource from './HomeView.vue?raw'

describe('HomeView layout fullscreen preview', () => {
  it('renders the fullscreen layout preview through a body-level overlay', () => {
    expect(homeViewSource).toContain('class="layout-fullscreen-overlay"')
    expect(homeViewSource).toContain('v-if="isLayoutFullscreen"')
    expect(homeViewSource).toContain('<Teleport to="body">')
  })

  it('does not keep layout fullscreen bound to the inline dashboard card', () => {
    expect(homeViewSource).not.toContain("'is-fullscreen': isLayoutFullscreen")
  })
})
