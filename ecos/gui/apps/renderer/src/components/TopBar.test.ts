import { describe, expect, it } from 'vitest'
import topBarSource from './TopBar.vue?raw'

function getCssDeclaration(selector: string, property: string): string | null {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const blockMatch = topBarSource.match(
    new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`),
  )
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
    expect(topBarSource).not.toContain(
      '<div class="topbar-center" data-window-drag-region>',
    )
  })

  it('keeps the centered title overlay pointer-transparent', () => {
    expect(topBarSource).toMatch(/\.topbar-center\s*\{[\s\S]*pointer-events:\s*none;/)
  })

  it('keeps dropdown menus above workspace content controls', () => {
    const topbarLeftZIndex = Number(getCssDeclaration('.topbar-left', 'z-index'))

    expect(topbarLeftZIndex).toBeGreaterThan(20)
  })

  it('places a workspace quick menu before the theme toggle with a divider', () => {
    const menuIndex = topBarSource.indexOf('class="workspace-quick-menu"')
    const dividerIndex = topBarSource.indexOf('class="topbar-right-separator"')
    const themeIndex = topBarSource.indexOf('class="window-btn theme-btn"')

    expect(menuIndex).toBeGreaterThan(-1)
    expect(dividerIndex).toBeGreaterThan(menuIndex)
    expect(themeIndex).toBeGreaterThan(dividerIndex)
    expect(topBarSource).toContain('ri-more-2-line')
  })

  it('only enables Project Management return when the workspace has project context', () => {
    expect(topBarSource).toContain('isWorkspaceRoute')
    expect(topBarSource).toContain('hasWorkspaceProjectContext')
    expect(topBarSource).toContain('route.query.projectRoot')
    expect(topBarSource).toContain(':disabled="!hasWorkspaceProjectContext"')
    expect(topBarSource).toContain('goToProjectManagement')
    expect(topBarSource).toContain("path: '/projects'")
  })

  it('teleports the workspace quick menu outside the app container clipping area', () => {
    expect(topBarSource).toContain('<Teleport to="body">')
    expect(topBarSource).toContain(':style="quickMenuStyle"')
    expect(topBarSource).toContain('@click.stop')
    expect(topBarSource).toContain('updateQuickMenuPosition')
    expect(topBarSource).toContain('Back to Project Management')
    expect(topBarSource).toMatch(/\.quick-dropdown-menu\s*\{[\s\S]*position:\s*fixed;/)
  })
})
