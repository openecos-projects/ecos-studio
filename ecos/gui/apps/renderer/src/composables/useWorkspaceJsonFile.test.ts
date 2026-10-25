import { effectScope, reactive, ref, type EffectScope, type Ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({
  currentProject: null as Ref<{ path: string } | null> | null,
  readOptionalProjectTextFile: vi.fn(),
  session: null as Record<string, any> | null,
}))

vi.mock('./useWorkspace', () => ({
  useWorkspace: () => ({ currentProject: testState.currentProject }),
}))
vi.mock('@/stores/backendWorkspaceSession', () => ({
  useBackendWorkspaceSession: () => testState.session,
}))
vi.mock('@/utils/projectFiles', () => ({
  readOptionalProjectTextFile: testState.readOptionalProjectTextFile,
}))

import { useWorkspaceJsonFile } from './useWorkspaceJsonFile'

function parseLabel(value: unknown): { label: string } | null {
  if (
    typeof value === 'object' &&
    value !== null &&
    'label' in value &&
    typeof value.label === 'string'
  ) {
    return { label: value.label }
  }
  return null
}

describe('useWorkspaceJsonFile', () => {
  let scope: EffectScope

  beforeEach(() => {
    scope = effectScope()
    testState.currentProject = ref({ path: '/project/ws-a' })
    testState.session = reactive({
      projection: {
        data: {
          revision: {
            status: 'ready',
            data: { workspaceRevision: 1 },
          },
        },
      },
    })
    testState.readOptionalProjectTextFile.mockReset()
  })

  afterEach(() => {
    scope.stop()
  })

  it('loads and parses an optional workspace JSON file', async () => {
    testState.readOptionalProjectTextFile.mockResolvedValue('{"label":"ready"}')
    const result = scope.run(() =>
      useWorkspaceJsonFile('feature/result.json', parseLabel, 'Result is invalid.'),
    )!

    await vi.waitFor(() => expect(result.data.value).toEqual({ label: 'ready' }))

    expect(testState.readOptionalProjectTextFile).toHaveBeenCalledWith(
      'feature/result.json',
      {
        projectPath: '/project/ws-a',
      },
    )
    expect(result.loading.value).toBe(false)
    expect(result.error.value).toBeNull()
  })

  it('treats a missing optional file as empty without an error', async () => {
    testState.readOptionalProjectTextFile.mockResolvedValue(null)
    const result = scope.run(() =>
      useWorkspaceJsonFile('feature/result.json', parseLabel, 'Result is invalid.'),
    )!

    await vi.waitFor(() => expect(result.loading.value).toBe(false))

    expect(testState.readOptionalProjectTextFile).toHaveBeenCalledOnce()
    expect(result.data.value).toBeNull()
    expect(result.error.value).toBeNull()
  })

  it('reports JSON that does not match the expected shape', async () => {
    testState.readOptionalProjectTextFile.mockResolvedValue('{"unexpected":true}')
    const result = scope.run(() =>
      useWorkspaceJsonFile('feature/result.json', parseLabel, 'Result is invalid.'),
    )!

    await vi.waitFor(() => expect(result.error.value).toBe('Result is invalid.'))

    expect(result.data.value).toBeNull()
    expect(result.loading.value).toBe(false)
  })

  it('surfaces malformed JSON errors', async () => {
    testState.readOptionalProjectTextFile.mockResolvedValue('{not-json')
    const result = scope.run(() =>
      useWorkspaceJsonFile('feature/result.json', parseLabel, 'Result is invalid.'),
    )!

    await vi.waitFor(() => expect(result.error.value).not.toBeNull())

    expect(result.data.value).toBeNull()
    expect(result.error.value).not.toBe('Result is invalid.')
    expect(result.loading.value).toBe(false)
  })

  it('ignores a stale response that resolves after a newer refresh', async () => {
    let resolveFirst!: (value: string) => void
    testState.readOptionalProjectTextFile
      .mockReturnValueOnce(
        new Promise<string>((resolve) => {
          resolveFirst = resolve
        }),
      )
      .mockResolvedValueOnce('{"label":"new"}')
    const result = scope.run(() =>
      useWorkspaceJsonFile('feature/result.json', parseLabel, 'Result is invalid.'),
    )!
    await vi.waitFor(() =>
      expect(testState.readOptionalProjectTextFile).toHaveBeenCalledOnce(),
    )

    await result.refresh()
    expect(result.data.value).toEqual({ label: 'new' })

    resolveFirst('{"label":"old"}')
    await flushPromises()
    expect(result.loading.value).toBe(false)
    expect(result.data.value).toEqual({ label: 'new' })
  })
})
