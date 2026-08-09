import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, type EffectScope, type Ref } from 'vue'
import { appMenuActionIds, type DesktopApi } from '@ecos-studio/shared'

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

import {
  canExportSignoffPackage,
  useSignoffPackageExport,
} from './useSignoffPackageExport'

type ProjectRef = Ref<{ path: string } | null>
type VersionsRef = Ref<{ flow: number; all: number }>
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

function successfulFlow() {
  return {
    steps: [
      { name: 'Synthesis', state: 'Success' },
      { name: ' Harden ', state: 'Success' },
    ],
  }
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
  const setActionEnabled = vi.fn().mockResolvedValue(undefined)
  const readFlow = vi.fn().mockResolvedValue(successfulFlow())
  const readParameters = vi.fn().mockResolvedValue({ Design: 'chip_top' })
  const inspectSignoff = vi.fn().mockResolvedValue(readyReview())
  const saveFile = vi.fn().mockResolvedValue('/exports/chip_top_signoff_package.tar.gz')
  const exportSignoff = vi.fn(async (request: { outputPath: string }) => ({
    outputPath: request.outputPath,
  }))
  testState.api = {
    menu: { setActionEnabled },
    workspaceResources: { readFlow, readParameters },
    dialog: { saveFile },
    ecc: { workspace: { exportSignoff, inspectSignoff } },
  } as unknown as DesktopApi

  return {
    exportSignoff,
    inspectSignoff,
    readFlow,
    readParameters,
    saveFile,
    setActionEnabled,
  }
}

function mountComposable(
  currentProject: ProjectRef = ref({ path: '/workspaces/chip' }),
  resourceVersions: VersionsRef = ref({ flow: 0, all: 0 }),
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
      resourceVersions,
      showToast,
      workspaceSession,
    }),
  )!
  return {
    currentProject,
    resourceVersions,
    result,
    scope,
    showToast,
    workspaceSession,
  }
}

describe('canExportSignoffPackage', () => {
  it.each([
    ['null flow', null],
    ['array flow', []],
    ['missing steps', {}],
    ['non-array steps', { steps: {} }],
    ['empty steps', { steps: [] }],
    ['malformed final step', { steps: [null] }],
    ['non-Harden final step', { steps: [{ name: 'Route', state: 'Success' }] }],
    ['case-mismatched state', { steps: [{ name: 'Harden', state: 'success' }] }],
    ['whitespace-padded state', { steps: [{ name: 'Harden', state: ' Success ' }] }],
    ['failed Harden', { steps: [{ name: 'Harden', state: 'Failed' }] }],
  ])('rejects %s', (_label, flow) => {
    expect(canExportSignoffPackage(flow)).toBe(false)
  })

  it.each(['Harden', ' harden ', 'HARDEN'])(
    'accepts final %s with exact Success',
    (name) => {
      expect(
        canExportSignoffPackage({
          steps: [
            { name: 'Synthesis', state: 'Incomplete' },
            { name, state: 'Success' },
          ],
        }),
      ).toBe(true)
    },
  )
})

describe('useSignoffPackageExport menu eligibility', () => {
  let scope: EffectScope | undefined

  beforeEach(() => {
    testState.unmountCallbacks = []
  })

  afterEach(() => {
    scope?.stop()
    scope = undefined
  })

  it('immediately enables export for an eligible active workspace', async () => {
    const api = createApi()
    const mounted = mountComposable()
    scope = mounted.scope

    await vi.waitFor(() => {
      expect(api.setActionEnabled).toHaveBeenLastCalledWith(
        appMenuActionIds.exportSignoffPackage,
        true,
      )
    })
    expect(mounted.result.signoffPackageExportEnabled.value).toBe(true)
  })

  it('refreshes eligibility from the runtime-driven resource version', async () => {
    const api = createApi()
    api.readFlow
      .mockResolvedValueOnce({ steps: [{ name: 'Harden', state: 'Running' }] })
      .mockResolvedValueOnce(successfulFlow())
    const mounted = mountComposable()
    scope = mounted.scope

    await vi.waitFor(() => expect(api.readFlow).toHaveBeenCalledTimes(1))
    mounted.resourceVersions.value.flow += 1
    await nextTick()

    await vi.waitFor(() => {
      expect(api.setActionEnabled).toHaveBeenLastCalledWith(
        appMenuActionIds.exportSignoffPackage,
        true,
      )
    })
    expect(mounted.showToast).not.toHaveBeenCalled()
  })

  it('disables export without reading when no workspace is active', async () => {
    const api = createApi()
    const mounted = mountComposable(ref(null))
    scope = mounted.scope

    await vi.waitFor(() => {
      expect(api.setActionEnabled).toHaveBeenLastCalledWith(
        appMenuActionIds.exportSignoffPackage,
        false,
      )
    })
    expect(api.readFlow).not.toHaveBeenCalled()
    expect(mounted.result.signoffPackageExportEnabled.value).toBe(false)
  })

  it('resynchronizes when flow and all resource versions change', async () => {
    const api = createApi()
    api.readFlow
      .mockResolvedValueOnce(successfulFlow())
      .mockResolvedValueOnce({ steps: [{ name: 'Harden', state: 'Running' }] })
      .mockResolvedValueOnce(successfulFlow())
    const mounted = mountComposable()
    scope = mounted.scope

    await vi.waitFor(() => expect(api.readFlow).toHaveBeenCalledTimes(1))
    mounted.resourceVersions.value.flow += 1
    await nextTick()
    await vi.waitFor(() => {
      expect(api.setActionEnabled).toHaveBeenLastCalledWith(
        appMenuActionIds.exportSignoffPackage,
        false,
      )
    })

    mounted.resourceVersions.value.all += 1
    await nextTick()
    await vi.waitFor(() => {
      expect(api.setActionEnabled).toHaveBeenLastCalledWith(
        appMenuActionIds.exportSignoffPackage,
        true,
      )
    })
  })

  it('keeps export disabled when reading the flow fails', async () => {
    const api = createApi()
    api.readFlow.mockRejectedValue(new Error('flow unavailable'))
    const mounted = mountComposable()
    scope = mounted.scope

    await vi.waitFor(() => expect(api.readFlow).toHaveBeenCalledTimes(1))
    expect(api.setActionEnabled).not.toHaveBeenCalledWith(
      appMenuActionIds.exportSignoffPackage,
      true,
    )
  })

  it('ignores a stale eligible read after switching workspaces', async () => {
    const api = createApi()
    const firstRead = deferred<Record<string, unknown> | null>()
    api.readFlow
      .mockImplementationOnce(() => firstRead.promise)
      .mockResolvedValueOnce({ steps: [{ name: 'Harden', state: 'Running' }] })
    const mounted = mountComposable(ref({ path: '/workspaces/a' }))
    scope = mounted.scope

    await vi.waitFor(() => expect(api.readFlow).toHaveBeenCalledTimes(1))
    mounted.currentProject.value = { path: '/workspaces/b' }
    await nextTick()
    await vi.waitFor(() => expect(api.readFlow).toHaveBeenCalledTimes(2))
    firstRead.resolve(successfulFlow())
    await firstRead.promise
    await nextTick()

    expect(api.setActionEnabled).not.toHaveBeenCalledWith(
      appMenuActionIds.exportSignoffPackage,
      true,
    )
  })

  it('disables export on unmount', async () => {
    const api = createApi()
    const mounted = mountComposable()
    scope = mounted.scope
    await vi.waitFor(() => {
      expect(api.setActionEnabled).toHaveBeenLastCalledWith(
        appMenuActionIds.exportSignoffPackage,
        true,
      )
    })
    testState.unmountCallbacks.forEach((callback) => callback())

    await vi.waitFor(() => {
      expect(api.setActionEnabled).toHaveBeenLastCalledWith(
        appMenuActionIds.exportSignoffPackage,
        false,
      )
    })
  })

  it('handles a rejected native menu disable without an unhandled rejection', async () => {
    const api = createApi()
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    api.setActionEnabled.mockRejectedValueOnce(new Error('menu unavailable'))
    const mounted = mountComposable(ref(null))
    scope = mounted.scope

    await vi.waitFor(() => {
      expect(consoleWarn).toHaveBeenCalledWith(
        '[signoff-export] Failed to update native menu state:',
        expect.objectContaining({ message: 'menu unavailable' }),
      )
    })

    expect(api.setActionEnabled).toHaveBeenCalledWith(
      appMenuActionIds.exportSignoffPackage,
      false,
    )
    expect(api.readFlow).not.toHaveBeenCalled()
    consoleWarn.mockRestore()
  })
})

describe('useSignoffPackageExport export action', () => {
  let scope: EffectScope | undefined

  beforeEach(() => {
    testState.unmountCallbacks = []
  })

  afterEach(() => {
    scope?.stop()
    scope = undefined
  })

  it('warns and stays disabled when export is requested without an active workspace', async () => {
    const api = createApi()
    const mounted = mountComposable(ref(null))
    scope = mounted.scope
    await vi.waitFor(() => expect(api.setActionEnabled).toHaveBeenCalledTimes(1))

    await mounted.result.exportSignoffPackage()

    expect(api.setActionEnabled).toHaveBeenLastCalledWith(
      appMenuActionIds.exportSignoffPackage,
      false,
    )
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
    await vi.waitFor(() => expect(api.readFlow).toHaveBeenCalledTimes(1))

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
    await vi.waitFor(() => expect(api.readFlow).toHaveBeenCalledTimes(1))

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
    await vi.waitFor(() => expect(api.readFlow).toHaveBeenCalledTimes(1))

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
    await vi.waitFor(() => expect(api.readFlow).toHaveBeenCalledTimes(1))

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

  it('rejects a stale ineligible flow without opening the save dialog', async () => {
    const api = createApi()
    const mounted = mountComposable()
    scope = mounted.scope
    await vi.waitFor(() => expect(api.readFlow).toHaveBeenCalledTimes(1))
    api.readFlow.mockResolvedValueOnce({ steps: [{ name: 'Harden', state: 'Running' }] })

    await openReviewAndConfirm(mounted)

    expect(api.saveFile).not.toHaveBeenCalled()
    expect(api.setActionEnabled).toHaveBeenLastCalledWith(
      appMenuActionIds.exportSignoffPackage,
      false,
    )
    expect(mounted.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'warn' }),
    )
  })

  it('does nothing after the save dialog is cancelled', async () => {
    const api = createApi()
    api.saveFile.mockResolvedValueOnce(null)
    const mounted = mountComposable()
    scope = mounted.scope
    await vi.waitFor(() => expect(api.readFlow).toHaveBeenCalledTimes(1))

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
    await vi.waitFor(() => expect(api.readFlow).toHaveBeenCalledTimes(1))

    await openReviewAndConfirm(mounted)

    expect(api.saveFile).toHaveBeenCalledWith({
      title: 'Export Signoff Package',
      defaultPath: '/workspaces/signoff/rocket_core_signoff_package.tar.gz',
      ensureDirectory: true,
      filters: [{ name: 'Signoff Package', extensions: ['tar.gz'] }],
    })
    expect(api.exportSignoff).toHaveBeenCalledWith({
      outputPath: '/tmp/rocket package.tar.gz',
      workspaceHandle: 'workspace-handle-1',
    })
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
    await vi.waitFor(() => expect(api.readFlow).toHaveBeenCalledTimes(1))

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
    await vi.waitFor(() => expect(api.readFlow).toHaveBeenCalledTimes(1))

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
    await vi.waitFor(() => expect(api.readFlow).toHaveBeenCalledTimes(1))

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
    await vi.waitFor(() => expect(api.readFlow).toHaveBeenCalledTimes(1))

    await openReviewAndConfirm(mounted)

    expect(mounted.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        detail: 'dialog bridge unavailable',
      }),
    )
  })

  it.each([
    ['flow read', 'readFlow'],
    ['parameters read', 'readParameters'],
    ['save dialog', 'saveFile'],
    ['ECC RPC execution', 'exportSignoff'],
  ] as const)('shows an error toast when %s throws', async (_label, method) => {
    const api = createApi()
    const mounted = mountComposable()
    scope = mounted.scope
    await vi.waitFor(() => {
      expect(api.setActionEnabled).toHaveBeenLastCalledWith(
        appMenuActionIds.exportSignoffPackage,
        true,
      )
    })
    api[method].mockRejectedValueOnce(new Error(`${method} exploded`))

    await mounted.result.exportSignoffPackage()
    if (method !== 'readFlow') {
      await mounted.result.confirmSignoffPackageExport()
    }

    expect(mounted.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        detail: expect.stringContaining(`${method} exploded`),
      }),
    )
    if (method === 'readFlow') {
      expect(api.setActionEnabled).toHaveBeenLastCalledWith(
        appMenuActionIds.exportSignoffPackage,
        false,
      )
    }
  })

  it('does not open the dialog when the workspace switches during flow validation', async () => {
    const api = createApi()
    const exportRead = deferred<Record<string, unknown> | null>()
    const mounted = mountComposable(ref({ path: '/workspaces/a' }))
    scope = mounted.scope
    await vi.waitFor(() => expect(api.readFlow).toHaveBeenCalledTimes(1))
    api.readFlow.mockImplementationOnce(() => exportRead.promise)

    const exportPromise = mounted.result.exportSignoffPackage()
    mounted.currentProject.value = { path: '/workspaces/b' }
    exportRead.resolve(successfulFlow())
    await exportPromise

    expect(api.saveFile).not.toHaveBeenCalled()
    expect(api.exportSignoff).not.toHaveBeenCalled()
  })

  it('does not open the dialog when the workspace switches during parameter loading', async () => {
    const api = createApi()
    const parametersRead = deferred<Record<string, unknown> | null>()
    api.readParameters.mockImplementationOnce(() => parametersRead.promise)
    const mounted = mountComposable(ref({ path: '/workspaces/a' }))
    scope = mounted.scope
    await vi.waitFor(() => expect(api.readFlow).toHaveBeenCalledTimes(1))

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
    await vi.waitFor(() => expect(api.readFlow).toHaveBeenCalledTimes(1))

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
    await vi.waitFor(() => expect(api.readFlow).toHaveBeenCalledTimes(1))

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
    await vi.waitFor(() => expect(api.readFlow).toHaveBeenCalledTimes(1))

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
    await vi.waitFor(() => expect(api.readFlow).toHaveBeenCalledTimes(1))

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
})
