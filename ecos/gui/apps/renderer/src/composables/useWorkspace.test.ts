import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopApi } from '@ecos-studio/shared'
import type { Project } from '@/types'

const {
  createSSEClientMock,
  createRuntimeEventClientMock,
  loadWorkspaceApiMock,
  settingsData,
  setDesktopWindowTitleMock,
  toastAddMock,
  waitForRuntimeReadyMock,
  waitForDesktopApiMock,
} = vi.hoisted(() => ({
  createSSEClientMock: vi.fn(),
  createRuntimeEventClientMock: vi.fn(),
  loadWorkspaceApiMock: vi.fn(),
  settingsData: new Map<string, unknown>(),
  setDesktopWindowTitleMock: vi.fn(),
  toastAddMock: vi.fn(),
  waitForRuntimeReadyMock: vi.fn(),
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
  waitForRuntimeReady: waitForRuntimeReadyMock,
}))

vi.mock('@/api/runtimeEvents', () => ({
  createSSEClient: createSSEClientMock,
  createRuntimeEventClient: createRuntimeEventClientMock,
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
  let onRuntimeEvent: ((response: unknown) => void) | undefined

  beforeEach(() => {
    const workspace = useWorkspace()
    workspace.currentProject.value = null
    workspace.recentProjects.value = []
    workspace.sseClient.value?.close()
    workspace.sseClient.value = null
    workspace.runtimeEvents.value = []
    workspace.stepRefreshCounter.value = 0
    workspace.runtimeBackendConnecting.value = false

    createSSEClientMock.mockReset()
    createRuntimeEventClientMock.mockReset()
    loadWorkspaceApiMock.mockReset()
    setDesktopWindowTitleMock.mockReset()
    toastAddMock.mockReset()
    waitForRuntimeReadyMock.mockReset()
    waitForDesktopApiMock.mockReset()
    settingsData.clear()

    desktopApi = createDesktopApiMock()
    waitForDesktopApiMock.mockResolvedValue(desktopApi)
    waitForRuntimeReadyMock.mockResolvedValue(undefined)
    onRuntimeEvent = undefined
    createRuntimeEventClientMock.mockReturnValue({
      onAll: vi.fn((handler: (response: unknown) => void) => {
        onRuntimeEvent = handler
      }),
      connect: vi.fn(),
      close: vi.fn(),
    })
    createSSEClientMock.mockImplementation(createRuntimeEventClientMock)
  })

  async function openWorkspaceAndConnectRuntimeEvents() {
    const workspace = useWorkspace()
    const project: Project = {
      id: '/work/demo',
      name: 'demo',
      path: '/work/demo',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }

    loadWorkspaceApiMock.mockResolvedValueOnce({
      response: 'success',
      data: {
        directory: '/work/demo',
        workspace_id: 'workspace-demo',
      },
    })

    await workspace.openProject(project)

    expect(createRuntimeEventClientMock).toHaveBeenCalledWith('workspace-demo')
    expect(onRuntimeEvent).toBeDefined()
    return workspace
  }

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

  it('checks only desktop bridge availability before workspace operations', async () => {
    const workspace = useWorkspace()

    await expect(workspace.ensureApiReady()).resolves.toBe(true)

    expect(waitForRuntimeReadyMock).toHaveBeenCalled()
    expect(workspace.runtimeBackendConnecting.value).toBe(false)
  })

  it('reports desktop runtime availability failures through ensureApiReady', async () => {
    const workspace = useWorkspace()
    waitForRuntimeReadyMock.mockRejectedValueOnce(new Error('bridge unavailable'))

    await expect(workspace.ensureApiReady()).resolves.toBe(false)

    expect(workspace.runtimeBackendConnecting.value).toBe(false)
  })

  it('does not increase stepRefreshCounter for read-only runtime events', async () => {
    const workspace = await openWorkspaceAndConnectRuntimeEvents()

    onRuntimeEvent?.({
      data: {
        type: 'task_complete',
        jobId: 'job-get-info',
        cmd: 'get_info',
        message: 'completed',
      },
    })
    onRuntimeEvent?.({
      data: {
        type: 'task_complete',
        jobId: 'job-home-page',
        cmd: 'home_page',
        message: 'completed',
      },
    })
    onRuntimeEvent?.({
      data: {
        type: 'data_ready',
        jobId: 'job-data-ready',
        cmd: 'run_step',
        message: 'completed',
      },
    })
    onRuntimeEvent?.({
      data: {
        type: 'task_complete',
        jobId: 'job-load',
        cmd: 'load_workspace',
        message: 'completed',
      },
    })
    onRuntimeEvent?.({
      data: {
        type: 'task_complete',
        jobId: 'job-create',
        cmd: 'create_workspace',
        message: 'completed',
      },
    })
    onRuntimeEvent?.({
      data: {
        type: 'task_complete',
        jobId: 'job-pdk',
        cmd: 'set_pdk_root',
        message: 'completed',
      },
    })

    expect(workspace.stepRefreshCounter.value).toBe(0)
  })

  it('increases stepRefreshCounter once when run_step completes', async () => {
    const workspace = await openWorkspaceAndConnectRuntimeEvents()

    onRuntimeEvent?.({
      data: {
        type: 'task_complete',
        jobId: 'job-run-step',
        cmd: 'run_step',
        step: 'floorplan',
        message: 'completed',
      },
    })

    expect(workspace.stepRefreshCounter.value).toBe(1)
  })

  it('does not increase stepRefreshCounter for stdout and stderr runtime events', async () => {
    const workspace = await openWorkspaceAndConnectRuntimeEvents()

    onRuntimeEvent?.({
      data: {
        type: 'stdout',
        jobId: 'job-run-step',
        cmd: 'run_step',
        message: 'running',
      },
    })
    onRuntimeEvent?.({
      data: {
        type: 'stderr',
        jobId: 'job-run-step',
        cmd: 'run_step',
        message: 'warning',
      },
    })

    expect(workspace.stepRefreshCounter.value).toBe(0)
  })

  it('does not count the same completed runtime event twice', async () => {
    const workspace = await openWorkspaceAndConnectRuntimeEvents()
    const completedEvent = {
      data: {
        type: 'task_complete',
        jobId: 'job-run-step',
        cmd: 'run_step',
        step: 'floorplan',
        message: 'completed',
      },
    }

    onRuntimeEvent?.(completedEvent)
    onRuntimeEvent?.(completedEvent)

    expect(workspace.stepRefreshCounter.value).toBe(1)
  })

  it('does not increase stepRefreshCounter for runtime events with explicit data paths', async () => {
    const workspace = await openWorkspaceAndConnectRuntimeEvents()

    onRuntimeEvent?.({
      cmd: 'notify',
      data: {
        type: 'step_complete',
        jobId: 'job-run-step',
        cmd: 'run_step',
        step: 'floorplan',
        info: {
          subflow_path: '/work/demo/floorplan/subflow.json',
        },
      },
    })

    expect(workspace.runtimeEvents.value).toHaveLength(1)
    expect(workspace.stepRefreshCounter.value).toBe(0)
  })

  it('does not increase stepRefreshCounter for runtime events with top-level explicit data paths', async () => {
    const workspace = await openWorkspaceAndConnectRuntimeEvents()

    onRuntimeEvent?.({
      cmd: 'notify',
      data: {
        type: 'step_complete',
        jobId: 'job-run-step',
        cmd: 'run_step',
        id: 'subflow',
        step: 'floorplan',
        subflow_path: '/work/demo/floorplan/subflow.json',
      },
    })

    expect(workspace.runtimeEvents.value).toHaveLength(1)
    expect(workspace.stepRefreshCounter.value).toBe(0)
  })

  it('does not count a final result after an explicit path lifecycle event for the same job', async () => {
    const workspace = await openWorkspaceAndConnectRuntimeEvents()

    onRuntimeEvent?.({
      cmd: 'notify',
      data: {
        type: 'step_complete',
        jobId: 'job-run-step',
        cmd: 'run_step',
        step: 'floorplan',
        info: {
          subflow_path: '/work/demo/floorplan/subflow.json',
        },
      },
    })
    onRuntimeEvent?.({
      cmd: 'notify',
      data: {
        type: 'step_complete',
        jobId: 'job-run-step',
        cmd: 'run_step',
        step: 'floorplan',
        state: 'Success',
      },
      message: ['done'],
    })

    expect(workspace.runtimeEvents.value).toHaveLength(2)
    expect(workspace.stepRefreshCounter.value).toBe(0)
  })
})
