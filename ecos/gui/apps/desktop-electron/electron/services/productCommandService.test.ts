import { describe, expect, it, vi } from 'vitest'
import { executeProductCommand } from './productCommandService'

describe('executeProductCommand Workspace creation', () => {
  it('validates and routes explicit Optimization Parent Adoption', async () => {
    const adoptOptimizationCandidate = vi.fn().mockResolvedValue({
      adopted: true,
      workspaceRevision: 8,
    })
    const payload = {
      affectedFlowSteps: ['Place', 'Route'],
      candidateId: 'candidate-1',
      candidateRootRef: '.agent/candidates/candidate-1',
      evidence: { manifestSha256: 'sha256:test' },
      episodeId: 'episode-1',
      expectedWorkspaceRevision: 7,
      idempotencyKey: 'adopt-1',
      parameterPatch: [{ knob_id: 'place.target_density', value: 0.6 }],
      workspaceHandle: 'handle-parent',
    }
    await expect(
      executeProductCommand({ command: 'optimization.adoptCandidate', payload }, {
        adoptOptimizationCandidate,
        ownsWorkspaceHandle: () => true,
      } as never),
    ).resolves.toEqual({ adopted: true, workspaceRevision: 8 })
    expect(adoptOptimizationCandidate).toHaveBeenCalledWith(payload)
  })

  it('routes confirmed Optimization cleanup through the owned Parent handle', async () => {
    const cleanupOptimizationEpisode = vi.fn().mockResolvedValue({ cleaned: true })
    const payload = {
      confirmation: true as const,
      episodeId: 'episode-1',
      executionWorkspaceDirectories: ['/runs/episode-1/candidate-1'],
      parentWorkspaceDirectory: '/runs/parent',
      workspaceHandle: 'handle-parent',
    }
    await expect(
      executeProductCommand({ command: 'optimization.cleanup', payload }, {
        cleanupOptimizationEpisode,
        ownsWorkspaceHandle: () => true,
      } as never),
    ).resolves.toEqual({ cleaned: true })
    expect(cleanupOptimizationEpisode).toHaveBeenCalledWith(payload)
  })

  it('rejects a guarded Parent Flow start before invoking the Runtime', async () => {
    const startFlowOperation = vi.fn()
    const error = Object.assign(new Error('Optimization is running in the background.'), {
      code: 'OPTIMIZATION_PARENT_GUARDED',
    })
    const authorizeWorkspaceMutation = vi.fn(() => {
      throw error
    })

    await expect(
      executeProductCommand(
        {
          command: 'workspace.run',
          payload: {
            expectedWorkspaceRevision: 7,
            idempotencyKey: 'run-1',
            workspaceHandle: 'handle-parent',
          },
        },
        {
          authorizeWorkspaceMutation,
          ownsWorkspaceHandle: () => true,
          runtime: { startFlowOperation } as never,
        } as never,
      ),
    ).rejects.toMatchObject({ code: 'OPTIMIZATION_PARENT_GUARDED' })
    expect(authorizeWorkspaceMutation).toHaveBeenCalledWith(
      'workspace.run',
      'handle-parent',
      undefined,
    )
    expect(startFlowOperation).not.toHaveBeenCalled()
  })

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

  it('routes Step Parameters without exposing a configuration path', async () => {
    const updateWorkspaceStepConfiguration = vi.fn().mockResolvedValue({
      workspaceRevision: 2,
    })
    const payload = {
      commandId: 'step-configuration-1',
      expectedWorkspaceRevision: 1,
      parameters: { 'floorplan.ifp.thread_number': 8 },
      stepId: 'Floorplan',
      workspaceHandle: 'handle-1',
    }

    await expect(
      executeProductCommand({ command: 'workspace.updateStepConfiguration', payload }, {
        ownsWorkspaceHandle: (handle: string) => handle === 'handle-1',
        runtime: { updateWorkspaceStepConfiguration } as never,
      } as never),
    ).resolves.toEqual({ workspaceRevision: 2 })
    expect(updateWorkspaceStepConfiguration).toHaveBeenCalledWith(payload)
  })

  it('rejects a Step Configuration update that still uses options', async () => {
    await expect(
      executeProductCommand(
        {
          command: 'workspace.updateStepConfiguration',
          payload: {
            commandId: 'step-configuration-1',
            expectedWorkspaceRevision: 1,
            options: { ifp: { thread_number: 8 } },
            stepId: 'Floorplan',
            workspaceHandle: 'handle-1',
          },
        } as never,
        {
          ownsWorkspaceHandle: (handle: string) => handle === 'handle-1',
          runtime: { updateWorkspaceStepConfiguration: vi.fn() } as never,
        } as never,
      ),
    ).rejects.toThrow('Product Command requires parameters')
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
            candidateCapabilities: vi.fn(),
            candidateRerun: vi.fn(),
            candidateResume: vi.fn(),
            createWorkspace: vi.fn().mockResolvedValue({
              directory: payload.targetDirectory,
              workspaceHandle: 'handle-1',
            }),
            deriveWorkspace: vi.fn(),
            exportSignoff: vi.fn(),
            openWorkspace: vi.fn(),
            releaseWorkspace,
            resetFlow: vi.fn(),
            retryFinalSnapshot: vi.fn(),
            startFlowOperation: vi.fn(),
            startStepOperation: vi.fn(),
            updateWorkspaceStepConfiguration: vi.fn(),
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
          candidateCapabilities: vi.fn(),
          candidateRerun: vi.fn(),
          candidateResume: vi.fn(),
          createWorkspace,
          deriveWorkspace: vi.fn(),
          exportSignoff: vi.fn(),
          openWorkspace: vi.fn(),
          releaseWorkspace: vi.fn(),
          resetFlow: vi.fn(),
          retryFinalSnapshot: vi.fn(),
          startFlowOperation: vi.fn(),
          startStepOperation: vi.fn(),
          updateWorkspaceStepConfiguration: vi.fn(),
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

  it('routes owned Candidate commands to the Runtime', async () => {
    const candidateCapabilities = vi.fn().mockResolvedValue({
      schema: 'ecc.workspace.candidate_capabilities.v1',
      schemaVersion: 1,
      targets: [],
    })
    const candidateRerun = vi.fn().mockResolvedValue({ operationId: 'operation-1' })
    const candidateResume = vi.fn().mockResolvedValue({ operationId: 'operation-2' })
    const runtime = {
      candidateCapabilities,
      candidateRerun,
      candidateResume,
    } as never
    const context = {
      ownsWorkspaceHandle: (handle: string) => handle === 'handle-1',
      runtime,
    } as never
    const rerunPayload = {
      candidateId: 'candidate-1',
      contextSha256: `sha256:${'a'.repeat(64)}`,
      endStep: 'Harden',
      executionScope: 'full_flow',
      expectedWorkspaceRevision: 1,
      idempotencyKey: 'episode-1.intervention-1',
      parameterCardSha256: `sha256:${'b'.repeat(64)}`,
      patch: [{ knob_id: 'place.target_density', value: 0.6 }],
      seed: 17,
      targetStep: 'place',
      workspaceHandle: 'handle-1',
    }

    await expect(
      executeProductCommand(
        { command: 'candidate.capabilities', payload: { workspaceHandle: 'handle-1' } },
        context,
      ),
    ).resolves.toEqual({
      schema: 'ecc.workspace.candidate_capabilities.v1',
      schemaVersion: 1,
      targets: [],
    })
    await expect(
      executeProductCommand(
        { command: 'candidate.rerun', payload: rerunPayload },
        context,
      ),
    ).resolves.toEqual({ operationId: 'operation-1' })
    await expect(
      executeProductCommand(
        {
          command: 'candidate.resume',
          payload: {
            candidateId: 'candidate-1',
            contextSha256: rerunPayload.contextSha256,
            expectedWorkspaceRevision: 1,
            idempotencyKey: 'episode-1.resume-1',
            parameterCardSha256: rerunPayload.parameterCardSha256,
            seed: 17,
            workspaceHandle: 'handle-1',
          },
        },
        context,
      ),
    ).resolves.toEqual({ operationId: 'operation-2' })
    expect(candidateCapabilities).toHaveBeenCalledWith({ workspaceHandle: 'handle-1' })
    expect(candidateRerun).toHaveBeenCalledWith(rerunPayload)
    expect(candidateResume).toHaveBeenCalledWith({
      candidateId: 'candidate-1',
      contextSha256: rerunPayload.contextSha256,
      expectedWorkspaceRevision: 1,
      idempotencyKey: 'episode-1.resume-1',
      parameterCardSha256: rerunPayload.parameterCardSha256,
      seed: 17,
      workspaceHandle: 'handle-1',
    })
  })

  it('opens a calibration replay Workspace without requiring an existing handle', async () => {
    const openWorkspace = vi.fn().mockResolvedValue({
      directory:
        '/work/demo/.agent/optimization/noise-calibration/default-replay-1/workspace',
      workspaceHandle: 'handle-replay',
      workspaceRevision: 1,
    })

    await expect(
      executeProductCommand(
        {
          command: 'workspace.open',
          payload: {
            directory:
              '/work/demo/.agent/optimization/noise-calibration/default-replay-1/workspace',
          },
        },
        {
          ownsWorkspaceHandle: () => false,
          runtime: { openWorkspace } as never,
        } as never,
      ),
    ).resolves.toMatchObject({ workspaceHandle: 'handle-replay' })
    expect(openWorkspace).toHaveBeenCalledWith({
      directory:
        '/work/demo/.agent/optimization/noise-calibration/default-replay-1/workspace',
    })
  })

  it('rejects a Candidate rerun that does not own the Workspace handle', async () => {
    await expect(
      executeProductCommand(
        {
          command: 'candidate.rerun',
          payload: {
            candidateId: 'candidate-1',
            contextSha256: `sha256:${'a'.repeat(64)}`,
            endStep: 'Harden',
            executionScope: 'full_flow',
            expectedWorkspaceRevision: 1,
            idempotencyKey: 'episode-1.intervention-1',
            parameterCardSha256: `sha256:${'b'.repeat(64)}`,
            patch: [{ knob_id: 'place.target_density', value: 0.6 }],
            seed: 17,
            targetStep: 'place',
            workspaceHandle: 'handle-2',
          },
        },
        {
          ownsWorkspaceHandle: () => false,
          runtime: { candidateRerun: vi.fn() } as never,
        } as never,
      ),
    ).rejects.toThrow('Product Command does not own this Workspace handle')
  })

  it('routes an owned Workspace derive to the Runtime', async () => {
    const deriveWorkspace = vi.fn().mockResolvedValue({
      directory: '/runs/gcd_rerun_place',
      workspaceHandle: 'handle-derived',
      workspaceRevision: 1,
    })
    const payload = {
      workspaceHandle: 'handle-1',
      directory: '/runs/gcd',
      targetDirectory: '/runs/gcd_rerun_place',
      resetFromStep: 'place',
      commandId: 'derive-1',
      cause: 'workspace.derived',
    }

    await expect(
      executeProductCommand({ command: 'workspace.derive', payload }, {
        ownsWorkspaceHandle: (handle: string) => handle === 'handle-1',
        runtime: { deriveWorkspace } as never,
      } as never),
    ).resolves.toEqual({
      directory: '/runs/gcd_rerun_place',
      workspaceHandle: 'handle-derived',
      workspaceRevision: 1,
    })
    expect(deriveWorkspace).toHaveBeenCalledWith(payload)
  })

  it.each([
    [
      'directory',
      {
        workspaceHandle: 'handle-1',
        targetDirectory: '/runs/gcd_rerun_place',
        resetFromStep: 'place',
      },
      'Product Command requires directory',
    ],
    [
      'targetDirectory',
      {
        workspaceHandle: 'handle-1',
        directory: '/runs/gcd',
        resetFromStep: 'place',
      },
      'Product Command requires targetDirectory',
    ],
    [
      'resetFromStep',
      {
        workspaceHandle: 'handle-1',
        directory: '/runs/gcd',
        targetDirectory: '/runs/gcd_rerun_place',
      },
      'Product Command requires resetFromStep',
    ],
    [
      'a targetDirectory equal to the source directory',
      {
        workspaceHandle: 'handle-1',
        directory: '/runs/gcd',
        targetDirectory: '/runs/gcd',
        resetFromStep: 'place',
      },
      'Product Command requires targetDirectory different from directory',
    ],
  ])('rejects a Workspace derive without %s', async (_case, payload, message) => {
    await expect(
      executeProductCommand({ command: 'workspace.derive', payload }, {
        ownsWorkspaceHandle: () => true,
        runtime: { deriveWorkspace: vi.fn() } as never,
      } as never),
    ).rejects.toThrow(message)
  })

  it('allows an empty resetFromStep for a full reset', async () => {
    const deriveWorkspace = vi.fn().mockResolvedValue({
      directory: '/runs/gcd_rerun_place',
      workspaceHandle: 'handle-derived',
      workspaceRevision: 1,
    })

    await expect(
      executeProductCommand(
        {
          command: 'workspace.derive',
          payload: {
            workspaceHandle: 'handle-1',
            directory: '/runs/gcd',
            targetDirectory: '/runs/gcd_rerun_place',
            resetFromStep: '',
          },
        },
        {
          ownsWorkspaceHandle: (handle: string) => handle === 'handle-1',
          runtime: { deriveWorkspace } as never,
        } as never,
      ),
    ).resolves.toMatchObject({ workspaceHandle: 'handle-derived' })
    expect(deriveWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ resetFromStep: '' }),
    )
  })

  it('rejects a Workspace derive that does not own the source handle', async () => {
    await expect(
      executeProductCommand(
        {
          command: 'workspace.derive',
          payload: {
            workspaceHandle: 'handle-2',
            directory: '/runs/gcd',
            targetDirectory: '/runs/gcd_rerun_place',
            resetFromStep: 'place',
          },
        },
        {
          ownsWorkspaceHandle: () => false,
          runtime: { deriveWorkspace: vi.fn() } as never,
        } as never,
      ),
    ).rejects.toThrow('Product Command does not own this Workspace handle')
  })

  it('blocks flow mutations while Chip Viewer is saving layout edits', async () => {
    const startFlowOperation = vi.fn()
    await expect(
      executeProductCommand(
        {
          command: 'workspace.run',
          payload: {
            expectedWorkspaceRevision: 4,
            idempotencyKey: 'run-1',
            workspaceHandle: 'handle-1',
          },
        },
        {
          isWorkspaceMutationBusy: () => true,
          ownsWorkspaceHandle: () => true,
          runtime: { startFlowOperation } as never,
        } as never,
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_MUTATION_BUSY' })
    expect(startFlowOperation).not.toHaveBeenCalled()
  })
})
