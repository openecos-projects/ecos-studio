import { describe, expect, it, vi } from 'vitest'
import {
  ProjectManifestService,
  type ProjectManifestReplacementProvider,
} from './projectManifestService'

const projectRoot = '/projects/gcd'
const emptyManifest = {
  schema_version: 1 as const,
  project_id: 'proj_gcd',
  name: 'gcd',
  design_name: 'gcd',
  description: '',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  objectives: { primary: 'timing', directions: {} },
  workspaces: [],
  mpc: null,
  best_workspace: null,
  qor_baseline: null,
}

function createService(
  callRuntime = vi.fn(),
  replacement?: ProjectManifestReplacementProvider,
) {
  return {
    callRuntime,
    service: new ProjectManifestService(
      { resolveProjectRoot: async (path) => path },
      replacement,
      { callRuntime },
    ),
  }
}

describe('ProjectManifestService', () => {
  it('discovers a nested Workspace through the ECC Runtime', async () => {
    const { callRuntime, service } = createService(
      vi
        .fn()
        .mockResolvedValueOnce({ projectId: 'proj_gcd', projectRoot })
        .mockResolvedValueOnce(emptyManifest),
    )

    await expect(service.discover(`${projectRoot}/runs/ws-1`)).resolves.toMatchObject({
      project_id: 'proj_gcd',
      root_path: projectRoot,
    })
    expect(callRuntime.mock.calls).toEqual([
      ['project.discover', { directory: `${projectRoot}/runs/ws-1` }],
      ['project.manifest.load', { projectRoot }],
    ])
  })

  it('delegates Manifest mutation to the ECC Runtime', async () => {
    const { callRuntime, service } = createService(
      vi.fn().mockResolvedValue(emptyManifest),
    )

    const result = await service.mutate({
      projectRoot,
      mutation: { type: 'archive-workspace', workspaceId: 'ws-1' },
    })

    expect(callRuntime).toHaveBeenCalledWith('project.manifest.mutate', {
      projectRoot,
      mutation: { type: 'archive-workspace', workspaceId: 'ws-1' },
    })
    expect(result.manifest).toMatchObject({
      project_id: emptyManifest.project_id,
      root_path: projectRoot,
      workspaces: [],
    })
  })

  it('registers a missing Workspace through the ECC Runtime', async () => {
    const registered = {
      ...emptyManifest,
      workspaces: [
        {
          workspace_id: 'ws-1',
          name: 'ws-1',
          workspace_path: 'ws-1',
          source_workspace_id: null,
          lifecycle: 'active',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ],
    }
    const callRuntime = vi
      .fn()
      .mockResolvedValueOnce(emptyManifest)
      .mockResolvedValueOnce(registered)
    const service = createService(callRuntime).service

    const evidence = await service.ensureWorkspaceRegistration(
      projectRoot,
      `${projectRoot}/ws-1`,
      'proj_gcd',
    )

    expect(callRuntime).toHaveBeenLastCalledWith('project.manifest.mutate', {
      projectRoot,
      mutation: {
        type: 'register-workspace',
        input: { projectRoot, workspacePath: `${projectRoot}/ws-1` },
      },
    })
    expect(evidence).toMatchObject({
      projectId: 'proj_gcd',
      workspaceId: 'ws-1',
      workspacePath: `${projectRoot}/ws-1`,
    })
  })

  it('accepts a CLI Workspace whose stable id differs from its directory name', async () => {
    const registered = {
      ...emptyManifest,
      workspaces: [
        {
          workspace_id: 'baseline',
          name: 'Baseline',
          workspace_path: 'runs/default',
        },
      ],
    }
    const { service } = createService(vi.fn().mockResolvedValue(registered))

    await expect(
      service.inspectWorkspaceRegistration(
        projectRoot,
        `${projectRoot}/runs/default`,
        'proj_gcd',
      ),
    ).resolves.toMatchObject({
      projectId: 'proj_gcd',
      workspaceId: 'baseline',
      workspacePath: `${projectRoot}/runs/default`,
    })
  })

  it('preserves a changed registration during recovery cleanup', async () => {
    const changed = {
      ...emptyManifest,
      workspaces: [
        {
          workspace_id: 'ws-1',
          name: 'changed',
          workspace_path: 'ws-1',
        },
      ],
    }
    const { service } = createService(vi.fn().mockResolvedValue(changed))

    await expect(
      service.removeWorkspaceRegistration(projectRoot, {
        fingerprint: 'old',
        projectId: 'proj_gcd',
        workspaceId: 'ws-1',
        workspacePath: `${projectRoot}/ws-1`,
      }),
    ).rejects.toThrow('registration changed')
  })

  it('keeps directory replacement in Electron and Manifest mutation in ECC', async () => {
    const callRuntime = vi
      .fn()
      .mockResolvedValueOnce({
        ...emptyManifest,
        workspaces: [{ workspace_id: 'ws-1', name: 'ws-1', workspace_path: 'ws-1' }],
      })
      .mockResolvedValueOnce(emptyManifest)
    const replacement: ProjectManifestReplacementProvider = {
      getProjectDirectoryReplacement: vi.fn(() => ({
        backupPath: `${projectRoot}/.backup/ws-1`,
        projectRoot,
        targetPath: `${projectRoot}/ws-1`,
      })),
      prepareManagedProjectWorkspaceDirectoryReplacement: vi.fn(async () => ({
        backupPath: `${projectRoot}/.backup/ws-1`,
        id: 'replace-1',
        projectRoot,
        targetPath: `${projectRoot}/ws-1`,
      })),
      setProjectDirectoryReplacementRecoveryMode: vi.fn(async () => undefined),
      finalizeProjectDirectoryReplacement: vi.fn(async () => undefined),
      restoreProjectDirectoryReplacement: vi.fn(async () => undefined),
      retainProjectDirectoryReplacement: vi.fn(async () => undefined),
    }
    const service = createService(callRuntime, replacement).service

    await service.mutate({
      projectRoot,
      mutation: { type: 'delete-workspace', workspaceId: 'ws-1', deleteDirectory: true },
    })

    expect(
      replacement.prepareManagedProjectWorkspaceDirectoryReplacement,
    ).toHaveBeenCalledWith(projectRoot, 'ws-1', `${projectRoot}/ws-1`)
    expect(callRuntime).toHaveBeenLastCalledWith('project.manifest.mutate', {
      projectRoot,
      mutation: {
        type: 'delete-workspace',
        workspaceId: 'ws-1',
        deleteDirectory: true,
      },
    })
    expect(replacement.finalizeProjectDirectoryReplacement).toHaveBeenCalledWith(
      'replace-1',
    )
  })
})
