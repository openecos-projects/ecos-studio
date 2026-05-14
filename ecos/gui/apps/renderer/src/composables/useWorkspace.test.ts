import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopApi } from '@ecos-studio/shared'
import type { Project } from '@/types'

const {
  createSSEClientMock,
  loadWorkspaceApiMock,
  settingsData,
  setDesktopWindowTitleMock,
  toastAddMock,
  waitForApiReadyMock,
  waitForDesktopApiMock,
} = vi.hoisted(() => ({
  createSSEClientMock: vi.fn(),
  loadWorkspaceApiMock: vi.fn(),
  settingsData: new Map<string, unknown>(),
  setDesktopWindowTitleMock: vi.fn(),
  toastAddMock: vi.fn(),
  waitForApiReadyMock: vi.fn(),
  waitForDesktopApiMock: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({
    isReady: vi.fn(async () => undefined),
    currentRoute: { value: { path: '/' } },
  }),
}))

vi.mock('primevue/usetoast', () => ({
  useToast: () => ({
    add: toastAddMock,
  }),
}))

vi.mock('@/platform/desktop', () => ({
  waitForDesktopApi: waitForDesktopApiMock,
}))

vi.mock('@/api', () => ({
  loadWorkspaceApi: loadWorkspaceApiMock,
  createWorkspaceApi: vi.fn(),
  waitForApiReady: waitForApiReadyMock,
}))

vi.mock('@/api/sse', () => ({
  createSSEClient: createSSEClientMock,
}))

vi.mock('./windowTitle', () => ({
  setDesktopWindowTitle: setDesktopWindowTitleMock,
}))

import { useWorkspace } from './useWorkspace'

function createDesktopApiMock(overrides: Partial<DesktopApi> = {}): DesktopApi {
  return {
    app: {
      getVersions: vi.fn(),
    },
    window: {
      minimize: vi.fn(),
      toggleMaximize: vi.fn(),
      close: vi.fn(),
      confirmClose: vi.fn(),
      setTitle: vi.fn(),
      isMaximized: vi.fn(),
      onCloseRequested: vi.fn(),
      onResized: vi.fn(),
      onMaximizedChanged: vi.fn(),
    },
    menu: {
      onAction: vi.fn(),
    },
    system: {
      openExternal: vi.fn(),
    },
    settings: {
      get: vi.fn(async (key: string) => settingsData.get(key) ?? null),
      set: vi.fn(async (key: string, value: unknown) => {
        settingsData.set(key, value)
      }),
      delete: vi.fn(async (key: string) => {
        settingsData.delete(key)
      }),
    },
    dialog: {
      pickDirectory: vi.fn(),
      pickFiles: vi.fn(),
    },
    workspace: {
      getApiPort: vi.fn(),
      isProjectDirectory: vi.fn(),
      registerProjectRoot: vi.fn(async (path: string) => path),
      clearProjectRoot: vi.fn(),
      requestProjectPathAccess: vi.fn(),
      readProjectTextFile: vi.fn(async () => {
        throw new Error('not available in test')
      }),
      readOptionalProjectTextFile: vi.fn(),
      readProjectTextFileTail: vi.fn(),
      readOptionalProjectTextFileTail: vi.fn(),
      readOptionalProjectTextFileUpdate: vi.fn(),
      subscribeProjectLogTail: vi.fn(),
      readProjectBinaryFile: vi.fn(),
      writeProjectTextFile: vi.fn(),
      scanPdkDirectory: vi.fn(),
      watchProjectFile: vi.fn(),
    },
    tiles: {
      generate: vi.fn(),
    },
    ...overrides,
  } as DesktopApi
}

describe('useWorkspace openProject', () => {
  let desktopApi: DesktopApi

  beforeEach(() => {
    const workspace = useWorkspace()
    workspace.currentProject.value = null
    workspace.recentProjects.value = []
    workspace.sseClient.value?.close()
    workspace.sseClient.value = null
    workspace.sseMessages.value = []
    workspace.stepRefreshCounter.value = 0
    workspace.apiBackendConnecting.value = false

    createSSEClientMock.mockReset()
    loadWorkspaceApiMock.mockReset()
    setDesktopWindowTitleMock.mockReset()
    toastAddMock.mockReset()
    waitForApiReadyMock.mockReset()
    waitForDesktopApiMock.mockReset()
    settingsData.clear()

    desktopApi = createDesktopApiMock()
    waitForDesktopApiMock.mockResolvedValue(desktopApi)
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

    vi.mocked(desktopApi.dialog.pickDirectory).mockResolvedValueOnce(null)

    expect(await workspace.openProject()).toBe(false)
    expect(workspace.currentProject.value?.path).toBe('/work/old')
    expect(settingsData.get('current_project_path')).toBe('/work/old')
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

    vi.mocked(desktopApi.dialog.pickDirectory).mockResolvedValueOnce('/work/bad')
    loadWorkspaceApiMock.mockResolvedValueOnce({
      response: 'error',
      message: ['not an ECOS workspace'],
      data: {},
    })

    expect(await workspace.openProject()).toBe(false)
    expect(workspace.currentProject.value?.path).toBe('/work/old')
    expect(settingsData.get('current_project_path')).toBe('/work/old')
  })

  it('keeps the active workspace when registering the selected workspace fails', async () => {
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

    vi.mocked(desktopApi.dialog.pickDirectory).mockResolvedValueOnce('/work/new')
    vi.mocked(desktopApi.workspace.registerProjectRoot)
      .mockRejectedValueOnce(new Error('permission denied'))
    loadWorkspaceApiMock.mockResolvedValueOnce({
      response: 'success',
      data: {
        directory: '/work/new',
        workspace_id: '/work/new',
      },
    })

    expect(await workspace.openProject()).toBe(false)
    expect(workspace.currentProject.value?.path).toBe('/work/old')
    expect(settingsData.get('current_project_path')).toBe('/work/old')
  })
})
