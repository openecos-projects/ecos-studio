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

  it('prevents stale view JSON package loads from mutating a newer workspace session', () => {
    expect(source).toMatch(
      /async function loadStepViewJsonOverview\([\s\S]*?viewJsonPackageRoot: string[\s\S]*?const pkg = await loadViewJsonPackageData\(viewJsonPackageRoot, \{[\s\S]*?projectPath,[\s\S]*?workerFactory: createViewJsonPackageDataWorker,[\s\S]*?deferRoutingDetail: true,[\s\S]*?shouldCancel: \(\) => !guard\.isCurrent\(\),[\s\S]*?\}\)[\s\S]*?if \(!guard\.isCurrent\(\) \|\| editor\.value !== ed\) \{[\s\S]*?return null[\s\S]*?\}/,
    )
    expect(source).toContain('isViewJsonLoadCancelled')
    expect(source).toMatch(/if \(isViewJsonLoadCancelled\(err\) && !guard\.isCurrent\(\)\) \{[\s\S]*?return null/)
  })

  it('releases layout renderer state when the component is unmounted', () => {
    expect(source).toMatch(
      /onUnmounted\(\(\) => \{[\s\S]*?cleanupLayout\(\)[\s\S]*?\}\)/,
    )
  })

  it('drops cached view JSON package data when switching back to image preview', () => {
    expect(source).toMatch(
      /if \(mode === 'image'\) \{[\s\S]*?releaseCurrentViewJsonPackageCache\(\)[\s\S]*?await loadStepImagePreview\(imagePath, guard\)/,
    )
  })
})
