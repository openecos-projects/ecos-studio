import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '@/types'

const dialogOpen = vi.hoisted(() => vi.fn())
const invokeMock = vi.hoisted(() => vi.fn())
const loadWorkspaceApiMock = vi.hoisted(() => vi.fn())
const waitForApiReadyMock = vi.hoisted(() => vi.fn())
const createSSEClientMock = vi.hoisted(() => vi.fn())
const storeData = vi.hoisted(() => new Map<string, unknown>())

vi.mock('vue-router', () => ({
  useRouter: () => ({
    isReady: vi.fn(async () => undefined),
    currentRoute: { value: { path: '/' } },
  }),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: dialogOpen,
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    setTitle: vi.fn(async () => undefined),
  }),
}))

vi.mock('@tauri-apps/plugin-store', () => ({
  LazyStore: vi.fn(function () {
    return {
      get: vi.fn(async (key: string) => storeData.get(key)),
      set: vi.fn(async (key: string, value: unknown) => {
        storeData.set(key, value)
      }),
      delete: vi.fn(async (key: string) => {
        storeData.delete(key)
      }),
      save: vi.fn(async () => undefined),
    }
  }),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(async () => {
    throw new Error('not available in test')
  }),
}))

vi.mock('primevue/usetoast', () => ({
  useToast: () => ({
    add: vi.fn(),
  }),
}))

vi.mock('@/api', () => ({
  loadWorkspaceApi: loadWorkspaceApiMock,
  createWorkspaceApi: vi.fn(),
  waitForApiReady: waitForApiReadyMock,
}))

vi.mock('@/api/sse', () => ({
  createSSEClient: createSSEClientMock,
}))

vi.mock('./useTauri', () => ({
  isTauri: () => true,
}))

import { useWorkspace } from './useWorkspace'

describe('useWorkspace openProject', () => {
  beforeEach(() => {
    const workspace = useWorkspace()
    workspace.currentProject.value = null
    workspace.recentProjects.value = []
    workspace.sseClient.value?.close()
    workspace.sseClient.value = null
    workspace.sseMessages.value = []
    workspace.stepRefreshCounter.value = 0
    workspace.apiBackendConnecting.value = false

    dialogOpen.mockReset()
    invokeMock.mockReset()
    loadWorkspaceApiMock.mockReset()
    waitForApiReadyMock.mockReset()
    createSSEClientMock.mockReset()
    storeData.clear()

    invokeMock.mockResolvedValue(true)
    waitForApiReadyMock.mockResolvedValue(undefined)
    createSSEClientMock.mockReturnValue({
      onAll: vi.fn(),
      connect: vi.fn(),
      close: vi.fn(),
    })
  })

  it('keeps the active workspace when the directory picker is canceled', async () => {
    const workspace = useWorkspace()
    const existingProject: Project = {
      id: '/work/old',
      name: 'old',
      path: '/work/old',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }

    loadWorkspaceApiMock.mockResolvedValueOnce({
      response: 'success',
      data: {
        directory: '/work/old',
        workspace_id: '/work/old',
      },
    })

    expect(await workspace.openProject(existingProject)).toBe(true)
    expect(workspace.currentProject.value?.path).toBe('/work/old')

    dialogOpen.mockResolvedValueOnce(null)

    expect(await workspace.openProject()).toBeFalsy()
    expect(workspace.currentProject.value?.path).toBe('/work/old')
    expect(storeData.get('current_project_path')).toBe('/work/old')
  })

  it('keeps the active workspace when the selected workspace fails to load', async () => {
    const workspace = useWorkspace()
    const existingProject: Project = {
      id: '/work/old',
      name: 'old',
      path: '/work/old',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }

    loadWorkspaceApiMock.mockResolvedValueOnce({
      response: 'success',
      data: {
        directory: '/work/old',
        workspace_id: '/work/old',
      },
    })

    expect(await workspace.openProject(existingProject)).toBe(true)

    dialogOpen.mockResolvedValueOnce('/work/bad')
    loadWorkspaceApiMock.mockResolvedValueOnce({
      response: 'error',
      message: ['not an ECOS workspace'],
      data: {},
    })

    expect(await workspace.openProject()).toBe(false)
    expect(workspace.currentProject.value?.path).toBe('/work/old')
    expect(storeData.get('current_project_path')).toBe('/work/old')
  })
})
