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

function cliResult(ok: boolean, message: string[] = []) {
  return {
    ok,
    cmd: 'export_signoff_package' as const,
    response: ok ? ('success' as const) : ('failed' as const),
    data: {},
    message,
  }
}

function createApi() {
  const setActionEnabled = vi.fn().mockResolvedValue(undefined)
  const readFlow = vi.fn().mockResolvedValue(successfulFlow())
  const readParameters = vi.fn().mockResolvedValue({ Design: 'chip_top' })
  const saveFile = vi.fn().mockResolvedValue('/exports/chip_top_signoff_package.tar.gz')
  const execute = vi.fn().mockResolvedValue(cliResult(true, ['exported']))

  testState.api = {
    menu: { setActionEnabled },
    workspaceResources: { readFlow, readParameters },
    dialog: { saveFile },
    cli: { execute },
  } as unknown as DesktopApi

  return { execute, readFlow, readParameters, saveFile, setActionEnabled }
}

function mountComposable(
  currentProject: ProjectRef = ref({ path: '/workspaces/chip' }),
  resourceVersions: VersionsRef = ref({ flow: 0, all: 0 }),
) {
  const scope = effectScope()
  const showToast = vi.fn()
  const result = scope.run(() =>
    useSignoffPackageExport({ currentProject, resourceVersions, showToast }),
  )!
  return { currentProject, resourceVersions, result, scope, showToast }
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

  it('rejects a stale ineligible flow without opening the save dialog', async () => {
    const api = createApi()
    const mounted = mountComposable()
    scope = mounted.scope
    await vi.waitFor(() => expect(api.readFlow).toHaveBeenCalledTimes(1))
    api.readFlow.mockResolvedValueOnce({ steps: [{ name: 'Harden', state: 'Running' }] })

    await mounted.result.exportSignoffPackage()

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

    await mounted.result.exportSignoffPackage()

    expect(api.execute).not.toHaveBeenCalled()
    expect(mounted.showToast).not.toHaveBeenCalled()
  })

  it('uses Design for the default name and sends the exact selected paths to the CLI', async () => {
    const api = createApi()
    api.readParameters.mockResolvedValueOnce({ Design: 'rocket_core' })
    api.saveFile.mockResolvedValueOnce('/tmp/rocket package.tar.gz')
    const mounted = mountComposable(ref({ path: '/workspaces/active path' }))
    scope = mounted.scope
    await vi.waitFor(() => expect(api.readFlow).toHaveBeenCalledTimes(1))

    await mounted.result.exportSignoffPackage()

    expect(api.saveFile).toHaveBeenCalledWith({
      title: 'Export Signoff Package',
      defaultPath: 'rocket_core_signoff_package.tar.gz',
      filters: [{ name: 'Signoff Package', extensions: ['tar.gz'] }],
    })
    expect(api.execute).toHaveBeenCalledWith({
      cmd: 'export_signoff_package',
      data: {
        directory: '/workspaces/active path',
        output_path: '/tmp/rocket package.tar.gz',
      },
      source: 'menu',
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

    await mounted.result.exportSignoffPackage()

    expect(api.saveFile).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: 'fallback_chip_signoff_package.tar.gz' }),
    )
  })

  it('shows CLI failure details', async () => {
    const api = createApi()
    api.execute.mockResolvedValueOnce(cliResult(false, ['archive failed', 'disk full']))
    const mounted = mountComposable()
    scope = mounted.scope
    await vi.waitFor(() => expect(api.readFlow).toHaveBeenCalledTimes(1))

    await mounted.result.exportSignoffPackage()

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

  it.each([
    ['flow read', 'readFlow'],
    ['parameters read', 'readParameters'],
    ['save dialog', 'saveFile'],
    ['CLI execution', 'execute'],
  ] as const)('shows an error toast when %s throws', async (_label, method) => {
    const api = createApi()
    const mounted = mountComposable()
    scope = mounted.scope
    await vi.waitFor(() => expect(api.readFlow).toHaveBeenCalledTimes(1))
    api[method].mockRejectedValueOnce(new Error(`${method} exploded`))

    await mounted.result.exportSignoffPackage()

    expect(mounted.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        detail: expect.stringContaining(`${method} exploded`),
      }),
    )
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
    expect(api.execute).not.toHaveBeenCalled()
  })

  it('does not execute when the workspace switches while the dialog is open', async () => {
    const api = createApi()
    const dialogResult = deferred<string | null>()
    api.saveFile.mockImplementationOnce(() => dialogResult.promise)
    const mounted = mountComposable(ref({ path: '/workspaces/a' }))
    scope = mounted.scope
    await vi.waitFor(() => expect(api.readFlow).toHaveBeenCalledTimes(1))

    const exportPromise = mounted.result.exportSignoffPackage()
    await vi.waitFor(() => expect(api.saveFile).toHaveBeenCalledTimes(1))
    mounted.currentProject.value = { path: '/workspaces/b' }
    dialogResult.resolve('/tmp/a.tar.gz')
    await exportPromise

    expect(api.execute).not.toHaveBeenCalled()
  })
})
