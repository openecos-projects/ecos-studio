import { effectScope, nextTick, reactive, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({
  getArtifact: vi.fn(),
  session: null as Record<string, any> | null,
}))

vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({ backendWorkspace: { getArtifact: testState.getArtifact } }),
}))
vi.mock('@/stores/backendWorkspaceSession', () => ({
  useBackendWorkspaceSession: () => testState.session,
}))

import { useStepReportDialog } from './useStepReportDialog'

const report = {
  artifactId: 'report-place',
  directory: '',
  id: 'report-place',
  label: 'Place.rpt',
  relativePath: 'Place.rpt',
  sizeBytes: 12,
  modifiedAt: null,
}

describe('useStepReportDialog', () => {
  beforeEach(() => {
    testState.getArtifact.mockReset()
    testState.session = reactive({
      workspaceContextId: 'context-a',
      projection: {
        data: {
          revision: {
            status: 'ready',
            data: { workspaceId: 'engineering-a', workspaceRevision: 9 },
          },
        },
      },
    })
  })

  it('loads report text from the revision-bound Artifact query', async () => {
    testState.getArtifact.mockResolvedValue({
      workspaceContextId: 'context-a',
      workspaceRevision: 9,
      artifact: { status: 'ready', data: { text: 'report body' } },
    })
    const scope = effectScope()
    const dialog = scope.run(() => useStepReportDialog(ref('Place'), ref('Place')))!

    await dialog.openReport(report)

    expect(dialog.reportDialog.value).toMatchObject({
      content: 'report body',
      loading: false,
      visible: true,
    })
    scope.stop()
  })

  it('discards a late report response after the loaded Step changes', async () => {
    let resolve!: (value: unknown) => void
    testState.getArtifact.mockReturnValue(new Promise((done) => (resolve = done)))
    const currentStep = ref('Place')
    const loadedStep = ref<string | undefined>('Place')
    const scope = effectScope()
    const dialog = scope.run(() => useStepReportDialog(currentStep, loadedStep))!
    const pending = dialog.openReport(report)

    currentStep.value = 'CTS'
    loadedStep.value = 'CTS'
    await nextTick()
    resolve({
      workspaceContextId: 'context-a',
      workspaceRevision: 9,
      artifact: { status: 'ready', data: { text: 'stale report' } },
    })
    await pending

    expect(dialog.reportDialog.value.visible).toBe(false)
    expect(dialog.reportDialog.value.content).toBe('')
    scope.stop()
  })
})
