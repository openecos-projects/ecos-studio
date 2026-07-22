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

  it('uses the flow overview instead of backend subflow data for frontend steps', () => {
    const overviewTemplate = source.slice(
      source.indexOf('<template v-if="showFlowOverviewPanel">'),
      source.indexOf('<template v-else-if="showBackendSubflowPanel">'),
    )
    const subflowTemplate = source.slice(
      source.indexOf('<template v-else-if="showBackendSubflowPanel">'),
    )

    expect(source).toContain("isFrontendProject.value ? 'Frontend Flow' : 'RTL2GDS'")
    expect(source).toContain('await runAllFlow({ rerun: isRerun.value })')
    expect(source).toContain('showOverviewPanel.value ||')
    expect(source).toContain('isFrontendProject.value && showSubflowPanel.value')
    expect(source).toContain('showSubflowPanel.value && !isFrontendProject.value')
    expect(overviewTemplate).toContain('currentStage === stage.path')
    expect(overviewTemplate).toContain('v-if="showOverviewRunControls"')
    expect(subflowTemplate).toContain('v-if="!isFrontendProject"')
  })
})
