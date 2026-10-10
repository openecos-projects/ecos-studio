import { effectScope, nextTick, reactive, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceResourceIndex, WorkspaceStepResource } from '@ecos-studio/shared'

const state = vi.hoisted(() => ({
  getIndex: vi.fn(),
  readChunk: vi.fn(),
  project: null as any,
  session: null as any,
}))
vi.mock('@/api/workspaceResources', () => ({
  getWorkspaceResourceIndexApi: state.getIndex,
}))
vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({
    workspace: { readOptionalProjectTextFileChunk: state.readChunk },
  }),
}))
vi.mock('./useWorkspace', () => ({
  useWorkspace: () => ({ currentProject: state.project }),
}))
vi.mock('@/stores/backendWorkspaceSession', () => ({
  useBackendWorkspaceSession: () => state.session,
}))

import { stepReportFiles, useStepReportsBrowser } from './useStepReportsBrowser'

function resourceStep(): WorkspaceStepResource {
  return {
    name: 'sta',
    tool: 'ecc',
    state: 'Success',
    runtime: '',
    directory: '/work/demo/sta_ecc',
    info: {},
    resources: {
      output: {},
      data: {},
      feature: {},
      log: {},
      script: {},
      analysis: {},
      subflow: {},
      checklist: {},
      config: {},
      report: {
        first: {
          path: '/work/demo/sta_ecc/report/sta.rpt',
          kind: 'report',
          exists: true,
        },
        corner: {
          timing: {
            path: '/work/demo/sta_ecc/report/slow/timing.rpt',
            kind: 'report',
            exists: true,
          },
        },
        discovered: {
          path: '/work/demo/sta_ecc/report/slow/timing.rpt',
          kind: 'report',
          exists: true,
        },
        log: { path: '/work/demo/sta_ecc/report/log.txt', kind: 'log', exists: true },
        missing: {
          path: '/work/demo/sta_ecc/report/missing.rpt',
          kind: 'report',
          exists: false,
        },
      },
    },
  }
}

function index(): WorkspaceResourceIndex {
  return {
    root: '/work/demo',
    design: 'demo',
    topModule: 'demo',
    pdk: '',
    home: {
      flowJson: { path: '', exists: false, kind: 'flow' },
      parametersJson: { path: '', exists: false, kind: 'parameters' },
      checklistJson: { path: '', exists: false, kind: 'checklist' },
    },
    parameters: null,
    flow: { steps: [resourceStep()] },
    status: 'available',
    messages: [],
  }
}

describe('step report browser', () => {
  beforeEach(() => {
    state.project = ref({ path: '/work/demo' })
    state.session = reactive({
      workspaceContextId: 'context-a',
      generation: 1,
      projection: {
        data: { revision: { status: 'ready', data: { workspaceRevision: 4 } } },
      },
    })
    state.getIndex.mockReset().mockResolvedValue(index())
    state.readChunk.mockReset().mockResolvedValue({
      content: 'Report body',
      eof: true,
      nextOffsetBytes: 11,
      sizeBytes: 11,
    })
  })

  it('lists all existing reports including nested corners and logs, without duplicates', () => {
    expect(
      stepReportFiles(resourceStep(), '/work/demo').map((file) => file.label),
    ).toEqual(['report/log.txt', 'report/slow/timing.rpt', 'report/sta.rpt'])
  })

  it('rejects paths outside the workspace or the selected report directory', () => {
    const step = resourceStep()
    step.resources.report.bad = {
      path: '/work/other/secret.rpt',
      kind: 'report',
      exists: true,
    }
    expect(() => stepReportFiles(step, '/work/demo')).toThrow(
      'outside the step report directory',
    )
    expect(() =>
      stepReportFiles({ ...step, directory: '/work/demo-other/sta_ecc' }, '/work/demo'),
    ).toThrow('outside the workspace')
  })

  it('loads bounded text and exposes truncated previews rather than silently showing a full report', async () => {
    state.readChunk.mockResolvedValue({
      content: 'Preview',
      eof: false,
      nextOffsetBytes: 7,
      sizeBytes: 2000000,
    })
    const scope = effectScope()
    const browser = scope.run(() => useStepReportsBrowser(ref('sta')))!
    await vi.waitFor(() => expect(browser.loading.value).toBe(false))
    expect(browser.content.value).toBe('Preview')
    expect(browser.truncated.value).toBe(true)
    expect(state.readChunk).toHaveBeenCalledWith(
      '/work/demo/sta_ecc/report/log.txt',
      0,
      256 * 1024,
    )
    scope.stop()
  })

  it('clears report text immediately when changing selection and ignores a late response', async () => {
    const scope = effectScope()
    const browser = scope.run(() => useStepReportsBrowser(ref('sta')))!
    await vi.waitFor(() => expect(browser.loading.value).toBe(false))
    let resolveLate!: (value: unknown) => void
    state.readChunk.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLate = resolve
      }),
    )
    const pending = browser.selectReport(browser.files.value[1])
    expect(browser.content.value).toBe('')
    await browser.selectReport(browser.files.value[2])
    resolveLate({ content: 'Old report', eof: true })
    await pending
    expect(browser.content.value).toBe('Report body')
    expect(browser.selectedPath.value).toContain('sta.rpt')
    scope.stop()
  })

  it('discards an old workspace listing and clears state on revision changes', async () => {
    let resolveLate!: (value: unknown) => void
    state.getIndex.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLate = resolve
      }),
    )
    const scope = effectScope()
    const browser = scope.run(() => useStepReportsBrowser(ref('sta')))!
    state.project.value = { path: '/work/other' }
    state.getIndex.mockResolvedValue({
      ...index(),
      root: '/work/other',
      flow: { steps: [] },
    })
    await nextTick()
    await vi.waitFor(() => expect(browser.loading.value).toBe(false))
    resolveLate(index())
    await nextTick()
    expect(browser.files.value).toEqual([])
    expect(state.readChunk).not.toHaveBeenCalled()
    scope.stop()
  })

  it('reports empty directories and unreadable or binary files explicitly', async () => {
    state.readChunk.mockResolvedValue({ content: 'binary\u0000data', eof: true })
    const scope = effectScope()
    const browser = scope.run(() => useStepReportsBrowser(ref('sta')))!
    await vi.waitFor(() => expect(browser.loading.value).toBe(false))
    expect(browser.contentError.value).toContain('not a text file')
    state.readChunk.mockRejectedValue(new Error('Permission denied'))
    await browser.selectReport(browser.files.value[1])
    expect(browser.contentError.value).toBe('Permission denied')
    const empty = resourceStep()
    empty.resources.report = {}
    state.getIndex.mockResolvedValue({ ...index(), flow: { steps: [empty] } })
    await browser.refresh()
    expect(browser.files.value).toEqual([])
    expect(browser.content.value).toBe('')
    scope.stop()
  })

  it('does not publish a read after disposal or a revision replacement', async () => {
    const scope = effectScope()
    const browser = scope.run(() => useStepReportsBrowser(ref('sta')))!
    await vi.waitFor(() => expect(browser.loading.value).toBe(false))
    let resolveLate!: (value: unknown) => void
    state.readChunk.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLate = resolve
      }),
    )
    const pending = browser.selectReport(browser.files.value[1])
    scope.stop()
    resolveLate({ content: 'After close', eof: true })
    await pending
    expect(browser.content.value).toBe('')
  })

  it('rejects a stale read when the workspace revision changes during loading', async () => {
    const scope = effectScope()
    const browser = scope.run(() => useStepReportsBrowser(ref('sta')))!
    await vi.waitFor(() => expect(browser.loading.value).toBe(false))
    let resolveLate!: (value: unknown) => void
    state.readChunk.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLate = resolve
      }),
    )
    const pending = browser.selectReport(browser.files.value[1])
    state.session.projection.data.revision.data.workspaceRevision += 1
    await nextTick()
    await vi.waitFor(() => expect(browser.loading.value).toBe(false))
    resolveLate({ content: 'Previous revision', eof: true })
    await pending
    expect(browser.content.value).toBe('Report body')
    scope.stop()
  })
})
