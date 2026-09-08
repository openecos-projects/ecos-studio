import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesignRuntimeEvent, DesktopApi } from '@ecos-studio/shared'
import type { Project } from '@/types'

const {
  createRuntimeEventClientMock,
  closeWorkspaceApiMock,
  createWorkspaceApiMock,
  updateWorkspaceApiMock,
  loadWorkspaceApiMock,
  clearMessagesMock,
  readWorkspaceFlowResourceApiMock,
  readWorkspaceParametersResourceApiMock,
  settingsData,
  setDesktopWindowTitleMock,
  toastAddMock,
  getDesktopApiMock,
  requestHomeRunArtifactResetMock,
  clearHomeRunArtifactResetAwaitingBackendStartMock,
  notifyWorkspaceRerunPreparedMock,
  clearFlowExecutionActiveForWorkspaceMock,
  isFlowExecutionActiveForWorkspaceMock,
  markFlowExecutionActiveForWorkspaceMock,
  resolveProjectRouteContextForWorkspaceMock,
} = vi.hoisted(() => ({
  createRuntimeEventClientMock: vi.fn(),
  closeWorkspaceApiMock: vi.fn(),
  createWorkspaceApiMock: vi.fn(),
  updateWorkspaceApiMock: vi.fn(),
  loadWorkspaceApiMock: vi.fn(),
  clearMessagesMock: vi.fn(),
  readWorkspaceFlowResourceApiMock: vi.fn(),
  readWorkspaceParametersResourceApiMock: vi.fn(),
  settingsData: new Map<string, unknown>(),
  setDesktopWindowTitleMock: vi.fn(),
  toastAddMock: vi.fn(),
  getDesktopApiMock: vi.fn(),
  requestHomeRunArtifactResetMock: vi.fn(),
  clearHomeRunArtifactResetAwaitingBackendStartMock: vi.fn(),
  notifyWorkspaceRerunPreparedMock: vi.fn(),
  clearFlowExecutionActiveForWorkspaceMock: vi.fn(),
  isFlowExecutionActiveForWorkspaceMock: vi.fn(() => false),
  markFlowExecutionActiveForWorkspaceMock: vi.fn(),
  resolveProjectRouteContextForWorkspaceMock: vi.fn(),
}))

const runtimeEventBridge = vi.hoisted(() => {
  const listeners: Array<(event: DesignRuntimeEvent) => void> = []
  return {
    listeners,
    onEvent: vi.fn((listener: (event: DesignRuntimeEvent) => void) => {
      listeners.push(listener)
      return () => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
      }
    }),
  }
})

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
  getDesktopApi: getDesktopApiMock,
}))

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  closeWorkspaceApi: closeWorkspaceApiMock,
  loadWorkspaceApi: loadWorkspaceApiMock,
  createWorkspaceApi: createWorkspaceApiMock,
  updateWorkspaceApi: updateWorkspaceApiMock,
}))

vi.mock('@/api/runtimeEvents', () => ({
  createFrontendRuntimeEventClient: createRuntimeEventClientMock,
}))

vi.mock('@/api/workspaceResources', () => ({
  readWorkspaceFlowResourceApi: readWorkspaceFlowResourceApiMock,
  readWorkspaceParametersResourceApi: readWorkspaceParametersResourceApiMock,
}))

vi.mock('./windowTitle', () => ({
  setDesktopWindowTitle: setDesktopWindowTitleMock,
}))

vi.mock('@/stores/messageStore', () => ({
  useMessageStore: () => ({
    clearMessages: clearMessagesMock,
  }),
}))

vi.mock('@/stores/agentShellStore', () => ({
  useAgentShellStore: () => ({
    shouldPreserveMessages: () => false,
    consumePreserveMessages: vi.fn(() => false),
    resetShell: vi.fn(),
  }),
}))

vi.mock('./homeRunArtifacts', () => ({
  requestHomeRunArtifactReset: requestHomeRunArtifactResetMock,
  clearHomeRunArtifactResetAwaitingBackendStart:
    clearHomeRunArtifactResetAwaitingBackendStartMock,
  isAgentWorkspaceRerunHomePrepared: vi.fn(() => false),
  notifyWorkspaceRerunPrepared: notifyWorkspaceRerunPreparedMock,
}))

vi.mock('./flowExecutionState', () => ({
  clearFlowExecutionActiveForWorkspace: clearFlowExecutionActiveForWorkspaceMock,
  isFlowExecutionActiveForWorkspace: isFlowExecutionActiveForWorkspaceMock,
  markFlowExecutionActiveForWorkspace: markFlowExecutionActiveForWorkspaceMock,
}))

vi.mock('@/utils/projectManifestRegistration', () => ({
  resolveProjectRouteContextForWorkspace: resolveProjectRouteContextForWorkspaceMock,
}))

import { useWorkspace } from './useWorkspace'
import { useWorkspaceLifecycle } from './useWorkspaceLifecycle'
import { useNotificationStore } from '@/stores/notificationStore'

type SerializedRecentProject = Omit<Project, 'lastOpened'> & { lastOpened: string }

function createDesktopApiMock(overrides: Partial<DesktopApi> = {}): DesktopApi {
  return {
    app: {
      getVersions: vi.fn(),
    },
    window: {
      minimize: vi.fn(),
      toggleMaximize: vi.fn(),
      close: vi.fn(),
      setTitle: vi.fn(),
      setZoomFactor: vi.fn(),
      isMaximized: vi.fn(),
      create: vi.fn(),
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
    productCommands: {
      execute: vi.fn(async () => ({ completed: false })),
    },
    projectManifest: {
      mutate: vi.fn(async () => ({ manifest: {} as never })),
    },
    backendWorkspace: {
      getArtifact: vi.fn(),
      getOverview: vi.fn(),
      getStepDetail: vi.fn(),
      refreshOverview: vi.fn(),
      onInvalidated: vi.fn(() => vi.fn()),
    },
    dialog: {
      pickDirectory: vi.fn(),
      pickFiles: vi.fn(),
      pickRtlSources: vi.fn(),
    },
    workspace: {
      isProjectDirectory: vi.fn(),
      openOrFocus: vi.fn(async () => ({ action: 'proceed' as const })),
      bindWindow: vi.fn(async (path: string) => path),
      unbindWindow: vi.fn(async () => undefined),
      getBoundPath: vi.fn(async () => null),
      registerProjectRoot: vi.fn(async (path: string) => path),
      registerProjectReadRoot: vi.fn(async (path: string) => path),
      clearProjectRoot: vi.fn(),
      requestProjectPathAccess: vi.fn(),
      readProjectTextFile: vi.fn(async () => {
        throw new Error('not available in test')
      }),
      readOptionalProjectTextFile: vi.fn(),
      readProjectTextFileTail: vi.fn(),
      readOptionalProjectTextFileTail: vi.fn(),
      readProjectBinaryFile: vi.fn(),
      writeProjectTextFile: vi.fn(),
      listProjectDirectory: vi.fn(),
      pathExists: vi.fn(async () => false),
      discardFailedWorkspaceCreate: vi.fn(async () => false),
      prepareProjectDirectoryReplacement: vi.fn(),
      restoreProjectDirectoryReplacement: vi.fn(),
      finalizeProjectDirectoryReplacement: vi.fn(),
      retainProjectDirectoryReplacement: vi.fn(),
      scanPdkDirectory: vi.fn(),
      scanRtlDirectory: vi.fn(),
      listDesignFiles: vi.fn(),
      addDesignFiles: vi.fn(),
      removeDesignFile: vi.fn(),
    },
    runtime: {
      events: { onEvent: runtimeEventBridge.onEvent },
    },
    ecc: {
      runtime: {
        snapshot: vi.fn(async () => ({ operations: [] })),
      },
    },
    ...overrides,
  } as DesktopApi
}

function readRecentProjectsSetting(): SerializedRecentProject[] {
  const value = settingsData.get('recent_projects')
  expect(Array.isArray(value)).toBe(true)
  return value as SerializedRecentProject[]
}

function backendProtocolEvent(
  sourceType: string,
  payload: Record<string, unknown> = {},
  options: {
    eventId?: string
    operationId?: string
    rerun?: boolean
    runtimeInstanceId?: string
    workspaceDirectory?: string | null
    workspaceHandle?: string
    workspaceRevision?: number
  } = {},
): DesignRuntimeEvent {
  return {
    designTool: 'backend',
    event: {
      eventId: options.eventId ?? `event-${sourceType}`,
      kind: 'flow',
      operationId: options.operationId ?? 'operation-1',
      origin: 'gui',
      payload: { sourceType, ...payload },
      ...(options.rerun === undefined ? {} : { rerun: options.rerun }),
      runtimeInstanceId: options.runtimeInstanceId,
      sequence: 1,
      timestamp: 1,
      type: 'execution.progress',
      workspaceId: 'engineering-workspace',
      workspaceRevision: options.workspaceRevision,
    },
    type: 'runtime.protocol',
    workspaceDirectory:
      options.workspaceDirectory === null
        ? undefined
        : (options.workspaceDirectory ?? '/work/demo'),
    workspaceHandle: options.workspaceHandle ?? 'workspace-demo',
  }
}

describe('useWorkspace openProject', () => {
  let activeProjectRoot: string | null
  let desktopApi: DesktopApi
  let onRuntimeEvent: ((event: DesignRuntimeEvent) => void) | undefined

  beforeEach(() => {
    const workspace = useWorkspace()
    const lifecycle = useWorkspaceLifecycle()
    lifecycle.closeSession()
    workspace.currentProject.value = null
    workspace.recentProjects.value = []
    workspace.runtimeEventClient.value?.close()
    workspace.runtimeEventClient.value = null
    workspace.runtimeEvents.value = []
    workspace.backendRuntimeEvents.value = []
    workspace.runtimeBackendConnecting.value = false

    createRuntimeEventClientMock.mockReset()
    runtimeEventBridge.listeners.splice(0)
    runtimeEventBridge.onEvent.mockClear()
    closeWorkspaceApiMock.mockReset()
    closeWorkspaceApiMock.mockResolvedValue({ ok: true })
    createWorkspaceApiMock.mockReset()
    updateWorkspaceApiMock.mockReset()
    updateWorkspaceApiMock.mockResolvedValue({
      directory: '/work/existing',
      workspaceId: 'workspace-1',
      workspaceRevision: 2,
    })
    loadWorkspaceApiMock.mockReset()
    clearMessagesMock.mockReset()
    readWorkspaceFlowResourceApiMock.mockReset()
    readWorkspaceParametersResourceApiMock.mockReset()
    setDesktopWindowTitleMock.mockReset()
    toastAddMock.mockReset()
    getDesktopApiMock.mockReset()
    requestHomeRunArtifactResetMock.mockReset()
    notifyWorkspaceRerunPreparedMock.mockReset()
    clearFlowExecutionActiveForWorkspaceMock.mockReset()
    isFlowExecutionActiveForWorkspaceMock.mockReset()
    isFlowExecutionActiveForWorkspaceMock.mockReturnValue(false)
    resolveProjectRouteContextForWorkspaceMock.mockReset()
    resolveProjectRouteContextForWorkspaceMock.mockResolvedValue(null)
    settingsData.clear()
    useNotificationStore().clear()

    desktopApi = createDesktopApiMock()
    activeProjectRoot = null
    vi.mocked(desktopApi.workspace.isProjectDirectory).mockResolvedValue(true)
    vi.mocked(desktopApi.workspace.registerProjectRoot).mockImplementation(
      async (path) => {
        activeProjectRoot = path
        return path
      },
    )
    vi.mocked(desktopApi.workspace.clearProjectRoot).mockImplementation(async () => {
      activeProjectRoot = null
    })
    getDesktopApiMock.mockReturnValue(desktopApi)
    onRuntimeEvent = undefined
    createRuntimeEventClientMock.mockReturnValue({
      onAll: vi.fn(),
      offAll: vi.fn(),
      connect: vi.fn(),
      close: vi.fn(),
    })
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
        workspace_handle: 'workspace-demo',
      },
    })

    await workspace.openProject(project)

    expect(runtimeEventBridge.onEvent).toHaveBeenCalledOnce()
    onRuntimeEvent = runtimeEventBridge.listeners[runtimeEventBridge.listeners.length - 1]
    expect(onRuntimeEvent).toBeDefined()
    return workspace
  }

  it('re-enters the active workspace without reloading it through ECC RPC', async () => {
    const workspace = useWorkspace()
    const activeProject: Project = {
      id: '/work/demo',
      name: 'demo',
      path: '/work/demo',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }

    workspace.currentProject.value = activeProject
    workspace.recentProjects.value = [{ ...activeProject }]
    settingsData.set('current_project_path', '/work/demo')

    await expect(
      workspace.openProject({
        ...activeProject,
        path: '/work/demo/',
      }),
    ).resolves.toBe(true)

    expect(loadWorkspaceApiMock).not.toHaveBeenCalled()
    expect(workspace.currentProject.value?.path).toBe('/work/demo')
    expect(settingsData.get('current_project_path')).toBe('/work/demo')
  })

  it('does not reopen the active workspace when it is selected from the directory picker', async () => {
    const workspace = useWorkspace()
    const activeProject: Project = {
      id: '/work/demo',
      name: 'demo',
      path: '/work/demo',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }
    loadWorkspaceApiMock.mockResolvedValueOnce({
      response: 'success',
      data: {
        directory: '/work/demo',
        workspace_handle: 'workspace-demo',
      },
    })

    await expect(workspace.openProject(activeProject)).resolves.toBe(true)
    vi.mocked(desktopApi.dialog.pickDirectory).mockResolvedValueOnce('/work/demo/')

    await expect(workspace.openProject()).resolves.toBe(true)

    expect(loadWorkspaceApiMock).toHaveBeenCalledOnce()
    expect(closeWorkspaceApiMock).not.toHaveBeenCalled()
    expect(workspace.workspaceSession.value.workspaceId).toBe('workspace-demo')
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
        workspace_handle: '/work/old',
      },
    })

    expect(await workspace.openProject(existingProject)).toBe(true)
    expect(workspace.currentProject.value?.path).toBe('/work/old')

    vi.mocked(desktopApi.dialog.pickDirectory).mockResolvedValueOnce(null)

    expect(await workspace.openProject()).toBe(false)
    expect(workspace.currentProject.value?.path).toBe('/work/old')
    expect(settingsData.get('current_project_path')).toBe('/work/old')
  })

  it('focuses another window instead of loading a workspace already open elsewhere', async () => {
    const workspace = useWorkspace()
    vi.mocked(desktopApi.workspace.openOrFocus).mockResolvedValueOnce({
      action: 'focused',
    })

    await expect(
      workspace.openProject({
        id: '/work/demo',
        name: 'demo',
        path: '/work/demo',
        lastOpened: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ).resolves.toBe(false)

    expect(desktopApi.workspace.openOrFocus).toHaveBeenCalledWith('/work/demo')
    expect(loadWorkspaceApiMock).not.toHaveBeenCalled()
    expect(desktopApi.workspace.bindWindow).not.toHaveBeenCalled()
    expect(workspace.currentProject.value).toBeNull()
  })

  it('restores the previous registry binding when a workspace switch fails', async () => {
    const workspace = useWorkspace()
    workspace.currentProject.value = {
      id: '/work/a',
      name: 'a',
      path: '/work/a',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }
    settingsData.set('current_project_path', '/work/a')
    activeProjectRoot = '/work/a'

    vi.mocked(desktopApi.workspace.openOrFocus).mockResolvedValueOnce({
      action: 'proceed',
      previousPath: '/work/a',
    })
    loadWorkspaceApiMock.mockResolvedValueOnce({
      response: 'failed',
      data: {},
      message: ['boom'],
    })

    await expect(
      workspace.openProject({
        id: '/work/b',
        name: 'b',
        path: '/work/b',
        lastOpened: new Date('2026-01-02T00:00:00.000Z'),
      }),
    ).resolves.toBe(false)

    expect(desktopApi.workspace.unbindWindow).toHaveBeenCalledWith('/work/b')
    expect(desktopApi.workspace.bindWindow).toHaveBeenCalledWith('/work/a')
    expect(workspace.currentProject.value?.path).toBe('/work/a')
  })

  it('does not close the current workspace when newProject affinity focuses another window', async () => {
    const workspace = useWorkspace()
    workspace.currentProject.value = {
      id: '/work/a',
      name: 'a',
      path: '/work/a',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }
    settingsData.set('current_project_path', '/work/a')

    vi.mocked(desktopApi.workspace.openOrFocus).mockResolvedValueOnce({
      action: 'focused',
    })

    await expect(
      workspace.newProject({
        directory: '/work/taken',
        pdk: 'ics55',
        pdk_root: '/pdk/ics55',
        parameters: {
          design: 'taken',
          top_module: 'top',
          clock: 'clk',
        },
        origin_def: '',
        origin_verilog: '',
        rtl_list: [],
      }),
    ).resolves.toBe(false)

    expect(createWorkspaceApiMock).not.toHaveBeenCalled()
    expect(desktopApi.workspace.clearProjectRoot).not.toHaveBeenCalled()
    expect(workspace.currentProject.value?.path).toBe('/work/a')
    expect(settingsData.get('current_project_path')).toBe('/work/a')
  })

  it('does not clear another window current_project_path hint when closing a different path', async () => {
    const workspace = useWorkspace()
    workspace.currentProject.value = {
      id: '/work/a',
      name: 'a',
      path: '/work/a',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }
    settingsData.set('current_project_path', '/work/b')

    await workspace.closeProject()

    expect(settingsData.get('current_project_path')).toBe('/work/b')
    expect(workspace.currentProject.value).toBeNull()
  })

  it('binds the window after a successful open and unbinds on close', async () => {
    const workspace = useWorkspace()
    loadWorkspaceApiMock.mockResolvedValueOnce({
      response: 'success',
      data: {
        directory: '/work/demo',
        workspace_handle: 'workspace-demo',
      },
    })

    await expect(
      workspace.openProject({
        id: '/work/demo',
        name: 'demo',
        path: '/work/demo',
        lastOpened: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ).resolves.toBe(true)

    expect(desktopApi.workspace.bindWindow).toHaveBeenCalledWith('/work/demo')

    await workspace.closeProject()

    expect(desktopApi.workspace.unbindWindow).toHaveBeenCalledWith('/work/demo')
  })

  it('registers the managed parent as a read-only scope after opening a workspace', async () => {
    const workspace = useWorkspace()
    resolveProjectRouteContextForWorkspaceMock.mockResolvedValueOnce({
      projectRoot: '/work',
      projectName: 'work',
    })
    loadWorkspaceApiMock.mockResolvedValueOnce({
      response: 'success',
      data: {
        directory: '/work/demo',
        workspace_handle: 'workspace-demo',
      },
    })

    await expect(
      workspace.openProject({
        id: '/work/demo',
        name: 'demo',
        path: '/work/demo',
        lastOpened: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ).resolves.toBe(true)

    expect(resolveProjectRouteContextForWorkspaceMock).toHaveBeenCalledWith('/work/demo')
    expect(desktopApi.workspace.registerProjectReadRoot).toHaveBeenCalledWith('/work')
  })

  it('stops before loading when the selected directory is not an ECOS workspace', async () => {
    const workspace = useWorkspace()

    vi.mocked(desktopApi.dialog.pickDirectory).mockResolvedValueOnce('/work/not-ecos')
    vi.mocked(desktopApi.workspace.isProjectDirectory).mockResolvedValueOnce(false)

    expect(await workspace.openProject()).toBe(false)
    expect(loadWorkspaceApiMock).not.toHaveBeenCalled()
    expect(desktopApi.workspace.isProjectDirectory).toHaveBeenCalledWith('/work/not-ecos')
    expect(workspace.currentProject.value).toBeNull()
  })

  it('rejects a quiet programmatic open for a non-workspace path without loading', async () => {
    const workspace = useWorkspace()

    vi.mocked(desktopApi.workspace.isProjectDirectory).mockResolvedValueOnce(false)

    expect(
      await workspace.openProject(
        {
          id: '/work/not-ecos',
          name: 'not-ecos',
          path: '/work/not-ecos',
          lastOpened: new Date(),
        },
        { quiet: true },
      ),
    ).toBe(false)
    expect(loadWorkspaceApiMock).not.toHaveBeenCalled()
    expect(workspace.currentProject.value).toBeNull()
  })

  it('keeps Agent chat messages when a workspace opens successfully', async () => {
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
        workspace_handle: '/work/old',
      },
    })

    expect(await workspace.openProject(existingProject)).toBe(true)
    expect(clearMessagesMock).not.toHaveBeenCalled()

    vi.mocked(desktopApi.dialog.pickDirectory).mockResolvedValueOnce('/work/bad')
    loadWorkspaceApiMock.mockResolvedValueOnce({
      response: 'error',
      message: ['not an ECOS workspace'],
      data: {},
    })

    expect(await workspace.openProject()).toBe(false)
    expect(clearMessagesMock).not.toHaveBeenCalled()

    vi.mocked(desktopApi.dialog.pickDirectory).mockResolvedValueOnce('/work/new')
    loadWorkspaceApiMock.mockResolvedValueOnce({
      response: 'success',
      data: {
        directory: '/work/new',
        workspace_handle: '/work/new',
      },
    })

    expect(await workspace.openProject()).toBe(true)
    expect(clearMessagesMock).not.toHaveBeenCalled()
  })

  it('keeps Agent chat messages when the workspace closes', async () => {
    const workspace = useWorkspace()
    const project: Project = {
      id: '/work/old',
      name: 'old',
      path: '/work/old',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }

    loadWorkspaceApiMock.mockResolvedValueOnce({
      response: 'success',
      data: {
        directory: '/work/old',
        workspace_handle: '/work/old',
      },
    })

    expect(await workspace.openProject(project)).toBe(true)

    await workspace.closeProject()

    expect(clearMessagesMock).not.toHaveBeenCalled()
  })

  it('does not let an in-flight project open commit after the workspace closes', async () => {
    const workspace = useWorkspace()
    const oldProject: Project = {
      id: '/work/old',
      name: 'old',
      path: '/work/old',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }
    const newProject: Project = {
      id: '/work/new',
      name: 'new',
      path: '/work/new',
      lastOpened: new Date('2026-01-02T00:00:00.000Z'),
    }
    loadWorkspaceApiMock.mockResolvedValueOnce({
      response: 'success',
      data: {
        directory: '/work/old',
        workspace_handle: 'workspace-old',
      },
    })
    await expect(workspace.openProject(oldProject)).resolves.toBe(true)

    let resolveNewWorkspace:
      | ((value: {
          response: string
          data: { directory: string; workspace_handle: string }
        }) => void)
      | undefined
    loadWorkspaceApiMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveNewWorkspace = resolve
      }),
    )

    const openNewProject = workspace.openProject(newProject)
    await vi.waitFor(() => {
      expect(loadWorkspaceApiMock).toHaveBeenCalledTimes(2)
    })
    await workspace.closeProject()

    resolveNewWorkspace?.({
      response: 'success',
      data: {
        directory: '/work/new',
        workspace_handle: 'workspace-new',
      },
    })

    await expect(openNewProject).resolves.toBe(false)
    expect(workspace.currentProject.value).toBeNull()
    expect(workspace.workspaceSession.value.state).toBe('idle')
    expect(workspace.runtimeBackendConnecting.value).toBe(false)
    expect(activeProjectRoot).toBeNull()
    expect(settingsData.has('current_project_path')).toBe(false)
    expect(closeWorkspaceApiMock).toHaveBeenCalledWith('workspace-old', 'backend')
    expect(closeWorkspaceApiMock).toHaveBeenCalledWith('workspace-new', 'backend')
  })

  it('does not let a delayed close clear a newer project root or persisted path', async () => {
    const workspace = useWorkspace()
    const oldProject: Project = {
      id: '/work/old',
      name: 'old',
      path: '/work/old',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }
    const newProject: Project = {
      id: '/work/new',
      name: 'new',
      path: '/work/new',
      lastOpened: new Date('2026-01-02T00:00:00.000Z'),
    }
    loadWorkspaceApiMock.mockResolvedValueOnce({
      response: 'success',
      data: {
        directory: '/work/old',
        workspace_handle: 'workspace-old',
      },
    })
    await expect(workspace.openProject(oldProject)).resolves.toBe(true)

    let releaseOldWorkspace: (() => void) | undefined
    closeWorkspaceApiMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseOldWorkspace = () => resolve({ ok: true })
        }),
    )
    loadWorkspaceApiMock.mockResolvedValueOnce({
      response: 'success',
      data: {
        directory: '/work/new',
        workspace_handle: 'workspace-new',
      },
    })

    const closeOldProject = workspace.closeProject()
    await vi.waitFor(() => {
      expect(closeWorkspaceApiMock).toHaveBeenCalledWith('workspace-old', 'backend')
    })
    await expect(workspace.openProject(newProject)).resolves.toBe(true)
    releaseOldWorkspace?.()
    await closeOldProject

    expect(workspace.currentProject.value?.path).toBe('/work/new')
    expect(workspace.workspaceSession.value).toMatchObject({
      projectRoot: '/work/new',
      workspaceId: 'workspace-new',
      state: 'active',
    })
    expect(activeProjectRoot).toBe('/work/new')
    expect(settingsData.get('current_project_path')).toBe('/work/new')
  })

  it('releases the previous ECC workspace only after a replacement opens', async () => {
    const workspace = useWorkspace()
    const oldProject: Project = {
      id: '/work/old',
      name: 'old',
      path: '/work/old',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }
    const newProject: Project = {
      id: '/work/new',
      name: 'new',
      path: '/work/new',
      lastOpened: new Date('2026-01-02T00:00:00.000Z'),
    }
    loadWorkspaceApiMock
      .mockResolvedValueOnce({
        response: 'success',
        data: {
          directory: '/work/old',
          workspace_handle: 'workspace-old',
        },
      })
      .mockResolvedValueOnce({
        response: 'success',
        data: {
          directory: '/work/new',
          workspace_handle: 'workspace-new',
        },
      })

    await expect(workspace.openProject(oldProject)).resolves.toBe(true)
    expect(closeWorkspaceApiMock).not.toHaveBeenCalled()

    await expect(workspace.openProject(newProject)).resolves.toBe(true)

    expect(closeWorkspaceApiMock).toHaveBeenCalledOnce()
    expect(closeWorkspaceApiMock).toHaveBeenCalledWith('workspace-old', 'backend')
    expect(workspace.workspaceSession.value.workspaceId).toBe('workspace-new')
  })

  it('does not wait for the previous runtime release when opening another workspace', async () => {
    const workspace = useWorkspace()
    const oldProject: Project = {
      id: '/work/old',
      name: 'old',
      path: '/work/old',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }
    const newProject: Project = {
      id: '/work/new',
      name: 'new',
      path: '/work/new',
      lastOpened: new Date('2026-01-02T00:00:00.000Z'),
    }
    loadWorkspaceApiMock
      .mockResolvedValueOnce({
        response: 'success',
        data: { directory: '/work/old', workspace_handle: 'workspace-old' },
      })
      .mockResolvedValueOnce({
        response: 'success',
        data: { directory: '/work/new', workspace_handle: 'workspace-new' },
      })
    await expect(workspace.openProject(oldProject)).resolves.toBe(true)

    let releaseOldWorkspace: (() => void) | undefined
    closeWorkspaceApiMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseOldWorkspace = () => resolve({ ok: true })
        }),
    )

    await expect(workspace.openProject(newProject)).resolves.toBe(true)
    expect(workspace.currentProject.value?.path).toBe('/work/new')
    expect(workspace.workspaceSession.value.workspaceId).toBe('workspace-new')
    expect(closeWorkspaceApiMock).toHaveBeenCalledWith('workspace-old', 'backend')
    releaseOldWorkspace?.()
  })

  it('snapshots a Backend recent-project summary from committed facts only', async () => {
    const workspace = useWorkspace()
    const project: Project = {
      id: '/work/demo',
      name: 'demo',
      path: '/work/demo',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }
    workspace.currentProject.value = project
    workspace.recentProjects.value = [{ ...project }]
    vi.mocked(desktopApi.backendWorkspace.getOverview).mockResolvedValueOnce({
      generation: 0,
      workspaceContextId: 'context-a',
      overview: {
        revision: {
          status: 'ready',
          data: { workspaceId: 'engineering-a', workspaceRevision: 9 },
          issues: [],
        },
        configuration: {
          status: 'ready',
          data: {
            pdk: 'ics55',
            design: 'gcd',
            topModule: 'top',
            dieArea: null,
            maxFanout: null,
            clock: 'clk',
            frequencyMaxMhz: 125,
            mpcDisplayName: null,
            mpcConstraints: null,
          },
          issues: [],
        },
        flow: {
          status: 'ready',
          data: {
            steps: [
              {
                name: 'synthesis',
                order: 0,
                runtimeSeconds: 65,
                state: 'succeeded',
                stepId: 'synthesis',
              },
              {
                name: 'floorplan',
                order: 1,
                runtimeSeconds: 30,
                state: 'running',
                stepId: 'floorplan',
              },
              {
                name: 'placement',
                order: 2,
                state: 'not-started',
                stepId: 'placement',
              },
            ],
          },
          issues: [],
        },
        keyMetrics: {
          status: 'ready',
          data: {
            items: [
              {
                id: 'core-utilization',
                label: 'Core Utility',
                value: 0.62,
                unit: 'ratio',
              },
            ],
          },
          issues: [],
        },
      },
    } as never)
    await workspace.closeProject()

    expect(readWorkspaceFlowResourceApiMock).not.toHaveBeenCalled()
    expect(readWorkspaceParametersResourceApiMock).not.toHaveBeenCalled()
    expect(desktopApi.workspace.readProjectTextFile).not.toHaveBeenCalled()
    expect(settingsData.get('recent_projects')).toEqual([
      expect.objectContaining({
        id: '/work/demo',
        name: 'demo',
        path: '/work/demo',
        lastOpened: '2026-01-01T00:00:00.000Z',
        status: 'running',
        totalSteps: 3,
        completedSteps: 1,
        currentStep: 'floorplan',
        totalRuntime: '1m 35s',
        pdk: 'ics55',
        topModule: 'top',
        frequencyTarget: 125,
        coreUtilization: 0.62,
        committedWorkspaceId: 'engineering-a',
        committedRevision: 9,
        committedVerifiedAt: expect.any(String),
      }),
    ])
  })

  it('reads canonical die_area utilization through committed Backend facts', async () => {
    const workspace = useWorkspace()
    const project: Project = {
      id: '/work/demo',
      name: 'demo',
      path: '/work/demo',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }
    workspace.currentProject.value = project
    workspace.recentProjects.value = [{ ...project }]
    vi.mocked(desktopApi.backendWorkspace.getOverview).mockResolvedValueOnce({
      generation: 0,
      workspaceContextId: 'context-a',
      overview: {
        configuration: {
          status: 'ready',
          data: { coreUtilization: 0.41 },
          issues: [],
        },
        flow: { status: 'unavailable', issues: [] },
        keyMetrics: { status: 'unavailable', issues: [] },
        revision: { status: 'unavailable', issues: [] },
      },
    } as never)
    await workspace.closeProject()

    expect(readWorkspaceParametersResourceApiMock).not.toHaveBeenCalled()
    expect(settingsData.get('recent_projects')).toEqual([
      expect.objectContaining({
        coreUtilization: 0.41,
      }),
    ])
  })

  it('applies a delayed snapshot to the original recent project after the list is prepended', async () => {
    const workspace = useWorkspace()
    const oldProject: Project = {
      id: '/work/old',
      name: 'old',
      path: '/work/old',
      designTool: 'frontend',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }
    const newProject: Project = {
      id: '/work/new',
      name: 'new',
      path: '/work/new',
      lastOpened: new Date('2026-01-02T00:00:00.000Z'),
      status: 'not_started',
      totalSteps: 9,
      completedSteps: 0,
      pdk: 'new-pdk',
      topModule: 'new_top',
    }
    let resolveFlow:
      | ((value: {
          steps: Array<{ name: string; state: string; runtime: string }>
        }) => void)
      | undefined

    workspace.currentProject.value = oldProject
    workspace.recentProjects.value = [{ ...oldProject }]
    readWorkspaceFlowResourceApiMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFlow = resolve
      }),
    )
    readWorkspaceParametersResourceApiMock.mockResolvedValueOnce({
      PDK: 'old-pdk',
      'Top module': 'old_top',
      'Frequency max [MHz]': 100,
      Core: {
        Utilitization: 0.5,
      },
    })
    const closePromise = workspace.closeProject()

    await vi.waitFor(() => {
      expect(readWorkspaceFlowResourceApiMock).toHaveBeenCalledTimes(1)
    })

    workspace.recentProjects.value = [
      { ...newProject },
      ...workspace.recentProjects.value,
    ]
    resolveFlow?.({
      steps: [
        { name: 'synthesis', state: 'Success', runtime: '00:01:00' },
        { name: 'floorplan', state: 'Ongoing', runtime: '00:00:30' },
      ],
    })

    await closePromise

    expect(settingsData.get('recent_projects')).toEqual([
      expect.objectContaining({
        id: '/work/new',
        name: 'new',
        path: '/work/new',
        status: 'not_started',
        totalSteps: 9,
        completedSteps: 0,
        pdk: 'new-pdk',
        topModule: 'new_top',
      }),
      expect.objectContaining({
        id: '/work/old',
        name: 'old',
        path: '/work/old',
        status: 'running',
        totalSteps: 2,
        completedSteps: 1,
        currentStep: 'floorplan',
        totalRuntime: '1m 30s',
        pdk: 'old-pdk',
        topModule: 'old_top',
        frequencyTarget: 100,
        coreUtilization: 0.5,
      }),
    ])
  })

  it('ignores null or malformed workspace resource payloads when snapshotting a recent project', async () => {
    const workspace = useWorkspace()
    const project: Project = {
      id: '/work/demo',
      name: 'demo',
      path: '/work/demo',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }
    workspace.currentProject.value = project
    workspace.recentProjects.value = [
      {
        ...project,
        status: 'success',
        totalSteps: 8,
        completedSteps: 8,
        currentStep: 'signoff',
        totalRuntime: '14m 2s',
        pdk: 'existing-pdk',
        topModule: 'existing-top',
        frequencyTarget: 250,
        coreUtilization: 0.71,
      },
    ]
    readWorkspaceFlowResourceApiMock.mockResolvedValueOnce({
      steps: { synthesis: { state: 'Success' } },
    })
    readWorkspaceParametersResourceApiMock.mockResolvedValueOnce({
      PDK: { name: 'ics55' },
      'Top module': ['top'],
      'Frequency max [MHz]': '250',
      Core: 'not-an-object',
    })
    await expect(workspace.closeProject()).resolves.toBeUndefined()

    expect(desktopApi.workspace.readProjectTextFile).not.toHaveBeenCalled()
    expect(settingsData.get('recent_projects')).toEqual([
      expect.objectContaining({
        id: '/work/demo',
        name: 'demo',
        path: '/work/demo',
        lastOpened: '2026-01-01T00:00:00.000Z',
        status: 'success',
        totalSteps: 8,
        completedSteps: 8,
        currentStep: 'signoff',
        totalRuntime: '14m 2s',
        pdk: 'existing-pdk',
        topModule: 'existing-top',
        frequencyTarget: 250,
        coreUtilization: 0.71,
      }),
    ])
  })

  it('ignores malformed workspace flow step arrays when snapshotting a recent project', async () => {
    const workspace = useWorkspace()
    const project: Project = {
      id: '/work/demo',
      name: 'demo',
      path: '/work/demo',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }
    workspace.currentProject.value = project
    workspace.recentProjects.value = [
      {
        ...project,
        status: 'running',
        totalSteps: 3,
        completedSteps: 1,
        currentStep: 'floorplan',
        totalRuntime: '1m 35s',
      },
    ]
    readWorkspaceFlowResourceApiMock.mockResolvedValueOnce({
      steps: ['bad', { name: 'synthesis' }, { runtime: '00:01:05' }],
    })
    readWorkspaceParametersResourceApiMock.mockResolvedValueOnce(null)

    await workspace.closeProject()

    expect(desktopApi.workspace.readProjectTextFile).not.toHaveBeenCalled()
    expect(settingsData.get('recent_projects')).toEqual([
      expect.objectContaining({
        id: '/work/demo',
        name: 'demo',
        path: '/work/demo',
        lastOpened: '2026-01-01T00:00:00.000Z',
        status: 'running',
        totalSteps: 3,
        completedSteps: 1,
        currentStep: 'floorplan',
        totalRuntime: '1m 35s',
      }),
    ])
  })

  it('preserves an existing flow summary when a workspace flow step array is mixed malformed', async () => {
    const workspace = useWorkspace()
    const project: Project = {
      id: '/work/demo',
      name: 'demo',
      path: '/work/demo',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }
    workspace.currentProject.value = project
    workspace.recentProjects.value = [
      {
        ...project,
        status: 'running',
        totalSteps: 3,
        completedSteps: 1,
        currentStep: 'floorplan',
        totalRuntime: '1m 35s',
      },
    ]
    readWorkspaceFlowResourceApiMock.mockResolvedValueOnce({
      steps: [
        { name: 'synthesis', state: 'Success', runtime: '00:01:00' },
        { state: 'Ongoing' },
      ],
    })
    readWorkspaceParametersResourceApiMock.mockResolvedValueOnce(null)

    await workspace.closeProject()

    expect(settingsData.get('recent_projects')).toEqual([
      expect.objectContaining({
        id: '/work/demo',
        name: 'demo',
        path: '/work/demo',
        lastOpened: '2026-01-01T00:00:00.000Z',
        status: 'running',
        totalSteps: 3,
        completedSteps: 1,
        currentStep: 'floorplan',
        totalRuntime: '1m 35s',
      }),
    ])
  })

  it('snapshots an empty workspace flow as not started and clears stale step details', async () => {
    const workspace = useWorkspace()
    const project: Project = {
      id: '/work/demo',
      name: 'demo',
      path: '/work/demo',
      designTool: 'frontend',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }
    workspace.currentProject.value = project
    workspace.recentProjects.value = [
      {
        ...project,
        status: 'running',
        totalSteps: 3,
        completedSteps: 1,
        currentStep: 'floorplan',
        totalRuntime: '1m 35s',
      },
    ]
    readWorkspaceFlowResourceApiMock.mockResolvedValueOnce({ steps: [] })
    readWorkspaceParametersResourceApiMock.mockResolvedValueOnce(null)

    await workspace.closeProject()

    expect(desktopApi.workspace.readProjectTextFile).not.toHaveBeenCalled()
    expect(settingsData.get('recent_projects')).toEqual([
      expect.objectContaining({
        id: '/work/demo',
        name: 'demo',
        path: '/work/demo',
        lastOpened: '2026-01-01T00:00:00.000Z',
        status: 'not_started',
        totalSteps: 0,
        completedSteps: 0,
      }),
    ])
    const [savedProject] = readRecentProjectsSetting()
    expect(savedProject).toBeDefined()
    expect(savedProject).not.toHaveProperty('currentStep')
    expect(savedProject).not.toHaveProperty('totalRuntime')
  })

  it('ignores flow steps missing names when snapshotting a recent project', async () => {
    const workspace = useWorkspace()
    const project: Project = {
      id: '/work/demo',
      name: 'demo',
      path: '/work/demo',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }
    workspace.currentProject.value = project
    workspace.recentProjects.value = [
      {
        ...project,
        status: 'running',
        totalSteps: 3,
        completedSteps: 1,
        currentStep: 'floorplan',
        totalRuntime: '1m 35s',
      },
    ]
    readWorkspaceFlowResourceApiMock.mockResolvedValueOnce({
      steps: [{ state: 'Success' }],
    })
    readWorkspaceParametersResourceApiMock.mockResolvedValueOnce(null)

    await workspace.closeProject()

    expect(desktopApi.workspace.readProjectTextFile).not.toHaveBeenCalled()
    expect(settingsData.get('recent_projects')).toEqual([
      expect.objectContaining({
        id: '/work/demo',
        name: 'demo',
        path: '/work/demo',
        lastOpened: '2026-01-01T00:00:00.000Z',
        status: 'running',
        totalSteps: 3,
        completedSteps: 1,
        currentStep: 'floorplan',
        totalRuntime: '1m 35s',
      }),
    ])
  })

  it('clears stale current step when snapshotting an all-success flow', async () => {
    const workspace = useWorkspace()
    const project: Project = {
      id: '/work/demo',
      name: 'demo',
      path: '/work/demo',
      designTool: 'frontend',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }
    workspace.currentProject.value = project
    workspace.recentProjects.value = [
      {
        ...project,
        status: 'running',
        totalSteps: 3,
        completedSteps: 1,
        currentStep: 'floorplan',
        totalRuntime: '1m 35s',
      },
    ]
    readWorkspaceFlowResourceApiMock.mockResolvedValueOnce({
      steps: [
        { name: 'synthesis', state: 'Success', runtime: '00:01:05' },
        { name: 'floorplan', state: 'Success', runtime: '00:00:30' },
        { name: 'placement', state: 'Success', runtime: '00:02:00' },
      ],
    })
    readWorkspaceParametersResourceApiMock.mockResolvedValueOnce(null)

    await workspace.closeProject()

    expect(desktopApi.workspace.readProjectTextFile).not.toHaveBeenCalled()
    expect(settingsData.get('recent_projects')).toEqual([
      expect.objectContaining({
        id: '/work/demo',
        name: 'demo',
        path: '/work/demo',
        lastOpened: '2026-01-01T00:00:00.000Z',
        status: 'success',
        totalSteps: 3,
        completedSteps: 3,
        totalRuntime: '3m 35s',
      }),
    ])
    const [savedProject] = readRecentProjectsSetting()
    expect(savedProject).toBeDefined()
    expect(savedProject).not.toHaveProperty('currentStep')
  })

  it('does not persist NaN total runtime from malformed step runtime strings', async () => {
    const workspace = useWorkspace()
    const project: Project = {
      id: '/work/demo',
      name: 'demo',
      path: '/work/demo',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }
    workspace.currentProject.value = project
    workspace.recentProjects.value = [
      {
        ...project,
        status: 'running',
        totalSteps: 2,
        completedSteps: 1,
        currentStep: 'floorplan',
        totalRuntime: '14m 2s',
      },
    ]
    readWorkspaceFlowResourceApiMock.mockResolvedValueOnce({
      steps: [
        { name: 'synthesis', state: 'Success', runtime: 'aa:bb:cc' },
        { name: 'floorplan', state: 'Ongoing', runtime: '' },
      ],
    })
    readWorkspaceParametersResourceApiMock.mockResolvedValueOnce(null)

    await workspace.closeProject()

    expect(desktopApi.workspace.readProjectTextFile).not.toHaveBeenCalled()
    expect(settingsData.get('recent_projects')).toEqual([
      expect.objectContaining({
        id: '/work/demo',
        name: 'demo',
        path: '/work/demo',
        lastOpened: '2026-01-01T00:00:00.000Z',
        status: 'running',
        totalSteps: 2,
        completedSteps: 1,
        currentStep: 'floorplan',
        totalRuntime: '14m 2s',
      }),
    ])
  })

  it('ignores null workspace resource payloads when snapshotting a recent project', async () => {
    const workspace = useWorkspace()
    const project: Project = {
      id: '/work/demo',
      name: 'demo',
      path: '/work/demo',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }
    workspace.currentProject.value = project
    workspace.recentProjects.value = [
      {
        ...project,
        status: 'running',
        totalSteps: 3,
        completedSteps: 1,
        currentStep: 'floorplan',
        totalRuntime: '1m 35s',
        pdk: 'ics55',
        topModule: 'top',
        frequencyTarget: 125,
        coreUtilization: 0.62,
      },
    ]
    readWorkspaceFlowResourceApiMock.mockResolvedValueOnce(null)
    readWorkspaceParametersResourceApiMock.mockResolvedValueOnce(null)

    await expect(workspace.closeProject()).resolves.toBeUndefined()

    expect(desktopApi.workspace.readProjectTextFile).not.toHaveBeenCalled()
    expect(settingsData.get('recent_projects')).toEqual([
      expect.objectContaining({
        id: '/work/demo',
        name: 'demo',
        path: '/work/demo',
        lastOpened: '2026-01-01T00:00:00.000Z',
        status: 'running',
        totalSteps: 3,
        completedSteps: 1,
        currentStep: 'floorplan',
        totalRuntime: '1m 35s',
        pdk: 'ics55',
        topModule: 'top',
        frequencyTarget: 125,
        coreUtilization: 0.62,
      }),
    ])
  })

  it('switches without snapshotting resources from the previous Workspace', async () => {
    const workspace = useWorkspace()
    const oldProject: Project = {
      id: '/work/old',
      name: 'old',
      path: '/work/old',
      designTool: 'frontend',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }
    const newProject: Project = {
      id: '/work/new',
      name: 'new',
      path: '/work/new',
      lastOpened: new Date('2026-01-02T00:00:00.000Z'),
    }
    workspace.currentProject.value = oldProject
    workspace.recentProjects.value = [{ ...oldProject }]
    loadWorkspaceApiMock.mockResolvedValueOnce({
      response: 'success',
      data: { directory: '/work/new', workspace_handle: 'workspace-new' },
    })

    await expect(workspace.openProject(newProject)).resolves.toBe(true)

    expect(readWorkspaceFlowResourceApiMock).not.toHaveBeenCalled()
    expect(readWorkspaceParametersResourceApiMock).not.toHaveBeenCalled()
    expect(desktopApi.backendWorkspace.getOverview).not.toHaveBeenCalled()
  })

  it('keeps the latest project when overlapping switches resolve out of order', async () => {
    const workspace = useWorkspace()
    const currentProject: Project = {
      id: '/work/current',
      name: 'current',
      path: '/work/current',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }
    const projectA: Project = {
      id: '/work/a',
      name: 'a',
      path: '/work/a',
      lastOpened: new Date('2026-01-02T00:00:00.000Z'),
    }
    const projectB: Project = {
      id: '/work/b',
      name: 'b',
      path: '/work/b',
      lastOpened: new Date('2026-01-03T00:00:00.000Z'),
    }
    let resolveProjectA: ((value: unknown) => void) | undefined

    workspace.currentProject.value = currentProject
    workspace.recentProjects.value = [{ ...currentProject }]
    settingsData.set('recent_projects', [
      {
        ...currentProject,
        lastOpened: currentProject.lastOpened.toISOString(),
      },
    ])
    settingsData.set('current_project_path', '/work/current')
    loadWorkspaceApiMock.mockImplementation((path: string) => {
      if (path === '/work/a') {
        return new Promise((resolve) => {
          resolveProjectA = resolve
        })
      }
      return Promise.resolve({
        response: 'success',
        data: {
          directory: path,
          workspace_handle: path,
        },
      })
    })
    readWorkspaceFlowResourceApiMock.mockResolvedValue(null)
    readWorkspaceParametersResourceApiMock.mockResolvedValue(null)

    const openProjectA = workspace.openProject(projectA)
    await vi.waitFor(() => {
      expect(loadWorkspaceApiMock).toHaveBeenCalledWith('/work/a')
    })
    const openProjectB = workspace.openProject(projectB)

    await vi.waitFor(() => {
      expect(workspace.currentProject.value?.path).toBe('/work/b')
    })

    resolveProjectA?.({
      response: 'success',
      data: {
        directory: '/work/a',
        workspace_handle: '/work/a',
      },
    })

    await expect(openProjectB).resolves.toBe(true)
    await expect(openProjectA).resolves.toBe(false)

    expect(workspace.currentProject.value?.path).toBe('/work/b')
    expect(settingsData.get('current_project_path')).toBe('/work/b')
    const recentProjects = readRecentProjectsSetting()
    expect(recentProjects[0]).toEqual(
      expect.objectContaining({
        id: '/work/b',
        name: 'b',
        path: '/work/b',
      }),
    )
    expect(recentProjects).not.toEqual([
      expect.objectContaining({
        id: '/work/a',
        path: '/work/a',
      }),
      expect.anything(),
    ])
    expect(closeWorkspaceApiMock).toHaveBeenCalledOnce()
    expect(closeWorkspaceApiMock).toHaveBeenCalledWith('/work/a', 'backend')
    expect(closeWorkspaceApiMock).not.toHaveBeenCalledWith('/work/b', 'backend')
  })

  it('does not let a stale switch rollback a newer project root or persisted path', async () => {
    const workspace = useWorkspace()
    const oldProject: Project = {
      id: '/work/old',
      name: 'old',
      path: '/work/old',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }
    const projectA: Project = {
      id: '/work/a',
      name: 'a',
      path: '/work/a',
      lastOpened: new Date('2026-01-02T00:00:00.000Z'),
    }
    const projectB: Project = {
      id: '/work/b',
      name: 'b',
      path: '/work/b',
      lastOpened: new Date('2026-01-03T00:00:00.000Z'),
    }
    loadWorkspaceApiMock.mockImplementation(async (path: string) => ({
      response: 'success',
      data: {
        directory: path,
        workspace_handle: `workspace-${path.split('/').pop()}`,
      },
    }))
    readWorkspaceFlowResourceApiMock.mockResolvedValue(null)
    readWorkspaceParametersResourceApiMock.mockResolvedValue(null)

    await expect(workspace.openProject(oldProject)).resolves.toBe(true)
    let releaseProjectAPathWrite: (() => void) | undefined
    vi.mocked(desktopApi.settings.set).mockImplementation(async (key, value) => {
      if (key === 'current_project_path' && value === '/work/a') {
        await new Promise<void>((resolve) => {
          releaseProjectAPathWrite = () => {
            settingsData.set(key, value)
            resolve()
          }
        })
        return
      }
      settingsData.set(key, value)
    })

    const openProjectA = workspace.openProject(projectA)
    await vi.waitFor(() => {
      expect(releaseProjectAPathWrite).toBeDefined()
      expect(activeProjectRoot).toBe('/work/a')
    })

    const openProjectB = workspace.openProject(projectB)
    await vi.waitFor(() => {
      expect(desktopApi.workspace.registerProjectRoot).toHaveBeenCalledWith('/work/b')
    })
    releaseProjectAPathWrite?.()

    await expect(openProjectA).resolves.toBe(false)
    await expect(openProjectB).resolves.toBe(true)
    expect(workspace.currentProject.value?.path).toBe('/work/b')
    expect(activeProjectRoot).toBe('/work/b')
    expect(settingsData.get('current_project_path')).toBe('/work/b')
    expect(closeWorkspaceApiMock).toHaveBeenCalledWith('workspace-a', 'backend')
    expect(closeWorkspaceApiMock).not.toHaveBeenCalledWith('workspace-b', 'backend')
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
        workspace_handle: '/work/old',
      },
    })

    expect(await workspace.openProject(existingProject)).toBe(true)
    const oldSessionId = workspace.workspaceSession.value.sessionId

    vi.mocked(desktopApi.dialog.pickDirectory).mockResolvedValueOnce('/work/bad')
    loadWorkspaceApiMock.mockResolvedValueOnce({
      response: 'error',
      message: ['not an ECOS workspace'],
      data: {},
    })

    expect(await workspace.openProject()).toBe(false)
    expect(workspace.currentProject.value?.path).toBe('/work/old')
    expect(settingsData.get('current_project_path')).toBe('/work/old')
    expect(workspace.workspaceSession.value).toMatchObject({
      sessionId: oldSessionId,
      workspaceId: '/work/old',
      projectRoot: '/work/old',
      state: 'active',
    })
  })

  it('keeps the active workspace when a provided project fails to load', async () => {
    const workspace = useWorkspace()
    const existingProject: Project = {
      id: '/work/old',
      name: 'old',
      path: '/work/old',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }
    const candidateProject: Project = {
      id: '/work/new',
      name: 'new',
      path: '/work/new',
      lastOpened: new Date('2026-01-02T00:00:00.000Z'),
    }
    loadWorkspaceApiMock
      .mockResolvedValueOnce({
        response: 'success',
        data: {
          directory: '/work/old',
          workspace_handle: 'workspace-old',
        },
      })
      .mockResolvedValueOnce({
        response: 'error',
        message: ['failed to open candidate'],
        data: {},
      })

    await expect(workspace.openProject(existingProject)).resolves.toBe(true)
    const oldSession = { ...workspace.workspaceSession.value }

    await expect(workspace.openProject(candidateProject)).resolves.toBe(false)

    expect(workspace.currentProject.value?.path).toBe('/work/old')
    expect(workspace.workspaceSession.value).toMatchObject({
      sessionId: oldSession.sessionId,
      workspaceId: 'workspace-old',
      state: 'active',
    })
    expect(closeWorkspaceApiMock).not.toHaveBeenCalled()
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
        workspace_handle: '/work/old',
      },
    })

    expect(await workspace.openProject(existingProject)).toBe(true)
    const oldSessionId = workspace.workspaceSession.value.sessionId

    vi.mocked(desktopApi.dialog.pickDirectory).mockResolvedValueOnce('/work/new')
    vi.mocked(desktopApi.workspace.registerProjectRoot).mockRejectedValueOnce(
      new Error('permission denied'),
    )
    loadWorkspaceApiMock.mockResolvedValueOnce({
      response: 'success',
      data: {
        directory: '/work/new',
        workspace_handle: '/work/new',
      },
    })

    expect(await workspace.openProject()).toBe(false)
    expect(workspace.currentProject.value?.path).toBe('/work/old')
    expect(settingsData.get('current_project_path')).toBe('/work/old')
    expect(workspace.workspaceSession.value).toMatchObject({
      sessionId: oldSessionId,
      workspaceId: '/work/old',
      state: 'active',
    })
    expect(closeWorkspaceApiMock).toHaveBeenCalledOnce()
    expect(closeWorkspaceApiMock).toHaveBeenCalledWith('/work/new', 'backend')
    expect(closeWorkspaceApiMock).not.toHaveBeenCalledWith('/work/old', 'backend')
  })

  it('rolls back the candidate when persisting its project path fails', async () => {
    const workspace = useWorkspace()
    const existingProject: Project = {
      id: '/work/old',
      name: 'old',
      path: '/work/old',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }
    const candidateProject: Project = {
      id: '/work/new',
      name: 'new',
      path: '/work/new',
      lastOpened: new Date('2026-01-02T00:00:00.000Z'),
    }
    loadWorkspaceApiMock
      .mockResolvedValueOnce({
        response: 'success',
        data: {
          directory: '/work/old',
          workspace_handle: 'workspace-old',
        },
      })
      .mockResolvedValueOnce({
        response: 'success',
        data: {
          directory: '/work/new',
          workspace_handle: 'workspace-new',
        },
      })

    await expect(workspace.openProject(existingProject)).resolves.toBe(true)
    const oldSession = { ...workspace.workspaceSession.value }
    vi.mocked(desktopApi.settings.set).mockImplementation(async (key, value) => {
      if (key === 'current_project_path' && value === '/work/new') {
        throw new Error('settings unavailable')
      }
      settingsData.set(key, value)
    })

    await expect(workspace.openProject(candidateProject)).resolves.toBe(false)

    expect(workspace.currentProject.value?.path).toBe('/work/old')
    expect(workspace.workspaceSession.value).toMatchObject({
      sessionId: oldSession.sessionId,
      workspaceId: 'workspace-old',
      state: 'active',
    })
    expect(activeProjectRoot).toBe('/work/old')
    expect(settingsData.get('current_project_path')).toBe('/work/old')
    expect(closeWorkspaceApiMock).toHaveBeenCalledOnce()
    expect(closeWorkspaceApiMock).toHaveBeenCalledWith('workspace-new', 'backend')
    expect(closeWorkspaceApiMock).not.toHaveBeenCalledWith('workspace-old', 'backend')
  })

  it('checks only desktop bridge availability before workspace operations', async () => {
    const workspace = useWorkspace()
    getDesktopApiMock.mockClear()

    await expect(workspace.ensureApiReady()).resolves.toBe(true)

    expect(getDesktopApiMock).toHaveBeenCalledOnce()
    expect(workspace.runtimeBackendConnecting.value).toBe(false)
  })

  it('reports desktop runtime availability failures through ensureApiReady', async () => {
    const workspace = useWorkspace()
    getDesktopApiMock.mockImplementationOnce(() => {
      throw new Error('bridge unavailable')
    })

    await expect(workspace.ensureApiReady()).resolves.toBe(false)

    expect(workspace.runtimeBackendConnecting.value).toBe(false)
  })

  it('keeps the workspace loading overlay visible while an existing workspace is loading', async () => {
    const workspace = useWorkspace()
    let resolveLoadWorkspace: ((value: unknown) => void) | undefined
    loadWorkspaceApiMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLoadWorkspace = resolve
      }),
    )

    const project: Project = {
      id: '/work/demo',
      name: 'demo',
      path: '/work/demo',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }

    const openPromise = workspace.openProject(project)

    await vi.waitFor(() => {
      expect(loadWorkspaceApiMock).toHaveBeenCalledWith('/work/demo')
    })

    expect(workspace.runtimeBackendConnecting.value).toBe(true)
    expect(workspace.runtimeBackendTitle.value).toBe('Loading your workspace')

    resolveLoadWorkspace?.({
      response: 'success',
      data: {
        directory: '/work/demo',
        workspace_handle: 'workspace-demo',
      },
      message: [],
    })

    await expect(openPromise).resolves.toBe(true)
    expect(workspace.runtimeBackendConnecting.value).toBe(false)
  })

  it('marks the workspace lifecycle session active after an existing workspace opens', async () => {
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
        workspace_handle: 'workspace-demo',
      },
    })

    expect(await workspace.openProject(project)).toBe(true)

    expect(workspace.workspaceSession.value).toMatchObject({
      workspaceId: 'workspace-demo',
      projectRoot: '/work/demo',
      state: 'active',
    })
  })

  it('runs lifecycle cleanup callbacks when the workspace closes', async () => {
    const workspace = await openWorkspaceAndConnectRuntimeEvents()
    const lifecycle = useWorkspaceLifecycle()
    const cleanup = vi.fn()

    lifecycle.registerCleanup(cleanup, {
      sessionId: workspace.workspaceSession.value.sessionId,
      label: 'test cleanup',
    })

    await workspace.closeProject()

    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(closeWorkspaceApiMock).toHaveBeenCalledOnce()
    expect(closeWorkspaceApiMock).toHaveBeenCalledWith('workspace-demo', 'backend')
    expect(workspace.workspaceSession.value.state).toBe('idle')
  })

  it('finishes local project cleanup when the ECC workspace close fails', async () => {
    const workspace = await openWorkspaceAndConnectRuntimeEvents()
    const closeError = new Error('sidecar unavailable')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    closeWorkspaceApiMock.mockRejectedValueOnce(closeError)

    try {
      await expect(workspace.closeProject()).resolves.toBeUndefined()

      expect(closeWorkspaceApiMock).toHaveBeenCalledWith('workspace-demo', 'backend')
      expect(warn).toHaveBeenCalledWith(
        'Failed to close design workspace session:',
        closeError,
      )
      expect(workspace.currentProject.value).toBeNull()
      expect(workspace.workspaceSession.value.state).toBe('idle')
      expect(desktopApi.workspace.clearProjectRoot).toHaveBeenCalled()
      expect(settingsData.has('current_project_path')).toBe(false)
    } finally {
      warn.mockRestore()
    }
  })

  it('ignores runtime events from an older workspace session after switching', async () => {
    const workspace = useWorkspace()
    const oldProject: Project = {
      id: '/work/old',
      name: 'old',
      path: '/work/old',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }
    const newProject: Project = {
      id: '/work/new',
      name: 'new',
      path: '/work/new',
      lastOpened: new Date('2026-01-02T00:00:00.000Z'),
    }
    let oldRuntimeEvent: ((event: DesignRuntimeEvent) => void) | undefined
    let newRuntimeEvent: ((event: DesignRuntimeEvent) => void) | undefined

    loadWorkspaceApiMock
      .mockResolvedValueOnce({
        response: 'success',
        data: {
          directory: '/work/old',
          workspace_handle: 'workspace-old',
        },
      })
      .mockResolvedValueOnce({
        response: 'success',
        data: {
          directory: '/work/new',
          workspace_handle: 'workspace-new',
        },
      })

    expect(await workspace.openProject(oldProject)).toBe(true)
    oldRuntimeEvent =
      runtimeEventBridge.listeners[runtimeEventBridge.listeners.length - 1]
    expect(await workspace.openProject(newProject)).toBe(true)
    newRuntimeEvent =
      runtimeEventBridge.listeners[runtimeEventBridge.listeners.length - 1]

    oldRuntimeEvent?.(
      backendProtocolEvent(
        'step.completed',
        { step: 'floorplan' },
        {
          operationId: 'job-old',
          workspaceDirectory: '/work/old',
          workspaceHandle: 'workspace-old',
        },
      ),
    )
    expect(workspace.backendRuntimeEvents.value).toHaveLength(0)

    newRuntimeEvent?.(
      backendProtocolEvent(
        'step.completed',
        { step: 'placement' },
        {
          operationId: 'job-new',
          workspaceDirectory: '/work/new',
          workspaceHandle: 'workspace-new',
        },
      ),
    )
    expect(workspace.backendRuntimeEvents.value).toHaveLength(1)
  })

  it('invalidates result resources without reloading Step Configuration when rtl2gds completes', async () => {
    const workspace = await openWorkspaceAndConnectRuntimeEvents()
    const before = { ...workspace.resourceVersions.value }

    onRuntimeEvent?.(
      backendProtocolEvent(
        'operation.completed',
        {},
        {
          operationId: 'job-rtl2gds',
        },
      ),
    )

    expect(workspace.resourceVersions.value.all).toBe(before.all)
    expect(workspace.resourceVersions.value['step-config']).toBe(before['step-config'])
    expect(workspace.resourceVersions.value.home).toBe(before.home + 1)
    expect(workspace.resourceVersions.value.flow).toBe(before.flow + 1)
    expect(workspace.resourceVersions.value.step).toBe(before.step + 1)
    expect(workspace.resourceVersions.value.maps).toBe(before.maps + 1)
    expect(workspace.resourceVersions.value.logs).toBe(before.logs + 1)
  })

  it('requests Home artifact reset after ECC prepares a full-flow rerun', async () => {
    const workspace = await openWorkspaceAndConnectRuntimeEvents()

    onRuntimeEvent?.(
      backendProtocolEvent(
        'operation.rerun_prepared',
        { scope: 'flow' },
        { rerun: true },
      ),
    )

    expect(workspace.backendRuntimeEvents.value).toHaveLength(1)
    expect(requestHomeRunArtifactResetMock).toHaveBeenCalledWith('/work/demo')
    expect(notifyWorkspaceRerunPreparedMock).toHaveBeenCalledWith({
      affectedSteps: [],
      projectPath: '/work/demo',
      scope: 'flow',
      targetStep: '',
    })
  })

  it('broadcasts a single-step rerun without resetting the whole Home workspace', async () => {
    await openWorkspaceAndConnectRuntimeEvents()

    onRuntimeEvent?.(
      backendProtocolEvent(
        'operation.rerun_prepared',
        {
          affectedSteps: ['Floorplan', 'route'],
          scope: 'step',
          targetStep: 'Floorplan',
        },
        { rerun: true },
      ),
    )

    expect(notifyWorkspaceRerunPreparedMock).toHaveBeenCalledWith({
      affectedSteps: ['Floorplan', 'route'],
      projectPath: '/work/demo',
      scope: 'step',
      targetStep: 'Floorplan',
    })
    expect(requestHomeRunArtifactResetMock).not.toHaveBeenCalled()
  })

  it('releases the workspace run lock when a single-step operation completes', async () => {
    await openWorkspaceAndConnectRuntimeEvents()

    onRuntimeEvent?.(backendProtocolEvent('operation.completed'))

    expect(clearFlowExecutionActiveForWorkspaceMock).toHaveBeenCalledWith('/work/demo')
  })

  it('updates a stopped sidecar notification after interruption recovery', async () => {
    await openWorkspaceAndConnectRuntimeEvents()
    const notifications = useNotificationStore()

    onRuntimeEvent?.({
      code: 1,
      designTool: 'backend',
      interruptedOperationId: 'operation-place',
      message: 'ECC RPC sidecar exited unexpectedly.',
      reason: 'unexpected',
      signal: null,
      type: 'runtime.exited',
      workspaceDirectory: '/work/demo',
      workspaceHandle: 'workspace-demo',
    })
    onRuntimeEvent?.({
      code: 'interrupted',
      designTool: 'backend',
      logFile: '/work/demo/place_dreamplace/log/place.log',
      message: 'place was interrupted when the ECC sidecar stopped.',
      method: 'flow.run_step',
      operationId: 'operation-place',
      step: 'place',
      type: 'operation.failed',
      workspaceDirectory: '/work/demo',
      workspaceHandle: 'workspace-demo',
    })

    expect(notifications.notifications.value).toEqual([
      expect.objectContaining({
        key: 'operation-place',
        logFile: '/work/demo/place_dreamplace/log/place.log',
        title: 'Place interrupted',
      }),
    ])
  })

  it('labels an interruption recovered on a later workspace open', async () => {
    await openWorkspaceAndConnectRuntimeEvents()
    const notifications = useNotificationStore()

    onRuntimeEvent?.({
      code: 'interrupted',
      designTool: 'backend',
      details: { previousRun: true },
      message: 'Previous place run was interrupted.',
      method: 'flow.run_step',
      operationId: 'operation-place',
      step: 'place',
      type: 'operation.failed',
      workspaceDirectory: '/work/demo',
      workspaceHandle: 'workspace-demo',
    })

    expect(notifications.notifications.value[0]?.title).toBe(
      'Previous Place run was interrupted',
    )
  })

  it('waits for the main-process terminal tracker when the renderer misses completion', async () => {
    const workspace = await openWorkspaceAndConnectRuntimeEvents()
    let resolveTracker: ((operation: { state: string }) => void) | undefined
    const waitForOperation = vi.fn(
      () =>
        new Promise<{ state: string }>((resolve) => {
          resolveTracker = resolve
        }),
    )
    getDesktopApiMock.mockReturnValue({
      ecc: { runtime: { waitForOperation } },
    } as unknown as DesktopApi)

    const completion = workspace.waitForRuntimeOperation('operation-1')

    expect(waitForOperation).toHaveBeenCalledWith({
      operationId: 'operation-1',
      workspaceHandle: 'workspace-demo',
    })

    resolveTracker?.({ state: 'succeeded' })
    await expect(completion).resolves.toBeUndefined()
  })

  it('uses the current project path for prepared rerun events with only a workspace handle', async () => {
    const workspace = await openWorkspaceAndConnectRuntimeEvents()

    onRuntimeEvent?.(
      backendProtocolEvent(
        'operation.rerun_prepared',
        { scope: 'flow' },
        { rerun: true, workspaceDirectory: null },
      ),
    )

    expect(workspace.backendRuntimeEvents.value).toHaveLength(1)
    expect(requestHomeRunArtifactResetMock).toHaveBeenCalledWith('/work/demo')
    expect(requestHomeRunArtifactResetMock).not.toHaveBeenCalledWith('workspace-demo')
  })

  it('accepts a new rerun event when a fresh sidecar reuses an event id', async () => {
    const workspace = await openWorkspaceAndConnectRuntimeEvents()
    const sharedEventId = 'workspace-demo:1'

    onRuntimeEvent?.(
      backendProtocolEvent(
        'operation.rerun_prepared',
        { scope: 'flow' },
        {
          eventId: sharedEventId,
          operationId: 'operation-old',
          rerun: true,
          runtimeInstanceId: 'runtime-old',
        },
      ),
    )
    onRuntimeEvent?.(
      backendProtocolEvent(
        'operation.rerun_prepared',
        { scope: 'flow' },
        {
          eventId: sharedEventId,
          operationId: 'operation-new',
          rerun: true,
          runtimeInstanceId: 'runtime-new',
        },
      ),
    )

    expect(workspace.backendRuntimeEvents.value).toHaveLength(2)
    expect(requestHomeRunArtifactResetMock).toHaveBeenCalledTimes(2)
  })

  it('keeps the workspace loading overlay visible while a new workspace is being created', async () => {
    const workspace = useWorkspace()
    let resolveCreateWorkspace: ((value: unknown) => void) | undefined
    createWorkspaceApiMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCreateWorkspace = resolve
      }),
    )

    const createPromise = workspace.newProject({
      directory: '/work/new-project',
      pdk: 'ics55',
      pdk_root: '/pdk/ics55',
      parameters: {
        design: 'new_project',
        top_module: 'top',
        clock: 'clk',
      },
      mpc: {
        resource_id: 'mpc:mpc-frame',
        display_name: 'MPC Frame',
        installed_version: '0.1.0',
        path: '/resources/mpcs/mpc-frame/0.1.0',
        spec_path: '/resources/mpcs/mpc-frame/0.1.0/spec/spec.json.in',
        design: { index: 0, design_name: 'frame' },
        core_template: { minimum_area: 100, maximum_area: 500 },
      },
      origin_def: '',
      origin_verilog: '',
      rtl_list: [],
    })

    await vi.waitFor(() => {
      expect(createWorkspaceApiMock).toHaveBeenCalled()
    })

    expect(createWorkspaceApiMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceSpec: expect.objectContaining({
          mpc: {
            designId: 'frame',
            resourceId: 'mpc:mpc-frame',
            version: '0.1.0',
          },
        }),
        workspaceBindings: expect.objectContaining({
          mpc: expect.objectContaining({
            template: { minimum_area: 100, maximum_area: 500 },
          }),
        }),
      }),
    )

    expect(workspace.runtimeBackendConnecting.value).toBe(true)

    resolveCreateWorkspace?.({
      response: 'success',
      data: {
        directory: '/work/new-project',
        workspace_handle: 'workspace-new-project',
      },
      message: [],
    })

    await expect(createPromise).resolves.toBe(true)
    expect(workspace.runtimeBackendConnecting.value).toBe(false)
  })

  it('does not await Electron-owned release of the previous runtime', async () => {
    const workspace = useWorkspace()
    let flowActive = true
    isFlowExecutionActiveForWorkspaceMock.mockImplementation(() => flowActive)
    const oldProject: Project = {
      id: '/work/old',
      name: 'old',
      path: '/work/old',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }
    loadWorkspaceApiMock.mockResolvedValueOnce({
      response: 'success',
      data: {
        directory: '/work/old',
        workspace_handle: 'workspace-old',
      },
    })
    await expect(workspace.openProject(oldProject)).resolves.toBe(true)

    let releaseOldWorkspace: (() => void) | undefined
    closeWorkspaceApiMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseOldWorkspace = () => resolve({ ok: true })
        }),
    )
    createWorkspaceApiMock.mockResolvedValueOnce({
      response: 'success',
      data: {
        directory: '/work/new',
        workspace_handle: 'workspace-new',
      },
      message: [],
    })

    const createPromise = workspace.newProject({
      directory: '/work/new',
      pdk: 'ics55',
      pdk_root: '/pdk/ics55',
      parameters: { design: 'new', top_module: 'top', clock: 'clk' },
      origin_def: '',
      origin_verilog: '',
      rtl_list: [],
    })

    await expect(createPromise).resolves.toBe(true)
    expect(createWorkspaceApiMock).toHaveBeenCalledOnce()
    expect(workspace.currentProject.value?.path).toBe('/work/new')
    expect(closeWorkspaceApiMock).toHaveBeenCalledWith('workspace-old', 'backend')
    releaseOldWorkspace?.()
  })

  it('treats creating the canonical current workspace as a no-op', async () => {
    const workspace = useWorkspace()
    workspace.currentProject.value = {
      id: '/work/current',
      name: 'current',
      path: '/work/current',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }

    await expect(
      workspace.newProject({
        directory: '/work/current/',
        pdk: 'ics55',
        pdk_root: '/pdk/ics55',
        parameters: { design: 'current', top_module: 'top', clock: 'clk' },
        origin_def: '',
        origin_verilog: '',
        rtl_list: [],
      }),
    ).resolves.toBe(true)

    expect(createWorkspaceApiMock).not.toHaveBeenCalled()
    expect(closeWorkspaceApiMock).not.toHaveBeenCalled()
    expect(workspace.currentProject.value?.path).toBe('/work/current')
  })

  it('delegates background finalization and release to Electron', async () => {
    const workspace = useWorkspace()
    let flowActive = true
    isFlowExecutionActiveForWorkspaceMock.mockImplementation(() => flowActive)
    const snapshotMock = vi.mocked(desktopApi.ecc.runtime!.snapshot)

    loadWorkspaceApiMock
      .mockResolvedValueOnce({
        response: 'success',
        data: { directory: '/work/old', workspace_handle: 'workspace-old' },
      })
      .mockResolvedValueOnce({
        response: 'success',
        data: { directory: '/work/new', workspace_handle: 'workspace-new' },
      })

    await expect(
      workspace.openProject({
        id: '/work/old',
        name: 'old',
        path: '/work/old',
        lastOpened: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ).resolves.toBe(true)
    await expect(
      workspace.openProject({
        id: '/work/new',
        name: 'new',
        path: '/work/new',
        lastOpened: new Date('2026-01-02T00:00:00.000Z'),
      }),
    ).resolves.toBe(true)

    expect(closeWorkspaceApiMock).toHaveBeenCalledWith('workspace-old', 'backend')
    expect(snapshotMock).not.toHaveBeenCalledWith({ workspaceHandle: 'workspace-old' })
  })

  it('registers a created workspace without replacing a newer foreground choice', async () => {
    const workspace = useWorkspace()
    workspace.currentProject.value = {
      id: '/work/current',
      name: 'current',
      path: '/work/current',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }
    createWorkspaceApiMock.mockResolvedValueOnce({
      response: 'success',
      data: {
        creationId: 'creation-background',
        directory: '/work/new',
        workspace_handle: 'workspace-new',
      },
      message: [],
    })

    await expect(
      workspace.newProject(
        {
          directory: '/work/new',
          pdk: 'ics55',
          pdk_root: '/pdk/ics55',
          parameters: { design: 'new', top_module: 'top', clock: 'clk' },
          origin_def: '',
          origin_verilog: '',
          rtl_list: [],
        },
        { shouldActivate: () => false },
      ),
    ).resolves.toBe(true)

    expect(workspace.currentProject.value?.path).toBe('/work/current')
    expect(desktopApi.workspace.registerProjectRoot).toHaveBeenLastCalledWith(
      '/work/current',
    )
    expect(closeWorkspaceApiMock).toHaveBeenCalledWith('workspace-new', 'backend')
    expect(desktopApi.productCommands.execute).toHaveBeenCalledWith({
      command: 'workspace.completeCreation',
      payload: { creationId: 'creation-background' },
    })
  })

  it('rejects a duplicate workspace creation while the first request is pending', async () => {
    const workspace = useWorkspace()
    let resolveCreateWorkspace: ((value: unknown) => void) | undefined
    createWorkspaceApiMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCreateWorkspace = resolve
      }),
    )
    const config = {
      directory: '/work/new-project',
      pdk: 'ics55',
      pdk_root: '/pdk/ics55',
      parameters: { design: 'new', top_module: 'top', clock: 'clk' },
      origin_def: '',
      origin_verilog: '',
      rtl_list: [],
    }

    const firstCreate = workspace.newProject(config)
    await vi.waitFor(() => expect(createWorkspaceApiMock).toHaveBeenCalledOnce())

    await expect(
      workspace.newProject({ ...config, directory: '/work/other' }),
    ).resolves.toBe(false)
    expect(createWorkspaceApiMock).toHaveBeenCalledOnce()

    resolveCreateWorkspace?.({
      response: 'success',
      data: { directory: '/work/new-project', workspace_handle: 'workspace-new' },
      message: [],
    })
    await expect(firstCreate).resolves.toBe(true)
  })

  it('opens and closes frontend workspaces through the unified runtime scope', async () => {
    const workspace = useWorkspace()
    const project: Project = {
      id: '/work/frontend-project',
      name: 'frontend-project',
      path: '/work/frontend-project',
      designTool: 'frontend',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }
    loadWorkspaceApiMock.mockResolvedValueOnce({
      response: 'success',
      data: {
        directory: '/work/frontend-project',
        workspace_handle: 'workspace-frontend',
      },
      message: [],
    })

    await expect(workspace.openProject(project)).resolves.toBe(true)

    expect(loadWorkspaceApiMock).toHaveBeenCalledWith(
      '/work/frontend-project',
      'frontend',
    )
    expect(workspace.currentProject.value?.designTool).toBe('frontend')
    expect(workspace.workspaceSession.value.workspaceId).toBe('workspace-frontend')
    expect(createRuntimeEventClientMock).toHaveBeenCalledWith('workspace-frontend', {
      workspaceDirectory: '/work/frontend-project',
    })

    await workspace.closeProject()
    expect(closeWorkspaceApiMock).toHaveBeenCalledWith('workspace-frontend', 'frontend')
  })

  it('forwards selected CPU RTL files when creating a frontend workspace', async () => {
    const workspace = useWorkspace()
    createWorkspaceApiMock.mockResolvedValueOnce({
      response: 'success',
      data: { directory: '/work/frontend-project' },
      message: [],
    })

    await expect(
      workspace.newProject({
        directory: '/work/frontend-project',
        designTool: 'frontend',
        cpu_rtl_files: ['/rtl/cpu_top.sv', '/rtl/alu.v'],
        pdk: '',
        pdk_root: '',
        parameters: {
          cpu_filelist: '',
          cpu_top_module: 'ysyx_00000000',
          design: 'frontend_project',
          frontend_core_id: 'custom-filelist',
          soc_harness_id: 'ysyx-am-soc',
          test_suite_id: 'cpu-tests',
          toolchain_id: 'riscv32-unknown-elf',
          top_module: 'ecos_sim_top',
        },
        origin_def: '',
        origin_verilog: '',
        rtl_list: [],
      }),
    ).resolves.toBe(true)

    expect(createWorkspaceApiMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cpu_filelist: '',
        cpu_rtl_files: ['/rtl/cpu_top.sv', '/rtl/alu.v'],
        cpu_top_module: 'ysyx_00000000',
        designTool: 'frontend',
        parameters: expect.objectContaining({
          'Top module': 'ecos_sim_top',
          cpu_top_module: 'ysyx_00000000',
        }),
      }),
    )
  })

  it('invalidates freshly created workspace resources after activating the session', async () => {
    const workspace = useWorkspace()
    const before = { ...workspace.resourceVersions.value }
    createWorkspaceApiMock.mockResolvedValueOnce({
      response: 'success',
      data: {
        directory: '/work/new-project',
        workspace_id: 'workspace-new-project',
      },
      message: [],
    })

    await expect(
      workspace.newProject({
        directory: '/work/new-project',
        pdk: 'ics55',
        pdk_root: '/pdk/ics55',
        parameters: {
          design: 'new_project',
          top_module: 'top',
          clock: 'clk',
        },
        origin_def: '',
        origin_verilog: '',
        rtl_list: [],
      }),
    ).resolves.toBe(true)

    expect(workspace.workspaceSession.value.state).toBe('active')
    expect(workspace.resourceVersions.value.home).toBe(before.home + 1)
    expect(workspace.resourceVersions.value.flow).toBe(before.flow + 1)
    expect(workspace.resourceVersions.value.parameters).toBe(before.parameters + 1)
  })

  it('names a newly created workspace from its directory, not the design parameter', async () => {
    const workspace = useWorkspace()
    createWorkspaceApiMock.mockResolvedValueOnce({
      response: 'success',
      data: {
        directory: '/work/project/ws_0002',
        workspace_id: 'workspace-ws-0002',
      },
      message: [],
    })

    await expect(
      workspace.newProject({
        directory: '/work/project/ws_0002',
        pdk: 'ics55',
        pdk_root: '/pdk/ics55',
        parameters: {
          design: 'gcd',
          top_module: 'gcd',
          clock: 'clk',
        },
        origin_def: '',
        origin_verilog: '',
        rtl_list: [],
      }),
    ).resolves.toBe(true)

    expect(workspace.currentProject.value).toMatchObject({
      name: 'ws_0002',
      path: '/work/project/ws_0002',
    })
    expect(setDesktopWindowTitleMock).toHaveBeenCalledWith('ws_0002')
  })

  it('forwards manual PDK file bindings without a PDK override blob', async () => {
    const workspace = useWorkspace()
    createWorkspaceApiMock.mockResolvedValueOnce({
      response: 'success',
      data: {
        directory: '/work/manual-pdk',
        workspace_id: 'workspace-manual-pdk',
      },
      message: [],
    })

    await expect(
      workspace.newProject({
        directory: '/work/manual-pdk',
        pdk: 'local-pdk',
        pdk_root: '/pdks/local-pdk',
        parameters: {
          design: 'manual_pdk',
          top_module: 'top',
          clock: 'clk',
        },
        origin_def: '',
        origin_verilog: '',
        rtl_list: [],
        pdk_config_mode: 'manual',
        pdk_config: {
          mode: 'manual',
          tech_lef: ['/pdks/local-pdk/tech.lef'],
          cell_lef: ['/pdks/local-pdk/stdcells.lef'],
          liberty: ['/pdks/local-pdk/stdcells.lib'],
        },
      }),
    ).resolves.toBe(true)

    expect(createWorkspaceApiMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceBindings: expect.objectContaining({
          pdk: expect.objectContaining({
            files: {
              tech: '/pdks/local-pdk/tech.lef',
              'lef-1': '/pdks/local-pdk/stdcells.lef',
              'liberty-1': '/pdks/local-pdk/stdcells.lib',
            },
          }),
        }),
        workspaceSpec: expect.objectContaining({
          pdk: expect.objectContaining({ mode: 'manual' }),
        }),
      }),
    )
  })

  it('updates the active backend workspace without replacing its directory', async () => {
    const workspace = useWorkspace()
    const lifecycle = useWorkspaceLifecycle()
    workspace.currentProject.value = {
      id: '/work/existing',
      name: 'existing',
      path: '/work/existing',
      designTool: 'backend',
      lastOpened: new Date(),
    }
    const session = lifecycle.beginSession({ projectRoot: '/work/existing' })
    lifecycle.activateSession(session.sessionId, {
      projectRoot: '/work/existing',
      workspaceId: 'workspace-handle-1',
      workspaceRevision: 1,
    })
    workspace.backendRuntimeEvents.value.push(
      backendProtocolEvent('step.completed', {
        step: 'Harden',
        state: 'succeeded',
      }),
    )

    await expect(
      workspace.newProject({
        directory: '/work/existing',
        pdk: 'ics55',
        pdk_root: '/pdks/ics55',
        parameters: { design: 'gcd', top_module: 'gcd', clock: 'clk' },
        origin_def: '',
        origin_verilog: '/work/gcd.v',
        rtl_list: ['/work/gcd.v'],
        replaceExistingWorkspace: true,
      }),
    ).resolves.toBe(true)

    expect(updateWorkspaceApiMock).toHaveBeenCalledWith(
      expect.objectContaining({ targetDirectory: '/work/existing' }),
      'workspace-handle-1',
      1,
    )
    expect(createWorkspaceApiMock).not.toHaveBeenCalled()
    expect(desktopApi.workspace.prepareProjectDirectoryReplacement).not.toHaveBeenCalled()
    expect(workspace.workspaceSession.value.sessionId).not.toBe(session.sessionId)
    expect(workspace.workspaceSession.value).toMatchObject({
      projectRoot: '/work/existing',
      state: 'active',
      workspaceId: 'workspace-handle-1',
      workspaceRevision: 2,
    })
    expect(workspace.backendRuntimeEvents.value).toHaveLength(0)
  })

  it('replaces the active backend workspace when keeping the original backup', async () => {
    const workspace = useWorkspace()
    const lifecycle = useWorkspaceLifecycle()
    workspace.currentProject.value = {
      id: '/work/existing',
      name: 'existing',
      path: '/work/existing',
      designTool: 'backend',
      lastOpened: new Date(),
    }
    const session = lifecycle.beginSession({ projectRoot: '/work/existing' })
    lifecycle.activateSession(session.sessionId, {
      projectRoot: '/work/existing',
      workspaceId: 'workspace-handle-1',
      workspaceRevision: 1,
    })
    const replacement = {
      id: 'replacement-existing-1',
      targetPath: '/work/existing',
      backupPath: '/work/.existing.replace-backup-1',
    }
    vi.mocked(
      desktopApi.workspace.prepareProjectDirectoryReplacement,
    ).mockResolvedValueOnce(replacement)
    createWorkspaceApiMock.mockResolvedValueOnce({
      response: 'success',
      data: {
        directory: '/work/existing',
        workspace_id: 'workspace-existing-new',
      },
      message: [],
    })

    await expect(
      workspace.newProject({
        directory: '/work/existing',
        replaceExistingWorkspace: true,
        keepReplacementBackup: true,
        pdk: 'ics55',
        pdk_root: '/pdks/ics55',
        parameters: { design: 'gcd', top_module: 'gcd', clock: 'clk' },
        origin_def: '',
        origin_verilog: '/work/gcd.v',
        rtl_list: ['/work/gcd.v'],
      }),
    ).resolves.toBe(true)

    expect(updateWorkspaceApiMock).not.toHaveBeenCalled()
    expect(desktopApi.workspace.prepareProjectDirectoryReplacement).toHaveBeenCalledWith(
      '/work/existing',
    )
    expect(createWorkspaceApiMock).toHaveBeenCalled()
    expect(desktopApi.workspace.retainProjectDirectoryReplacement).toHaveBeenCalledWith(
      replacement.id,
    )
  })

  it('restores the active workspace root when replacement is blocked', async () => {
    const workspace = useWorkspace()
    const lifecycle = useWorkspaceLifecycle()
    workspace.currentProject.value = {
      id: '/work/existing',
      name: 'existing',
      path: '/work/existing',
      designTool: 'backend',
      lastOpened: new Date(),
    }
    activeProjectRoot = '/work/existing'
    const session = lifecycle.beginSession({ projectRoot: '/work/existing' })
    lifecycle.activateSession(session.sessionId, {
      projectRoot: '/work/existing',
      workspaceId: 'workspace-handle-1',
      workspaceRevision: 1,
    })
    vi.mocked(
      desktopApi.workspace.prepareProjectDirectoryReplacement,
    ).mockRejectedValueOnce(
      new Error('Cannot replace a workspace while its flow is running.'),
    )

    await expect(
      workspace.newProject({
        directory: '/work/existing',
        replaceExistingWorkspace: true,
        keepReplacementBackup: true,
        pdk: 'ics55',
        pdk_root: '/pdks/ics55',
        parameters: { design: 'gcd', top_module: 'gcd', clock: 'clk' },
        origin_def: '',
        origin_verilog: '/work/gcd.v',
        rtl_list: ['/work/gcd.v'],
      }),
    ).resolves.toBe(false)

    expect(activeProjectRoot).toBe('/work/existing')
    expect(workspace.currentProject.value?.path).toBe('/work/existing')
    expect(workspace.workspaceSession.value).toMatchObject({
      sessionId: session.sessionId,
      state: 'active',
      workspaceId: 'workspace-handle-1',
      workspaceRevision: 1,
    })
    expect(createWorkspaceApiMock).not.toHaveBeenCalled()
  })

  it('closes a freshly created workspace handle when local activation fails', async () => {
    const workspace = useWorkspace()
    vi.mocked(desktopApi.workspace.registerProjectRoot).mockResolvedValueOnce('')
    createWorkspaceApiMock.mockResolvedValueOnce({
      response: 'success',
      data: {
        directory: '/work/new-project',
        workspace_handle: 'workspace-new-project',
      },
      message: [],
    })

    await expect(
      workspace.newProject({
        directory: '/work/new-project',
        pdk: 'ics55',
        pdk_root: '/pdk/ics55',
        parameters: {
          design: 'new_project',
          top_module: 'top',
          clock: 'clk',
        },
        origin_def: '',
        origin_verilog: '',
        rtl_list: [],
      }),
    ).resolves.toBe(false)

    expect(closeWorkspaceApiMock).toHaveBeenCalledWith('workspace-new-project', 'backend')
  })

  it('keeps the previous Workspace when application registration fails after creation', async () => {
    const workspace = useWorkspace()
    const lifecycle = useWorkspaceLifecycle()
    const previousProject: Project = {
      id: '/work/previous',
      name: 'previous',
      path: '/work/previous',
      lastOpened: new Date(),
    }
    workspace.currentProject.value = previousProject
    const previousSession = lifecycle.beginSession({ projectRoot: previousProject.path })
    lifecycle.activateSession(previousSession.sessionId, {
      projectRoot: previousProject.path,
      workspaceId: 'workspace-previous',
      workspaceRevision: 1,
    })
    vi.mocked(desktopApi.settings.set).mockImplementation(async (key, value) => {
      if (key === 'recent_projects') throw new Error('settings unavailable')
      settingsData.set(key, value)
    })
    createWorkspaceApiMock.mockResolvedValueOnce({
      response: 'success',
      data: {
        creationId: 'creation-1',
        directory: '/work/new-project',
        workspace_handle: 'workspace-new-project',
      },
      message: [],
    })

    await expect(
      workspace.newProject({
        directory: '/work/new-project',
        pdk: 'ics55',
        pdk_root: '/pdk/ics55',
        parameters: { design: 'new_project', top_module: 'top', clock: 'clk' },
        origin_def: '',
        origin_verilog: '',
        rtl_list: [],
      }),
    ).resolves.toBe(false)

    expect(workspace.currentProject.value).toMatchObject(previousProject)
    expect(workspace.workspaceSession.value.workspaceId).toBe('workspace-previous')
    expect(desktopApi.workspace.discardFailedWorkspaceCreate).not.toHaveBeenCalled()
    expect(closeWorkspaceApiMock).toHaveBeenCalledWith('workspace-new-project', 'backend')
  })

  it('replaces an existing workspace by creating from a temporary backup directory', async () => {
    const workspace = useWorkspace()
    const replacement = {
      id: 'replacement-demo-1',
      targetPath: '/work/demo',
      backupPath: '/work/.demo.replace-backup-1',
    }
    vi.mocked(
      desktopApi.workspace.prepareProjectDirectoryReplacement,
    ).mockResolvedValueOnce(replacement)
    createWorkspaceApiMock.mockResolvedValueOnce({
      response: 'success',
      data: {
        directory: '/work/demo',
        workspace_id: 'workspace-demo',
      },
      message: [],
    })

    await expect(
      workspace.newProject({
        directory: '/work/demo',
        replaceExistingWorkspace: true,
        pdk: 'ics55',
        pdk_root: '/pdk/ics55',
        parameters: {
          design: 'demo',
          top_module: 'top',
          clock: 'clk',
        },
        origin_def: '/work/demo/origin/demo.def',
        origin_verilog: '/work/demo/origin/demo.v',
        rtl_list: ['/work/demo/origin/demo.v'],
        sdc: '/work/demo/origin/demo.sdc',
        pdk_json: '/work/demo/home/pdk.json',
      }),
    ).resolves.toBe(true)

    expect(desktopApi.workspace.registerProjectRoot).toHaveBeenNthCalledWith(1, '/work')
    expect(desktopApi.workspace.prepareProjectDirectoryReplacement).toHaveBeenCalledWith(
      '/work/demo',
    )
    expect(createWorkspaceApiMock).toHaveBeenCalledWith(
      expect.objectContaining({
        targetDirectory: '/work/demo',
        workspaceBindings: expect.objectContaining({
          inputs: {
            def: '/work/.demo.replace-backup-1/origin/demo.def',
            'rtl-1': '/work/.demo.replace-backup-1/origin/demo.v',
            sdc: '/work/.demo.replace-backup-1/origin/demo.sdc',
          },
        }),
      }),
    )
    expect(desktopApi.workspace.finalizeProjectDirectoryReplacement).toHaveBeenCalledWith(
      replacement.id,
    )
    expect(desktopApi.workspace.restoreProjectDirectoryReplacement).not.toHaveBeenCalled()
  })

  it('keeps replacement backup and records it in project.json when requested', async () => {
    const workspace = useWorkspace()
    const replacement = {
      id: 'replacement-demo-1',
      targetPath: '/work/demo',
      backupPath: '/work/.demo.replace-backup-1',
    }
    vi.mocked(
      desktopApi.workspace.prepareProjectDirectoryReplacement,
    ).mockResolvedValueOnce(replacement)
    vi.mocked(desktopApi.projectManifest.mutate).mockResolvedValueOnce({
      manifest: {
        schema_version: 1,
        project_id: 'proj_work',
        name: 'work',
        design_name: 'demo',
        description: '',
        root_path: '/work',
        created_at: '2026-07-08T00:00:00.000Z',
        updated_at: '2026-07-08T00:00:00.000Z',
        base_design: { parameters: {}, rtl_list: [] },
        objectives: { primary: 'timing', directions: {} },
        workspaces: [],
        mpc: null,
        best_workspace: null,
        qor_baseline: null,
      },
    })
    createWorkspaceApiMock.mockResolvedValueOnce({
      response: 'success',
      data: {
        directory: '/work/demo',
        workspace_id: 'workspace-demo',
      },
      message: [],
    })

    await expect(
      workspace.newProject({
        directory: '/work/demo',
        replaceExistingWorkspace: true,
        keepReplacementBackup: true,
        pdk: 'ics55',
        pdk_root: '/pdk/ics55',
        parameters: {
          design: 'demo',
          top_module: 'top',
          clock: 'clk',
        },
        origin_def: '/work/demo/origin/demo.def',
        origin_verilog: '/work/demo/origin/demo.v',
        rtl_list: ['/work/demo/origin/demo.v'],
        project_context: {
          mode: 'select',
          project_name: 'work',
          project_root: '/work',
          project_json_path: '/work/project.json',
        },
      }),
    ).resolves.toBe(true)

    expect(
      desktopApi.workspace.finalizeProjectDirectoryReplacement,
    ).not.toHaveBeenCalled()
    expect(desktopApi.projectManifest.mutate).toHaveBeenCalledWith({
      projectRoot: '/work',
      mutation: {
        type: 'record-replacement-backup',
        input: {
          replacementId: 'replacement-demo-1',
          fallbackStartStep: undefined,
          fallbackEndStep: undefined,
        },
      },
    })
    expect(desktopApi.workspace.restoreProjectDirectoryReplacement).not.toHaveBeenCalled()
    expect(desktopApi.workspace.retainProjectDirectoryReplacement).not.toHaveBeenCalled()
  })

  it('keeps a standalone workspace backup without writing project.json', async () => {
    const workspace = useWorkspace()
    const replacement = {
      id: 'replacement-standalone-1',
      targetPath: '/work/standalone',
      backupPath: '/work/.standalone.replace-backup-1',
    }
    vi.mocked(
      desktopApi.workspace.prepareProjectDirectoryReplacement,
    ).mockResolvedValueOnce(replacement)
    createWorkspaceApiMock.mockResolvedValueOnce({
      response: 'success',
      data: {
        directory: '/work/standalone',
        workspace_id: 'workspace-standalone',
      },
      message: [],
    })

    await expect(
      workspace.newProject({
        directory: '/work/standalone',
        replaceExistingWorkspace: true,
        keepReplacementBackup: true,
        pdk: 'ics55',
        pdk_root: '/pdk/ics55',
        parameters: {
          design: 'standalone',
          top_module: 'top',
          clock: 'clk',
        },
        origin_def: '',
        origin_verilog: '',
        rtl_list: [],
      }),
    ).resolves.toBe(true)

    expect(desktopApi.workspace.retainProjectDirectoryReplacement).toHaveBeenCalledWith(
      replacement.id,
    )
    expect(desktopApi.projectManifest.mutate).not.toHaveBeenCalled()
    expect(
      desktopApi.workspace.finalizeProjectDirectoryReplacement,
    ).not.toHaveBeenCalled()
  })

  it('restores the original workspace when replacement finalization fails', async () => {
    const workspace = useWorkspace()
    const replacement = {
      id: 'replacement-demo-1',
      targetPath: '/work/demo',
      backupPath: '/work/.demo.replace-backup-1',
    }
    vi.mocked(
      desktopApi.workspace.prepareProjectDirectoryReplacement,
    ).mockResolvedValueOnce(replacement)
    vi.mocked(
      desktopApi.workspace.finalizeProjectDirectoryReplacement,
    ).mockRejectedValueOnce(new Error('backup cleanup failed'))
    createWorkspaceApiMock.mockResolvedValueOnce({
      response: 'success',
      data: {
        directory: '/work/demo',
        workspace_id: 'workspace-demo',
      },
      message: [],
    })

    await expect(
      workspace.newProject({
        directory: '/work/demo',
        replaceExistingWorkspace: true,
        pdk: 'ics55',
        pdk_root: '/pdk/ics55',
        origin_def: '',
        origin_verilog: '',
        rtl_list: [],
        parameters: {
          design: 'demo',
          top_module: 'top',
          clock: 'clk',
        },
      }),
    ).resolves.toBe(false)

    expect(desktopApi.workspace.restoreProjectDirectoryReplacement).toHaveBeenCalledWith(
      replacement.id,
    )
    expect(workspace.currentProject.value).toBeNull()
  })

  it('releases a replacement token when backup manifest recording fails', async () => {
    const workspace = useWorkspace()
    const replacement = {
      id: 'replacement-demo-1',
      targetPath: '/work/demo',
      backupPath: '/work/.demo.replace-backup-1',
    }
    vi.mocked(
      desktopApi.workspace.prepareProjectDirectoryReplacement,
    ).mockResolvedValueOnce(replacement)
    vi.mocked(desktopApi.projectManifest.mutate).mockRejectedValueOnce(
      new Error('manifest write failed'),
    )
    createWorkspaceApiMock.mockResolvedValueOnce({
      response: 'success',
      data: {
        directory: '/work/demo',
        workspace_id: 'workspace-demo',
      },
      message: [],
    })

    await expect(
      workspace.newProject({
        directory: '/work/demo',
        replaceExistingWorkspace: true,
        keepReplacementBackup: true,
        pdk: 'ics55',
        pdk_root: '/pdk/ics55',
        parameters: {
          design: 'demo',
          top_module: 'top',
          clock: 'clk',
        },
        origin_def: '/work/demo/origin/demo.def',
        origin_verilog: '/work/demo/origin/demo.v',
        rtl_list: ['/work/demo/origin/demo.v'],
        project_context: {
          mode: 'select',
          project_name: 'work',
          project_root: '/work',
          project_json_path: '/work/project.json',
        },
      }),
    ).resolves.toBe(true)

    expect(desktopApi.workspace.retainProjectDirectoryReplacement).toHaveBeenCalledWith(
      replacement.id,
    )
    expect(desktopApi.workspace.restoreProjectDirectoryReplacement).not.toHaveBeenCalled()
    expect(
      desktopApi.workspace.finalizeProjectDirectoryReplacement,
    ).not.toHaveBeenCalled()
  })

  it('restores the original workspace when backup retention fails', async () => {
    const workspace = useWorkspace()
    const replacement = {
      id: 'replacement-demo-1',
      targetPath: '/work/demo',
      backupPath: '/work/.demo.replace-backup-1',
    }
    vi.mocked(
      desktopApi.workspace.prepareProjectDirectoryReplacement,
    ).mockResolvedValueOnce(replacement)
    vi.mocked(desktopApi.projectManifest.mutate).mockRejectedValueOnce(
      new Error('manifest write failed'),
    )
    vi.mocked(
      desktopApi.workspace.retainProjectDirectoryReplacement,
    ).mockRejectedValueOnce(new Error('backup retention failed'))
    createWorkspaceApiMock.mockResolvedValueOnce({
      response: 'success',
      data: {
        directory: '/work/demo',
        workspace_id: 'workspace-demo',
      },
      message: [],
    })

    await expect(
      workspace.newProject({
        directory: '/work/demo',
        replaceExistingWorkspace: true,
        keepReplacementBackup: true,
        pdk: 'ics55',
        pdk_root: '/pdk/ics55',
        origin_def: '',
        origin_verilog: '',
        rtl_list: [],
        parameters: {
          design: 'demo',
          top_module: 'top',
          clock: 'clk',
        },
        project_context: {
          mode: 'select',
          project_name: 'work',
          project_root: '/work',
          project_json_path: '/work/project.json',
        },
      }),
    ).resolves.toBe(false)

    expect(desktopApi.workspace.retainProjectDirectoryReplacement).toHaveBeenCalledWith(
      replacement.id,
    )
    expect(desktopApi.workspace.restoreProjectDirectoryReplacement).toHaveBeenCalledWith(
      replacement.id,
    )
    expect(workspace.currentProject.value).toBeNull()
  })

  it('restores the original workspace backup when replacement creation fails', async () => {
    const workspace = useWorkspace()
    const replacement = {
      id: 'replacement-demo-1',
      targetPath: '/work/demo',
      backupPath: '/work/.demo.replace-backup-1',
    }
    vi.mocked(
      desktopApi.workspace.prepareProjectDirectoryReplacement,
    ).mockResolvedValueOnce(replacement)
    createWorkspaceApiMock.mockResolvedValueOnce({
      response: 'error',
      data: {},
      message: ['creation failed'],
    })

    await expect(
      workspace.newProject({
        directory: '/work/demo',
        replaceExistingWorkspace: true,
        pdk: 'ics55',
        pdk_root: '/pdk/ics55',
        parameters: {
          design: 'demo',
          top_module: 'top',
          clock: 'clk',
        },
        origin_def: '/work/demo/origin/demo.def',
        origin_verilog: '/work/demo/origin/demo.v',
        rtl_list: [],
      }),
    ).resolves.toBe(false)

    expect(workspace.lastWorkspaceCreationError.value).toBe('creation failed')

    expect(desktopApi.workspace.restoreProjectDirectoryReplacement).toHaveBeenCalledWith(
      replacement.id,
    )
    expect(
      desktopApi.workspace.finalizeProjectDirectoryReplacement,
    ).not.toHaveBeenCalled()
    expect(desktopApi.workspace.discardFailedWorkspaceCreate).not.toHaveBeenCalled()
  })

  it('preserves a brand-new incomplete backend directory for journal recovery', async () => {
    const workspace = useWorkspace()
    vi.mocked(desktopApi.workspace.pathExists).mockResolvedValueOnce(false)
    createWorkspaceApiMock.mockResolvedValueOnce({
      response: 'error',
      data: {},
      message: ['PDK path is missing'],
    })

    await expect(
      workspace.newProject({
        directory: '/work/project/ws_0036',
        pdk: 'ics55',
        pdk_root: '/missing/pdk',
        parameters: {
          design: 'gcd',
          top_module: 'top',
          clock: 'clk',
        },
        origin_def: '',
        origin_verilog: '',
        rtl_list: [],
      }),
    ).resolves.toBe(false)

    expect(workspace.lastWorkspaceCreationError.value).toBe('PDK path is missing')
    expect(desktopApi.workspace.discardFailedWorkspaceCreate).not.toHaveBeenCalled()
  })

  it('does not discard a pre-existing directory when create fails', async () => {
    const workspace = useWorkspace()
    vi.mocked(desktopApi.workspace.pathExists).mockResolvedValueOnce(true)
    createWorkspaceApiMock.mockRejectedValueOnce(new Error('PDK path is missing'))

    await expect(
      workspace.newProject({
        directory: '/work/project/ws_0036',
        pdk: 'ics55',
        pdk_root: '/missing/pdk',
        parameters: {
          design: 'gcd',
          top_module: 'top',
          clock: 'clk',
        },
        origin_def: '',
        origin_verilog: '',
        rtl_list: [],
      }),
    ).resolves.toBe(false)

    expect(desktopApi.workspace.discardFailedWorkspaceCreate).not.toHaveBeenCalled()
  })
})
