import { EventEmitter } from 'node:events'
import {
  desktopApiEventChannels,
  desktopApiIpcChannels,
  desktopMenuEventIds,
  type EccRuntimeEvent,
  type EccBackgroundOperationProjection,
  type DesktopShutdownStatus,
  type EccWorkspaceCreateRequest,
} from '@ecos-studio/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface MockBrowserWindow {
  isDestroyed(): boolean
  webContents: {
    send(...args: unknown[]): void
  }
}

const {
  fromWebContents,
  getAllWindows,
  openExternal,
  openPath,
  showMessageBox,
  showOpenDialog,
  showSaveDialog,
  mkdirMock,
  statMock,
} = vi.hoisted(() => ({
  fromWebContents: vi.fn(),
  getAllWindows: vi.fn<() => MockBrowserWindow[]>(() => []),
  mkdirMock: vi.fn(),
  openExternal: vi.fn(),
  openPath: vi.fn(),
  showMessageBox: vi.fn(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  statMock: vi.fn(),
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    mkdir: mkdirMock,
    stat: statMock,
  }
})

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents,
    getAllWindows,
  },
  dialog: {
    showMessageBox,
    showOpenDialog,
    showSaveDialog,
  },
  ipcMain: {
    handle: vi.fn(),
  },
  shell: {
    openExternal,
    openPath,
  },
}))

const electronLogger = vi.hoisted(() => ({
  warn: vi.fn(),
}))

vi.mock('../services/logger', () => ({
  electronLogger,
}))

const setMenuActionEnabled = vi.hoisted(() => vi.fn())

vi.mock('../services/menuService', () => ({
  setMenuActionEnabled,
}))

const { executeWorkspaceRerunMock, prepareWorkspaceRerunMock } = vi.hoisted(() => ({
  executeWorkspaceRerunMock: vi.fn(),
  prepareWorkspaceRerunMock: vi.fn(),
}))

vi.mock('../services/eccRpc/workspaceRerun', () => ({
  executeWorkspaceRerun: executeWorkspaceRerunMock,
  prepareWorkspaceRerun: prepareWorkspaceRerunMock,
}))

import { registerIpc, type DesktopBridgeServices } from './registerIpc'
import { workspaceWindowRegistry } from '../services/workspaceWindowRegistry'

type RegisteredHandler = (event: { sender: unknown }, ...args: unknown[]) => unknown

function registerHandlers(
  agentRuntimeService?: DesktopBridgeServices['agentRuntimeService'],
) {
  const handlers = new Map<string, RegisteredHandler>()
  const services = {
    agentRuntimeService,
    settingsStore: {
      delete: vi.fn(),
      get: vi.fn(),
      set: vi.fn(),
    },
    projectManifestService: {
      mutate: vi.fn(),
    },
    projectManagementReadService: {
      readManifest: vi.fn(),
      listProjectEntries: vi.fn(),
      readWorkspaceTexts: vi.fn(),
    },
    backendWorkspaceService: {
      clearWindow: vi.fn(),
      getArtifact: vi.fn(),
      getOverview: vi.fn(),
      getStepDetail: vi.fn(),
      invalidateWindow: vi.fn(),
      onInvalidated: vi.fn(),
      refreshOverview: vi.fn(),
    },
    backendProjectComparisonService: {
      closeProject: vi.fn(),
      disposeWindow: vi.fn(),
      getComparison: vi.fn(),
      getExecutionSnapshot: vi.fn(),
      getStepFindings: vi.fn(),
      invalidateExecution: vi.fn(),
      refreshComparison: vi.fn(),
      selectProject: vi.fn(),
      invalidateProject: vi.fn(),
      invalidateWorkspace: vi.fn(),
      onInvalidated: vi.fn(),
      onExecutionInvalidated: vi.fn(),
    },
    workspaceService: {
      approvePendingExternalReadRoots: vi.fn(),
      clearProjectRoot: vi.fn(),
      getProjectRoot: vi.fn().mockResolvedValue('/work/demo'),
      isProjectDirectory: vi.fn(),
      listPendingExternalReadRoots: vi.fn(),
      readProjectBinaryFile: vi.fn(),
      readOptionalProjectTextFile: vi.fn(),
      readOptionalProjectTextFileChunk: vi.fn(),
      readOptionalProjectTextFileTail: vi.fn(),
      readProjectTextFile: vi.fn(),
      readProjectTextFileTail: vi.fn(),
      registerProjectReadRoot: vi.fn(),
      registerProjectRoot: vi.fn(),
      listProjectDirectory: vi.fn(),
      pathExists: vi.fn(),
      discardFailedWorkspaceCreate: vi.fn(),
      requestProjectPathAccess: vi.fn(),
      scanPdkDirectory: vi.fn(),
      scanRtlDirectory: vi.fn(),
      listDesignFiles: vi.fn(),
      addDesignFiles: vi.fn(),
      removeDesignFile: vi.fn(),
      prepareProjectDirectoryReplacement: vi.fn(),
      restoreProjectDirectoryReplacement: vi.fn(),
      finalizeProjectDirectoryReplacement: vi.fn(),
      getProjectDirectoryReplacement: vi.fn(() => ({
        id: 'replacement-1',
        targetPath: '/work/demo',
        backupPath: '/work/.demo.backup',
        projectRoot: '/work',
      })),
      retainProjectDirectoryReplacement: vi.fn(),
      writeProjectTextFile: vi.fn(),
    },
    workspaceResourceService: {
      getIndex: vi.fn(),
      readFlow: vi.fn(),
      readHome: vi.fn(),
      readParameters: vi.fn(),
      resolveStepInfo: vi.fn(),
    },
    resourceManagerService: {
      cancelResource: vi.fn(),
      getResource: vi.fn(),
      readMpcSpec: vi.fn(),
      importLocalPath: vi.fn(),
      importPdkPath: vi.fn(),
      installResource: vi.fn(),
      listResources: vi.fn(),
      refreshRegistry: vi.fn(),
      checkResourceUpdates: vi.fn(),
      removePdkReference: vi.fn(),
      uninstallResource: vi.fn(),
      updateResource: vi.fn(),
      validatePdk: vi.fn(),
      validatePdkRootForWorkspace: vi.fn(),
    },
    pdkInventoryService: {
      bindInstallation: vi.fn(),
      importInstallation: vi.fn(),
      listInstallations: vi.fn(),
      locateInstallation: vi.fn(),
      removeInstallation: vi.fn(),
      resolveBinding: vi.fn(),
      validateWorkspace: vi.fn(),
    },
    surferProtocolService: {
      authorizeWaveform: vi.fn(),
      resolveWaveformPath: vi.fn(),
    },
    appInfoService: {
      getVersions: vi.fn(),
    },
    createWindow: vi.fn(),
    eccRuntimeService: {
      cancelOperation: vi.fn(),
      cancelOperationLegacy: vi.fn(),
      closeWorkspace: vi.fn(),
      createWorkspace: vi.fn(),
      describeWorkspaceSpec: vi.fn(),
      engineeringSnapshot: vi.fn(),
      exportSignoff: vi.fn(),
      onEvent: vi.fn((_listener: (event: EccRuntimeEvent) => void) => () => undefined),
      onOperationProjectionInvalidated: vi.fn(
        (_listener: (generation: number) => void) => () => undefined,
      ),
      onWorkspaceReleased: vi.fn(
        (_listener: (workspaceHandle: string) => void) => () => undefined,
      ),
      operationProjection: vi.fn(
        (): EccBackgroundOperationProjection => ({
          creations: [],
          finalizations: [],
          generation: 0,
          operations: [],
          outcomes: [],
        }),
      ),
      operationLog: vi.fn(),
      operationStatus: vi.fn(),
      waitForOperation: vi.fn(),
      openWorkspace: vi.fn(),
      refreshConfig: vi.fn(),
      releaseWorkspace: vi.fn().mockResolvedValue({ ok: true }),
      retryFinalSnapshot: vi.fn(),
      resetFlow: vi.fn(),
      runFlow: vi.fn(),
      runStep: vi.fn(),
      startFlowOperation: vi.fn(),
      startStepOperation: vi.fn(),
      syncConfig: vi.fn(),
      updateWorkspace: vi.fn(),
      validateWorkspaceSpec: vi.fn(),
      workspaceHome: vi.fn(),
      workspaceInfo: vi.fn(),
      workspaceSnapshot: vi.fn(),
      workspaceSession: vi.fn(),
    },
    workspaceCreationJournal: {
      abandon: vi.fn(),
      allowsRegistration: vi.fn().mockResolvedValue(false),
      begin: vi.fn(
        async (_ownerWindowId: number, request: EccWorkspaceCreateRequest) => ({
          creationId: 'creation-1',
          targetDirectory: request.targetDirectory,
        }),
      ),
      complete: vi.fn().mockResolvedValue(undefined),
      continueInitialization: vi.fn(),
      entriesForWindow: vi.fn().mockResolvedValue([]),
      generation: 0,
      markUnfinished: vi.fn().mockResolvedValue(undefined),
      markWorkspaceCreated: vi.fn().mockResolvedValue(undefined),
      onInvalidated: vi.fn(() => () => undefined),
      registerWorkspace: vi.fn().mockResolvedValue(undefined),
    },
    shutdownCoordinator: {
      beginAcceptedWork: vi.fn(() => vi.fn()),
      cancelShutdown: vi.fn(),
      completeRendererCleanup: vi.fn(),
      isMutationBlocked: vi.fn(() => false),
      onStatusChanged: vi.fn(() => () => undefined),
      reviewShutdownOptions: vi.fn(),
      statusForWindow: vi.fn(
        (): DesktopShutdownStatus => ({
          activeFlows: 0,
          attemptId: null,
          finalizations: 0,
          forceEligible: false,
          pendingCreations: 0,
          scope: null,
          snapshotFailures: 0,
          state: 'idle',
        }),
      ),
      trackWorkspaceHandle: vi.fn(),
      untrackWorkspaceHandle: vi.fn(),
    },
    frontendRpcRuntimeService: {
      cancelOperationLegacy: vi.fn(),
      catalogList: vi.fn(),
      closeWorkspace: vi.fn(),
      createWorkspace: vi.fn(),
      onEvent: vi.fn((_listener: (event: EccRuntimeEvent) => void) => () => undefined),
      openWorkspace: vi.fn(),
      refreshConfig: vi.fn(),
      resetFlow: vi.fn(),
      rpcHello: vi.fn(),
      rpcPing: vi.fn(),
      rpcShutdown: vi.fn(),
      runFlow: vi.fn(),
      runStep: vi.fn(),
      syncConfig: vi.fn(),
      validateConfig: vi.fn(),
      workspaceHome: vi.fn(),
      workspaceInfo: vi.fn(),
    },
    shellService: {
      createSession: vi.fn(),
      kill: vi.fn(),
      resize: vi.fn(),
      write: vi.fn(),
    },
    chipViewerService: {
      isOpen: vi.fn(),
      open: vi.fn(),
    },
  }

  registerIpc(
    {
      handle: (channel, listener) => {
        handlers.set(channel, listener as RegisteredHandler)
      },
    },
    services,
  )

  return {
    handlers,
    services,
  }
}

function openBackendWorkspace(
  handlers: Map<string, RegisteredHandler>,
  event: { sender: unknown },
  request: { directory: string },
) {
  return handlers.get(desktopApiIpcChannels.designRuntimeWorkspaceOpen)?.(event, {
    ...request,
    designTool: 'backend',
  })
}

function closeBackendWorkspace(
  handlers: Map<string, RegisteredHandler>,
  event: { sender: unknown },
  request: { workspaceHandle: string },
) {
  return handlers.get(desktopApiIpcChannels.designRuntimeWorkspaceClose)?.(event, {
    ...request,
    designTool: 'backend',
  })
}

function workspaceCreateRequest(
  request: Partial<EccWorkspaceCreateRequest>,
): EccWorkspaceCreateRequest {
  return {
    commandId: 'workspace-create',
    targetDirectory: '/tmp/workspace',
    workspaceBindings: { inputs: {}, pdk: {} },
    workspaceSpec: { pdk: { familyId: 'ics55', mode: 'default' } },
    ...request,
  }
}

function createWindowDouble(isMaximized = false) {
  return {
    close: vi.fn(),
    isMaximized: vi.fn(() => isMaximized),
    maximize: vi.fn(),
    minimize: vi.fn(),
    setTitle: vi.fn(),
    webContents: {
      setZoomFactor: vi.fn(),
    },
    unmaximize: vi.fn(),
  }
}

describe('registerIpc', () => {
  beforeEach(() => {
    workspaceWindowRegistry.clearAll()
    fromWebContents.mockReset()
    getAllWindows.mockReset()
    getAllWindows.mockReturnValue([])
    electronLogger.warn.mockReset()
    openExternal.mockReset()
    openPath.mockReset()
    executeWorkspaceRerunMock.mockReset()
    prepareWorkspaceRerunMock.mockReset()
    showOpenDialog.mockReset()
    showMessageBox.mockReset()
    showSaveDialog.mockReset()
    mkdirMock.mockReset()
    setMenuActionEnabled.mockReset()
    statMock.mockReset()
    statMock.mockImplementation(async (path: string) => {
      if (path === '/tmp/project') {
        return { isDirectory: () => true, isFile: () => false }
      }
      if (path === '/tmp/rtl-dir') {
        return { isDirectory: () => true, isFile: () => false }
      }
      if (path === '/tmp/a.v' || path === '/tmp/b.sv') {
        return { isDirectory: () => false, isFile: () => true }
      }
      throw Object.assign(
        new Error(`ENOENT: no such file or directory, stat '${path}'`),
        { code: 'ENOENT', path },
      )
    })
  })

  it('registers a handler for every desktop bridge channel', () => {
    const { handlers } = registerHandlers()

    expect(Array.from(handlers.keys()).sort()).toEqual(
      Object.values(desktopApiIpcChannels).sort(),
    )
  })

  it('rejects new backend mutations while the owning scope is draining', async () => {
    const { handlers, services } = registerHandlers()
    services.shutdownCoordinator.isMutationBlocked.mockReturnValue(true)

    await expect(
      handlers.get(desktopApiIpcChannels.productCommandExecute)?.(
        { sender: { id: 7 } },
        {
          command: 'workspace.create',
          payload: workspaceCreateRequest({ commandId: 'blocked-create' }),
        },
      ),
    ).resolves.toEqual({
      error: {
        code: 'SHUTDOWN_IN_PROGRESS',
        message: 'Shutdown is in progress.',
        name: 'Error',
      },
      ok: false,
    })
    expect(services.eccRuntimeService.createWorkspace).not.toHaveBeenCalled()

    await expect(
      handlers.get(desktopApiIpcChannels.productCommandExecute)?.(
        { sender: { id: 7 } },
        {
          command: 'workspace.continueCreation',
          payload: { creationId: 'creation-1' },
        },
      ),
    ).resolves.toMatchObject({
      error: { code: 'SHUTDOWN_IN_PROGRESS' },
      ok: false,
    })
    expect(
      services.workspaceCreationJournal.continueInitialization,
    ).not.toHaveBeenCalled()

    await expect(
      handlers.get(desktopApiIpcChannels.workspaceWriteProjectTextFile)?.(
        { sender: { id: 7 } },
        '/projects/demo/home/parameters.json',
        '{}',
      ),
    ).resolves.toMatchObject({
      error: { code: 'SHUTDOWN_IN_PROGRESS' },
      ok: false,
    })
    expect(services.workspaceService.writeProjectTextFile).not.toHaveBeenCalled()

    await expect(
      handlers.get(desktopApiIpcChannels.workspaceDiscardFailedWorkspaceCreate)?.(
        { sender: { id: 7 } },
        '/projects/demo/ws_1',
      ),
    ).resolves.toMatchObject({
      error: { code: 'SHUTDOWN_IN_PROGRESS' },
      ok: false,
    })
    expect(services.workspaceService.discardFailedWorkspaceCreate).not.toHaveBeenCalled()
  })

  it('tracks an accepted mutating command until its handler settles', async () => {
    const { handlers, services } = registerHandlers()
    const finish = vi.fn()
    services.shutdownCoordinator.beginAcceptedWork.mockReturnValueOnce(finish)

    await handlers.get(desktopApiIpcChannels.workspaceWriteProjectTextFile)?.(
      { sender: { id: 7 } },
      'notes.txt',
      'ready',
    )

    expect(services.shutdownCoordinator.beginAcceptedWork).toHaveBeenCalledWith(7)
    expect(finish).toHaveBeenCalledOnce()
  })

  it('allows only the exact active creation registration while draining', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 7 } }
    const request = {
      mutation: {
        input: {
          projectRoot: '/projects/demo',
          workspacePath: '/projects/demo/ws_1',
        },
        type: 'register-workspace',
      },
      projectRoot: '/projects/demo',
    }
    services.shutdownCoordinator.isMutationBlocked.mockReturnValue(true)

    await expect(
      handlers.get(desktopApiIpcChannels.projectManifestMutate)?.(event, request),
    ).resolves.toMatchObject({
      error: { code: 'SHUTDOWN_IN_PROGRESS' },
      ok: false,
    })

    services.workspaceCreationJournal.allowsRegistration.mockResolvedValueOnce(true)
    await handlers.get(desktopApiIpcChannels.projectManifestMutate)?.(event, request)
    expect(services.projectManifestService.mutate).toHaveBeenCalledWith(request)
    expect(services.workspaceCreationJournal.allowsRegistration).toHaveBeenCalledWith(
      7,
      '/projects/demo',
      '/projects/demo/ws_1',
    )
  })

  it('matches Renderer cleanup acknowledgements to the sending window', async () => {
    const { handlers, services } = registerHandlers()

    await handlers.get(desktopApiIpcChannels.shutdownCompleteCleanup)?.(
      { sender: { id: 7 } },
      { attemptId: 'attempt-1', ok: true },
    )

    expect(services.shutdownCoordinator.completeRendererCleanup).toHaveBeenCalledWith(
      'attempt-1',
      7,
      true,
      undefined,
    )
  })

  it('closes only the sending window Project Comparison context', async () => {
    const { handlers, services } = registerHandlers()

    await handlers.get(desktopApiIpcChannels.backendProjectComparisonCloseProject)?.(
      { sender: { id: 7 } },
      { projectComparisonContextId: 'context-1' },
    )

    expect(services.backendProjectComparisonService.closeProject).toHaveBeenCalledWith(
      7,
      'context-1',
    )
  })

  it('queries Project execution state for only the sending window context', async () => {
    const { handlers, services } = registerHandlers()
    const result = {
      data: { operations: [] },
      generation: 0,
      ok: true,
      projectComparisonContextId: 'context-1',
    }
    services.backendProjectComparisonService.getExecutionSnapshot.mockResolvedValue(
      result,
    )

    await expect(
      handlers.get(desktopApiIpcChannels.backendProjectComparisonGetExecutionSnapshot)?.(
        { sender: { id: 7 } },
        { projectComparisonContextId: 'context-1' },
      ),
    ).resolves.toEqual(result)
    expect(
      services.backendProjectComparisonService.getExecutionSnapshot,
    ).toHaveBeenCalledWith(7, 'context-1')
  })

  it('queries Step Findings without accepting a Renderer path', async () => {
    const { handlers, services } = registerHandlers()
    const request = {
      projectComparisonContextId: 'context-1',
      projectWorkspaceId: 'ws_1',
      step: 'Route',
    }
    const result = { ok: false, code: 'ARTIFACT_REFERENCE_MISSING' }
    services.backendProjectComparisonService.getStepFindings.mockResolvedValue(result)

    await expect(
      handlers.get(desktopApiIpcChannels.backendProjectComparisonGetStepFindings)?.(
        { sender: { id: 7 } },
        request,
      ),
    ).resolves.toEqual(result)
    expect(services.backendProjectComparisonService.getStepFindings).toHaveBeenCalledWith(
      7,
      request,
    )
    await expect(
      handlers.get(desktopApiIpcChannels.backendProjectComparisonGetStepFindings)?.(
        { sender: { id: 7 } },
        { ...request, projectWorkspaceId: undefined, workspacePath: '/work/ws_1' },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { message: 'Backend project Findings query is invalid.' },
    })
  })

  it('requires native confirmation before approving external frontend roots', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 7 } }
    const windowDouble = createWindowDouble(false)
    fromWebContents.mockReturnValue(windowDouble)
    services.workspaceService.registerProjectRoot.mockResolvedValue('/tmp/project')
    services.workspaceService.listPendingExternalReadRoots.mockResolvedValue([
      '/tmp/external-rtl',
    ])
    showMessageBox.mockResolvedValue({ response: 1 })

    await expect(
      handlers.get(desktopApiIpcChannels.workspaceRegisterProjectRoot)?.(
        event,
        '/tmp/project',
      ),
    ).resolves.toBe('/tmp/project')

    expect(showMessageBox).toHaveBeenCalledWith(
      windowDouble,
      expect.objectContaining({
        buttons: ['Not Now', 'Allow Access'],
        cancelId: 0,
        defaultId: 0,
        detail: expect.stringContaining('/tmp/external-rtl'),
        type: 'warning',
      }),
    )
    expect(
      services.workspaceService.approvePendingExternalReadRoots,
    ).toHaveBeenCalledWith('/tmp/project', ['/tmp/external-rtl'])
  })

  it('keeps external frontend roots blocked when native confirmation is denied', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 7 } }
    fromWebContents.mockReturnValue(createWindowDouble(false))
    services.workspaceService.registerProjectRoot.mockResolvedValue('/tmp/project')
    services.workspaceService.listPendingExternalReadRoots.mockResolvedValue([
      '/tmp/external-rtl',
    ])
    showMessageBox.mockResolvedValue({ response: 0 })

    await handlers.get(desktopApiIpcChannels.workspaceRegisterProjectRoot)?.(
      event,
      '/tmp/project',
    )

    expect(
      services.workspaceService.approvePendingExternalReadRoots,
    ).not.toHaveBeenCalled()
  })

  it('rejects a renderer-supplied rerun contract without a main-process token', async () => {
    const { handlers, services } = registerHandlers()
    const handler = handlers.get(desktopApiIpcChannels.workspacePrepareFlowAgentRerun)

    await expect(
      handler?.(
        { sender: { id: 'web-contents' } },
        {
          design_id: 'gcd',
          end_step: 'place',
          execution_scope: 'single_step',
          parameter_patch: [],
          requires_gui_review: true,
          rerun_id: 'gcd_rerun_place',
          schema_version: 'flow-agent.workspace_rerun_contract.v1',
          source_stage_artifact: 'place_dreamplace/output/gcd_place.def.gz',
          source_flow_json_sha256: 'a'.repeat(64),
          source_stage_artifact_sha256: 'b'.repeat(64),
          source_workspace: '/runs/gcd',
          target_step: 'place',
          target_workspace: '/runs/gcd_rerun_place',
        },
      ),
    ).resolves.toMatchObject({
      error: { message: 'Workspace rerun token is invalid.' },
      ok: false,
    })
    expect(services.eccRuntimeService.openWorkspace).not.toHaveBeenCalled()
  })

  it('binds rerun tokens to the agent window and its source workspace', async () => {
    let emitAgentEvent: ((event: Record<string, unknown>) => void) | undefined
    const agentRuntimeService = {
      interrupt: vi.fn(async () => {}),
      onEvent: vi.fn((listener) => {
        emitAgentEvent = listener
        return () => undefined
      }),
      sendMessage: vi.fn(),
      start: vi.fn(),
      startSession: vi.fn(async (request) => ({ sessionId: request.sessionId })),
    } as unknown as DesktopBridgeServices['agentRuntimeService']
    const { handlers, services } = registerHandlers(agentRuntimeService)
    const window = {
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      show: vi.fn(),
    }
    fromWebContents.mockReturnValue(window)
    workspaceWindowRegistry.register('/runs/other', window)
    const owner = {
      id: 101,
      isDestroyed: vi.fn(() => false),
      once: vi.fn(),
      send: vi.fn(),
    }
    const session = {
      providerId: 'ecos_agent',
      sessionId: 'gui-session-1',
      projectRoot: '/runs',
      knownProjects: [{ name: 'runs', path: '/runs' }],
      mode: 'workspace' as const,
    }
    await handlers.get(desktopApiIpcChannels.agentStartSession)?.(
      { sender: owner },
      session,
    )
    expect(agentRuntimeService?.startSession).toHaveBeenCalledWith({
      ...session,
      directory: '/runs/other',
    })

    await handlers.get(desktopApiIpcChannels.agentStartSession)?.(
      { sender: owner },
      {
        ...session,
        sessionId: 'gui-session-frozen',
        directory: '/runs/frozen-tab',
      },
    )
    expect(agentRuntimeService?.startSession).toHaveBeenCalledWith({
      ...session,
      sessionId: 'gui-session-frozen',
      directory: '/runs/frozen-tab',
    })

    emitAgentEvent?.({
      ...session,
      type: 'workspace_rerun',
      workspaceRerun: {
        design_id: 'gcd',
        end_step: 'place',
        execution_scope: 'single_step',
        parameter_patch: [],
        requires_gui_review: true,
        rerun_id: 'gcd_rerun_place',
        schema_version: 'flow-agent.workspace_rerun_contract.v1',
        source_stage_artifact: 'place_dreamplace/output/gcd_place.def.gz',
        source_flow_json_sha256: 'a'.repeat(64),
        source_stage_artifact_sha256: 'b'.repeat(64),
        source_workspace: '/runs/gcd',
        target_step: 'place',
        target_workspace: '/runs/gcd_rerun_place',
      },
    })
    const forwarded = owner.send.mock.calls[0]?.[1] as { workspaceRerunToken?: string }
    const handler = handlers.get(desktopApiIpcChannels.workspacePrepareFlowAgentRerun)

    await expect(
      handler?.({ sender: { id: 102 } }, { token: forwarded.workspaceRerunToken }),
    ).resolves.toMatchObject({
      error: { message: 'Workspace rerun authorization is invalid.' },
      ok: false,
    })
    await expect(
      handler?.({ sender: owner }, { token: forwarded.workspaceRerunToken }),
    ).resolves.toMatchObject({
      error: { message: 'Workspace rerun source is not bound to this window.' },
      ok: false,
    })
    expect(services.eccRuntimeService.openWorkspace).not.toHaveBeenCalled()
  })

  it('keeps a rerun token usable when source workspace binding is restored', async () => {
    let emitAgentEvent: ((event: Record<string, unknown>) => void) | undefined
    const agentRuntimeService = {
      interrupt: vi.fn(async () => {}),
      onEvent: vi.fn((listener) => {
        emitAgentEvent = listener
        return () => undefined
      }),
      sendMessage: vi.fn(),
      start: vi.fn(),
      startSession: vi.fn(async (request) => ({ sessionId: request.sessionId })),
    } as unknown as DesktopBridgeServices['agentRuntimeService']
    const { handlers } = registerHandlers(agentRuntimeService)
    const window = {
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      show: vi.fn(),
    }
    const owner = {
      id: 101,
      isDestroyed: vi.fn(() => false),
      once: vi.fn(),
      send: vi.fn(),
    }
    const session = { providerId: 'ecos_agent', sessionId: 'gui-session-1' }
    const contract = {
      design_id: 'gcd',
      end_step: 'place',
      execution_scope: 'single_step' as const,
      parameter_patch: [],
      requires_gui_review: true as const,
      rerun_id: 'gcd_rerun_place',
      schema_version: 'flow-agent.workspace_rerun_contract.v1' as const,
      source_stage_artifact: 'place_dreamplace/output/gcd_place.def.gz',
      source_flow_json_sha256: 'a'.repeat(64),
      source_stage_artifact_sha256: 'b'.repeat(64),
      source_workspace: '/runs/gcd',
      target_step: 'place',
      target_workspace: '/runs/gcd_rerun_place',
    }
    fromWebContents.mockReturnValue(window)
    prepareWorkspaceRerunMock.mockResolvedValue({ directory: contract.target_workspace })
    await handlers.get(desktopApiIpcChannels.agentStartSession)?.(
      { sender: owner },
      session,
    )
    emitAgentEvent?.({ ...session, type: 'workspace_rerun', workspaceRerun: contract })

    const forwarded = owner.send.mock.calls[0]?.[1] as { workspaceRerunToken: string }
    const prepare = handlers.get(desktopApiIpcChannels.workspacePrepareFlowAgentRerun)
    await expect(
      prepare?.({ sender: owner }, { token: forwarded.workspaceRerunToken }),
    ).resolves.toMatchObject({
      error: { message: 'Workspace rerun source is not bound to this window.' },
      ok: false,
    })

    workspaceWindowRegistry.register(contract.source_workspace, window)
    await expect(
      prepare?.({ sender: owner }, { token: forwarded.workspaceRerunToken }),
    ).resolves.toMatchObject({ directory: contract.target_workspace })
    expect(prepareWorkspaceRerunMock).toHaveBeenCalledWith(contract)
  })

  it('executes a prepared rerun through the target workspace handle owned by its window', async () => {
    let emitAgentEvent: ((event: Record<string, unknown>) => void) | undefined
    const agentRuntimeService = {
      onEvent: vi.fn((listener) => {
        emitAgentEvent = listener
        return () => undefined
      }),
      sendMessage: vi.fn(),
      start: vi.fn(),
      startSession: vi.fn(async (request) => ({ sessionId: request.sessionId })),
    } as unknown as DesktopBridgeServices['agentRuntimeService']
    const { handlers, services } = registerHandlers(agentRuntimeService)
    const window = {
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      show: vi.fn(),
    }
    const owner = {
      id: 101,
      isDestroyed: vi.fn(() => false),
      once: vi.fn(),
      send: vi.fn(),
    }
    const session = { providerId: 'ecos_agent', sessionId: 'gui-session-1' }
    const contract = {
      design_id: 'gcd',
      end_step: 'place',
      execution_scope: 'full_flow' as const,
      parameter_patch: [{ knob_id: 'place.target_density', value: 0.55 }],
      requires_gui_review: true as const,
      rerun_id: 'gcd_rerun_place',
      schema_version: 'flow-agent.workspace_rerun_contract.v1' as const,
      source_stage_artifact: 'place_dreamplace/output/gcd_place.def.gz',
      source_flow_json_sha256: 'a'.repeat(64),
      source_stage_artifact_sha256: 'b'.repeat(64),
      source_workspace: '/runs/gcd',
      target_step: 'place',
      target_workspace: '/runs/gcd_rerun_place',
    }
    fromWebContents.mockReturnValue(window)
    workspaceWindowRegistry.register(contract.source_workspace, window)
    prepareWorkspaceRerunMock.mockResolvedValue({ directory: contract.target_workspace })
    await handlers.get(desktopApiIpcChannels.agentStartSession)?.(
      { sender: owner },
      session,
    )
    emitAgentEvent?.({ ...session, type: 'workspace_rerun', workspaceRerun: contract })

    const forwarded = owner.send.mock.calls[0]?.[1]
    if (!forwarded || typeof forwarded !== 'object') {
      throw new Error('Workspace rerun event was not forwarded.')
    }
    const rerunToken = (forwarded as { workspaceRerunToken: string }).workspaceRerunToken
    const prepared = (await handlers.get(
      desktopApiIpcChannels.workspacePrepareFlowAgentRerun,
    )?.({ sender: owner }, { token: rerunToken })) as { executionToken: string }

    await expect(
      handlers.get(desktopApiIpcChannels.workspaceExecuteFlowAgentRerun)?.(
        { sender: owner },
        { token: prepared.executionToken },
      ),
    ).resolves.toMatchObject({
      error: { message: 'Workspace rerun target is not bound to this window.' },
      ok: false,
    })
    workspaceWindowRegistry.register(contract.target_workspace, window)
    services.eccRuntimeService.openWorkspace.mockResolvedValue({
      directory: contract.target_workspace,
      workspaceHandle: 'target-gui-handle',
    })
    services.eccRuntimeService.workspaceSnapshot.mockResolvedValue({
      workspaceRevision: 1,
    })
    await openBackendWorkspace(
      handlers,
      { sender: owner },
      { directory: contract.target_workspace },
    )
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceExecuteFlowAgentRerun)?.(
        { sender: owner },
        { token: prepared.executionToken },
      ),
    ).resolves.toBeUndefined()

    expect(executeWorkspaceRerunMock).toHaveBeenCalledWith(
      contract,
      services.eccRuntimeService,
      'target-gui-handle',
      1,
    )
  })

  it('executes a rerun when ECC opens the target under a canonical path alias', async () => {
    let emitAgentEvent: ((event: Record<string, unknown>) => void) | undefined
    const agentRuntimeService = {
      onEvent: vi.fn((listener) => {
        emitAgentEvent = listener
        return () => undefined
      }),
      sendMessage: vi.fn(),
      start: vi.fn(),
      startSession: vi.fn(async (request) => ({ sessionId: request.sessionId })),
    } as unknown as DesktopBridgeServices['agentRuntimeService']
    const { handlers, services } = registerHandlers(agentRuntimeService)
    const window = {
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      show: vi.fn(),
    }
    const owner = {
      id: 102,
      isDestroyed: vi.fn(() => false),
      once: vi.fn(),
      send: vi.fn(),
    }
    const contract = {
      design_id: 'gcd',
      end_step: 'place',
      execution_scope: 'full_flow' as const,
      parameter_patch: [{ knob_id: 'place.target_density', value: 0.55 }],
      requires_gui_review: true as const,
      rerun_id: 'gcd_rerun_place',
      schema_version: 'flow-agent.workspace_rerun_contract.v1' as const,
      source_stage_artifact: 'place_dreamplace/output/gcd_place.def.gz',
      source_flow_json_sha256: 'a'.repeat(64),
      source_stage_artifact_sha256: 'b'.repeat(64),
      source_workspace: '/runs/gcd',
      target_step: 'place',
      target_workspace: '/runs/gcd_rerun_place',
    }
    fromWebContents.mockReturnValue(window)
    workspaceWindowRegistry.register(contract.source_workspace, window)
    prepareWorkspaceRerunMock.mockResolvedValue({ directory: contract.target_workspace })
    await handlers.get(desktopApiIpcChannels.agentStartSession)?.(
      { sender: owner },
      { providerId: 'ecos_agent', sessionId: 'gui-session-alias' },
    )
    emitAgentEvent?.({
      providerId: 'ecos_agent',
      sessionId: 'gui-session-alias',
      type: 'workspace_rerun',
      workspaceRerun: contract,
    })
    const forwarded = owner.send.mock.calls[0]?.[1] as { workspaceRerunToken: string }
    const prepared = (await handlers.get(
      desktopApiIpcChannels.workspacePrepareFlowAgentRerun,
    )?.({ sender: owner }, { token: forwarded.workspaceRerunToken })) as {
      executionToken: string
    }
    workspaceWindowRegistry.register(contract.target_workspace, window)
    services.eccRuntimeService.openWorkspace.mockResolvedValue({
      directory: '/canonical/gcd_rerun_place',
      workspaceHandle: 'aliased-handle',
    })
    services.eccRuntimeService.workspaceSnapshot.mockResolvedValue({
      workspaceRevision: 1,
    })
    await openBackendWorkspace(
      handlers,
      { sender: owner },
      { directory: contract.target_workspace },
    )

    await expect(
      handlers.get(desktopApiIpcChannels.workspaceExecuteFlowAgentRerun)?.(
        { sender: owner },
        { token: prepared.executionToken },
      ),
    ).resolves.toBeUndefined()
    expect(executeWorkspaceRerunMock).toHaveBeenCalledWith(
      contract,
      services.eccRuntimeService,
      'aliased-handle',
      1,
    )
  })

  it('binds an agent session before forwarding its first provider event', async () => {
    let emitAgentEvent:
      | ((event: {
          providerId: string
          sessionId: string
          text: string
          type: 'message'
        }) => void)
      | undefined
    const agentRuntimeService = {
      interrupt: vi.fn(async () => {}),
      onEvent: vi.fn((listener) => {
        emitAgentEvent = listener
        return () => undefined
      }),
      sendMessage: vi.fn(async (request) => ({
        messageId: 'message-1',
        sessionId: request.sessionId,
      })),
      start: vi.fn(async () => {}),
      startSession: vi.fn(async (request) => {
        emitAgentEvent?.({
          providerId: request.providerId,
          sessionId: request.sessionId,
          text: 'Select language',
          type: 'message',
        })
        return { sessionId: request.sessionId }
      }),
    } as unknown as DesktopBridgeServices['agentRuntimeService']
    const { handlers } = registerHandlers(agentRuntimeService)
    const sender = {
      id: 101,
      isDestroyed: vi.fn(() => false),
      once: vi.fn(),
      send: vi.fn(),
    }
    const event = { sender }
    const session = {
      providerId: 'ecos_agent',
      sessionId: 'gui-session-1',
    }
    await expect(
      handlers.get(desktopApiIpcChannels.agentStart)?.(event, {
        providerId: session.providerId,
      }),
    ).resolves.toBeUndefined()
    await expect(
      handlers.get(desktopApiIpcChannels.agentStartSession)?.(event, session),
    ).resolves.toEqual({ sessionId: session.sessionId })
    await expect(
      handlers.get(desktopApiIpcChannels.agentSendMessage)?.(event, {
        ...session,
        message: '',
      }),
    ).resolves.toEqual({
      messageId: 'message-1',
      sessionId: session.sessionId,
    })
    await expect(
      handlers.get(desktopApiIpcChannels.agentInterrupt)?.(event, session),
    ).resolves.toBeUndefined()

    expect(sender.send).toHaveBeenCalledWith(desktopApiEventChannels.agentEvent, {
      providerId: session.providerId,
      sessionId: session.sessionId,
      text: 'Select language',
      type: 'message',
    })
    expect(agentRuntimeService?.sendMessage).toHaveBeenCalledWith({
      ...session,
      message: '',
    })
    expect(agentRuntimeService?.interrupt).toHaveBeenCalledWith(session)
  })

  it('returns version information from the app info service', async () => {
    const { handlers, services } = registerHandlers()
    const versions = {
      gui: '0.1.0-alpha.4',
      runtime: 'ECC RPC',
      ecc: '0.1.0a4',
      dreamplace: '0.1.0a2',
    }
    services.appInfoService.getVersions.mockResolvedValue(versions)

    const handler = handlers.get(desktopApiIpcChannels.appGetVersions)

    expect(handler).toBeDefined()
    await expect(handler?.({ sender: { id: 'web-contents' } })).resolves.toEqual(versions)
    expect(services.appInfoService.getVersions).toHaveBeenCalledTimes(1)
  })

  it('lists typed PDK Installation snapshots', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    const installations = [
      {
        id: 'pdk-installation:1',
        familyId: 'ics55',
        displayName: 'ICS55',
        version: '1.10.100',
        root: '/tmp/pdk',
        ownership: 'managed',
        readiness: 'ready',
        reason: null,
      },
    ]
    services.pdkInventoryService.listInstallations.mockResolvedValue(installations)

    await expect(handlers.get('pdk-inventory:list')?.(event)).resolves.toEqual(
      installations,
    )
  })

  it('delegates resource manager calls to the resource manager service', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    const resources = {
      diagnostics: [],
      resources: [
        {
          id: 'pdk:ics55',
          type: 'pdk',
          name: 'ics55',
          display_name: 'ICSPROUT 55nm PDK',
          description: '',
          category: 'pdk',
          status: 'installed',
          installed_version: null,
          available_versions: [],
          active_version: null,
          active: false,
          path: '/tmp/pdk',
          managed_root: null,
          platform: null,
          size: null,
          source: 'local',
          homepage: '',
          actions: ['activate'],
          health: {},
          error: null,
        },
      ],
    }
    services.resourceManagerService.listResources.mockResolvedValue(resources)
    services.resourceManagerService.installResource.mockResolvedValue({
      status: 'started',
      resource_id: 'tool:yosys',
      version: '0.61',
    })
    services.resourceManagerService.cancelResource.mockResolvedValue({
      status: 'cancelled',
      resource_id: 'tool:yosys',
    })
    services.resourceManagerService.readMpcSpec.mockResolvedValue({
      resource_id: 'mpc:mpc-frame',
      installed_version: '0.1.0',
      spec_path: '/tmp/mpc/spec/spec.json.in',
      spec: { designs: [] },
    })
    services.resourceManagerService.importPdkPath.mockResolvedValue(
      resources.resources[0],
    )
    services.resourceManagerService.importLocalPath.mockResolvedValue(
      resources.resources[0],
    )

    await expect(
      handlers.get(desktopApiIpcChannels.resourcesList)?.(event),
    ).resolves.toEqual(resources)
    await expect(
      handlers.get(desktopApiIpcChannels.resourcesInstall)?.(event, {
        resourceId: 'tool:yosys',
        version: '0.61',
      }),
    ).resolves.toEqual({
      status: 'started',
      resource_id: 'tool:yosys',
      version: '0.61',
    })
    await expect(
      handlers.get(desktopApiIpcChannels.resourcesReadMpcSpec)?.(event, 'mpc:mpc-frame'),
    ).resolves.toEqual({
      resource_id: 'mpc:mpc-frame',
      installed_version: '0.1.0',
      spec_path: '/tmp/mpc/spec/spec.json.in',
      spec: { designs: [] },
    })
    await expect(
      handlers.get(desktopApiIpcChannels.resourcesImportPdkPath)?.(event, {
        path: '/tmp/pdk',
      }),
    ).resolves.toEqual(resources.resources[0])
    await expect(
      handlers.get(desktopApiIpcChannels.resourcesImportLocalPath)?.(event, {
        resourceId: 'pdk:ics55',
        path: '/tmp/pdk',
      }),
    ).resolves.toEqual(resources.resources[0])
    await expect(
      handlers.get(desktopApiIpcChannels.resourcesCancel)?.(event, 'tool:yosys'),
    ).resolves.toEqual({
      status: 'cancelled',
      resource_id: 'tool:yosys',
    })

    expect(services.resourceManagerService.listResources).toHaveBeenCalledTimes(1)
    expect(services.resourceManagerService.installResource).toHaveBeenCalledWith(
      'tool:yosys',
      '0.61',
      expect.any(Function),
    )
    expect(services.resourceManagerService.readMpcSpec).toHaveBeenCalledWith(
      'mpc:mpc-frame',
    )
    expect(services.resourceManagerService.importPdkPath).toHaveBeenCalledWith('/tmp/pdk')
    expect(services.resourceManagerService.importLocalPath).toHaveBeenCalledWith(
      'pdk:ics55',
      '/tmp/pdk',
    )
    expect(services.resourceManagerService.cancelResource).toHaveBeenCalledWith(
      'tool:yosys',
    )
  })

  it('preserves and rejects an invalid existing Binding before workspace creation', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    const error = new Error('PDK validation failed for ics55')
    services.pdkInventoryService.resolveBinding.mockResolvedValue({
      installationId: 'pdk-installation:ics55',
      projectId: 'proj_demo',
      projectRoot: '/tmp/project',
    })
    services.pdkInventoryService.validateWorkspace.mockRejectedValue(error)

    await expect(
      handlers.get(desktopApiIpcChannels.productCommandExecute)?.(event, {
        command: 'workspace.create',
        payload: workspaceCreateRequest({
          commandId: 'workspace-create-invalid-binding',
          pdkInstallationId: 'pdk-installation:ics55',
          projectId: 'proj_demo',
          projectRoot: '/tmp/project',
          pdkRequirement: {
            familyId: 'ics55',
            version: null,
            manualConfig: null,
          },
        }),
      }),
    ).resolves.toEqual({
      error: { message: error.message, name: 'Error' },
      ok: false,
    })
    expect(services.pdkInventoryService.validateWorkspace).toHaveBeenCalledWith({
      projectId: 'proj_demo',
      projectRoot: '/tmp/project',
      requirement: {
        familyId: 'ics55',
        version: null,
        manualConfig: null,
      },
    })
    expect(services.pdkInventoryService.bindInstallation).not.toHaveBeenCalled()
    expect(services.eccRuntimeService.createWorkspace).not.toHaveBeenCalled()
  })

  it('rejects backend workspace creation without a PDK Requirement', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }

    await expect(
      handlers.get(desktopApiIpcChannels.productCommandExecute)?.(event, {
        command: 'workspace.create',
        payload: workspaceCreateRequest({
          commandId: 'workspace-create-missing-requirement',
        }),
      }),
    ).resolves.toEqual({
      error: {
        message: 'PDK Requirement is required for backend workspace creation',
        name: 'Error',
      },
      ok: false,
    })
    expect(
      services.resourceManagerService.validatePdkRootForWorkspace,
    ).not.toHaveBeenCalled()
    expect(services.eccRuntimeService.createWorkspace).not.toHaveBeenCalled()
  })

  it('uses the persisted Project Requirement for workspace creation', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    const payload = workspaceCreateRequest({
      commandId: 'workspace-create-persisted-requirement',
      pdkInstallationId: 'pdk-installation:ics55',
      projectId: 'proj_demo',
      projectRoot: '/tmp/project',
      pdkRequirement: {
        familyId: 'ics55',
        version: null,
        manualConfig: null,
      },
      workspaceSpec: {
        pdk: {
          familyId: 'ics55',
          mode: 'manual',
          files: [
            { fileId: 'tech', role: 'tech' },
            { fileId: 'lef-1', role: 'lef' },
            { fileId: 'liberty-1', role: 'liberty' },
          ],
        },
      },
    })
    const result = { directory: '/tmp/workspace', workspaceHandle: 'workspace-handle' }
    const persistedRequirement = {
      familyId: 'ics55',
      version: null,
      manualConfig: {
        techLef: 'tech.lef',
        cellLefs: ['cells.lef'],
        liberty: ['typ.lib'],
      },
    }
    services.projectManagementReadService.readManifest.mockResolvedValue(
      JSON.stringify({
        schema_version: 1,
        project_id: payload.projectId,
        name: 'demo',
        design_name: 'demo',
        root_path: payload.projectRoot,
        created_at: '2026-08-25T00:00:00.000Z',
        updated_at: '2026-08-25T00:00:00.000Z',
        base_design: { pdk_requirement: persistedRequirement, rtl_list: [] },
        objectives: { primary: 'timing', directions: {} },
        workspaces: [],
        best_workspace: null,
      }),
    )
    services.pdkInventoryService.resolveBinding.mockResolvedValue(null)
    services.pdkInventoryService.bindInstallation.mockResolvedValue({
      installationId: payload.pdkInstallationId,
      projectId: payload.projectId,
      projectRoot: payload.projectRoot,
    })
    services.pdkInventoryService.validateWorkspace.mockResolvedValue({
      id: payload.pdkInstallationId,
      familyId: 'ics55',
      displayName: 'ICS55',
      version: null,
      root: '/canonical/pdk',
      ownership: 'imported',
      readiness: 'ready',
      reason: null,
    })
    services.eccRuntimeService.createWorkspace.mockResolvedValue(result)

    await expect(
      handlers.get(desktopApiIpcChannels.productCommandExecute)?.(event, {
        command: 'workspace.create',
        payload,
      }),
    ).resolves.toEqual({ ...result, creationId: 'creation-1' })
    expect(services.pdkInventoryService.bindInstallation).toHaveBeenCalledWith({
      installationId: payload.pdkInstallationId,
      requirement: persistedRequirement,
      projectId: payload.projectId,
      projectRoot: payload.projectRoot,
    })
    expect(services.pdkInventoryService.resolveBinding).toHaveBeenCalledWith({
      projectId: payload.projectId,
      projectRoot: payload.projectRoot,
      requirement: persistedRequirement,
    })
    expect(services.pdkInventoryService.validateWorkspace).toHaveBeenCalledWith({
      projectId: payload.projectId,
      projectRoot: payload.projectRoot,
      requirement: persistedRequirement,
    })
    expect(services.eccRuntimeService.createWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        commandId: payload.commandId,
        targetDirectory: payload.targetDirectory,
        workspaceBindings: {
          inputs: {},
          pdk: {
            files: {
              tech: 'tech.lef',
              'lef-1': 'cells.lef',
              'liberty-1': 'typ.lib',
            },
            root: '/canonical/pdk',
          },
        },
        workspaceSpec: payload.workspaceSpec,
      }),
    )
    expect(services.workspaceCreationJournal.begin).toHaveBeenCalledWith(
      0,
      expect.objectContaining({
        commandId: payload.commandId,
        projectId: payload.projectId,
        projectRoot: payload.projectRoot,
      }),
    )
    expect(services.workspaceCreationJournal.markWorkspaceCreated).toHaveBeenCalledWith(
      'creation-1',
      result,
      0,
    )
    expect(services.workspaceCreationJournal.registerWorkspace).toHaveBeenCalledWith(
      'creation-1',
      0,
    )
    expect(services.workspaceCreationJournal.complete).not.toHaveBeenCalled()
    expect(
      services.workspaceCreationJournal.begin.mock.invocationCallOrder[0],
    ).toBeLessThan(
      services.eccRuntimeService.createWorkspace.mock.invocationCallOrder[0]!,
    )
  })

  it('waits for a runtime operation through the main-process tracker', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    const request = { operationId: 'operation-1', workspaceHandle: 'workspace-handle-1' }
    const operation = { operationId: 'operation-1', state: 'succeeded' }
    services.eccRuntimeService.waitForOperation.mockResolvedValue(operation)

    await expect(
      handlers.get(desktopApiIpcChannels.eccRuntimeWaitForOperation)?.(event, request),
    ).resolves.toEqual(operation)
    expect(services.eccRuntimeService.waitForOperation).toHaveBeenCalledWith(request)
  })

  it('forwards resource progress to the requesting renderer during installs', async () => {
    const { handlers, services } = registerHandlers()
    const sender = {
      id: 'web-contents',
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    }
    services.resourceManagerService.installResource.mockImplementation(
      async (_resourceId, _version, listener) => {
        listener?.({
          id: 'job-1',
          resource_id: 'tool:yosys',
          action: 'install',
          phase: 'downloading',
          progress: 0.5,
          message: 'Downloading...',
          error: null,
        })
        return { status: 'started', resource_id: 'tool:yosys', version: '0.61' }
      },
    )

    await handlers.get(desktopApiIpcChannels.resourcesInstall)?.(
      { sender },
      { resourceId: 'tool:yosys', version: '0.61' },
    )

    expect(sender.send).toHaveBeenCalledWith(desktopApiEventChannels.resourcesProgress, {
      id: 'job-1',
      resource_id: 'tool:yosys',
      action: 'install',
      phase: 'downloading',
      progress: 0.5,
      message: 'Downloading...',
      error: null,
    })
  })

  it('logs unexpected handler errors and returns an IPC error result', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    const error = new Error('settings store is unavailable')
    services.settingsStore.get.mockRejectedValue(error)

    await expect(
      handlers.get(desktopApiIpcChannels.settingsGet)?.(event, 'recent_projects'),
    ).resolves.toEqual({
      error: {
        message: 'settings store is unavailable',
        name: 'Error',
      },
      ok: false,
    })

    expect(electronLogger.warn).toHaveBeenCalledWith(
      '[ipc] Handler settings:get failed',
      error,
    )
  })

  it('looks up the event window and uses it for window controls', async () => {
    const { handlers } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    const windowDouble = createWindowDouble(false)
    fromWebContents.mockReturnValue(windowDouble)

    await handlers.get(desktopApiIpcChannels.windowMinimize)?.(event)
    await handlers.get(desktopApiIpcChannels.windowSetTitle)?.(event, 'ECOS Studio')
    const isMaximized = await handlers.get(desktopApiIpcChannels.windowIsMaximized)?.(
      event,
    )
    await handlers.get(desktopApiIpcChannels.windowClose)?.(event)

    expect(fromWebContents).toHaveBeenCalledTimes(4)
    expect(fromWebContents).toHaveBeenNthCalledWith(1, event.sender)
    expect(windowDouble.minimize).toHaveBeenCalledTimes(1)
    expect(windowDouble.setTitle).toHaveBeenCalledWith('ECOS Studio')
    expect(isMaximized).toBe(false)
    expect(windowDouble.close).toHaveBeenCalledTimes(1)
  })

  it('applies valid zoom factors and rejects values outside the supported range', async () => {
    const { handlers } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    const windowDouble = createWindowDouble()
    fromWebContents.mockReturnValue(windowDouble)

    await expect(
      handlers.get(desktopApiIpcChannels.windowSetZoomFactor)?.(event, 1.25),
    ).resolves.toBeUndefined()
    expect(windowDouble.webContents.setZoomFactor).toHaveBeenCalledWith(1.25)

    await expect(
      handlers.get(desktopApiIpcChannels.windowSetZoomFactor)?.(event, 1.5),
    ).resolves.toEqual({
      error: {
        message: 'Zoom factor must be between 0.8 and 1.4',
        name: 'Error',
      },
      ok: false,
    })
    expect(windowDouble.webContents.setZoomFactor).toHaveBeenCalledTimes(1)
  })

  it('toggles maximize by maximizing a normal window and restoring a maximized one', async () => {
    const { handlers } = registerHandlers()
    const toggleHandler = handlers.get(desktopApiIpcChannels.windowToggleMaximize)
    const event = { sender: { id: 'web-contents' } }

    const normalWindow = createWindowDouble(false)
    fromWebContents.mockReturnValueOnce(normalWindow)
    await toggleHandler?.(event)

    expect(normalWindow.maximize).toHaveBeenCalledTimes(1)
    expect(normalWindow.unmaximize).not.toHaveBeenCalled()

    const maximizedWindow = createWindowDouble(true)
    fromWebContents.mockReturnValueOnce(maximizedWindow)
    await toggleHandler?.(event)

    expect(maximizedWindow.unmaximize).toHaveBeenCalledTimes(1)
    expect(maximizedWindow.maximize).not.toHaveBeenCalled()
  })

  it('opens external URLs through the Electron shell', async () => {
    const { handlers } = registerHandlers()

    await handlers.get(desktopApiIpcChannels.systemOpenExternal)?.(
      { sender: { id: 'web-contents' } },
      'https://openecos.org',
    )

    expect(openExternal).toHaveBeenCalledWith('https://openecos.org')
  })

  it('opens validated waveform paths without converting Windows paths to URLs', async () => {
    const { handlers, services } = registerHandlers()
    const requestedPath = String.raw`C:\work\cpu\trace.vcd`
    const canonicalPath = String.raw`C:\work\cpu\trace.vcd`
    services.surferProtocolService.resolveWaveformPath.mockResolvedValue(canonicalPath)
    openPath.mockResolvedValue('')

    await handlers.get(desktopApiIpcChannels.workspaceOpenWaveformExternal)?.(
      { sender: { id: 'web-contents' } },
      requestedPath,
    )

    expect(services.surferProtocolService.resolveWaveformPath).toHaveBeenCalledWith(
      requestedPath,
    )
    expect(openPath).toHaveBeenCalledWith(canonicalPath)
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('rejects waveform opens when the operating system reports an error', async () => {
    const { handlers, services } = registerHandlers()
    services.surferProtocolService.resolveWaveformPath.mockResolvedValue(
      '/work/trace.vcd',
    )
    openPath.mockResolvedValue('No application is associated with this file type')

    await expect(
      handlers.get(desktopApiIpcChannels.workspaceOpenWaveformExternal)?.(
        { sender: { id: 'web-contents' } },
        '/work/trace.vcd',
      ),
    ).resolves.toEqual({
      error: {
        message:
          'Unable to open waveform: No application is associated with this file type',
        name: 'Error',
      },
      ok: false,
    })
  })

  it('shows a Save As dialog for the requesting window and returns its path', async () => {
    const { handlers } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    const windowDouble = createWindowDouble()
    const options = {
      title: 'Export Signoff Package',
      defaultPath: '/exports/gcd_signoff_package.tar.gz',
      filters: [{ name: 'Tarball', extensions: ['tar.gz'] }],
    }
    fromWebContents.mockReturnValue(windowDouble)
    showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: options.defaultPath,
    })

    await expect(
      handlers.get(desktopApiIpcChannels.dialogSaveFile)?.(event, options),
    ).resolves.toBe(options.defaultPath)

    expect(fromWebContents).toHaveBeenCalledWith(event.sender)
    expect(showSaveDialog).toHaveBeenCalledWith(windowDouble, options)
  })

  it('creates the requested default directory before showing Save As', async () => {
    const { handlers } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    const windowDouble = createWindowDouble()
    const options = {
      title: 'Export Signoff Package',
      defaultPath: '/projects/gcd/signoff/gcd_signoff_package.tar.gz',
      ensureDirectory: true,
    }
    fromWebContents.mockReturnValue(windowDouble)
    mkdirMock.mockResolvedValue(undefined)
    showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: options.defaultPath,
    })

    await expect(
      handlers.get(desktopApiIpcChannels.dialogSaveFile)?.(event, options),
    ).resolves.toBe(options.defaultPath)

    expect(mkdirMock).toHaveBeenCalledWith('/projects/gcd/signoff', {
      recursive: true,
    })
    expect(showSaveDialog).toHaveBeenCalledWith(windowDouble, {
      title: options.title,
      defaultPath: options.defaultPath,
    })
    expect(mkdirMock.mock.invocationCallOrder[0]).toBeLessThan(
      showSaveDialog.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    )
  })

  it('returns null when the Save As dialog is canceled', async () => {
    const { handlers } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    fromWebContents.mockReturnValue(createWindowDouble())
    showSaveDialog.mockResolvedValue({ canceled: true })

    await expect(
      handlers.get(desktopApiIpcChannels.dialogSaveFile)?.(event, {
        title: 'Export Signoff Package',
      }),
    ).resolves.toBeNull()
  })

  it('delegates native menu enabled-state updates to the menu service', async () => {
    const { handlers } = registerHandlers()

    await handlers.get(desktopApiIpcChannels.menuSetActionEnabled)?.(
      { sender: { id: 'web-contents' } },
      desktopMenuEventIds.exportSignoffPackage,
      true,
    )

    expect(setMenuActionEnabled).toHaveBeenCalledWith(
      desktopMenuEventIds.exportSignoffPackage,
      true,
      'web-contents',
    )
  })

  it('delegates settings, dialog, and workspace calls to the provided services', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    services.settingsStore.get.mockResolvedValue([{ id: 'recent' }])
    services.workspaceService.isProjectDirectory.mockResolvedValue(true)
    services.workspaceService.readProjectTextFile.mockResolvedValue('{"steps":[]}')
    services.workspaceService.readOptionalProjectTextFile.mockResolvedValue(null)
    services.workspaceService.readOptionalProjectTextFileChunk.mockResolvedValue({
      content: 'complete log',
      eof: true,
      nextOffsetBytes: 12,
      sizeBytes: 12,
    })
    services.workspaceService.readProjectTextFileTail.mockResolvedValue('tail log')
    services.workspaceService.readOptionalProjectTextFileTail.mockResolvedValue({
      content: 'tail log',
      truncated: true,
      sizeBytes: 4096,
    })
    services.workspaceService.readProjectBinaryFile.mockResolvedValue(
      Uint8Array.from([0x45, 0x43, 0x4f, 0x53]),
    )
    services.workspaceService.registerProjectRoot.mockResolvedValue('/tmp/project')
    services.workspaceService.registerProjectReadRoot.mockResolvedValue('/tmp/project')
    services.projectManagementReadService.readManifest.mockResolvedValue('{"name":"gcd"}')
    services.projectManagementReadService.listProjectEntries.mockResolvedValue([
      'project.json',
      'ws_0001',
    ])
    services.projectManagementReadService.readWorkspaceTexts.mockResolvedValue({
      texts: { 'home/flow.json': '{"steps":[]}' },
      unavailablePaths: [],
    })
    services.workspaceService.requestProjectPathAccess.mockResolvedValue(
      '/tmp/project/home.json',
    )
    services.workspaceService.prepareProjectDirectoryReplacement.mockResolvedValue({
      id: 'replacement-ws-0001',
      targetPath: '/tmp/project/ws_0001',
      backupPath: '/tmp/project/.ws_0001.replace-backup',
    })
    services.workspaceService.listProjectDirectory.mockResolvedValue([
      {
        name: 'gcd_Floorplan.def.gz',
        path: '/tmp/project/origin/gcd_Floorplan.def.gz',
        type: 'file',
      },
    ])
    services.workspaceService.scanPdkDirectory.mockResolvedValue({
      canonicalPath: '/tmp/pdk',
      name: 'ics55',
      description: 'ICSPROUT 55nm process library (auto-detected)',
      techNode: '55nm',
      pdkId: 'ics55',
      detectedFiles: {
        directories: ['IP', 'prtech'],
        files: [],
      },
    })
    showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/project'],
    })

    await expect(
      handlers.get(desktopApiIpcChannels.settingsGet)?.(event, 'recent_projects'),
    ).resolves.toEqual([{ id: 'recent' }])
    await handlers.get(desktopApiIpcChannels.settingsSet)?.(event, 'recent_projects', [
      { id: 'recent' },
    ])
    await handlers.get(desktopApiIpcChannels.settingsDelete)?.(event, 'recent_projects')
    await expect(
      handlers.get(desktopApiIpcChannels.dialogPickDirectory)?.(event, {
        title: 'Select Project',
      }),
    ).resolves.toBe('/tmp/project')
    showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/tmp/a.v', '/tmp/b.sv'],
    })
    await expect(
      handlers.get(desktopApiIpcChannels.dialogPickFiles)?.(event, {
        title: 'Select RTL',
        multiple: true,
        filters: [{ name: 'HDL Files', extensions: ['v', 'sv'] }],
      }),
    ).resolves.toEqual(['/tmp/a.v', '/tmp/b.sv'])
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceIsProjectDirectory)?.(
        event,
        '/tmp/project',
      ),
    ).resolves.toBe(true)
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceRegisterProjectRoot)?.(
        event,
        '/tmp/project',
      ),
    ).resolves.toBe('/tmp/project')
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceRegisterProjectReadRoot)?.(
        event,
        '/tmp/project',
      ),
    ).resolves.toBe('/tmp/project')
    await expect(
      handlers.get(desktopApiIpcChannels.projectManagementReadManifest)?.(
        event,
        '/tmp/project',
      ),
    ).resolves.toBe('{"name":"gcd"}')
    await expect(
      handlers.get(desktopApiIpcChannels.projectManagementListEntries)?.(
        event,
        '/tmp/project',
      ),
    ).resolves.toEqual(['project.json', 'ws_0001'])
    await expect(
      handlers.get(desktopApiIpcChannels.projectManagementReadWorkspaceTexts)?.(event, {
        projectRoot: '/tmp/project',
        workspacePath: '/tmp/project/ws_0001',
        paths: ['home/flow.json'],
      }),
    ).resolves.toEqual({
      texts: { 'home/flow.json': '{"steps":[]}' },
      unavailablePaths: [],
    })
    await handlers.get(desktopApiIpcChannels.workspaceClearProjectRoot)?.(event)
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceRequestProjectPathAccess)?.(
        event,
        '/tmp/project/home.json',
      ),
    ).resolves.toBe('/tmp/project/home.json')
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceReadProjectTextFile)?.(
        event,
        '/tmp/project/home/flow.json',
      ),
    ).resolves.toBe('{"steps":[]}')
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceReadOptionalProjectTextFile)?.(
        event,
        '/tmp/project/Synthesis_yosys/log/Synthesis.log',
      ),
    ).resolves.toBeNull()
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceReadProjectTextFileTail)?.(
        event,
        '/tmp/project/Synthesis_yosys/log/Synthesis.log',
        1024,
      ),
    ).resolves.toBe('tail log')
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceReadOptionalProjectTextFileTail)?.(
        event,
        '/tmp/project/Synthesis_yosys/log/Synthesis.log',
        1024,
      ),
    ).resolves.toEqual({
      content: 'tail log',
      truncated: true,
      sizeBytes: 4096,
    })
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceReadOptionalProjectTextFileChunk)?.(
        event,
        '/tmp/project/Synthesis_yosys/log/Synthesis.log',
        0,
        262144,
      ),
    ).resolves.toMatchObject({
      content: 'complete log',
      eof: true,
    })
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceReadProjectBinaryFile)?.(
        event,
        '/tmp/project/output/preview.bin',
      ),
    ).resolves.toEqual(Uint8Array.from([0x45, 0x43, 0x4f, 0x53]))
    await handlers.get(desktopApiIpcChannels.workspaceWriteProjectTextFile)?.(
      event,
      '/tmp/project/home/parameters.json',
      '{"PDK":"ics55"}',
    )
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceListProjectDirectory)?.(
        event,
        '/tmp/project/origin',
      ),
    ).resolves.toEqual([
      {
        name: 'gcd_Floorplan.def.gz',
        path: '/tmp/project/origin/gcd_Floorplan.def.gz',
        type: 'file',
      },
    ])
    const replacement = {
      id: 'replacement-ws-0001',
      targetPath: '/tmp/project/ws_0001',
      backupPath: '/tmp/project/.ws_0001.replace-backup',
    }
    await expect(
      handlers.get(desktopApiIpcChannels.workspacePrepareProjectDirectoryReplacement)?.(
        event,
        '/tmp/project/ws_0001',
      ),
    ).resolves.toEqual(replacement)
    await handlers.get(
      desktopApiIpcChannels.workspaceRestoreProjectDirectoryReplacement,
    )?.(event, replacement.id)
    await handlers.get(
      desktopApiIpcChannels.workspaceFinalizeProjectDirectoryReplacement,
    )?.(event, replacement.id)
    await handlers.get(
      desktopApiIpcChannels.workspaceRetainProjectDirectoryReplacement,
    )?.(event, replacement.id)
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceScanPdkDirectory)?.(event, '/tmp/pdk'),
    ).resolves.toMatchObject({
      canonicalPath: '/tmp/pdk',
      pdkId: 'ics55',
    })

    expect(services.settingsStore.get).toHaveBeenCalledWith('recent_projects')
    expect(services.settingsStore.set).toHaveBeenCalledWith('recent_projects', [
      { id: 'recent' },
    ])
    expect(services.settingsStore.delete).toHaveBeenCalledWith('recent_projects')
    expect(showOpenDialog).toHaveBeenCalledWith({
      properties: ['openDirectory'],
      title: 'Select Project',
      buttonLabel: 'Select Folder',
    })
    expect(showOpenDialog).toHaveBeenCalledWith({
      properties: ['openFile', 'multiSelections'],
      title: 'Select RTL',
      filters: [{ name: 'HDL Files', extensions: ['v', 'sv'] }],
    })
    expect(services.workspaceService.readProjectTextFile).toHaveBeenCalledWith(
      '/tmp/project/home/flow.json',
    )
    expect(services.workspaceService.readOptionalProjectTextFile).toHaveBeenCalledWith(
      '/tmp/project/Synthesis_yosys/log/Synthesis.log',
    )
    expect(services.workspaceService.readProjectTextFileTail).toHaveBeenCalledWith(
      '/tmp/project/Synthesis_yosys/log/Synthesis.log',
      1024,
    )
    expect(
      services.workspaceService.readOptionalProjectTextFileTail,
    ).toHaveBeenCalledWith('/tmp/project/Synthesis_yosys/log/Synthesis.log', 1024)
    expect(
      services.workspaceService.readOptionalProjectTextFileChunk,
    ).toHaveBeenCalledWith('/tmp/project/Synthesis_yosys/log/Synthesis.log', 0, 262144)
    expect(services.workspaceService.readProjectBinaryFile).toHaveBeenCalledWith(
      '/tmp/project/output/preview.bin',
    )
    expect(services.workspaceService.writeProjectTextFile).toHaveBeenCalledWith(
      '/tmp/project/home/parameters.json',
      '{"PDK":"ics55"}',
    )
    expect(services.workspaceService.listProjectDirectory).toHaveBeenCalledWith(
      '/tmp/project/origin',
    )
    expect(
      services.workspaceService.prepareProjectDirectoryReplacement,
    ).toHaveBeenCalledWith('/tmp/project/ws_0001')
    expect(
      services.workspaceService.restoreProjectDirectoryReplacement,
    ).toHaveBeenCalledWith(replacement.id)
    expect(
      services.workspaceService.finalizeProjectDirectoryReplacement,
    ).toHaveBeenCalledWith(replacement.id)
    expect(
      services.workspaceService.retainProjectDirectoryReplacement,
    ).toHaveBeenCalledWith(replacement.id)
    expect(services.workspaceService.clearProjectRoot).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed replacement ids before calling the workspace service', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }

    await expect(
      handlers.get(desktopApiIpcChannels.workspaceRestoreProjectDirectoryReplacement)?.(
        event,
        { id: 'replacement-ws-0001' },
      ),
    ).resolves.toMatchObject({
      error: { message: 'Workspace replacement id must be a string' },
      ok: false,
    })
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceFinalizeProjectDirectoryReplacement)?.(
        event,
        null,
      ),
    ).resolves.toMatchObject({
      error: { message: 'Workspace replacement id must be a string' },
      ok: false,
    })

    expect(
      services.workspaceService.restoreProjectDirectoryReplacement,
    ).not.toHaveBeenCalled()
    expect(
      services.workspaceService.finalizeProjectDirectoryReplacement,
    ).not.toHaveBeenCalled()
  })

  it('opens RTL source file picker as single file selection and rejects returned directories', async () => {
    const { handlers } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/tmp/a.v'],
    })

    await expect(
      handlers.get(desktopApiIpcChannels.dialogPickRtlSources)?.(event, {
        title: 'Add RTL Design Files',
        multiple: false,
      }),
    ).resolves.toEqual({
      directories: [],
      files: ['/tmp/a.v'],
    })

    expect(showOpenDialog).toHaveBeenCalledWith({
      properties: ['openFile'],
      title: 'Add RTL Design Files',
      filters: [{ name: 'HDL Files', extensions: ['v', 'sv', 'vhd', 'vhdl', 'gz'] }],
    })

    showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/tmp/rtl-dir'],
    })

    await expect(
      handlers.get(desktopApiIpcChannels.dialogPickRtlSources)?.(event, {
        title: 'Add RTL Design Files',
        multiple: false,
      }),
    ).resolves.toEqual({
      error: expect.objectContaining({
        message:
          'Please select RTL design files, not folders. Use Select design folder to scan a folder.',
      }),
      ok: false,
    })
  })

  it('delegates chip viewer launches to the chip viewer service', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    const request = {
      mode: 'edit',
      projectPath: '/tmp/project',
      step: 'Floorplan',
    }
    services.chipViewerService.open.mockResolvedValue({
      geometryManifestPath:
        '/tmp/project/Floorplan_ecc/output/geometry/geometry.manifest',
      spawned: true,
      workspaceStepDirectory: '/tmp/project/Floorplan_ecc',
    })

    await expect(
      handlers.get(desktopApiIpcChannels.chipViewerOpen)?.(event, request),
    ).resolves.toEqual({
      geometryManifestPath:
        '/tmp/project/Floorplan_ecc/output/geometry/geometry.manifest',
      spawned: true,
      workspaceStepDirectory: '/tmp/project/Floorplan_ecc',
    })

    expect(services.chipViewerService.open).toHaveBeenCalledWith(request)
  })

  it('reports whether a step Chip Viewer is still open', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    const request = { projectPath: '/tmp/project', step: 'Floorplan' }
    services.chipViewerService.isOpen.mockReturnValue({ open: true })

    await expect(
      handlers.get(desktopApiIpcChannels.chipViewerIsOpen)?.(event, request),
    ).resolves.toEqual({ open: true })

    expect(services.chipViewerService.isOpen).toHaveBeenCalledWith(request)
  })

  it('delegates workspace resource calls to the resource service', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    const index = {
      design: 'gcd',
      flow: { steps: [] },
      home: {
        checklistJson: {
          exists: false,
          kind: 'checklist',
          path: '/tmp/project/home/checklist.json',
        },
        flowJson: { exists: true, kind: 'flow', path: '/tmp/project/home/flow.json' },
        homeJson: { exists: true, kind: 'home', path: '/tmp/project/home/home.json' },
        parametersJson: {
          exists: true,
          kind: 'parameters',
          path: '/tmp/project/home/parameters.json',
        },
      },
      homeData: {},
      messages: [],
      parameters: {},
      pdk: 'ics55',
      root: '/tmp/project',
      status: 'available',
      topModule: 'gcd',
    }
    services.workspaceResourceService.getIndex.mockResolvedValue(index)
    services.workspaceResourceService.readHome.mockResolvedValue({
      flow: '/tmp/project/home/flow.json',
    })
    services.workspaceResourceService.readFlow.mockResolvedValue({ steps: [] })
    services.workspaceResourceService.readParameters.mockResolvedValue({ Design: 'gcd' })
    services.workspaceResourceService.resolveStepInfo.mockResolvedValue({
      id: 'layout',
      info: {},
      message: [],
      missing: [],
      response: 'available',
      step: 'route',
    })

    await expect(
      handlers.get(desktopApiIpcChannels.workspaceResourcesGetIndex)?.(event),
    ).resolves.toEqual(index)
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceResourcesReadHome)?.(event),
    ).resolves.toEqual({ flow: '/tmp/project/home/flow.json' })
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceResourcesReadFlow)?.(event),
    ).resolves.toEqual({ steps: [] })
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceResourcesReadParameters)?.(event),
    ).resolves.toEqual({ Design: 'gcd' })
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceResourcesResolveStepInfo)?.(event, {
        step: 'route',
        id: 'layout',
      }),
    ).resolves.toMatchObject({
      id: 'layout',
      response: 'available',
      step: 'route',
    })

    expect(services.workspaceResourceService.getIndex).toHaveBeenCalledTimes(1)
    expect(services.workspaceResourceService.readHome).toHaveBeenCalledTimes(1)
    expect(services.workspaceResourceService.readFlow).toHaveBeenCalledTimes(1)
    expect(services.workspaceResourceService.readParameters).toHaveBeenCalledTimes(1)
    expect(services.workspaceResourceService.resolveStepInfo).toHaveBeenCalledWith({
      step: 'route',
      id: 'layout',
    })
  })

  it('delegates Backend Workspace queries to the scenario service', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 41 } }
    const result = {
      generation: 0,
      overview: { identity: { workspaceName: 'Workspace A' } },
      workspaceContextId: 'workspace-context-1',
    }
    services.backendWorkspaceService.getOverview.mockResolvedValue(result)
    const detailRequest = {
      stepId: 'Place',
      workspaceContextId: 'workspace-context-1',
      workspaceRevision: 9,
    }
    const detail = { detail: { status: 'unavailable', issues: [] } }
    services.backendWorkspaceService.getStepDetail.mockResolvedValue(detail)
    services.backendWorkspaceService.getArtifact.mockResolvedValue(detail)
    services.backendWorkspaceService.refreshOverview.mockResolvedValue(result)

    await expect(
      handlers.get(desktopApiIpcChannels.backendWorkspaceGetOverview)?.(event),
    ).resolves.toEqual(result)
    await expect(
      handlers.get(desktopApiIpcChannels.backendWorkspaceGetStepDetail)?.(
        event,
        detailRequest,
      ),
    ).resolves.toEqual(detail)
    await expect(
      handlers.get(desktopApiIpcChannels.backendWorkspaceGetArtifact)?.(event, {
        artifactId: 'layout-place',
        workspaceContextId: 'workspace-context-1',
        workspaceRevision: 9,
      }),
    ).resolves.toEqual(detail)
    await expect(
      handlers.get(desktopApiIpcChannels.backendWorkspaceRefreshOverview)?.(event),
    ).resolves.toEqual(result)

    expect(services.backendWorkspaceService.getOverview).toHaveBeenCalledTimes(1)
    expect(services.backendWorkspaceService.getStepDetail).toHaveBeenCalledWith(
      detailRequest,
    )
    expect(services.backendWorkspaceService.getArtifact).toHaveBeenCalledWith({
      artifactId: 'layout-place',
      workspaceContextId: 'workspace-context-1',
      workspaceRevision: 9,
    })
    expect(services.backendWorkspaceService.refreshOverview).toHaveBeenCalledTimes(1)
  })

  it('forwards Backend Workspace invalidation only to its owning window', () => {
    const send = vi.fn()
    getAllWindows.mockReturnValue([
      {
        isDestroyed: () => false,
        webContents: { id: 41, send },
      } as unknown as MockBrowserWindow,
    ])
    const { services } = registerHandlers()
    const listener = services.backendWorkspaceService.onInvalidated.mock.calls[0]?.[0]

    listener?.({
      generation: 2,
      windowId: 41,
      workspaceContextId: 'workspace-context-1',
    })

    expect(send).toHaveBeenCalledWith(
      desktopApiEventChannels.backendWorkspaceInvalidated,
      {
        generation: 2,
        workspaceContextId: 'workspace-context-1',
      },
    )
  })

  it('exports ECC signoff through the runtime service', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    const request = {
      outputPath: '/exports/custom package.tar.gz',
      workspaceHandle: 'workspace-handle-1',
    }
    const result = { outputPath: request.outputPath }
    services.eccRuntimeService.openWorkspace.mockResolvedValue({
      directory: '/work/demo',
      workspaceHandle: request.workspaceHandle,
    })
    services.eccRuntimeService.exportSignoff.mockResolvedValue(result)
    await openBackendWorkspace(handlers, event, {
      directory: '/work/demo',
    })

    await expect(
      handlers.get(desktopApiIpcChannels.productCommandExecute)?.(event, {
        command: 'workspace.exportSignoff',
        payload: request,
      }),
    ).resolves.toEqual(result)

    expect(services.eccRuntimeService.exportSignoff).toHaveBeenCalledWith(request)
  })

  it('rejects Product Commands from a Renderer that does not own the Workspace', async () => {
    const { handlers, services } = registerHandlers()
    const owner = { sender: { id: 'owner' } }
    services.eccRuntimeService.openWorkspace.mockResolvedValue({
      directory: '/work/demo',
      workspaceHandle: 'workspace-handle-1',
    })
    await openBackendWorkspace(handlers, owner, {
      directory: '/work/demo',
    })

    await expect(
      handlers.get(desktopApiIpcChannels.productCommandExecute)?.(
        { sender: { id: 'other' } },
        {
          command: 'workspace.run',
          payload: {
            expectedWorkspaceRevision: 1,
            idempotencyKey: 'command-1',
            workspaceHandle: 'workspace-handle-1',
          },
        },
      ),
    ).resolves.toEqual({
      error: {
        message: 'Product Command does not own this Workspace handle',
        name: 'Error',
      },
      ok: false,
    })
    expect(services.eccRuntimeService.startFlowOperation).not.toHaveBeenCalled()
  })

  it('reads the Engineering Snapshot through the runtime service', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    const request = {
      expectedWorkspaceRevision: 7,
      workspaceHandle: 'workspace-handle-1',
    }
    const result = { workspaceId: 'workspace-1', workspaceRevision: 7 }
    services.eccRuntimeService.engineeringSnapshot.mockResolvedValue(result)

    await expect(
      handlers.get(desktopApiIpcChannels.eccRuntimeEngineeringSnapshot)?.(event, request),
    ).resolves.toEqual(result)

    expect(services.eccRuntimeService.engineeringSnapshot).toHaveBeenCalledWith(request)
  })

  it('returns and invalidates only Operations owned by the sending window', async () => {
    const { handlers, services } = registerHandlers()
    const ownerSend = vi.fn()
    const otherSend = vi.fn()
    const ownerSender = Object.assign(new EventEmitter(), {
      id: 11,
      isDestroyed: vi.fn(() => false),
      send: ownerSend,
    })
    const otherSender = Object.assign(new EventEmitter(), {
      id: 22,
      isDestroyed: vi.fn(() => false),
      send: otherSend,
    })
    services.eccRuntimeService.openWorkspace
      .mockResolvedValueOnce({
        directory: '/work/a',
        workspaceHandle: 'workspace-handle-a',
      })
      .mockResolvedValueOnce({
        directory: '/work/b',
        workspaceHandle: 'workspace-handle-b',
      })
    await openBackendWorkspace(
      handlers,
      { sender: ownerSender },
      { directory: '/work/a' },
    )
    await openBackendWorkspace(
      handlers,
      { sender: otherSender },
      { directory: '/work/b' },
    )
    services.eccRuntimeService.operationProjection.mockReturnValue({
      creations: [],
      finalizations: [],
      generation: 4,
      operations: [
        { operationId: 'operation-a', workspaceHandle: 'workspace-handle-a' },
        { operationId: 'operation-b', workspaceHandle: 'workspace-handle-b' },
      ],
      outcomes: [],
    } as unknown as EccBackgroundOperationProjection)

    await expect(
      handlers.get(desktopApiIpcChannels.eccRuntimeOperationProjection)?.({
        sender: ownerSender,
      }),
    ).resolves.toEqual({
      creations: [],
      finalizations: [],
      generation: 4,
      operations: [{ operationId: 'operation-a', workspaceHandle: 'workspace-handle-a' }],
      outcomes: [],
    })
    await handlers.get(desktopApiIpcChannels.eccRuntimeOperationProjection)?.({
      sender: otherSender,
    })

    const invalidate =
      services.eccRuntimeService.onOperationProjectionInvalidated.mock.calls[0]?.[0]
    services.eccRuntimeService.operationProjection.mockReturnValue({
      creations: [],
      finalizations: [],
      generation: 5,
      operations: [],
      outcomes: [],
    })
    invalidate?.(5)
    expect(ownerSend).toHaveBeenCalledWith(
      desktopApiEventChannels.eccRuntimeOperationProjectionInvalidated,
      { generation: 5 },
    )
    expect(otherSend).toHaveBeenCalledWith(
      desktopApiEventChannels.eccRuntimeOperationProjectionInvalidated,
      { generation: 5 },
    )
  })

  it('retains released terminal outcomes for the window that owned the handle', async () => {
    const { handlers, services } = registerHandlers()
    const ownerSender = Object.assign(new EventEmitter(), {
      id: 11,
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    })
    services.eccRuntimeService.openWorkspace.mockResolvedValue({
      directory: '/work/a',
      workspaceHandle: 'workspace-handle-a',
    })
    await openBackendWorkspace(
      handlers,
      { sender: ownerSender },
      { directory: '/work/a' },
    )

    const released = services.eccRuntimeService.onWorkspaceReleased.mock.calls[0]?.[0]
    released?.('workspace-handle-a')
    services.eccRuntimeService.operationProjection.mockReturnValue({
      creations: [],
      finalizations: [],
      generation: 5,
      operations: [],
      outcomes: [{ operationId: 'operation-a', workspaceHandle: 'workspace-handle-a' }],
    } as unknown as EccBackgroundOperationProjection)

    await expect(
      handlers.get(desktopApiIpcChannels.eccRuntimeOperationProjection)?.({
        sender: ownerSender,
      }),
    ).resolves.toMatchObject({
      outcomes: [{ operationId: 'operation-a', workspaceHandle: 'workspace-handle-a' }],
    })
    await expect(
      handlers.get(desktopApiIpcChannels.eccRuntimeOperationProjection)?.({
        sender: Object.assign(new EventEmitter(), {
          id: 22,
          isDestroyed: vi.fn(() => false),
          send: vi.fn(),
        }),
      }),
    ).resolves.toMatchObject({ outcomes: [] })
  })

  it('reuses a tracked backend Workspace Session only for its owning window', async () => {
    const { handlers, services } = registerHandlers()
    const ownerSender = Object.assign(new EventEmitter(), {
      id: 11,
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    })
    services.eccRuntimeService.openWorkspace.mockResolvedValue({
      directory: '/work/demo',
      workspaceHandle: 'workspace-handle-1',
      workspaceId: 'engineering-1',
      workspaceRevision: 7,
    })
    services.eccRuntimeService.workspaceSession.mockReturnValue({
      directory: '/work/demo',
      reused: true,
      workspaceHandle: 'workspace-handle-1',
      workspaceId: 'engineering-1',
      workspaceRevision: 7,
    })

    await openBackendWorkspace(
      handlers,
      { sender: ownerSender },
      { directory: '/work/demo' },
    )
    await expect(
      openBackendWorkspace(
        handlers,
        { sender: ownerSender },
        { directory: '/work/demo/' },
      ),
    ).resolves.toMatchObject({
      reused: true,
      workspaceHandle: 'workspace-handle-1',
    })

    expect(services.eccRuntimeService.openWorkspace).toHaveBeenCalledOnce()
    expect(services.eccRuntimeService.workspaceSession).toHaveBeenCalledWith(
      'workspace-handle-1',
    )
  })

  it('does not transfer a reused Runtime handle to another window', async () => {
    const { handlers, services } = registerHandlers()
    const ownerSender = Object.assign(new EventEmitter(), {
      id: 11,
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    })
    const otherSender = Object.assign(new EventEmitter(), {
      id: 22,
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    })
    services.eccRuntimeService.openWorkspace.mockResolvedValue({
      directory: '/work/demo',
      workspaceHandle: 'workspace-handle-1',
    })
    await openBackendWorkspace(
      handlers,
      { sender: ownerSender },
      { directory: '/work/demo' },
    )

    await expect(
      openBackendWorkspace(
        handlers,
        { sender: otherSender },
        { directory: '/work/demo' },
      ),
    ).resolves.toMatchObject({
      error: { message: 'Workspace Runtime Session is owned by another window.' },
      ok: false,
    })
    expect(services.eccRuntimeService.openWorkspace).toHaveBeenCalledOnce()

    services.eccRuntimeService.operationLog.mockResolvedValue({
      content: 'still owned',
      truncated: false,
    })
    await expect(
      handlers.get(desktopApiIpcChannels.eccRuntimeOperationLog)?.(
        { sender: ownerSender },
        { operationId: 'operation-1', workspaceHandle: 'workspace-handle-1' },
      ),
    ).resolves.toMatchObject({ content: 'still owned' })
  })

  it('claims a Workspace directory while an open is in flight', async () => {
    const { handlers, services } = registerHandlers()
    const ownerSender = Object.assign(new EventEmitter(), {
      id: 11,
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    })
    const otherSender = Object.assign(new EventEmitter(), {
      id: 22,
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    })
    let finishOpen:
      | ((value: { directory: string; workspaceHandle: string }) => void)
      | undefined
    services.eccRuntimeService.openWorkspace.mockReturnValueOnce(
      new Promise((resolve) => {
        finishOpen = resolve
      }),
    )

    const firstOpen = openBackendWorkspace(
      handlers,
      { sender: ownerSender },
      { directory: '/work/demo' },
    )
    await vi.waitFor(() =>
      expect(services.eccRuntimeService.openWorkspace).toHaveBeenCalledOnce(),
    )

    await expect(
      openBackendWorkspace(
        handlers,
        { sender: otherSender },
        { directory: '/work/demo' },
      ),
    ).resolves.toMatchObject({
      error: { message: 'Workspace Runtime Session is owned by another window.' },
      ok: false,
    })

    finishOpen?.({ directory: '/work/demo', workspaceHandle: 'workspace-handle-1' })
    await expect(firstOpen).resolves.toMatchObject({
      workspaceHandle: 'workspace-handle-1',
    })
    expect(services.eccRuntimeService.openWorkspace).toHaveBeenCalledOnce()
  })

  it('loads bounded Operation logs only for the window that owns the handle', async () => {
    const { handlers, services } = registerHandlers()
    const owner = Object.assign(new EventEmitter(), {
      id: 11,
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    })
    services.eccRuntimeService.openWorkspace.mockResolvedValue({
      directory: '/work/demo',
      workspaceHandle: 'workspace-handle-1',
    })
    services.eccRuntimeService.operationLog.mockResolvedValue({
      content: 'route completed',
      truncated: false,
    })
    await openBackendWorkspace(handlers, { sender: owner }, { directory: '/work/demo' })
    const request = {
      operationId: 'operation-1',
      workspaceHandle: 'workspace-handle-1',
    }

    await expect(
      handlers.get(desktopApiIpcChannels.eccRuntimeOperationLog)?.(
        { sender: owner },
        request,
      ),
    ).resolves.toEqual({ content: 'route completed', truncated: false })
    await expect(
      handlers.get(desktopApiIpcChannels.eccRuntimeOperationLog)?.(
        { sender: { id: 22 } },
        request,
      ),
    ).resolves.toMatchObject({
      error: {
        message: 'Operation log request does not own this Workspace handle.',
      },
      ok: false,
    })
  })

  it('routes directory-scoped runtime.ready only to the matching workspace window', async () => {
    const { handlers, services } = registerHandlers()
    const ownerSend = vi.fn()
    const otherSend = vi.fn()
    const ownerSender = Object.assign(new EventEmitter(), {
      id: 11,
      isDestroyed: vi.fn(() => false),
      send: ownerSend,
    })
    const otherSender = Object.assign(new EventEmitter(), {
      id: 22,
      isDestroyed: vi.fn(() => false),
      send: otherSend,
    })
    services.eccRuntimeService.openWorkspace
      .mockResolvedValueOnce({
        directory: '/work/demo',
        workspaceHandle: 'workspace-handle-1',
      })
      .mockResolvedValueOnce({
        directory: '/work/other',
        workspaceHandle: 'workspace-handle-2',
      })
    await openBackendWorkspace(
      handlers,
      { sender: ownerSender },
      { directory: '/work/demo' },
    )
    await openBackendWorkspace(
      handlers,
      { sender: otherSender },
      { directory: '/work/other' },
    )

    const listener = services.eccRuntimeService.onEvent.mock.calls[0]?.[0]
    getAllWindows.mockClear()
    listener?.({
      type: 'runtime.ready',
      workspaceDirectory: '/work/demo',
    })

    expect(ownerSend).toHaveBeenCalledWith(desktopApiEventChannels.designRuntimeEvent, {
      designTool: 'backend',
      type: 'runtime.ready',
      workspaceDirectory: '/work/demo',
    })
    expect(otherSend).not.toHaveBeenCalled()
    expect(getAllWindows).not.toHaveBeenCalled()
  })

  it('routes directory-scoped runtime.exited only to the matching workspace window', async () => {
    const { handlers, services } = registerHandlers()
    const ownerSend = vi.fn()
    const otherSend = vi.fn()
    const ownerSender = Object.assign(new EventEmitter(), {
      id: 11,
      isDestroyed: vi.fn(() => false),
      send: ownerSend,
    })
    const otherSender = Object.assign(new EventEmitter(), {
      id: 22,
      isDestroyed: vi.fn(() => false),
      send: otherSend,
    })
    services.eccRuntimeService.openWorkspace
      .mockResolvedValueOnce({
        directory: '/work/demo',
        workspaceHandle: 'workspace-handle-1',
      })
      .mockResolvedValueOnce({
        directory: '/work/other',
        workspaceHandle: 'workspace-handle-2',
      })
    await openBackendWorkspace(
      handlers,
      { sender: ownerSender },
      { directory: '/work/demo' },
    )
    await openBackendWorkspace(
      handlers,
      { sender: otherSender },
      { directory: '/work/other' },
    )

    const listener = services.eccRuntimeService.onEvent.mock.calls[0]?.[0]
    const exited: EccRuntimeEvent = {
      code: 1,
      reason: 'unexpected',
      signal: null,
      type: 'runtime.exited',
      workspaceDirectory: '/work/demo',
    }
    listener?.(exited)

    expect(ownerSend).toHaveBeenCalledWith(desktopApiEventChannels.designRuntimeEvent, {
      ...exited,
      designTool: 'backend',
    })
    expect(otherSend).not.toHaveBeenCalled()
  })

  it('does not deliver directory-scoped events without a workspaceDirectory', () => {
    const { services } = registerHandlers()
    const webContents = {
      send: vi.fn(),
    }
    getAllWindows.mockReturnValue([
      {
        isDestroyed: () => false,
        webContents,
      },
    ])
    const listener = services.eccRuntimeService.onEvent.mock.calls[0]?.[0]
    listener?.({ type: 'runtime.ready' })

    expect(webContents.send).not.toHaveBeenCalled()
    expect(getAllWindows).not.toHaveBeenCalled()
  })

  it('invalidates every Project execution snapshot for Runtime operation changes', () => {
    const { services } = registerHandlers()
    const listener = services.eccRuntimeService.onEvent.mock.calls[0]?.[0]

    listener?.({
      event: {
        eventId: 'event-1',
        operationId: 'operation-1',
        origin: 'gui',
        payload: { state: 'queued', workspaceRevision: 1 },
        sequence: 1,
        timestamp: 1,
        type: 'operation.changed',
        workspaceId: 'engineering-1',
      },
      type: 'runtime.protocol',
    })

    expect(
      services.backendProjectComparisonService.invalidateExecution,
    ).toHaveBeenCalledOnce()
    expect(
      services.backendProjectComparisonService.invalidateWorkspace,
    ).not.toHaveBeenCalled()

    listener?.({
      event: {
        eventId: 'event-prepared',
        operationId: 'operation-1',
        origin: 'gui',
        payload: {
          sourceType: 'operation.rerun_prepared',
          workspaceRevision: 2,
        },
        sequence: 2,
        timestamp: 2,
        type: 'execution.progress',
        workspaceId: 'engineering-1',
      },
      type: 'runtime.protocol',
      workspaceDirectory: '/work/demo',
    })

    expect(
      services.backendProjectComparisonService.invalidateExecution,
    ).toHaveBeenCalledTimes(2)
    expect(
      services.backendProjectComparisonService.invalidateWorkspace,
    ).toHaveBeenCalledWith('/work/demo')

    listener?.({
      event: {
        eventId: 'event-2',
        operationId: 'operation-1',
        origin: 'gui',
        payload: { state: 'succeeded', workspaceRevision: 2 },
        sequence: 3,
        timestamp: 3,
        type: 'operation.changed',
        workspaceId: 'engineering-1',
      },
      type: 'runtime.protocol',
      workspaceDirectory: '/work/demo',
    })

    expect(
      services.backendProjectComparisonService.invalidateExecution,
    ).toHaveBeenCalledTimes(3)
    expect(
      services.backendProjectComparisonService.invalidateWorkspace,
    ).toHaveBeenCalledWith('/work/demo')
  })

  it('matches directory-scoped events after normalizing trailing slashes', async () => {
    const { handlers, services } = registerHandlers()
    const ownerSend = vi.fn()
    const ownerSender = Object.assign(new EventEmitter(), {
      id: 11,
      isDestroyed: vi.fn(() => false),
      send: ownerSend,
    })
    services.eccRuntimeService.openWorkspace.mockResolvedValue({
      directory: '/work/demo/',
      workspaceHandle: 'workspace-handle-1',
    })
    await openBackendWorkspace(
      handlers,
      { sender: ownerSender },
      { directory: '/work/demo/' },
    )

    const listener = services.eccRuntimeService.onEvent.mock.calls[0]?.[0]
    listener?.({
      type: 'runtime.ready',
      workspaceDirectory: '/work/demo',
    })

    expect(ownerSend).toHaveBeenCalledWith(desktopApiEventChannels.designRuntimeEvent, {
      designTool: 'backend',
      type: 'runtime.ready',
      workspaceDirectory: '/work/demo',
    })
  })

  it('routes directory-scoped runtime.stderr to the matching workspace window', async () => {
    const { handlers, services } = registerHandlers()
    const ownerSend = vi.fn()
    const otherSend = vi.fn()
    const ownerSender = Object.assign(new EventEmitter(), {
      id: 11,
      isDestroyed: vi.fn(() => false),
      send: ownerSend,
    })
    const otherSender = Object.assign(new EventEmitter(), {
      id: 22,
      isDestroyed: vi.fn(() => false),
      send: otherSend,
    })
    services.eccRuntimeService.openWorkspace
      .mockResolvedValueOnce({
        directory: '/work/demo',
        workspaceHandle: 'workspace-handle-1',
      })
      .mockResolvedValueOnce({
        directory: '/work/other',
        workspaceHandle: 'workspace-handle-2',
      })
    await openBackendWorkspace(
      handlers,
      { sender: ownerSender },
      { directory: '/work/demo' },
    )
    await openBackendWorkspace(
      handlers,
      { sender: otherSender },
      { directory: '/work/other' },
    )

    const listener = services.eccRuntimeService.onEvent.mock.calls[0]?.[0]
    listener?.({
      text: 'yosys: warning',
      type: 'runtime.stderr',
      workspaceDirectory: '/work/demo',
    })

    expect(ownerSend).toHaveBeenCalledWith(desktopApiEventChannels.designRuntimeEvent, {
      designTool: 'backend',
      text: 'yosys: warning',
      type: 'runtime.stderr',
      workspaceDirectory: '/work/demo',
    })
    expect(otherSend).not.toHaveBeenCalled()
  })

  it('replays buffered runtime.ready when a workspace handle subscribes later', async () => {
    const { handlers, services } = registerHandlers()
    const listener = services.eccRuntimeService.onEvent.mock.calls[0]?.[0]
    listener?.({
      type: 'runtime.ready',
      workspaceDirectory: '/work/demo/',
    })

    const ownerSend = vi.fn()
    const ownerSender = Object.assign(new EventEmitter(), {
      id: 11,
      isDestroyed: vi.fn(() => false),
      send: ownerSend,
    })
    services.eccRuntimeService.openWorkspace.mockResolvedValue({
      directory: '/work/demo',
      workspaceHandle: 'workspace-handle-1',
    })
    await openBackendWorkspace(
      handlers,
      { sender: ownerSender },
      { directory: '/work/demo' },
    )

    expect(ownerSend).toHaveBeenCalledWith(desktopApiEventChannels.designRuntimeEvent, {
      designTool: 'backend',
      type: 'runtime.ready',
      workspaceDirectory: '/work/demo',
    })
  })

  it('unicasts operation ECC events only to the subscribed workspace window', async () => {
    const { handlers, services } = registerHandlers()
    const ownerSend = vi.fn()
    const otherSend = vi.fn()
    const ownerSender = Object.assign(new EventEmitter(), {
      id: 11,
      isDestroyed: vi.fn(() => false),
      send: ownerSend,
    })
    const otherSender = Object.assign(new EventEmitter(), {
      id: 22,
      isDestroyed: vi.fn(() => false),
      send: otherSend,
    })
    services.eccRuntimeService.openWorkspace
      .mockResolvedValueOnce({
        directory: '/work/demo',
        workspaceHandle: 'workspace-handle-1',
      })
      .mockResolvedValueOnce({
        directory: '/work/other',
        workspaceHandle: 'workspace-handle-2',
      })
    await openBackendWorkspace(
      handlers,
      { sender: ownerSender },
      { directory: '/work/demo' },
    )
    await openBackendWorkspace(
      handlers,
      { sender: otherSender },
      { directory: '/work/other' },
    )

    const listener = services.eccRuntimeService.onEvent.mock.calls[0]?.[0]
    getAllWindows.mockClear()
    listener?.({
      method: 'flow.run_step',
      operationId: 'op-1',
      type: 'operation.started',
      workspaceHandle: 'workspace-handle-1',
    })

    expect(ownerSend).toHaveBeenCalledWith(
      desktopApiEventChannels.designRuntimeEvent,
      expect.objectContaining({
        type: 'operation.started',
        workspaceHandle: 'workspace-handle-1',
      }),
    )
    expect(otherSend).not.toHaveBeenCalled()
    expect(getAllWindows).not.toHaveBeenCalled()
  })

  it('invalidates Backend Workspace before forwarding a committed step event', async () => {
    const { handlers, services } = registerHandlers()
    const send = vi.fn()
    const sender = Object.assign(new EventEmitter(), {
      id: 11,
      isDestroyed: vi.fn(() => false),
      send,
    })
    services.eccRuntimeService.openWorkspace.mockResolvedValue({
      directory: '/work/demo',
      workspaceHandle: 'workspace-handle-1',
    })
    await openBackendWorkspace(handlers, { sender }, { directory: '/work/demo' })

    const listener = services.eccRuntimeService.onEvent.mock.calls[0]?.[0]
    listener?.({
      event: {
        eventId: 'workspace-1:3',
        operationId: 'operation-1',
        origin: 'gui',
        payload: { sourceType: 'step.completed', state: 'Success' },
        sequence: 3,
        timestamp: 1,
        type: 'workspace.committed',
        workspaceId: 'workspace-1',
      },
      type: 'runtime.protocol',
      workspaceHandle: 'workspace-handle-1',
    })

    expect(services.backendWorkspaceService.invalidateWindow).toHaveBeenCalledWith(11)
    expect(
      services.backendProjectComparisonService.invalidateWorkspace,
    ).toHaveBeenCalledOnce()
    expect(
      services.backendProjectComparisonService.invalidateWorkspace,
    ).toHaveBeenCalledWith('/work/demo')
    expect(
      services.backendWorkspaceService.invalidateWindow.mock.invocationCallOrder[0],
    ).toBeLessThan(send.mock.invocationCallOrder[0]!)
  })

  it('streams frontend subflow progress to its subscribed workspace window', async () => {
    const { handlers, services } = registerHandlers()
    const ownerSend = vi.fn()
    const otherSend = vi.fn()
    const ownerSender = Object.assign(new EventEmitter(), {
      id: 11,
      isDestroyed: vi.fn(() => false),
      send: ownerSend,
    })
    const otherSender = Object.assign(new EventEmitter(), {
      id: 22,
      isDestroyed: vi.fn(() => false),
      send: otherSend,
    })
    services.frontendRpcRuntimeService.openWorkspace
      .mockResolvedValueOnce({
        directory: '/work/frontend',
        workspaceHandle: 'workspace-frontend-1',
      })
      .mockResolvedValueOnce({
        directory: '/work/other',
        workspaceHandle: 'workspace-frontend-2',
      })
    await handlers.get(desktopApiIpcChannels.designRuntimeWorkspaceOpen)?.(
      { sender: ownerSender },
      { designTool: 'frontend', directory: '/work/frontend' },
    )
    await handlers.get(desktopApiIpcChannels.designRuntimeWorkspaceOpen)?.(
      { sender: otherSender },
      { designTool: 'frontend', directory: '/work/other' },
    )

    const listener = services.frontendRpcRuntimeService.onEvent.mock.calls[0]?.[0]
    const progress: EccRuntimeEvent = {
      data: {
        runtimeProtocolType: 'subflow.stage',
        state: 'Success',
        step: 'prepare',
        subflowStep: 'collect inputs',
      },
      method: 'flow.run_step',
      phase: 'subflow.stage',
      step: 'prepare',
      type: 'operation.progress',
      workspaceDirectory: '/work/frontend',
      workspaceHandle: 'workspace-frontend-1',
    }
    listener?.(progress)

    expect(ownerSend).toHaveBeenCalledWith(desktopApiEventChannels.designRuntimeEvent, {
      ...progress,
      designTool: 'frontend',
    })
    expect(otherSend).not.toHaveBeenCalled()
  })

  it('routes frontend progress by directory when a sidecar handle is unavailable', async () => {
    const { handlers, services } = registerHandlers()
    const ownerSend = vi.fn()
    const ownerSender = Object.assign(new EventEmitter(), {
      id: 11,
      isDestroyed: vi.fn(() => false),
      send: ownerSend,
    })
    services.frontendRpcRuntimeService.openWorkspace.mockResolvedValueOnce({
      directory: '/work/frontend',
      workspaceHandle: 'workspace-frontend-1',
    })
    await handlers.get(desktopApiIpcChannels.designRuntimeWorkspaceOpen)?.(
      { sender: ownerSender },
      { designTool: 'frontend', directory: '/work/frontend' },
    )

    const listener = services.frontendRpcRuntimeService.onEvent.mock.calls[0]?.[0]
    listener?.({
      data: { step: 'prepare' },
      method: 'flow.run',
      phase: 'started',
      step: 'prepare',
      type: 'operation.progress',
      workspaceDirectory: '/work/frontend',
    })

    expect(ownerSend).toHaveBeenCalledWith(
      desktopApiEventChannels.designRuntimeEvent,
      expect.objectContaining({
        designTool: 'frontend',
        phase: 'started',
        step: 'prepare',
      }),
    )
  })

  it('focuses an existing workspace window instead of proceeding to open', async () => {
    const { handlers } = registerHandlers()
    const existing = {
      focus: vi.fn(),
      isDestroyed: () => false,
      isMinimized: () => false,
      restore: vi.fn(),
      show: vi.fn(),
    }
    const caller = {
      focus: vi.fn(),
      isDestroyed: () => false,
      isMinimized: () => false,
      restore: vi.fn(),
      show: vi.fn(),
    }
    workspaceWindowRegistry.register('/work/demo', existing)
    fromWebContents.mockReturnValue(caller)

    await expect(
      handlers.get(desktopApiIpcChannels.workspaceOpenOrFocus)?.(
        { sender: { id: 1 } },
        '/work/demo/',
      ),
    ).resolves.toEqual({ action: 'focused' })

    expect(existing.focus).toHaveBeenCalledTimes(1)
    expect(caller.focus).not.toHaveBeenCalled()
  })

  it('claims the path on proceed so concurrent opens focus the caller', async () => {
    const { handlers } = registerHandlers()
    const caller = {
      focus: vi.fn(),
      isDestroyed: () => false,
      isMinimized: () => false,
      restore: vi.fn(),
      show: vi.fn(),
    }
    const other = {
      focus: vi.fn(),
      isDestroyed: () => false,
      isMinimized: () => false,
      restore: vi.fn(),
      show: vi.fn(),
    }
    fromWebContents.mockReturnValueOnce(caller).mockReturnValueOnce(other)

    await expect(
      handlers.get(desktopApiIpcChannels.workspaceOpenOrFocus)?.(
        { sender: { id: 1 } },
        '/work/demo',
      ),
    ).resolves.toEqual({ action: 'proceed' })
    expect(workspaceWindowRegistry.findWindow('/work/demo')).toBe(caller)

    await expect(
      handlers.get(desktopApiIpcChannels.workspaceOpenOrFocus)?.(
        { sender: { id: 2 } },
        '/work/demo/',
      ),
    ).resolves.toEqual({ action: 'focused' })
    expect(caller.focus).toHaveBeenCalled()
    expect(other.focus).not.toHaveBeenCalled()
  })

  it('binds and unbinds workspace windows for the caller', async () => {
    const { handlers } = registerHandlers()
    const window = {
      focus: vi.fn(),
      isDestroyed: () => false,
      isMinimized: () => false,
      restore: vi.fn(),
      show: vi.fn(),
    }
    fromWebContents.mockReturnValue(window)

    await expect(
      handlers.get(desktopApiIpcChannels.workspaceBindWindow)?.(
        { sender: { id: 1 } },
        '/work/demo/',
      ),
    ).resolves.toBe('/work/demo')
    expect(workspaceWindowRegistry.findWindow('/work/demo')).toBe(window)

    await expect(
      handlers.get(desktopApiIpcChannels.workspaceGetBoundPath)?.({
        sender: { id: 1 },
      }),
    ).resolves.toBe('/work/demo')

    await handlers.get(desktopApiIpcChannels.workspaceUnbindWindow)?.(
      { sender: { id: 1 } },
      '/work/demo',
    )
    expect(workspaceWindowRegistry.findWindow('/work/demo')).toBeNull()
    await expect(
      handlers.get(desktopApiIpcChannels.workspaceGetBoundPath)?.({
        sender: { id: 1 },
      }),
    ).resolves.toBeNull()
  })

  it('treats openOrFocus as proceed when the caller already owns the path', async () => {
    const { handlers } = registerHandlers()
    const caller = {
      focus: vi.fn(),
      isDestroyed: () => false,
      isMinimized: () => false,
      restore: vi.fn(),
      show: vi.fn(),
    }
    workspaceWindowRegistry.register('/work/demo', caller)
    fromWebContents.mockReturnValue(caller)

    await expect(
      handlers.get(desktopApiIpcChannels.workspaceOpenOrFocus)?.(
        { sender: { id: 1 } },
        '/work/demo/',
      ),
    ).resolves.toEqual({ action: 'proceed' })
    expect(caller.focus).not.toHaveBeenCalled()
    expect(workspaceWindowRegistry.findWindow('/work/demo')).toBe(caller)
  })

  it('returns previousPath when openOrFocus replaces an existing binding', async () => {
    const { handlers } = registerHandlers()
    const caller = {
      focus: vi.fn(),
      isDestroyed: () => false,
      isMinimized: () => false,
      restore: vi.fn(),
      show: vi.fn(),
    }
    workspaceWindowRegistry.register('/work/a', caller)
    fromWebContents.mockReturnValue(caller)

    await expect(
      handlers.get(desktopApiIpcChannels.workspaceOpenOrFocus)?.(
        { sender: { id: 1 } },
        '/work/b',
      ),
    ).resolves.toEqual({ action: 'proceed', previousPath: '/work/a' })
    expect(workspaceWindowRegistry.findWindow('/work/a')).toBeNull()
    expect(workspaceWindowRegistry.findWindow('/work/b')).toBe(caller)
  })

  it('keeps window A bound when openOrFocus focuses window B for a taken path', async () => {
    const { handlers } = registerHandlers()
    const windowA = {
      focus: vi.fn(),
      isDestroyed: () => false,
      isMinimized: () => false,
      restore: vi.fn(),
      show: vi.fn(),
    }
    const windowB = {
      focus: vi.fn(),
      isDestroyed: () => false,
      isMinimized: () => false,
      restore: vi.fn(),
      show: vi.fn(),
    }
    workspaceWindowRegistry.register('/work/a', windowA)
    workspaceWindowRegistry.register('/work/b', windowB)
    fromWebContents.mockReturnValue(windowA)

    await expect(
      handlers.get(desktopApiIpcChannels.workspaceOpenOrFocus)?.(
        { sender: { id: 1 } },
        '/work/b',
      ),
    ).resolves.toEqual({ action: 'focused' })
    expect(windowB.focus).toHaveBeenCalled()
    expect(workspaceWindowRegistry.findWindow('/work/a')).toBe(windowA)
    expect(workspaceWindowRegistry.findWindow('/work/b')).toBe(windowB)
  })

  it('creates a new empty window through the bridge', async () => {
    const { handlers, services } = registerHandlers()

    await handlers.get(desktopApiIpcChannels.windowCreate)?.(
      { sender: { id: 1 } },
      { initialRoute: '/' },
    )

    expect(services.createWindow).toHaveBeenCalledWith({ initialRoute: '/' })
  })

  it('marks a destroyed renderer Workspace lease for lifecycle-aware release', async () => {
    const { handlers, services } = registerHandlers()
    const sender = Object.assign(new EventEmitter(), {
      isDestroyed: vi.fn(() => false),
    })
    const event = { sender }
    services.eccRuntimeService.openWorkspace.mockResolvedValue({
      directory: '/work/demo',
      workspaceHandle: 'workspace-handle-1',
    })

    await expect(
      openBackendWorkspace(handlers, event, {
        directory: '/work/demo',
      }),
    ).resolves.toEqual({
      directory: '/work/demo',
      workspaceHandle: 'workspace-handle-1',
    })

    expect(sender.listenerCount('destroyed')).toBe(1)
    sender.emit('destroyed')
    const explicitClose = closeBackendWorkspace(handlers, event, {
      workspaceHandle: 'workspace-handle-1',
    })

    await explicitClose

    expect(services.eccRuntimeService.closeWorkspace).not.toHaveBeenCalled()
    expect(services.eccRuntimeService.releaseWorkspace).toHaveBeenCalledWith({
      workspaceHandle: 'workspace-handle-1',
    })
    expect(sender.listenerCount('destroyed')).toBe(0)
  })

  it('tracks a workspace handle again after a successful explicit close', async () => {
    const { handlers, services } = registerHandlers()
    const sender = Object.assign(new EventEmitter(), {
      isDestroyed: vi.fn(() => false),
    })
    const event = { sender }
    services.eccRuntimeService.openWorkspace.mockResolvedValue({
      directory: '/work/demo',
      workspaceHandle: 'workspace-handle-1',
    })

    await openBackendWorkspace(handlers, event, {
      directory: '/work/demo',
    })
    expect(sender.listenerCount('destroyed')).toBe(1)

    await closeBackendWorkspace(handlers, event, {
      workspaceHandle: 'workspace-handle-1',
    })
    expect(sender.listenerCount('destroyed')).toBe(0)

    await openBackendWorkspace(handlers, event, {
      directory: '/work/demo',
    })

    expect(sender.listenerCount('destroyed')).toBe(1)
  })

  it('creates shell sessions and forwards shell output to the requesting renderer', async () => {
    const { handlers, services } = registerHandlers()
    const sender = Object.assign(new EventEmitter(), {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    })
    const session = {
      pid: 4242,
      sessionId: 'shell-1',
      shell: '/bin/zsh',
    }
    services.shellService.createSession.mockImplementation(async (_options, listener) => {
      listener({
        data: 'ready\r\n',
        sessionId: 'shell-1',
      })
      listener({
        exitCode: 0,
        sessionId: 'shell-1',
      })
      return session
    })

    await expect(
      handlers.get(desktopApiIpcChannels.shellCreateSession)?.(
        { sender },
        { cols: 120, rows: 32 },
      ),
    ).resolves.toEqual(session)

    expect(services.shellService.createSession).toHaveBeenCalledWith(
      { cols: 120, rows: 32 },
      expect.any(Function),
    )
    expect(sender.send).toHaveBeenCalledWith(desktopApiEventChannels.shellData, {
      data: 'ready\r\n',
      sessionId: 'shell-1',
    })
    expect(sender.send).toHaveBeenCalledWith(desktopApiEventChannels.shellExit, {
      exitCode: 0,
      sessionId: 'shell-1',
    })
    expect(sender.listenerCount('destroyed')).toBe(1)
  })

  it('does not forward shell events after the requesting renderer is destroyed', async () => {
    const { handlers, services } = registerHandlers()
    const sender = Object.assign(new EventEmitter(), {
      isDestroyed: vi.fn(() => true),
      send: vi.fn(),
    })
    services.shellService.createSession.mockImplementation(async (_options, listener) => {
      listener({
        data: 'hidden',
        sessionId: 'shell-1',
      })
      return {
        pid: 4242,
        sessionId: 'shell-1',
        shell: '/bin/zsh',
      }
    })

    await handlers.get(desktopApiIpcChannels.shellCreateSession)?.(
      { sender },
      { cols: 80, rows: 24 },
    )

    expect(sender.send).not.toHaveBeenCalled()
  })

  it('kills shell sessions when the renderer is destroyed or closes them explicitly', async () => {
    const { handlers, services } = registerHandlers()
    const sender = Object.assign(new EventEmitter(), {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    })
    services.shellService.createSession.mockResolvedValue({
      pid: 4242,
      sessionId: 'shell-1',
      shell: '/bin/zsh',
    })

    await handlers.get(desktopApiIpcChannels.shellCreateSession)?.(
      { sender },
      { cols: 80, rows: 24 },
    )
    sender.emit('destroyed')

    await vi.waitFor(() => {
      expect(services.shellService.kill).toHaveBeenCalledWith('shell-1')
    })

    await handlers.get(desktopApiIpcChannels.shellKill)?.({ sender }, 'shell-1')

    expect(services.shellService.kill).toHaveBeenCalledTimes(1)
    expect(sender.listenerCount('destroyed')).toBe(0)
  })

  it('delegates shell writes and resizes to the shell service', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }

    await handlers.get(desktopApiIpcChannels.shellWrite)?.(event, 'shell-1', 'pwd\r')
    await handlers.get(desktopApiIpcChannels.shellResize)?.(event, 'shell-1', 100, 28)

    expect(services.shellService.write).toHaveBeenCalledWith('shell-1', 'pwd\r')
    expect(services.shellService.resize).toHaveBeenCalledWith('shell-1', 100, 28)
  })

  it('returns a missing project binary file as an IPC error without warning', async () => {
    const { handlers, services } = registerHandlers()
    const event = { sender: { id: 'web-contents' } }
    const path = '/tmp/project/place_dreamplace/output/minirv_place.png'
    const error = Object.assign(
      new Error(`ENOENT: no such file or directory, open '${path}'`),
      {
        code: 'ENOENT',
        path,
      },
    )
    services.workspaceService.readProjectBinaryFile.mockRejectedValue(error)

    await expect(
      handlers.get(desktopApiIpcChannels.workspaceReadProjectBinaryFile)?.(event, path),
    ).resolves.toEqual({
      error: {
        code: 'ENOENT',
        message: `ENOENT: no such file or directory, open '${path}'`,
        name: 'Error',
      },
      ok: false,
    })

    expect(electronLogger.warn).not.toHaveBeenCalled()
  })
})
