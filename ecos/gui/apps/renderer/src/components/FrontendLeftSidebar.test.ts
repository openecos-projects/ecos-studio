import { describe, expect, it } from 'vitest'
import source from './FrontendLeftSidebar.vue?raw'

describe('FrontendLeftSidebar', () => {
  it('preserves frontend-only Home, Src, and Wave navigation', () => {
    expect(source).toContain("stage.path === 'home' ? { ...stage, label: 'Home' }")
    expect(source).toContain("virtualStage('Src', 'src'")
    expect(source).toContain("virtualStage('Wave', 'wave'")
    expect(source).toContain("stage.path !== 'configure' && stage.path !== 'tech'")
  })

  it('preserves project-management query parameters in workspace links', () => {
    expect(source).toContain('workspaceStageLink(stage.path)')
    expect(source).toContain('query: route.query')
  })

  it('keeps the frontend overview while giving source and wave the full width', () => {
    expect(source).toContain('Frontend Workspace')
    expect(source).toContain('Frontend Verification Flow')
    expect(source).toContain("['src', 'wave'].includes")
    expect(source).toContain('v-if="showWorkspaceProgressPanel"')
    expect(source).toContain('w-[240px]')
  })

  it('runs frontend full flow without the backend workspace rebuild control', () => {
    expect(source).toContain("computed(() => 'Frontend Flow')")
    expect(source).toContain('setFirstRunStepOngoing({ resetAll: isRerun.value })')
    expect(source).toContain('await runAllFlow({ rerun: isRerun.value })')
    expect(source).not.toContain('FlowRunControl')
    expect(source).not.toContain('rerunHomeWorkspace')
  })
})
