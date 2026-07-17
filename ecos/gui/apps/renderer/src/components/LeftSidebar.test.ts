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

  it('keeps full-flow run controls visible for frontend workspaces', () => {
    const overviewTemplate = source.slice(
      source.indexOf('<template v-if="showOverviewPanel">'),
      source.indexOf('<template v-else-if="showSubflowPanel">'),
    )
    const subflowTemplate = source.slice(
      source.indexOf('<template v-else-if="showSubflowPanel">'),
    )

    expect(source).toContain("isFrontendProject.value ? 'Frontend Flow' : 'RTL2GDS'")
    expect(source).toContain('await runAllFlow({ rerun: isRerun.value })')
    expect(overviewTemplate).not.toContain('v-if="!isFrontendProject"')
    expect(subflowTemplate).toContain('v-if="!isFrontendProject"')
  })
})
