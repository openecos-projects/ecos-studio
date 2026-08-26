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
  it('moves workspace home navigation into the quick menu above Project Management', () => {
    const quickMenuIndex = topBarSource.indexOf('class="quick-dropdown-menu"')
    const homeMenuIndex = topBarSource.indexOf('title="Back to Home"', quickMenuIndex)
    const projectManagementIndex = topBarSource.indexOf(
      'Back to Project Management',
      quickMenuIndex,
    )

    expect(topBarSource).not.toContain('class="home-btn"')
    expect(topBarSource).not.toContain('.home-btn')
    expect(topBarSource).toContain("router.push({ name: 'ECOS' })")
    expect(quickMenuIndex).toBeGreaterThan(-1)
    expect(homeMenuIndex).toBeGreaterThan(quickMenuIndex)
    expect(homeMenuIndex).toBeLessThan(projectManagementIndex)
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

  it('always enables Project Management return from a workspace route', () => {
    expect(topBarSource).toContain('isWorkspaceRoute')
    expect(topBarSource).toContain('route.query.projectRoot')
    expect(topBarSource).not.toContain('hasWorkspaceProjectContext')
    expect(topBarSource).not.toContain(':disabled="!hasWorkspaceProjectContext"')
    expect(topBarSource).not.toContain('if (!hasWorkspaceProjectContext.value) return')
    expect(topBarSource).toContain('goToProjectManagement')
    expect(topBarSource).toContain("path: '/projects'")
  })

  it('returns to Project Management with the current workspace focus query', () => {
    const goStart = topBarSource.indexOf('const goToProjectManagement')
    const goEnd = topBarSource.indexOf('const handleClickOutside', goStart)
    const goSource = topBarSource.slice(goStart, goEnd)

    expect(goSource).toContain('workspaceId')
    expect(goSource).toContain('projectRoot')
    expect(goSource).toContain("path: '/projects'")
    expect(goSource).toContain('query')
    expect(topBarSource).toContain('route.query.workspaceId')
  })

  it('teleports the workspace quick menu outside the app container clipping area', () => {
    expect(topBarSource).toContain('<Teleport to="body">')
    expect(topBarSource).toContain(':style="quickMenuStyle"')
    expect(topBarSource).toContain('@click.stop')
    expect(topBarSource).toContain('updateQuickMenuPosition')
    expect(topBarSource).toContain('Back to Project Management')
    expect(topBarSource).toMatch(/\.quick-dropdown-menu\s*\{[\s\S]*position:\s*fixed;/)
  })

  it('adds a File menu action for opening a new window above workspace actions', () => {
    const newWindowIndex = topBarSource.indexOf("label: 'New Window'")
    const newWorkspaceIndex = topBarSource.indexOf("label: 'New Workspace'")

    expect(newWindowIndex).toBeGreaterThan(-1)
    expect(newWorkspaceIndex).toBeGreaterThan(newWindowIndex)
    expect(topBarSource).toContain('appMenuActionIds.newWindow')
    expect(topBarSource).toContain('ri-window-line')
  })

  it('adds Edit > Config for the active workspace flow', () => {
    const menuStart = topBarSource.indexOf('const menus = computed<Menu[]>')
    const menuEnd = topBarSource.indexOf('// ---- 下拉菜单状态 ----', menuStart)
    const menuSource = topBarSource.slice(menuStart, menuEnd)
    const fileIndex = menuSource.indexOf("label: 'File'")
    const editIndex = menuSource.indexOf('...(isWorkspaceRoute.value')
    const helpIndex = menuSource.indexOf("label: 'Help'")

    expect(editIndex).toBeGreaterThan(fileIndex)
    expect(helpIndex).toBeGreaterThan(editIndex)
    expect(topBarSource).toContain("label: 'Config'")
    expect(topBarSource).toContain("event: 'step-config'")
    expect(topBarSource).toContain('canOpenStepConfig')
    expect(topBarSource).toContain("emit('step-config')")
    expect(topBarSource).toContain('...(isWorkspaceRoute.value ? [editMenu.value] : [])')
  })

  it('binds File shortcuts for new window, new workspace, and open workspace', () => {
    expect(topBarSource).toContain("key === 'n'")
    expect(topBarSource).toContain("key === 'o'")
    expect(topBarSource).toContain('appMenuActionIds.newWindow')
    expect(topBarSource).toContain('appMenuActionIds.newProject')
    expect(topBarSource).toContain('appMenuActionIds.openProject')
    expect(topBarSource).toContain('isEditableKeyboardTarget')
  })

  it('adds View zoom actions to the topbar menu', () => {
    expect(topBarSource).toContain("label: 'View'")
    expect(topBarSource).toContain("label: 'Zoom In'")
    expect(topBarSource).toContain("label: 'Zoom Out'")
    expect(topBarSource).toContain("label: 'Reset Zoom'")
    expect(topBarSource).toContain('appMenuActionIds.zoomIn')
    expect(topBarSource).toContain('appMenuActionIds.zoomOut')
    expect(topBarSource).toContain('appMenuActionIds.zoomReset')
  })

  it('adds a File menu action for reconfiguring the active workspace', () => {
    expect(topBarSource).toContain('Update Workspace')
    expect(topBarSource).not.toContain('Reconfigure Workspace...')
    expect(topBarSource).toContain('ri-settings-3-line')
    expect(topBarSource).toContain('appMenuActionIds.reconfigureWorkspace')
    expect(topBarSource).toContain('disabled: !props.hasWorkspace')
  })

  it('shows signoff export below workspace update and binds its eligibility', () => {
    const updateIndex = topBarSource.indexOf("label: 'Update Workspace'")
    const exportIndex = topBarSource.indexOf("label: 'Export Signoff Package'")
    const metricsIndex = topBarSource.indexOf("label: 'Export Design Summary'")

    expect(exportIndex).toBeGreaterThan(updateIndex)
    expect(metricsIndex).toBeGreaterThan(exportIndex)
    expect(topBarSource).toContain('appMenuActionIds.exportSignoffPackage')
    expect(topBarSource).toContain('disabled: !props.signoffPackageExportEnabled')
    expect(topBarSource).toContain('appMenuActionIds.exportDesignSummary')
  })

  it('does not render the workspace Design menu', () => {
    expect(topBarSource).not.toContain("label: 'Design'")
    expect(topBarSource).not.toContain("action: 'design'")
    expect(topBarSource).not.toContain('Manage RTL Files...')
    expect(topBarSource).not.toContain('appMenuActionIds.manageDesignFiles')
  })
})
