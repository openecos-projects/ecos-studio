import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
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
  const requestProjectPathAccess = vi.fn(async (path: string) => path)
  const fileWatchers: Array<{
    listener: (event: { subscriptionId: string; path: string; eventType: string }) => void
    path: string
    unwatch: Mock<() => void>
  }> = []
  const watchProjectFile = vi.fn(
    async (
      path: string,
      listener: (event: {
        subscriptionId: string
        path: string
        eventType: string
      }) => void,
    ) => {
      const unwatch = vi.fn<() => void>()
      fileWatchers.push({ listener, path, unwatch })
      return unwatch
    },
  )

  testState.api = {
    menu: { setActionEnabled },
    workspaceResources: { readFlow, readParameters },
    workspace: { requestProjectPathAccess, watchProjectFile },
    dialog: { saveFile },
    cli: { execute },
  } as unknown as DesktopApi

  return {
    execute,
    fileWatchers,
    readFlow,
    readParameters,
    requestProjectPathAccess,
    saveFile,
    setActionEnabled,
    watchProjectFile,
  }
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

  it('tracks flow eligibility as home/flow.json changes on disk', async () => {
    const api = createApi()
    api.readFlow
      .mockResolvedValueOnce({ steps: [{ name: 'Harden', state: 'Running' }] })
      .mockResolvedValueOnce(successfulFlow())
      .mockResolvedValueOnce({ steps: [{ name: 'Harden', state: 'Failed' }] })
    const mounted = mountComposable()
    scope = mounted.scope

    await vi.waitFor(() => {
      expect(api.watchProjectFile).toHaveBeenCalledWith(
        '/workspaces/chip/home/flow.json',
        expect.any(Function),
      )
      expect(api.setActionEnabled).toHaveBeenLastCalledWith(
        appMenuActionIds.exportSignoffPackage,
        false,
      )
    })

    const watcher = api.fileWatchers[0]!
    watcher.listener({
      subscriptionId: 'flow-watch',
      path: watcher.path,
      eventType: 'change',
    })
    await vi.waitFor(() => {
      expect(api.setActionEnabled).toHaveBeenLastCalledWith(
        appMenuActionIds.exportSignoffPackage,
        true,
      )
    })

    watcher.listener({
      subscriptionId: 'flow-watch',
      path: watcher.path,
      eventType: 'change',
    })
    await vi.waitFor(() => {
      expect(api.setActionEnabled).toHaveBeenLastCalledWith(
        appMenuActionIds.exportSignoffPackage,
        false,
      )
    })
  })

  it('cleans the old watcher and ignores its callback after switching workspaces', async () => {
    const api = createApi()
    const mounted = mountComposable(ref({ path: '/workspaces/a' }))
    scope = mounted.scope
    await vi.waitFor(() => expect(api.fileWatchers).toHaveLength(1))
    const oldWatcher = api.fileWatchers[0]!

    mounted.currentProject.value = { path: '/workspaces/b' }
    await nextTick()

    await vi.waitFor(() => {
      expect(oldWatcher.unwatch).toHaveBeenCalledTimes(1)
      expect(api.fileWatchers).toHaveLength(2)
      expect(api.fileWatchers[1]?.path).toBe('/workspaces/b/home/flow.json')
    })
    const readCount = api.readFlow.mock.calls.length
    oldWatcher.listener({
      subscriptionId: 'old-flow-watch',
      path: oldWatcher.path,
      eventType: 'change',
    })
    await nextTick()

    expect(api.readFlow).toHaveBeenCalledTimes(readCount)
  })

  it('cleans a delayed watcher registration after switching workspaces', async () => {
    const api = createApi()
    const firstRegistration = deferred<Mock<() => void>>()
    const staleUnwatch = vi.fn<() => void>()
    api.watchProjectFile.mockImplementationOnce(() => firstRegistration.promise)
    const mounted = mountComposable(ref({ path: '/workspaces/a' }))
    scope = mounted.scope
    await vi.waitFor(() => expect(api.watchProjectFile).toHaveBeenCalledTimes(1))
    const staleListener = api.watchProjectFile.mock.calls[0]![1]

    mounted.currentProject.value = { path: '/workspaces/b' }
    await nextTick()
    await vi.waitFor(() => expect(api.watchProjectFile).toHaveBeenCalledTimes(2))
    firstRegistration.resolve(staleUnwatch)

    await vi.waitFor(() => expect(staleUnwatch).toHaveBeenCalledTimes(1))
    const readCount = api.readFlow.mock.calls.length
    staleListener({
      subscriptionId: 'stale-flow-watch',
      path: '/workspaces/a/home/flow.json',
      eventType: 'change',
    })
    await nextTick()
    expect(api.readFlow).toHaveBeenCalledTimes(readCount)
  })

  it('cleans a delayed watcher registration after unmount', async () => {
    const api = createApi()
    const registration = deferred<Mock<() => void>>()
    const unwatch = vi.fn<() => void>()
    api.watchProjectFile.mockImplementationOnce(() => registration.promise)
    const mounted = mountComposable()
    scope = mounted.scope
    await vi.waitFor(() => expect(api.watchProjectFile).toHaveBeenCalledTimes(1))

    testState.unmountCallbacks.forEach((callback) => callback())
    registration.resolve(unwatch)

    await vi.waitFor(() => expect(unwatch).toHaveBeenCalledTimes(1))
  })

  it('keeps resource-version synchronization after watcher registration fails', async () => {
    const api = createApi()
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    api.readFlow
      .mockResolvedValueOnce({ steps: [{ name: 'Harden', state: 'Running' }] })
      .mockResolvedValueOnce(successfulFlow())
    api.watchProjectFile.mockRejectedValueOnce(new Error('watch unavailable'))
    const mounted = mountComposable()
    scope = mounted.scope

    await vi.waitFor(() => {
      expect(consoleWarn).toHaveBeenCalledWith(
        '[signoff-export] Failed to watch home/flow.json:',
        expect.objectContaining({ message: 'watch unavailable' }),
      )
    })
    mounted.resourceVersions.value.flow += 1
    await nextTick()

    await vi.waitFor(() => {
      expect(api.setActionEnabled).toHaveBeenLastCalledWith(
        appMenuActionIds.exportSignoffPackage,
        true,
      )
    })
    expect(mounted.showToast).not.toHaveBeenCalled()
    consoleWarn.mockRestore()
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
    await vi.waitFor(() => expect(api.fileWatchers).toHaveLength(1))
    const watcher = api.fileWatchers[0]!

    testState.unmountCallbacks.forEach((callback) => callback())

    await vi.waitFor(() => {
      expect(api.setActionEnabled).toHaveBeenLastCalledWith(
        appMenuActionIds.exportSignoffPackage,
        false,
      )
      expect(watcher.unwatch).toHaveBeenCalledTimes(1)
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
    expect(api.execute).not.toHaveBeenCalled()
    expect(mounted.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'warn',
        detail: expect.stringContaining('Open an eligible workspace'),
      }),
    )
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

  it('uses fallback details when the CLI failure has no message', async () => {
    const api = createApi()
    api.execute.mockResolvedValueOnce(cliResult(false))
    const mounted = mountComposable()
    scope = mounted.scope
    await vi.waitFor(() => expect(api.readFlow).toHaveBeenCalledTimes(1))

    await mounted.result.exportSignoffPackage()

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

    await mounted.result.exportSignoffPackage()

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
    ['CLI execution', 'execute'],
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
    expect(api.execute).not.toHaveBeenCalled()
  })

  it('does not open the dialog when the workspace switches during parameter loading', async () => {
    const api = createApi()
    const parametersRead = deferred<Record<string, unknown> | null>()
    api.readParameters.mockImplementationOnce(() => parametersRead.promise)
    const mounted = mountComposable(ref({ path: '/workspaces/a' }))
    scope = mounted.scope
    await vi.waitFor(() => expect(api.readFlow).toHaveBeenCalledTimes(1))

    const exportPromise = mounted.result.exportSignoffPackage()
    await vi.waitFor(() => expect(api.readParameters).toHaveBeenCalledTimes(1))
    mounted.currentProject.value = { path: '/workspaces/b' }
    parametersRead.resolve({ Design: 'workspace_a' })
    await exportPromise

    expect(api.saveFile).not.toHaveBeenCalled()
    expect(api.execute).not.toHaveBeenCalled()
  })

  it('suppresses a rejected parameter read after the workspace switches', async () => {
    const api = createApi()
    const parametersRead = deferred<Record<string, unknown> | null>()
    api.readParameters.mockImplementationOnce(() => parametersRead.promise)
    const mounted = mountComposable(ref({ path: '/workspaces/a' }))
    scope = mounted.scope
    await vi.waitFor(() => expect(api.readFlow).toHaveBeenCalledTimes(1))

    const exportPromise = mounted.result.exportSignoffPackage()
    await vi.waitFor(() => expect(api.readParameters).toHaveBeenCalledTimes(1))
    mounted.currentProject.value = { path: '/workspaces/b' }
    parametersRead.reject(new Error('stale workspace read failed'))
    await exportPromise

    expect(mounted.showToast).not.toHaveBeenCalled()
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
