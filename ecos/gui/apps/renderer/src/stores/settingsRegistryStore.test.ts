// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { DesktopSettingState } from '@ecos-studio/shared'

type ChangedListener = (state: DesktopSettingState) => void

const {
  bridgeAvailable,
  changedListeners,
  listMock,
  onChangedMock,
  registryReset,
  registrySet,
} = vi.hoisted(() => ({
  bridgeAvailable: { value: true },
  changedListeners: [] as ChangedListener[],
  listMock: vi.fn(),
  onChangedMock: vi.fn((listener: ChangedListener) => {
    changedListeners.push(listener)
    return () => {
      const index = changedListeners.indexOf(listener)
      if (index >= 0) changedListeners.splice(index, 1)
    }
  }),
  registryReset: vi.fn(),
  registrySet: vi.fn(),
}))

vi.mock('@/platform/desktop', () => ({
  getOptionalDesktopApi: () =>
    bridgeAvailable.value
      ? {
          settingsRegistry: {
            list: listMock,
            onChanged: onChangedMock,
            reset: registryReset,
            set: registrySet,
          },
        }
      : null,
  hasDesktopApi: () => bridgeAvailable.value,
}))

import { useSettingsRegistryStore } from './settingsRegistryStore'

function entryFixture(
  key: string,
  overrides: Partial<DesktopSettingState> = {},
): DesktopSettingState {
  return {
    descriptor: {
      category: 'Runtime',
      default: null,
      description: `${key} description`,
      key,
      title: key,
      valueType: 'filePath',
    },
    isDefault: true,
    status: { kind: 'ok' },
    value: null,
    ...overrides,
  }
}

describe('settingsRegistryStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    bridgeAvailable.value = true
    changedListeners.length = 0
    listMock.mockReset()
    registryReset.mockReset()
    registrySet.mockReset()
  })

  it('loads entries from the registry list', async () => {
    const store = useSettingsRegistryStore()
    const entries = [
      entryFixture('runtime.eccPath'),
      entryFixture('agent.codexBin', {
        descriptor: {
          category: 'Agent',
          default: null,
          description: 'codex',
          key: 'agent.codexBin',
          title: 'Codex CLI Binary',
          valueType: 'filePath',
        },
      }),
    ]
    listMock.mockResolvedValueOnce(entries)

    await store.load()
    expect(store.entries).toEqual(entries)
    expect(store.loading).toBe(false)
  })

  it('updates optimistically and rolls back on a failed set', async () => {
    const store = useSettingsRegistryStore()
    const initial = entryFixture('runtime.eccPath', { isDefault: true, value: null })
    listMock.mockResolvedValueOnce([initial])
    await store.load()

    registrySet.mockResolvedValueOnce({ ok: false, error: 'path missing' })

    const result = await store.set('runtime.eccPath', '/bad/ecc')
    expect(result).toMatchObject({ ok: false })
    expect(store.entryFor('runtime.eccPath')?.value).toBeNull()
    expect(store.isValidating('runtime.eccPath')).toBe(false)
    expect(store.errorFor('runtime.eccPath')).toBe('path missing')
  })

  it('clears the row error after a successful write', async () => {
    const store = useSettingsRegistryStore()
    const initial = entryFixture('runtime.eccPath', { value: null })
    listMock.mockResolvedValueOnce([initial])
    await store.load()

    registrySet.mockResolvedValueOnce({ ok: false, error: 'path missing' })
    await store.set('runtime.eccPath', '/bad/ecc')
    expect(store.errorFor('runtime.eccPath')).toBe('path missing')

    const confirmed = entryFixture('runtime.eccPath', {
      isDefault: false,
      value: '/good/ecc',
    })
    registrySet.mockResolvedValueOnce({ ok: true, state: confirmed })
    await store.set('runtime.eccPath', '/good/ecc')
    expect(store.errorFor('runtime.eccPath')).toBe('')
  })

  it('keeps the optimistic value validated by a successful set', async () => {
    const store = useSettingsRegistryStore()
    const initial = entryFixture('runtime.eccPath', { value: null })
    listMock.mockResolvedValueOnce([initial])
    await store.load()

    const confirmed = entryFixture('runtime.eccPath', {
      isDefault: false,
      status: { displayInfo: 'ecc 1.0', kind: 'ok' },
      value: '/good/ecc',
    })
    registrySet.mockImplementation(async () => {
      for (const listener of changedListeners) listener(confirmed)
      return { ok: true, state: confirmed }
    })

    const result = await store.set('runtime.eccPath', '/good/ecc')
    expect(result).toMatchObject({ ok: true })
    expect(store.entryFor('runtime.eccPath')?.value).toBe('/good/ecc')
    expect(store.entryFor('runtime.eccPath')?.status).toEqual({
      displayInfo: 'ecc 1.0',
      kind: 'ok',
    })
  })

  it('applies changed broadcasts from other windows', async () => {
    const store = useSettingsRegistryStore()
    const initial = entryFixture('runtime.eccPath', { value: '/old/ecc' })
    listMock.mockResolvedValueOnce([initial])
    await store.load()
    store.bindChangedEvents()

    const broadcast = entryFixture('runtime.eccPath', {
      isDefault: false,
      status: { kind: 'pending' },
      value: '/new/ecc',
    })
    for (const listener of changedListeners) listener(broadcast)

    expect(store.entryFor('runtime.eccPath')?.value).toBe('/new/ecc')
    expect(store.entryFor('runtime.eccPath')?.status).toEqual({ kind: 'pending' })
    store.unbindChangedEvents()
    expect(changedListeners).toHaveLength(0)
  })

  it('keeps a newer cross-window broadcast when an older in-flight set fails', async () => {
    const store = useSettingsRegistryStore()
    const initial = entryFixture('runtime.eccPath', { value: '/old/ecc' })
    listMock.mockResolvedValueOnce([initial])
    await store.load()
    store.bindChangedEvents()

    let resolveSet!: (result: { error: string; ok: false }) => void
    registrySet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSet = resolve
        }),
    )
    const inFlight = store.set('runtime.eccPath', '/mine/ecc')
    expect(store.entryFor('runtime.eccPath')?.value).toBe('/mine/ecc')

    // Another window wins the race and broadcasts its newer value.
    const broadcast = entryFixture('runtime.eccPath', {
      isDefault: false,
      value: '/theirs/ecc',
    })
    for (const listener of changedListeners) listener(broadcast)

    resolveSet({ error: 'write rejected', ok: false })
    const result = await inFlight

    expect(result).toMatchObject({ ok: false })
    // The rollback must not clobber the last-write-wins broadcast value.
    expect(store.entryFor('runtime.eccPath')?.value).toBe('/theirs/ecc')
    store.unbindChangedEvents()
  })

  it('rolls back and surfaces the error when the IPC call itself throws', async () => {
    const store = useSettingsRegistryStore()
    const initial = entryFixture('runtime.eccPath', { value: null })
    listMock.mockResolvedValueOnce([initial])
    await store.load()

    registrySet.mockRejectedValueOnce(new Error('main-side disk failure'))

    const result = await store.set('runtime.eccPath', '/bad/ecc')
    expect(result).toMatchObject({ ok: false, error: 'main-side disk failure' })
    expect(store.entryFor('runtime.eccPath')?.value).toBeNull()
    expect(store.errorFor('runtime.eccPath')).toBe('main-side disk failure')
    expect(store.isValidating('runtime.eccPath')).toBe(false)
  })

  it('merges a broadcast that lands during the initial load into the full snapshot', async () => {
    const store = useSettingsRegistryStore()
    const stale = entryFixture('runtime.eccPath', { value: '/stale/ecc' })
    const untouched = entryFixture('agent.codexBin', { value: '/bin/codex' })
    listMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          // The broadcast arrives while the list fetch is still in flight.
          for (const listener of changedListeners) {
            listener(
              entryFixture('runtime.eccPath', {
                isDefault: false,
                value: '/fresh/ecc',
              }),
            )
          }
          resolve([stale, untouched])
        }),
    )
    store.bindChangedEvents()
    await store.load()

    // The broadcast wins for its key while the snapshot keeps the rest.
    expect(store.entryFor('runtime.eccPath')?.value).toBe('/fresh/ecc')
    expect(store.entryFor('agent.codexBin')?.value).toBe('/bin/codex')
    expect(store.entries).toHaveLength(2)
    store.unbindChangedEvents()
  })

  it('does not apply a successful write response that a newer broadcast superseded', async () => {
    const store = useSettingsRegistryStore()
    const initial = entryFixture('runtime.eccPath', { value: '/old/ecc' })
    listMock.mockResolvedValueOnce([initial])
    await store.load()
    store.bindChangedEvents()

    let resolveSet!: (result: { ok: true; state: DesktopSettingState }) => void
    registrySet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSet = resolve
        }),
    )
    const inFlight = store.set('runtime.eccPath', '/mine/ecc')
    expect(store.entryFor('runtime.eccPath')?.value).toBe('/mine/ecc')

    // Another window wins the last-write-wins race before our response lands.
    for (const listener of changedListeners) {
      listener(
        entryFixture('runtime.eccPath', {
          isDefault: false,
          value: '/theirs/ecc',
        }),
      )
    }
    resolveSet({
      ok: true,
      state: entryFixture('runtime.eccPath', {
        isDefault: false,
        value: '/mine/ecc',
      }),
    })
    await inFlight

    // The stale successful response must not regress the newer broadcast.
    expect(store.entryFor('runtime.eccPath')?.value).toBe('/theirs/ecc')
    expect(store.errorFor('runtime.eccPath')).toBe('')
    store.unbindChangedEvents()
  })

  it('keeps the validating state until every in-flight write for a key settles', async () => {
    const store = useSettingsRegistryStore()
    const initial = entryFixture('runtime.eccPath', { value: null })
    listMock.mockResolvedValueOnce([initial])
    await store.load()

    let resolveFirst!: (result: { ok: true; state: DesktopSettingState }) => void
    let resolveSecond!: (result: { ok: true; state: DesktopSettingState }) => void
    registrySet
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve
          }),
      )

    const first = store.set('runtime.eccPath', '/first/ecc')
    const second = store.set('runtime.eccPath', '/second/ecc')
    expect(store.isValidating('runtime.eccPath')).toBe(true)

    resolveFirst({
      ok: true,
      state: entryFixture('runtime.eccPath', { isDefault: false, value: '/first/ecc' }),
    })
    await first
    // The second write is still in flight; the spinner must stay up.
    expect(store.isValidating('runtime.eccPath')).toBe(true)

    resolveSecond({
      ok: true,
      state: entryFixture('runtime.eccPath', { isDefault: false, value: '/second/ecc' }),
    })
    await second
    expect(store.isValidating('runtime.eccPath')).toBe(false)
  })

  it('records a load error and clears it on a successful retry', async () => {
    const store = useSettingsRegistryStore()

    listMock.mockRejectedValueOnce(new Error('inventory unavailable'))
    await store.load()
    expect(store.loadError).toBe('inventory unavailable')

    const entries = [entryFixture('runtime.eccPath')]
    listMock.mockResolvedValueOnce(entries)
    await store.load()
    expect(store.loadError).toBe('')
    expect(store.entries).toEqual(entries)
  })

  it('reset restores the default entry', async () => {
    const store = useSettingsRegistryStore()
    const initial = entryFixture('agent.codexBin', {
      isDefault: false,
      value: '/bin/codex',
    })
    listMock.mockResolvedValueOnce([initial])
    await store.load()

    const resetEntry = entryFixture('agent.codexBin', { isDefault: true, value: null })
    registryReset.mockResolvedValueOnce({ ok: true, state: resetEntry })

    const result = await store.reset('agent.codexBin')
    expect(result).toMatchObject({ ok: true })
    expect(store.entryFor('agent.codexBin')?.isDefault).toBe(true)
    expect(store.entryFor('agent.codexBin')?.value).toBeNull()
  })

  it('fails gracefully when the bridge is unavailable', async () => {
    bridgeAvailable.value = false
    const store = useSettingsRegistryStore()
    const result = await store.set('runtime.eccPath', '/x')
    expect(result).toMatchObject({ ok: false })
    await expect(store.load()).resolves.toBeUndefined()
    expect(store.entries).toEqual([])
  })
})
