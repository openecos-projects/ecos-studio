import { describe, expect, it } from 'vitest'
import source from './LeftSidebar.vue?raw'

describe('LeftSidebar workspace navigation', () => {
  it('preserves workspace route query when switching flow steps', () => {
    expect(source).toContain('useRoute')
    expect(source).toContain('workspaceStageLink(stage.path)')
    expect(source).toContain('function workspaceStageLink')
    expect(source).toContain('query: route.query')
    expect(source).not.toContain(`:to="'/workspace/' + stage.path"`)
  })
})
