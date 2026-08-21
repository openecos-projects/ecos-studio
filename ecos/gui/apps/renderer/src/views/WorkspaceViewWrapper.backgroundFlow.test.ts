import { describe, expect, it } from 'vitest'
import source from './WorkspaceViewWrapper.vue?raw'

describe('WorkspaceViewWrapper background flow lifecycle', () => {
  it('keeps the active workspace runtime alive when the workspace route is left', () => {
    expect(source).toContain('onBeforeRouteLeave(() => {')
    expect(source).not.toContain('closeProject')
  })
})
