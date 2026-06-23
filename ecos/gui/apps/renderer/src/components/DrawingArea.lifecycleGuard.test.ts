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

  it('guards late DRC overlay reads against route, workspace, and editor changes', () => {
    expect(source).toContain(
      'guard: DrawingAsyncGuard = createDrawingAsyncGuard(currentStepKey.value)',
    )
    expect(source).toContain('const overlay = drcViolationOverlay')
    expect(source).toContain('if (!guard.isCurrent() || drcViolationOverlay !== overlay) return')
  })

  it('prevents stale view JSON overview loads from mutating a newer workspace session', () => {
    expect(source).toMatch(
      /async function loadStepViewJsonOverview\([\s\S]*?viewJsonPackageRoot: string[\s\S]*?const overview = await loadViewJsonOverview\(viewJsonPackageRoot, \{[\s\S]*?projectPath,[\s\S]*?shouldCancel: \(\) => !guard\.isCurrent\(\),[\s\S]*?workerFactory: createViewJsonOverviewWorker,[\s\S]*?\}\)[\s\S]*?if \(!guard\.isCurrent\(\) \|\| editor\.value !== ed\) \{[\s\S]*?return null[\s\S]*?\}/,
    )
    expect(source).toContain('isViewJsonLoadCancelled')
    expect(source).toMatch(/if \(isViewJsonLoadCancelled\(err\) && !guard\.isCurrent\(\)\) \{[\s\S]*?return null/)
  })
})
