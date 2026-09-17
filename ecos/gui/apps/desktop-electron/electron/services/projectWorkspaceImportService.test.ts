import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ProjectManifest } from '@ecos-studio/shared'
import { EccJsonRpcError } from './eccRpc/jsonRpcClient'
import {
  ProjectWorkspaceImportService,
  projectWorkspaceImportFailure,
} from './projectWorkspaceImportService'
import type { ProjectWorkspaceManifestGateway } from './projectWorkspaceImportService'

const temporaryDirectories: string[] = []

function manifestFixture(
  projectRoot: string,
  workspaces: Array<{ workspace_id: string; workspace_path: string; status?: string }>,
): ProjectManifest {
  return {
    schema_version: 1,
    project_id: 'proj_gcd',
    root_path: projectRoot,
    name: 'gcd',
    description: null,
    design_name: 'gcd',
    created_at: '2026-09-17T00:00:00.000Z',
    updated_at: '2026-09-17T00:00:00.000Z',
    base_design: {
      pdk: 'ics55',
      parameters: { design: 'gcd', frequency_max: 100 },
    },
    objectives: {
      primary: 'timing',
      directions: {
        wns: 'maximize',
        tns: 'maximize',
        area: 'minimize',
        drc_count: 'minimize',
        lvs_count: 'minimize',
        power: 'minimize',
      },
    },
    workspaces: workspaces.map((workspace) => ({
      workspace_id: workspace.workspace_id,
      name: workspace.workspace_id,
      workspace_path: workspace.workspace_path,
      status: workspace.status ?? 'success',
      created_at: '2026-09-17T00:00:00.000Z',
      updated_at: '2026-09-17T00:00:00.000Z',
      branch_from: null,
      start_step: 'Synth',
      end_step: 'Harden',
      parameter_patch: {},
    })),
    mpc: null,
    best_workspace: null,
    qor_baseline: null,
  } as unknown as ProjectManifest
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'ecos-workspace-import-'))
  temporaryDirectories.push(root)
  const projectRoot = join(root, 'project')
  const workspaceRoot = join(root, 'external', 'recovered')
  await mkdir(projectRoot, { recursive: true })
  await mkdir(join(workspaceRoot, 'home'), { recursive: true })
  return { projectRoot, workspaceRoot }
}

function gatewayFixture(
  manifest: ProjectManifest,
  mutate: ProjectWorkspaceManifestGateway['mutate'] = async () => ({ manifest }),
) {
  return {
    load: vi.fn(async () => manifest),
    mutate: vi.fn(mutate),
  }
}

describe('ProjectWorkspaceImportService', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { force: true, recursive: true })),
    )
  })

  it('imports a workspace through the runtime import mutation', async () => {
    const { projectRoot, workspaceRoot } = await createFixture()
    const manifest = manifestFixture(projectRoot, [])
    const updated = manifestFixture(projectRoot, [
      { workspace_id: 'recovered', workspace_path: workspaceRoot },
    ])
    const gateway = gatewayFixture(
      manifest,
      vi.fn(async () => ({ manifest: updated })),
    )
    const service = new ProjectWorkspaceImportService(gateway)

    await expect(
      service.importWorkspace(projectRoot, workspaceRoot),
    ).resolves.toMatchObject({
      status: 'imported',
      manifest: updated,
      workspaceId: 'recovered',
      workspacePath: workspaceRoot,
    })
    expect(gateway.mutate).toHaveBeenCalledWith({
      projectRoot,
      mutation: {
        type: 'import-workspace',
        input: {
          projectRoot,
          workspacePath: workspaceRoot,
          workspaceId: 'recovered',
        },
      },
    })
  })

  it('returns an existing identical registration without mutating the manifest', async () => {
    const { projectRoot, workspaceRoot } = await createFixture()
    const registered = manifestFixture(projectRoot, [
      { workspace_id: 'recovered', workspace_path: workspaceRoot },
    ])
    const gateway = gatewayFixture(
      registered,
      vi.fn(async () => {
        throw new Error('Registration should not be requested for a registered path.')
      }),
    )

    await expect(
      new ProjectWorkspaceImportService(gateway).importWorkspace(
        projectRoot,
        workspaceRoot,
      ),
    ).resolves.toMatchObject({ status: 'already_registered', workspaceId: 'recovered' })
    expect(gateway.mutate).not.toHaveBeenCalled()
  })

  it('rejects unavailable and protected workspace paths before any mutation', async () => {
    const { projectRoot, workspaceRoot } = await createFixture()
    const service = new ProjectWorkspaceImportService(
      gatewayFixture(manifestFixture(projectRoot, [])),
    )

    await expect(
      service.importWorkspace(projectRoot, join(projectRoot, 'missing')),
    ).rejects.toMatchObject({ code: 'workspace_not_importable' })
    await expect(service.importWorkspace(projectRoot, projectRoot)).rejects.toMatchObject(
      {
        code: 'workspace_not_importable',
      },
    )
    await expect(
      service.importWorkspace(projectRoot, join(projectRoot, 'runs')),
    ).rejects.toMatchObject({ code: 'workspace_not_importable' })
    await expect(
      service.importWorkspace(join(projectRoot, 'missing'), workspaceRoot),
    ).rejects.toMatchObject({ code: 'project_invalid' })
  })

  it('maps structured runtime failure codes from the import mutation', async () => {
    const { projectRoot, workspaceRoot } = await createFixture()
    const gateway = gatewayFixture(
      manifestFixture(projectRoot, []),
      vi.fn(async () => {
        throw new EccJsonRpcError(-32000, 'workspace_id_conflict', {
          message: 'Workspace ID recovered is already registered at another path.',
        })
      }),
    )
    const service = new ProjectWorkspaceImportService(gateway)

    const failure = await service.importWorkspace(projectRoot, workspaceRoot).then(
      () => {
        throw new Error('import should fail')
      },
      (error: unknown) => projectWorkspaceImportFailure(error),
    )
    expect(failure).toEqual({
      status: 'failed',
      code: 'workspace_id_conflict',
      message: 'Workspace ID recovered is already registered at another path.',
    })
  })

  it('falls back to project_invalid for unstructured mutation failures', async () => {
    const { projectRoot, workspaceRoot } = await createFixture()
    const gateway = gatewayFixture(
      manifestFixture(projectRoot, []),
      vi.fn(async () => {
        throw new EccJsonRpcError(-32000, 'command_failed', {
          message: 'sidecar exploded',
        })
      }),
    )
    const service = new ProjectWorkspaceImportService(gateway)

    const failure = await service.importWorkspace(projectRoot, workspaceRoot).then(
      () => {
        throw new Error('import should fail')
      },
      (error: unknown) => projectWorkspaceImportFailure(error),
    )
    expect(failure).toEqual({
      status: 'failed',
      code: 'project_invalid',
      message: 'sidecar exploded',
    })
  })
})
