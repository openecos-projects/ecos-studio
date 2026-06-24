import { describe, expect, it } from 'vitest'
import source from './DrawingArea.vue?raw'

describe('DrawingArea lifecycle guards', () => {
  it('captures workspace session identity before asynchronous stage loads mutate editor state', () => {
    expect(source).toContain('const { currentProject, resourceVersions, workspaceSession } = useWorkspace()')
    expect(source).toContain('function createDrawingAsyncGuard(')
    expect(source).toMatch(
      /const handleStageChange = async \(stage: string\) => \{[\s\S]*?const guard = createDrawingAsyncGuard\(stage\)[\s\S]*?const layoutResponse = await resolveWorkspaceStepInfoApi\(/,
    )
  })

  it('does not keep late DRC overlay reads in DrawingArea', () => {
    expect(source).not.toContain('drcViolationOverlay')
    expect(source).not.toContain('loadDrcViolationOverlayAfterTiles')
    expect(source).not.toContain('parseDrcStepJson')
  })

  it('prevents stale image preview loads from mutating a newer workspace session', () => {
    expect(source).toMatch(
      /async function loadStepImagePreview\([\s\S]*?guard: DrawingAsyncGuard[\s\S]*?if \(!ed \|\| !guard\.isCurrent\(\)\) return[\s\S]*?await ed\.setBackgroundImage\(imageUrl\)[\s\S]*?if \(!guard\.isCurrent\(\) \|\| editor\.value !== ed\) return/,
    )
    expect(source).not.toContain('loadStepViewJsonOverview')
    expect(source).not.toContain('isViewJsonLoadCancelled')
  })
})
