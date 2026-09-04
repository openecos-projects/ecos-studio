import { describe, expect, it, vi } from 'vitest'
import { executeProductCommand } from './productCommandService'

describe('executeProductCommand Workspace creation', () => {
  it('routes an owned canonical configuration update to the Runtime', async () => {
    const updateWorkspaceConfiguration = vi.fn().mockResolvedValue({
      workspaceRevision: 2,
    })
    const payload = {
      commandId: 'configuration-1',
      configuration: {
        design: { name: 'gcd', topModule: 'gcd', clockPort: 'clk' },
        parameters: { frequency_max: 200 },
        pdk: { familyId: 'ics55' },
      },
      expectedWorkspaceRevision: 1,
      workspaceHandle: 'handle-1',
    }

    await expect(
      executeProductCommand({ command: 'workspace.updateConfiguration', payload }, {
        ownsWorkspaceHandle: (handle: string) => handle === 'handle-1',
        runtime: { updateWorkspaceConfiguration } as never,
      } as never),
    ).resolves.toEqual({ workspaceRevision: 2 })
    expect(updateWorkspaceConfiguration).toHaveBeenCalledWith(payload)
  })

  it('rejects invalid optional Project identity fields at the command boundary', async () => {
    await expect(
      executeProductCommand(
        {
          command: 'workspace.create',
          payload: {
            commandId: 'command-1',
            projectRoot: 42,
            targetDirectory: '/projects/demo/ws_1',
            workspaceBindings: {},
            workspaceSpec: {},
          },
        } as never,
        {} as never,
      ),
    ).rejects.toThrow('Product Command requires projectRoot')
  })

  it('journals registration failure and releases the uncommitted Runtime handle', async () => {
    const failCreate = vi.fn().mockResolvedValue(undefined)
    const releaseWorkspace = vi.fn().mockResolvedValue({ ok: true })
    const registerCreateWorkspace = vi
      .fn()
      .mockRejectedValue(new Error('manifest unavailable'))
    const payload = {
      commandId: 'command-1',
      projectId: 'project-1',
      projectRoot: '/projects/demo',
      targetDirectory: '/projects/demo/ws_1',
      workspaceBindings: {},
      workspaceSpec: {},
    }

    await expect(
      executeProductCommand(
        { command: 'workspace.create', payload },
        {
          beginCreate: vi.fn().mockResolvedValue({
            creationId: 'creation-1',
            targetDirectory: payload.targetDirectory,
          }),
          failCreate,
          markCreateWorkspaceCreated: vi.fn().mockResolvedValue(undefined),
          ownsWorkspaceHandle: () => false,
          prepareCreate: vi.fn(async (request) => request),
          registerCreateWorkspace,
          runtime: {
            cancelOperation: vi.fn(),
            createWorkspace: vi.fn().mockResolvedValue({
              directory: payload.targetDirectory,
              workspaceHandle: 'handle-1',
            }),
            exportSignoff: vi.fn(),
            releaseWorkspace,
            resetFlow: vi.fn(),
            retryFinalSnapshot: vi.fn(),
            startFlowOperation: vi.fn(),
            startStepOperation: vi.fn(),
            syncConfig: vi.fn(),
            updateWorkspaceConfiguration: vi.fn(),
            updateWorkspace: vi.fn(),
          },
          trackCreateResult: vi.fn(),
        },
      ),
    ).rejects.toThrow('manifest unavailable')

    expect(failCreate).toHaveBeenCalledWith('creation-1', expect.any(Error))
    expect(releaseWorkspace).toHaveBeenCalledWith({ workspaceHandle: 'handle-1' })
  })

  it('creates the Runtime Workspace at the journal-authorized target', async () => {
    const createWorkspace = vi.fn().mockResolvedValue({})
    const payload = {
      commandId: 'command-1',
      projectRoot: '/projects/link',
      targetDirectory: '/projects/link/ws_1',
      workspaceBindings: {},
      workspaceSpec: {},
    }

    await executeProductCommand(
      { command: 'workspace.create', payload },
      {
        beginCreate: vi.fn().mockResolvedValue({
          creationId: 'creation-1',
          targetDirectory: '/projects/real/ws_1',
        }),
        failCreate: vi.fn(),
        markCreateWorkspaceCreated: vi.fn(),
        ownsWorkspaceHandle: () => false,
        prepareCreate: vi.fn(async (request) => request),
        registerCreateWorkspace: vi.fn(),
        runtime: {
          cancelOperation: vi.fn(),
          createWorkspace,
          exportSignoff: vi.fn(),
          releaseWorkspace: vi.fn(),
          resetFlow: vi.fn(),
          retryFinalSnapshot: vi.fn(),
          startFlowOperation: vi.fn(),
          startStepOperation: vi.fn(),
          syncConfig: vi.fn(),
          updateWorkspaceConfiguration: vi.fn(),
          updateWorkspace: vi.fn(),
        },
        trackCreateResult: vi.fn(),
      },
    )

    expect(createWorkspace).toHaveBeenCalledWith({
      ...payload,
      targetDirectory: '/projects/real/ws_1',
    })
  })
})
