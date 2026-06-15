import { describe, expect, it } from 'vitest'
import topBarSource from './TopBar.vue?raw'

function getCssDeclaration(selector: string, property: string): string | null {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const blockMatch = topBarSource.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`))
  if (!blockMatch) return null

  const declarationMatch = blockMatch[1].match(new RegExp(`${property}\\s*:\\s*([^;]+);`))
  return declarationMatch?.[1].trim() ?? null
}

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

  it('keeps dropdown menus above workspace content controls', () => {
    const topbarLeftZIndex = Number(getCssDeclaration('.topbar-left', 'z-index'))

    expect(topbarLeftZIndex).toBeGreaterThan(20)
  })
})
