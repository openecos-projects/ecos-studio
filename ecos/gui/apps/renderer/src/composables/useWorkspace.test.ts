import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopApi } from '@ecos-studio/shared'
import type { Project } from '@/types'

const {
  createRuntimeEventClientMock,
  createWorkspaceApiMock,
  loadWorkspaceApiMock,
  clearMessagesMock,
  readWorkspaceFlowResourceApiMock,
  readWorkspaceHomeResourceApiMock,
  readWorkspaceParametersResourceApiMock,
  settingsData,
  setDesktopWindowTitleMock,
  toastAddMock,
  waitForRuntimeReadyMock,
  waitForDesktopApiMock,
  requestHomeRunArtifactResetMock,
  clearHomeRunArtifactResetAwaitingBackendStartMock,
} = vi.hoisted(() => ({
  createRuntimeEventClientMock: vi.fn(),
  createWorkspaceApiMock: vi.fn(),
  loadWorkspaceApiMock: vi.fn(),
  clearMessagesMock: vi.fn(),
  readWorkspaceFlowResourceApiMock: vi.fn(),
  readWorkspaceHomeResourceApiMock: vi.fn(),
  readWorkspaceParametersResourceApiMock: vi.fn(),
  settingsData: new Map<string, unknown>(),
  setDesktopWindowTitleMock: vi.fn(),
  toastAddMock: vi.fn(),
  waitForRuntimeReadyMock: vi.fn(),
  waitForDesktopApiMock: vi.fn(),
  requestHomeRunArtifactResetMock: vi.fn(),
  clearHomeRunArtifactResetAwaitingBackendStartMock: vi.fn(),
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
  createWorkspaceApi: createWorkspaceApiMock,
  waitForRuntimeReady: waitForRuntimeReadyMock,
}))

vi.mock('@/api/runtimeEvents', () => ({
  createRuntimeEventClient: createRuntimeEventClientMock,
}))

vi.mock('@/api/workspaceResources', () => ({
  readWorkspaceFlowResourceApi: readWorkspaceFlowResourceApiMock,
  readWorkspaceHomeResourceApi: readWorkspaceHomeResourceApiMock,
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

vi.mock('./homeRunArtifacts', () => ({
  requestHomeRunArtifactReset: requestHomeRunArtifactResetMock,
  clearHomeRunArtifactResetAwaitingBackendStart: clearHomeRunArtifactResetAwaitingBackendStartMock,
}))

import { useWorkspace } from './useWorkspace'
import { useWorkspaceLifecycle } from './useWorkspaceLifecycle'

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
      pickRtlSources: vi.fn(),
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
      scanRtlDirectory: vi.fn(),
      listDesignFiles: vi.fn(),
      addDesignFiles: vi.fn(),
      removeDesignFile: vi.fn(),
      watchProjectFile: vi.fn(),
    },
    ...overrides,
  } as DesktopApi
}

function readRecentProjectsSetting(): SerializedRecentProject[] {
  const value = settingsData.get('recent_projects')
  expect(Array.isArray(value)).toBe(true)
  return value as SerializedRecentProject[]
}

describe('useWorkspace openProject', () => {
  let desktopApi: DesktopApi
  let onRuntimeEvent: ((response: unknown) => void) | undefined

  beforeEach(() => {
    const workspace = useWorkspace()
    const lifecycle = useWorkspaceLifecycle()
    lifecycle.closeSession()
    workspace.currentProject.value = null
    workspace.recentProjects.value = []
    workspace.runtimeEventClient.value?.close()
    workspace.runtimeEventClient.value = null
    workspace.runtimeEvents.value = []
    workspace.runtimeBackendConnecting.value = false

    createRuntimeEventClientMock.mockReset()
    createWorkspaceApiMock.mockReset()
    loadWorkspaceApiMock.mockReset()
    clearMessagesMock.mockReset()
    readWorkspaceFlowResourceApiMock.mockReset()
    readWorkspaceHomeResourceApiMock.mockReset()
    readWorkspaceParametersResourceApiMock.mockReset()
    setDesktopWindowTitleMock.mockReset()
    toastAddMock.mockReset()
    waitForRuntimeReadyMock.mockReset()
    waitForDesktopApiMock.mockReset()
    requestHomeRunArtifactResetMock.mockReset()
    settingsData.clear()

    desktopApi = createDesktopApiMock()
    vi.mocked(desktopApi.workspace.isProjectDirectory).mockResolvedValue(true)
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

  it('re-enters the active workspace without reloading it through the CLI', async () => {
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

    await expect(workspace.openProject({
      ...activeProject,
      path: '/work/demo/',
    })).resolves.toBe(true)

    expect(loadWorkspaceApiMock).not.toHaveBeenCalled()
    expect(waitForRuntimeReadyMock).not.toHaveBeenCalled()
    expect(workspace.currentProject.value?.path).toBe('/work/demo')
    expect(settingsData.get('current_project_path')).toBe('/work/demo')
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

  it('stops before loading when the selected directory is not an ECOS workspace', async () => {
    const workspace = useWorkspace()

    vi.mocked(desktopApi.dialog.pickDirectory).mockResolvedValueOnce('/work/not-ecos')
    vi.mocked(desktopApi.workspace.isProjectDirectory).mockResolvedValueOnce(false)

    expect(await workspace.openProject()).toBe(false)
    expect(loadWorkspaceApiMock).not.toHaveBeenCalled()
    expect(waitForRuntimeReadyMock).not.toHaveBeenCalled()
    expect(desktopApi.workspace.isProjectDirectory).toHaveBeenCalledWith('/work/not-ecos')
    expect(workspace.currentProject.value).toBeNull()
  })

  it('clears chat messages only after a workspace opens successfully', async () => {
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
    expect(clearMessagesMock).toHaveBeenCalledTimes(1)

    vi.mocked(desktopApi.dialog.pickDirectory).mockResolvedValueOnce('/work/bad')
    loadWorkspaceApiMock.mockResolvedValueOnce({
      response: 'error',
      message: ['not an ECOS workspace'],
      data: {},
    })

    expect(await workspace.openProject()).toBe(false)
    expect(clearMessagesMock).toHaveBeenCalledTimes(1)

    vi.mocked(desktopApi.dialog.pickDirectory).mockResolvedValueOnce('/work/new')
    loadWorkspaceApiMock.mockResolvedValueOnce({
      response: 'success',
      data: {
        directory: '/work/new',
        workspace_id: '/work/new',
      },
    })

    expect(await workspace.openProject()).toBe(true)
    expect(clearMessagesMock).toHaveBeenCalledTimes(2)
  })

  it('clears chat messages when the workspace closes', async () => {
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
        workspace_id: '/work/old',
      },
    })

    expect(await workspace.openProject(project)).toBe(true)

    await workspace.closeProject()

    expect(clearMessagesMock).toHaveBeenCalledTimes(2)
  })

  it('snapshots recent project summary from workspace resources without direct project file reads', async () => {
    const workspace = useWorkspace()
    const project: Project = {
      id: '/work/demo',
      name: 'demo',
      path: '/work/demo',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }
    workspace.currentProject.value = project
    workspace.recentProjects.value = [{ ...project }]
    readWorkspaceFlowResourceApiMock.mockResolvedValueOnce({
      steps: [
        { name: 'synthesis', state: 'Success', runtime: '00:01:05' },
        { name: 'floorplan', state: 'Ongoing', runtime: '00:00:30' },
        { name: 'placement', state: 'Pending', runtime: '' },
      ],
    })
    readWorkspaceParametersResourceApiMock.mockResolvedValueOnce({
      PDK: 'ics55',
      'Top module': 'top',
      'Frequency max [MHz]': 125,
      Core: {
        Utilitization: 0.62,
      },
    })
    readWorkspaceHomeResourceApiMock.mockResolvedValueOnce({
      monitor: {
        instance: [10, 42],
        frequency: [0, 118.5],
      },
    })

    await workspace.closeProject()

    expect(readWorkspaceFlowResourceApiMock).toHaveBeenCalledTimes(1)
    expect(readWorkspaceParametersResourceApiMock).toHaveBeenCalledTimes(1)
    expect(readWorkspaceHomeResourceApiMock).toHaveBeenCalledTimes(1)
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
        cellCount: 42,
        frequency: 118.5,
      }),
    ])
  })

  it('applies a delayed snapshot to the original recent project after the list is prepended', async () => {
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
      status: 'not_started',
      totalSteps: 9,
      completedSteps: 0,
      pdk: 'new-pdk',
      topModule: 'new_top',
    }
    let resolveFlow:
      | ((value: { steps: Array<{ name: string; state: string; runtime: string }> }) => void)
      | undefined

    workspace.currentProject.value = oldProject
    workspace.recentProjects.value = [{ ...oldProject }]
    readWorkspaceFlowResourceApiMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFlow = resolve
      })
    )
    readWorkspaceParametersResourceApiMock.mockResolvedValueOnce({
      PDK: 'old-pdk',
      'Top module': 'old_top',
      'Frequency max [MHz]': 100,
      Core: {
        Utilitization: 0.5,
      },
    })
    readWorkspaceHomeResourceApiMock.mockResolvedValueOnce({
      monitor: {
        instance: [11],
        frequency: [95],
      },
    })

    const closePromise = workspace.closeProject()

    await vi.waitFor(() => {
      expect(readWorkspaceFlowResourceApiMock).toHaveBeenCalledTimes(1)
    })

    workspace.recentProjects.value = [{ ...newProject }, ...workspace.recentProjects.value]
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
        cellCount: 11,
        frequency: 95,
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
    workspace.recentProjects.value = [{
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
      cellCount: 12345,
      frequency: 241.5,
    }]
    readWorkspaceFlowResourceApiMock.mockResolvedValueOnce({
      steps: { synthesis: { state: 'Success' } },
    })
    readWorkspaceParametersResourceApiMock.mockResolvedValueOnce({
      PDK: { name: 'ics55' },
      'Top module': ['top'],
      'Frequency max [MHz]': '250',
      Core: 'not-an-object',
    })
    readWorkspaceHomeResourceApiMock.mockResolvedValueOnce({
      monitor: {
        instance: ['not-a-cell-count'],
        frequency: ['not-a-frequency'],
      },
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
        cellCount: 12345,
        frequency: 241.5,
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
    workspace.recentProjects.value = [{
      ...project,
      status: 'running',
      totalSteps: 3,
      completedSteps: 1,
      currentStep: 'floorplan',
      totalRuntime: '1m 35s',
    }]
    readWorkspaceFlowResourceApiMock.mockResolvedValueOnce({
      steps: [
        'bad',
        { name: 'synthesis' },
        { runtime: '00:01:05' },
      ],
    })
    readWorkspaceParametersResourceApiMock.mockResolvedValueOnce(null)
    readWorkspaceHomeResourceApiMock.mockResolvedValueOnce(null)

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
    workspace.recentProjects.value = [{
      ...project,
      status: 'running',
      totalSteps: 3,
      completedSteps: 1,
      currentStep: 'floorplan',
      totalRuntime: '1m 35s',
    }]
    readWorkspaceFlowResourceApiMock.mockResolvedValueOnce({
      steps: [
        { name: 'synthesis', state: 'Success', runtime: '00:01:00' },
        { state: 'Ongoing' },
      ],
    })
    readWorkspaceParametersResourceApiMock.mockResolvedValueOnce(null)
    readWorkspaceHomeResourceApiMock.mockResolvedValueOnce(null)

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
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }
    workspace.currentProject.value = project
    workspace.recentProjects.value = [{
      ...project,
      status: 'running',
      totalSteps: 3,
      completedSteps: 1,
      currentStep: 'floorplan',
      totalRuntime: '1m 35s',
    }]
    readWorkspaceFlowResourceApiMock.mockResolvedValueOnce({ steps: [] })
    readWorkspaceParametersResourceApiMock.mockResolvedValueOnce(null)
    readWorkspaceHomeResourceApiMock.mockResolvedValueOnce(null)

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
    workspace.recentProjects.value = [{
      ...project,
      status: 'running',
      totalSteps: 3,
      completedSteps: 1,
      currentStep: 'floorplan',
      totalRuntime: '1m 35s',
    }]
    readWorkspaceFlowResourceApiMock.mockResolvedValueOnce({
      steps: [{ state: 'Success' }],
    })
    readWorkspaceParametersResourceApiMock.mockResolvedValueOnce(null)
    readWorkspaceHomeResourceApiMock.mockResolvedValueOnce(null)

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
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }
    workspace.currentProject.value = project
    workspace.recentProjects.value = [{
      ...project,
      status: 'running',
      totalSteps: 3,
      completedSteps: 1,
      currentStep: 'floorplan',
      totalRuntime: '1m 35s',
    }]
    readWorkspaceFlowResourceApiMock.mockResolvedValueOnce({
      steps: [
        { name: 'synthesis', state: 'Success', runtime: '00:01:05' },
        { name: 'floorplan', state: 'Success', runtime: '00:00:30' },
        { name: 'placement', state: 'Success', runtime: '00:02:00' },
      ],
    })
    readWorkspaceParametersResourceApiMock.mockResolvedValueOnce(null)
    readWorkspaceHomeResourceApiMock.mockResolvedValueOnce(null)

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
    workspace.recentProjects.value = [{
      ...project,
      status: 'running',
      totalSteps: 2,
      completedSteps: 1,
      currentStep: 'floorplan',
      totalRuntime: '14m 2s',
    }]
    readWorkspaceFlowResourceApiMock.mockResolvedValueOnce({
      steps: [
        { name: 'synthesis', state: 'Success', runtime: 'aa:bb:cc' },
        { name: 'floorplan', state: 'Ongoing', runtime: '' },
      ],
    })
    readWorkspaceParametersResourceApiMock.mockResolvedValueOnce(null)
    readWorkspaceHomeResourceApiMock.mockResolvedValueOnce(null)

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
    workspace.recentProjects.value = [{
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
      cellCount: 42,
      frequency: 118.5,
    }]
    readWorkspaceFlowResourceApiMock.mockResolvedValueOnce(null)
    readWorkspaceParametersResourceApiMock.mockResolvedValueOnce(null)
    readWorkspaceHomeResourceApiMock.mockResolvedValueOnce(null)

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
        cellCount: 42,
        frequency: 118.5,
      }),
    ])
  })

  it('snapshots the old project before loading workspace resources for the new project', async () => {
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
    let activeResourceProject: 'old' | 'new' = 'old'

    workspace.currentProject.value = oldProject
    workspace.recentProjects.value = [{ ...oldProject }]
    loadWorkspaceApiMock.mockImplementation(async (path: string) => {
      if (path === '/work/new') activeResourceProject = 'new'
      return {
        response: 'success',
        data: {
          directory: path,
          workspace_id: path,
        },
      }
    })
    readWorkspaceFlowResourceApiMock.mockImplementation(async () => {
      if (activeResourceProject === 'old') {
        return {
          steps: [
            { name: 'synthesis', state: 'Success', runtime: '00:01:00' },
            { name: 'floorplan', state: 'Ongoing', runtime: '00:00:30' },
          ],
        }
      }
      return {
        steps: [
          { name: 'synthesis', state: 'Success', runtime: '00:02:00' },
          { name: 'floorplan', state: 'Success', runtime: '00:03:00' },
        ],
      }
    })
    readWorkspaceParametersResourceApiMock.mockImplementation(async () => {
      if (activeResourceProject === 'old') {
        return {
          PDK: 'old-pdk',
          'Top module': 'old_top',
          'Frequency max [MHz]': 100,
          Core: {
            Utilitization: 0.5,
          },
        }
      }
      return {
        PDK: 'new-pdk',
        'Top module': 'new_top',
        'Frequency max [MHz]': 200,
        Core: {
          Utilitization: 0.7,
        },
      }
    })
    readWorkspaceHomeResourceApiMock.mockImplementation(async () => {
      if (activeResourceProject === 'old') {
        return {
          monitor: {
            instance: [11],
            frequency: [95],
          },
        }
      }
      return {
        monitor: {
          instance: [22],
          frequency: [195],
        },
      }
    })

    expect(await workspace.openProject(newProject)).toBe(true)

    expect(settingsData.get('recent_projects')).toEqual([
      expect.objectContaining({
        id: '/work/new',
        name: 'new',
        path: '/work/new',
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
        cellCount: 11,
        frequency: 95,
      }),
    ])
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
    settingsData.set('recent_projects', [{
      ...currentProject,
      lastOpened: currentProject.lastOpened.toISOString(),
    }])
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
          workspace_id: path,
        },
      })
    })
    readWorkspaceFlowResourceApiMock.mockResolvedValue(null)
    readWorkspaceParametersResourceApiMock.mockResolvedValue(null)
    readWorkspaceHomeResourceApiMock.mockResolvedValue(null)

    const openProjectA = workspace.openProject(projectA)
    const openProjectB = workspace.openProject(projectB)

    await vi.waitFor(() => {
      expect(workspace.currentProject.value?.path).toBe('/work/b')
    })

    resolveProjectA?.({
      response: 'success',
      data: {
        directory: '/work/a',
        workspace_id: '/work/a',
      },
    })

    await expect(openProjectB).resolves.toBe(true)
    await expect(openProjectA).resolves.toBe(false)

    expect(workspace.currentProject.value?.path).toBe('/work/b')
    expect(settingsData.get('current_project_path')).toBe('/work/b')
    const recentProjects = readRecentProjectsSetting()
    expect(recentProjects[0]).toEqual(expect.objectContaining({
      id: '/work/b',
      name: 'b',
      path: '/work/b',
    }))
    expect(recentProjects).not.toEqual([
      expect.objectContaining({
        id: '/work/a',
        path: '/work/a',
      }),
      expect.anything(),
    ])
  })

  it('keeps the latest project when an older provided-project switch stalls before session creation', async () => {
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
    let resolveProjectASnapshot:
      | ((value: { steps: Array<{ name: string; state: string; runtime: string }> }) => void)
      | undefined

    workspace.currentProject.value = currentProject
    workspace.recentProjects.value = [{ ...currentProject }]
    settingsData.set('recent_projects', [{
      ...currentProject,
      lastOpened: currentProject.lastOpened.toISOString(),
    }])
    settingsData.set('current_project_path', '/work/current')
    readWorkspaceFlowResourceApiMock
      .mockImplementationOnce(
        () => new Promise((resolve) => {
          resolveProjectASnapshot = resolve
        })
      )
      .mockResolvedValue(null)
    readWorkspaceParametersResourceApiMock.mockResolvedValue(null)
    readWorkspaceHomeResourceApiMock.mockResolvedValue(null)
    loadWorkspaceApiMock.mockImplementation(async (path: string) => ({
      response: 'success',
      data: {
        directory: path,
        workspace_id: path,
      },
    }))

    const openProjectA = workspace.openProject(projectA)

    await vi.waitFor(() => {
      expect(readWorkspaceFlowResourceApiMock).toHaveBeenCalledTimes(1)
    })

    const openProjectB = workspace.openProject(projectB)

    await vi.waitFor(() => {
      expect(workspace.currentProject.value?.path).toBe('/work/b')
    })

    resolveProjectASnapshot?.({
      steps: [
        { name: 'synthesis', state: 'Success', runtime: '00:01:00' },
      ],
    })

    await expect(openProjectB).resolves.toBe(true)
    await expect(openProjectA).resolves.toBe(false)

    expect(workspace.currentProject.value?.path).toBe('/work/b')
    expect(settingsData.get('current_project_path')).toBe('/work/b')
    const recentProjects = readRecentProjectsSetting()
    expect(recentProjects[0]).toEqual(expect.objectContaining({
      id: '/work/b',
      name: 'b',
      path: '/work/b',
    }))
  })

  it('does not let a stale stalled switch snapshot persist mixed resources after a newer switch wins', async () => {
    const workspace = useWorkspace()
    const oldProject: Project = {
      id: '/work/old',
      name: 'old',
      path: '/work/old',
      lastOpened: new Date('2026-01-01T00:00:00.000Z'),
    }
    const oldSummary: Project = {
      ...oldProject,
      status: 'success',
      totalSteps: 2,
      completedSteps: 2,
      pdk: 'old-pdk',
      topModule: 'old_top',
      frequencyTarget: 100,
      coreUtilization: 0.5,
      cellCount: 11,
      frequency: 95,
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
    let activeResourceProject: 'old' | 'b' = 'old'
    let flowReadCount = 0
    let parametersReadCount = 0
    let resolveProjectAParameters: ((value: Record<string, unknown>) => void) | undefined

    workspace.currentProject.value = oldProject
    workspace.recentProjects.value = [{ ...oldSummary }]
    settingsData.set('recent_projects', [{
      ...oldSummary,
      lastOpened: oldSummary.lastOpened.toISOString(),
    }])
    settingsData.set('current_project_path', '/work/old')

    readWorkspaceFlowResourceApiMock.mockImplementation(async () => {
      flowReadCount += 1
      if (flowReadCount === 1) {
        return {
          steps: [
            { name: 'synthesis', state: 'Success', runtime: '00:01:00' },
            { name: 'floorplan', state: 'Ongoing', runtime: '00:00:30' },
          ],
        }
      }
      return null
    })
    readWorkspaceParametersResourceApiMock.mockImplementation(() => {
      parametersReadCount += 1
      if (parametersReadCount === 1) {
        return new Promise((resolve) => {
          resolveProjectAParameters = resolve
        })
      }
      return Promise.resolve(null)
    })
    readWorkspaceHomeResourceApiMock.mockImplementation(async () => {
      if (activeResourceProject === 'b') {
        return {
          monitor: {
            instance: [222],
            frequency: [222.5],
          },
        }
      }
      return null
    })
    loadWorkspaceApiMock.mockImplementation(async (path: string) => {
      if (path === '/work/b') activeResourceProject = 'b'
      return {
        response: 'success',
        data: {
          directory: path,
          workspace_id: path,
        },
      }
    })

    const openProjectA = workspace.openProject(projectA)

    await vi.waitFor(() => {
      expect(readWorkspaceParametersResourceApiMock).toHaveBeenCalledTimes(1)
    })

    const openProjectB = workspace.openProject(projectB)
    await expect(openProjectB).resolves.toBe(true)
    expect(workspace.currentProject.value?.path).toBe('/work/b')

    resolveProjectAParameters?.({
      PDK: 'b-pdk',
      'Top module': 'b_top',
      'Frequency max [MHz]': 220,
      Core: {
        Utilitization: 0.88,
      },
    })

    await expect(openProjectA).resolves.toBe(false)

    expect(workspace.currentProject.value?.path).toBe('/work/b')
    expect(settingsData.get('current_project_path')).toBe('/work/b')
    const recentProjects = readRecentProjectsSetting()
    expect(recentProjects[0]).toEqual(expect.objectContaining({
      id: '/work/b',
      name: 'b',
      path: '/work/b',
    }))
    expect(recentProjects[1]).toEqual(expect.objectContaining({
      id: '/work/old',
      name: 'old',
      path: '/work/old',
      status: 'success',
      totalSteps: 2,
      completedSteps: 2,
      pdk: 'old-pdk',
      topModule: 'old_top',
      frequencyTarget: 100,
      coreUtilization: 0.5,
      cellCount: 11,
      frequency: 95,
    }))
  })

  it('does not let a stale snapshot settings write overwrite a newer project switch', async () => {
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
    let recentProjectsSetCount = 0
    let releaseStaleSnapshotWrite: (() => void) | undefined

    workspace.currentProject.value = oldProject
    workspace.recentProjects.value = [{ ...oldProject }]
    settingsData.set('recent_projects', [{
      ...oldProject,
      lastOpened: oldProject.lastOpened.toISOString(),
    }])
    settingsData.set('current_project_path', '/work/old')
    readWorkspaceFlowResourceApiMock.mockResolvedValue(null)
    readWorkspaceParametersResourceApiMock.mockResolvedValue(null)
    readWorkspaceHomeResourceApiMock.mockResolvedValue(null)
    loadWorkspaceApiMock.mockImplementation(async (path: string) => ({
      response: 'success',
      data: {
        directory: path,
        workspace_id: path,
      },
    }))
    vi.mocked(desktopApi.settings.set).mockImplementation(async (key: string, value: unknown) => {
      if (key === 'recent_projects') {
        recentProjectsSetCount += 1
        if (recentProjectsSetCount === 1) {
          await new Promise<void>((resolve) => {
            releaseStaleSnapshotWrite = resolve
          })
        }
      }
      settingsData.set(key, value)
    })

    const openProjectA = workspace.openProject(projectA)

    await vi.waitFor(() => {
      expect(recentProjectsSetCount).toBe(1)
    })

    const openProjectB = workspace.openProject(projectB)

    await vi.waitFor(() => {
      expect(workspace.currentProject.value?.path).toBe('/work/b')
    })
    await expect(openProjectB).resolves.toBe(true)

    releaseStaleSnapshotWrite?.()
    await expect(openProjectA).resolves.toBe(false)

    expect(workspace.currentProject.value?.path).toBe('/work/b')
    expect(settingsData.get('current_project_path')).toBe('/work/b')
    const recentProjects = readRecentProjectsSetting()
    expect(recentProjects[0]).toEqual(expect.objectContaining({
      id: '/work/b',
      name: 'b',
      path: '/work/b',
    }))
    expect(recentProjects).not.toEqual([
      expect.objectContaining({
        id: '/work/old',
        path: '/work/old',
      }),
    ])
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

  it('keeps the workspace loading overlay visible while an existing workspace is loading', async () => {
    const workspace = useWorkspace()
    let resolveLoadWorkspace: ((value: unknown) => void) | undefined
    loadWorkspaceApiMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLoadWorkspace = resolve
      })
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
        workspace_id: 'workspace-demo',
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
        workspace_id: 'workspace-demo',
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
    expect(workspace.workspaceSession.value.state).toBe('idle')
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
    let oldRuntimeEvent: ((response: unknown) => void) | undefined
    let newRuntimeEvent: ((response: unknown) => void) | undefined

    createRuntimeEventClientMock
      .mockReturnValueOnce({
        onAll: vi.fn((handler: (response: unknown) => void) => {
          oldRuntimeEvent = handler
        }),
        connect: vi.fn(),
        close: vi.fn(),
      })
      .mockReturnValueOnce({
        onAll: vi.fn((handler: (response: unknown) => void) => {
          newRuntimeEvent = handler
        }),
        connect: vi.fn(),
        close: vi.fn(),
      })

    loadWorkspaceApiMock
      .mockResolvedValueOnce({
        response: 'success',
        data: {
          directory: '/work/old',
          workspace_id: 'workspace-old',
        },
      })
      .mockResolvedValueOnce({
        response: 'success',
        data: {
          directory: '/work/new',
          workspace_id: 'workspace-new',
        },
      })

    expect(await workspace.openProject(oldProject)).toBe(true)
    expect(await workspace.openProject(newProject)).toBe(true)

    oldRuntimeEvent?.({
      cmd: 'notify',
      data: {
        type: 'step_complete',
        jobId: 'job-old',
        cmd: 'run_step',
        step: 'floorplan',
      },
    })
    expect(workspace.runtimeEvents.value).toHaveLength(0)

    newRuntimeEvent?.({
      cmd: 'notify',
      data: {
        type: 'step_complete',
        jobId: 'job-new',
        cmd: 'run_step',
        step: 'placement',
      },
    })
    expect(workspace.runtimeEvents.value).toHaveLength(1)
  })

  it('invalidates flow, current step, maps, and logs when run_step completes', async () => {
    const workspace = await openWorkspaceAndConnectRuntimeEvents()
    const before = { ...workspace.resourceVersions.value }

    onRuntimeEvent?.({
      cmd: 'notify',
      data: {
        type: 'step_complete',
        jobId: 'job-run-step',
        cmd: 'run_step',
        step: 'floorplan',
      },
    })

    expect(workspace.resourceVersions.value.flow).toBe(before.flow + 1)
    expect(workspace.resourceVersions.value.step).toBe(before.step + 1)
    expect(workspace.resourceVersions.value.maps).toBe(before.maps + 1)
    expect(workspace.resourceVersions.value.logs).toBe(before.logs + 1)
    expect(workspace.resourceVersions.value.all).toBe(before.all)
  })

  it('invalidates all workspace resources when rtl2gds completes', async () => {
    const workspace = await openWorkspaceAndConnectRuntimeEvents()
    const before = { ...workspace.resourceVersions.value }

    onRuntimeEvent?.({
      cmd: 'notify',
      data: {
        type: 'task_complete',
        jobId: 'job-rtl2gds',
        cmd: 'rtl2gds',
      },
    })

    expect(workspace.resourceVersions.value.all).toBe(before.all + 1)
    expect(workspace.resourceVersions.value.flow).toBe(before.flow + 1)
    expect(workspace.resourceVersions.value.maps).toBe(before.maps + 1)
    expect(workspace.resourceVersions.value.logs).toBe(before.logs + 1)
  })

  it('requests Home artifact reset when backend reports rerun start', async () => {
    const workspace = await openWorkspaceAndConnectRuntimeEvents()

    onRuntimeEvent?.({
      cmd: 'notify',
      data: {
        type: 'message',
        cmd: 'rtl2gds',
        directory: '/work/demo',
        rerun: true,
      },
      message: ['Started rtl2gds'],
      response: 'success',
    })

    expect(workspace.runtimeEvents.value).toHaveLength(1)
    expect(requestHomeRunArtifactResetMock).toHaveBeenCalledWith('/work/demo')
  })

  it('keeps the workspace loading overlay visible while a new workspace is being created', async () => {
    const workspace = useWorkspace()
    let resolveCreateWorkspace: ((value: unknown) => void) | undefined
    createWorkspaceApiMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCreateWorkspace = resolve
      })
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
      origin_def: '',
      origin_verilog: '',
      rtl_list: [],
    })

    await vi.waitFor(() => {
      expect(createWorkspaceApiMock).toHaveBeenCalled()
    })

    expect(workspace.runtimeBackendConnecting.value).toBe(true)

    resolveCreateWorkspace?.({
      response: 'success',
      data: {
        directory: '/work/new-project',
        workspace_id: 'workspace-new-project',
      },
      message: [],
    })

    await expect(createPromise).resolves.toBe(true)
    expect(workspace.runtimeBackendConnecting.value).toBe(false)
  })

  it('does not invalidate resources for read-only runtime events', async () => {
    const workspace = await openWorkspaceAndConnectRuntimeEvents()
    const before = { ...workspace.resourceVersions.value }

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
    expect(workspace.resourceVersions.value).toEqual(before)
    expect(workspace).not.toHaveProperty('stepRefreshCounter')
  })

  it('invalidates run_step resources once when run_step completes', async () => {
    const workspace = await openWorkspaceAndConnectRuntimeEvents()
    const before = { ...workspace.resourceVersions.value }

    onRuntimeEvent?.({
      data: {
        type: 'task_complete',
        jobId: 'job-run-step',
        cmd: 'run_step',
        step: 'floorplan',
        message: 'completed',
      },
    })

    expect(workspace.resourceVersions.value.flow).toBe(before.flow + 1)
    expect(workspace.resourceVersions.value.step).toBe(before.step + 1)
    expect(workspace.resourceVersions.value.maps).toBe(before.maps + 1)
    expect(workspace.resourceVersions.value.logs).toBe(before.logs + 1)
    expect(workspace.resourceVersions.value.all).toBe(before.all)
  })

  it('does not invalidate resources for stdout and stderr runtime events', async () => {
    const workspace = await openWorkspaceAndConnectRuntimeEvents()
    const before = { ...workspace.resourceVersions.value }

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

    expect(workspace.resourceVersions.value).toEqual(before)
  })

  it('does not count the same completed runtime event twice', async () => {
    const workspace = await openWorkspaceAndConnectRuntimeEvents()
    const before = { ...workspace.resourceVersions.value }
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

    expect(workspace.resourceVersions.value.flow).toBe(before.flow + 1)
    expect(workspace.resourceVersions.value.step).toBe(before.step + 1)
    expect(workspace.resourceVersions.value.maps).toBe(before.maps + 1)
    expect(workspace.resourceVersions.value.logs).toBe(before.logs + 1)
    expect(workspace.resourceVersions.value.all).toBe(before.all)
  })

  it('invalidates structured resources for runtime events with explicit data paths', async () => {
    const workspace = await openWorkspaceAndConnectRuntimeEvents()
    const before = { ...workspace.resourceVersions.value }

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
    expect(workspace.resourceVersions.value.flow).toBe(before.flow + 1)
    expect(workspace.resourceVersions.value.step).toBe(before.step + 1)
    expect(workspace.resourceVersions.value.maps).toBe(before.maps + 1)
    expect(workspace.resourceVersions.value.logs).toBe(before.logs + 1)
    expect(workspace.resourceVersions.value.all).toBe(before.all)
  })

  it('invalidates structured resources for runtime events with top-level explicit data paths', async () => {
    const workspace = await openWorkspaceAndConnectRuntimeEvents()
    const before = { ...workspace.resourceVersions.value }

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
    expect(workspace.resourceVersions.value.flow).toBe(before.flow + 1)
    expect(workspace.resourceVersions.value.step).toBe(before.step + 1)
    expect(workspace.resourceVersions.value.maps).toBe(before.maps + 1)
    expect(workspace.resourceVersions.value.logs).toBe(before.logs + 1)
    expect(workspace.resourceVersions.value.all).toBe(before.all)
  })

  it('invalidates home and parameters when runtime events carry a home page path', async () => {
    const workspace = await openWorkspaceAndConnectRuntimeEvents()
    const before = { ...workspace.resourceVersions.value }

    onRuntimeEvent?.({
      cmd: 'notify',
      data: {
        type: 'step_complete',
        jobId: 'job-run-step',
        cmd: 'run_step',
        step: 'floorplan',
        info: {
          home_page: '/work/demo/home/home.json',
        },
      },
    })

    expect(workspace.runtimeEvents.value).toHaveLength(1)
    expect(workspace.resourceVersions.value.home).toBe(before.home + 1)
    expect(workspace.resourceVersions.value.parameters).toBe(before.parameters + 1)
    expect(workspace.resourceVersions.value.flow).toBe(before.flow + 1)
    expect(workspace.resourceVersions.value.step).toBe(before.step + 1)
    expect(workspace.resourceVersions.value.maps).toBe(before.maps + 1)
    expect(workspace.resourceVersions.value.logs).toBe(before.logs + 1)
    expect(workspace.resourceVersions.value.all).toBe(before.all)
  })

  it('counts a final result only once after an explicit path lifecycle event for the same job', async () => {
    const workspace = await openWorkspaceAndConnectRuntimeEvents()
    const before = { ...workspace.resourceVersions.value }

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
    expect(workspace.resourceVersions.value.flow).toBe(before.flow + 1)
    expect(workspace.resourceVersions.value.step).toBe(before.step + 1)
    expect(workspace.resourceVersions.value.maps).toBe(before.maps + 1)
    expect(workspace.resourceVersions.value.logs).toBe(before.logs + 1)
    expect(workspace.resourceVersions.value.all).toBe(before.all)
  })
})
