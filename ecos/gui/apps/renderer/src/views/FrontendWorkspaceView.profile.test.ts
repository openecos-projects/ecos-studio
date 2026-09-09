import { describe, expect, it } from 'vitest'
import frontendWorkspaceViewSource from './FrontendWorkspaceView.vue?raw'

describe('FrontendWorkspaceView design profiles', () => {
  it('uses the persisted frontend design kind for general RTL presentation', () => {
    expect(frontendWorkspaceViewSource).toContain(
      "config.frontend.designKind === 'generic_rtl'",
    )
    expect(frontendWorkspaceViewSource).toContain(
      "isGenericRtl.value ? 'Design RTL' : 'CPU RTL'",
    )
    expect(frontendWorkspaceViewSource).toContain("'Static verification flow'")
    expect(frontendWorkspaceViewSource).toContain(
      "issue.ownership === (isGenericRtl.value ? 'design' : 'cpu')",
    )
    expect(frontendWorkspaceViewSource).toContain(
      "item.ownership === (isGenericRtl.value ? 'design' : 'cpu')",
    )
  })
})
