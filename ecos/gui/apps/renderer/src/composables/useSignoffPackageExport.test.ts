import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, type EffectScope, type Ref } from 'vue'
import type { DesktopApi } from '@ecos-studio/shared'

const testState = vi.hoisted(() => ({
  api: null as DesktopApi | null,
  unmountCallbacks: [] as Array<() => void>,
}))

vi.mock('vue', async () => {
  const actual = await vi.importActual<typeof import('vue')>('vue')
  return {
    ...actual,
    onUnmounted: (callback: () => void) => {
      testState.unmountCallbacks.push(callback)
    },
  }
})

vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => testState.api,
}))

import { useSignoffPackageExport } from './useSignoffPackageExport'

type ProjectRef = Ref<{ path: string } | null>
type WorkspaceSessionRef = Ref<{ state: string; workspaceId: string }>

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, reject, resolve }
}

function readyReview() {
  return {
    groups: [
      {
        available: 3,
        expected: 3,
        id: 'initial' as const,
        label: 'Initial',
        status: 'ready' as const,
        summary: '3 of 3 resources ready',
      },
    ],
    risks: [],
    status: 'ready' as const,
  }
}

function blockedReview() {
  return {
    groups: [
      {
        available: 0,
        expected: 1,
        id: 'harden' as const,
        label: 'Harden',
        status: 'blocked' as const,
        summary: '1 required resource missing',
      },
    ],
    risks: [
      {
        details: [
          {
            kind: 'artifact' as const,
            label: 'Harden GDS',
            location: 'Harden_ecc/output/gcd_Harden.gds',
            reason: 'Required file is missing or empty',
            owner: 'checklist' as const,
            policy: 'block' as const,
            state: 'failed' as const,
            evidence: [
              {
                kind: 'file',
                path: 'Harden_ecc/output/gcd_Harden.gds',
              },
            ],
          },
        ],
        severity: 'blocked' as const,
        summary: '1 required resource missing',
        title: 'Harden resources missing',
      },
    ],
    status: 'blocked' as const,
  }
}

async function openReviewAndConfirm(
  mounted: ReturnType<typeof mountComposable>,
): Promise<void> {
  await mounted.result.exportSignoffPackage()
  await mounted.result.confirmSignoffPackageExport()
}

function createApi() {
  const readFlow = vi.fn().mockResolvedValue({ steps: [] })
  const readParameters = vi.fn().mockResolvedValue({ Design: 'chip_top' })
  const readHome = vi.fn().mockResolvedValue({})
  const getVersions = vi.fn().mockResolvedValue({})
  const writeProjectTextFile = vi.fn().mockResolvedValue(undefined)
  const inspectSignoff = vi.fn().mockResolvedValue(readyReview())
  const saveFile = vi.fn().mockResolvedValue('/exports/chip_top_signoff_package.tar.gz')
  const exportSignoff = vi.fn(async (request: { outputPath: string }) => ({
    outputPath: request.outputPath,
  }))
  testState.api = {
    app: { getVersions },
    workspace: { writeProjectTextFile },
    workspaceResources: { readFlow, readParameters, readHome },
    dialog: { saveFile },
    ecc: { workspace: { exportSignoff, inspectSignoff } },
  } as unknown as DesktopApi

  return {
    exportSignoff,
    getVersions,
    inspectSignoff,
    readFlow,
    readHome,
    readParameters,
    saveFile,
    writeProjectTextFile,
  }
}

function mountComposable(
  currentProject: ProjectRef = ref({ path: '/workspaces/chip' }),
  workspaceSession: WorkspaceSessionRef = ref({
    state: 'active',
    workspaceId: 'workspace-handle-1',
  }),
) {
  const scope = effectScope()
  const showToast = vi.fn()
  const result = scope.run(() =>
    useSignoffPackageExport({
      currentProject,
      showToast,
      workspaceSession,
    }),
  )!
  return {
    currentProject,
    result,
    scope,
    showToast,
    workspaceSession,
  }
}

describe('useSignoffPackageExport export action', () => {
  let scope: EffectScope | undefined

  beforeEach(() => {
    testState.unmountCallbacks = []
  })

  afterEach(() => {
    scope?.stop()
    scope = undefined
  })

  it('warns when export is requested without an active workspace', async () => {
    const api = createApi()
    const mounted = mountComposable(ref(null))
    scope = mounted.scope

    await mounted.result.exportSignoffPackage()

    expect(api.readFlow).not.toHaveBeenCalled()
    expect(api.saveFile).not.toHaveBeenCalled()
    expect(api.exportSignoff).not.toHaveBeenCalled()
    expect(mounted.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'warn',
        detail: expect.stringContaining('Open an eligible workspace'),
      }),
    )
  })

  it('opens review before Save As and exports after a ready review is confirmed', async () => {
    const api = createApi()
    const mounted = mountComposable()
    scope = mounted.scope

    await mounted.result.exportSignoffPackage()

    expect(api.inspectSignoff).toHaveBeenCalledWith({
      workspaceHandle: 'workspace-handle-1',
    })
    expect(mounted.result.signoffPackageReview.value).toMatchObject({
      result: readyReview(),
      visible: true,
    })
    expect(api.saveFile).not.toHaveBeenCalled()

    await mounted.result.confirmSignoffPackageExport()

    expect(api.saveFile).toHaveBeenCalledTimes(1)
    expect(api.exportSignoff).toHaveBeenCalledTimes(1)
  })

  it('keeps Save As closed when the review is blocked', async () => {
    const api = createApi()
    api.inspectSignoff.mockResolvedValueOnce(blockedReview())
    const mounted = mountComposable()
    scope = mounted.scope

    await mounted.result.exportSignoffPackage()

    expect(mounted.result.canConfirmSignoffPackageExport.value).toBe(false)
    await mounted.result.confirmSignoffPackageExport()
    expect(api.saveFile).not.toHaveBeenCalled()
  })

  it('keeps the review open after an inspection error and allows a refresh', async () => {
    const api = createApi()
    api.inspectSignoff
      .mockRejectedValueOnce(new Error('inspection service unavailable'))
      .mockResolvedValueOnce(readyReview())
    const mounted = mountComposable()
    scope = mounted.scope

    await mounted.result.exportSignoffPackage()

    expect(mounted.result.signoffPackageReview.value).toMatchObject({
      error: 'inspection service unavailable',
      result: null,
      visible: true,
    })
    expect(mounted.result.canConfirmSignoffPackageExport.value).toBe(false)
    await mounted.result.confirmSignoffPackageExport()
    expect(api.saveFile).not.toHaveBeenCalled()
    expect(mounted.showToast).not.toHaveBeenCalled()

    await mounted.result.refreshSignoffPackageReview()

    expect(mounted.result.signoffPackageReview.value).toMatchObject({
      error: '',
      result: readyReview(),
      visible: true,
    })
    expect(mounted.result.canConfirmSignoffPackageExport.value).toBe(true)
    expect(api.inspectSignoff).toHaveBeenCalledTimes(2)
  })

  it('closes the review and ignores a stale inspection after switching workspaces', async () => {
    const api = createApi()
    const inspection = deferred<ReturnType<typeof readyReview>>()
    api.inspectSignoff.mockImplementationOnce(() => inspection.promise)
    const mounted = mountComposable(ref({ path: '/workspaces/a' }))
    scope = mounted.scope

    const exportPromise = mounted.result.exportSignoffPackage()
    await vi.waitFor(() => expect(api.inspectSignoff).toHaveBeenCalledTimes(1))
    mounted.currentProject.value = { path: '/workspaces/b' }
    await nextTick()
    inspection.resolve(readyReview())
    await exportPromise

    expect(mounted.result.signoffPackageReview.value.visible).toBe(false)
    expect(api.saveFile).not.toHaveBeenCalled()
    expect(api.exportSignoff).not.toHaveBeenCalled()
  })

  it('opens review without requiring a successful Harden step', async () => {
    const api = createApi()
    api.readFlow.mockResolvedValueOnce({ steps: [{ name: 'Harden', state: 'Running' }] })
    const mounted = mountComposable()
    scope = mounted.scope

    await mounted.result.exportSignoffPackage()

    expect(api.inspectSignoff).toHaveBeenCalledTimes(1)
    expect(api.readFlow).not.toHaveBeenCalled()
    expect(api.saveFile).not.toHaveBeenCalled()
  })

  it('does nothing after the save dialog is cancelled', async () => {
    const api = createApi()
    api.saveFile.mockResolvedValueOnce(null)
    const mounted = mountComposable()
    scope = mounted.scope

    await openReviewAndConfirm(mounted)

    expect(api.exportSignoff).not.toHaveBeenCalled()
    expect(mounted.showToast).not.toHaveBeenCalled()
  })

  it('opens Save As in the workspace project signoff directory using Design for the filename', async () => {
    const api = createApi()
    api.readParameters.mockResolvedValueOnce({ Design: 'rocket_core' })
    api.saveFile.mockResolvedValueOnce('/tmp/rocket package.tar.gz')
    const mounted = mountComposable(ref({ path: '/workspaces/active path' }))
    scope = mounted.scope

    await openReviewAndConfirm(mounted)

    expect(api.saveFile).toHaveBeenCalledWith({
      title: 'Export Signoff Package',
      defaultPath: '/workspaces/signoff/rocket_core_signoff_package.tar.gz',
      ensureDirectory: true,
      filters: [{ name: 'Signoff Package', extensions: ['tar.gz'] }],
    })
    expect(api.exportSignoff).toHaveBeenCalledWith({
      additionalFiles: expect.arrayContaining([
        expect.objectContaining({
          archivePath: 'design_summaries/rocket_core_design_summary.tex',
          content: expect.stringContaining('\\begin{table}'),
        }),
        expect.objectContaining({
          archivePath: 'design_summaries/rocket_core_design_summary.md',
          content: expect.stringContaining('# Design Summary Report: rocket_core'),
        }),
        expect.objectContaining({
          archivePath: 'design_summaries/rocket_core_design_summary.typ',
          content: expect.stringContaining('#figure('),
        }),
        expect.objectContaining({
          archivePath: 'design_summaries/rocket_core_design_summary.csv',
          content: expect.stringContaining('Category,Metric,Value'),
        }),
        expect.objectContaining({
          archivePath: 'design_summaries/rocket_core_design_summary.txt',
          content: expect.stringContaining('ECOS STUDIO — DESIGN SUMMARY'),
        }),
      ]),
      outputPath: '/tmp/rocket package.tar.gz',
      workspaceHandle: 'workspace-handle-1',
    })
    expect(
      (api.exportSignoff.mock.calls[0]![0] as Record<string, unknown>).additionalFiles,
    ).toHaveLength(5)
    expect(api.writeProjectTextFile).not.toHaveBeenCalled()
    expect(mounted.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'success',
        detail: expect.stringContaining('/tmp/rocket package.tar.gz'),
      }),
    )
  })

  it('falls back to the workspace leaf for the default name', async () => {
    const api = createApi()
    api.readParameters.mockResolvedValueOnce({ Design: '   ' })
    const mounted = mountComposable(ref({ path: 'C:\\projects\\fallback_chip\\' }))
    scope = mounted.scope

    await openReviewAndConfirm(mounted)

    expect(api.saveFile).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: 'C:\\projects\\signoff\\fallback_chip_signoff_package.tar.gz',
        ensureDirectory: true,
      }),
    )
  })

  it('shows ECC RPC failure details', async () => {
    const api = createApi()
    api.exportSignoff.mockRejectedValueOnce(new Error('archive failed\ndisk full'))
    const mounted = mountComposable()
    scope = mounted.scope

    await openReviewAndConfirm(mounted)

    expect(mounted.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        detail: expect.stringContaining('archive failed'),
      }),
    )
    expect(mounted.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ detail: expect.stringContaining('disk full') }),
    )
  })

  it('uses fallback details when the ECC RPC failure has no message', async () => {
    const api = createApi()
    api.exportSignoff.mockRejectedValueOnce(new Error(''))
    const mounted = mountComposable()
    scope = mounted.scope

    await openReviewAndConfirm(mounted)

    expect(mounted.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        detail: 'Export failed.',
      }),
    )
  })

  it('converts a non-Error rejection into useful error details', async () => {
    const api = createApi()
    api.saveFile.mockRejectedValueOnce('dialog bridge unavailable')
    const mounted = mountComposable()
    scope = mounted.scope

    await openReviewAndConfirm(mounted)

    expect(mounted.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        detail: 'dialog bridge unavailable',
      }),
    )
  })

  it.each([
    ['parameters read', 'readParameters'],
    ['save dialog', 'saveFile'],
    ['ECC RPC execution', 'exportSignoff'],
  ] as const)('shows an error toast when %s throws', async (_label, method) => {
    const api = createApi()
    const mounted = mountComposable()
    scope = mounted.scope
    api[method].mockRejectedValueOnce(new Error(`${method} exploded`))

    await mounted.result.exportSignoffPackage()
    await mounted.result.confirmSignoffPackageExport()

    expect(mounted.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        detail: expect.stringContaining(`${method} exploded`),
      }),
    )
  })

  it('does not open the dialog when the workspace switches during parameter loading', async () => {
    const api = createApi()
    const parametersRead = deferred<Record<string, unknown> | null>()
    api.readParameters.mockImplementationOnce(() => parametersRead.promise)
    const mounted = mountComposable(ref({ path: '/workspaces/a' }))
    scope = mounted.scope

    await mounted.result.exportSignoffPackage()
    const exportPromise = mounted.result.confirmSignoffPackageExport()
    await vi.waitFor(() => expect(api.readParameters).toHaveBeenCalledTimes(1))
    mounted.currentProject.value = { path: '/workspaces/b' }
    parametersRead.resolve({ Design: 'workspace_a' })
    await exportPromise

    expect(api.saveFile).not.toHaveBeenCalled()
    expect(api.exportSignoff).not.toHaveBeenCalled()
  })

  it('suppresses a rejected parameter read after the workspace switches', async () => {
    const api = createApi()
    const parametersRead = deferred<Record<string, unknown> | null>()
    api.readParameters.mockImplementationOnce(() => parametersRead.promise)
    const mounted = mountComposable(ref({ path: '/workspaces/a' }))
    scope = mounted.scope

    await mounted.result.exportSignoffPackage()
    const exportPromise = mounted.result.confirmSignoffPackageExport()
    await vi.waitFor(() => expect(api.readParameters).toHaveBeenCalledTimes(1))
    mounted.currentProject.value = { path: '/workspaces/b' }
    parametersRead.reject(new Error('stale workspace read failed'))
    await exportPromise

    expect(mounted.showToast).not.toHaveBeenCalled()
    expect(api.saveFile).not.toHaveBeenCalled()
    expect(api.exportSignoff).not.toHaveBeenCalled()
  })

  it('does not execute when the workspace switches while the dialog is open', async () => {
    const api = createApi()
    const dialogResult = deferred<string | null>()
    api.saveFile.mockImplementationOnce(() => dialogResult.promise)
    const mounted = mountComposable(ref({ path: '/workspaces/a' }))
    scope = mounted.scope

    await mounted.result.exportSignoffPackage()
    const exportPromise = mounted.result.confirmSignoffPackageExport()
    await vi.waitFor(() => expect(api.saveFile).toHaveBeenCalledTimes(1))
    mounted.currentProject.value = { path: '/workspaces/b' }
    dialogResult.resolve('/tmp/a.tar.gz')
    await exportPromise

    expect(api.exportSignoff).not.toHaveBeenCalled()
  })

  it('suppresses a successful RPC result after the workspace switches', async () => {
    const api = createApi()
    const rpcResult = deferred<{ outputPath: string }>()
    api.exportSignoff.mockImplementationOnce(() => rpcResult.promise)
    const mounted = mountComposable(ref({ path: '/workspaces/a' }))
    scope = mounted.scope

    await mounted.result.exportSignoffPackage()
    const exportPromise = mounted.result.confirmSignoffPackageExport()
    await vi.waitFor(() => expect(api.exportSignoff).toHaveBeenCalledTimes(1))
    mounted.currentProject.value = { path: '/workspaces/b' }
    rpcResult.resolve({ outputPath: '/tmp/a.tar.gz' })
    await exportPromise

    expect(mounted.showToast).not.toHaveBeenCalled()
  })

  it('suppresses a rejected RPC result after the workspace switches', async () => {
    const api = createApi()
    const rpcResult = deferred<{ outputPath: string }>()
    api.exportSignoff.mockImplementationOnce(() => rpcResult.promise)
    const mounted = mountComposable(ref({ path: '/workspaces/a' }))
    scope = mounted.scope

    await mounted.result.exportSignoffPackage()
    const exportPromise = mounted.result.confirmSignoffPackageExport()
    await vi.waitFor(() => expect(api.exportSignoff).toHaveBeenCalledTimes(1))
    mounted.workspaceSession.value = {
      state: 'active',
      workspaceId: 'workspace-handle-2',
    }
    rpcResult.reject(new Error('stale export failed'))
    await exportPromise

    expect(mounted.showToast).not.toHaveBeenCalled()
  })

  it('propagates archive append failure and shows error toast when exportSignoff rejects with additionalFiles', async () => {
    const api = createApi()
    api.exportSignoff.mockRejectedValueOnce(
      new Error('Failed to append files to archive: permission denied'),
    )
    const mounted = mountComposable()
    scope = mounted.scope

    await openReviewAndConfirm(mounted)

    expect(api.exportSignoff).toHaveBeenCalledWith(
      expect.objectContaining({
        additionalFiles: expect.any(Array),
      }),
    )
    expect(mounted.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        summary: 'Failed to Export Signoff Package',
        detail: expect.stringContaining(
          'Failed to append files to archive: permission denied',
        ),
      }),
    )
  })
})
