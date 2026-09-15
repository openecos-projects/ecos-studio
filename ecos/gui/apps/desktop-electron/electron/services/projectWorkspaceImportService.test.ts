import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ProjectManifest } from '@ecos-studio/shared'
import { ProjectWorkspaceImportService } from './projectWorkspaceImportService'
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

async function createFixture(options: { design?: string; pdk?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ecos-workspace-import-'))
  temporaryDirectories.push(root)
  const projectRoot = join(root, 'project')
  const workspaceRoot = join(root, 'external', 'recovered')
  await mkdir(projectRoot, { recursive: true })
  await mkdir(join(workspaceRoot, 'home'), { recursive: true })
  await writeFile(
    join(workspaceRoot, 'home', 'params.toml'),
    `[design]\nname = "${options.design ?? 'gcd'}"\ntop = "gcd"\nclock_port = "clk"\n\n[pdk]\nname = "${options.pdk ?? 'ics55'}"\nroot = "/pdk/ics55"\n\n[flow]\nstart = "Synthesis"\nend = "Synthesis"\n\n[params]\nfrequency_max = 125\nmax_fanout = 16\n`,
  )
  await writeFile(
    join(workspaceRoot, 'home', 'flow.json'),
    JSON.stringify({
      steps: [{ name: 'Synthesis', tool: 'yosys', state: 'Success' }],
    }),
  )
  return { manifest: manifestFixture(projectRoot, []), projectRoot, workspaceRoot }
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

  it('imports an external workspace with derived metadata without changing it', async () => {
    const { manifest, projectRoot, workspaceRoot } = await createFixture()
    const before = await readFile(join(workspaceRoot, 'home', 'params.toml'), 'utf8')
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
        type: 'register-workspace',
        input: {
          projectRoot,
          projectName: 'gcd',
          workspacePath: workspaceRoot,
          startStep: 'Synth',
          endStep: 'Synth',
        },
      },
    })
    await expect(
      readFile(join(workspaceRoot, 'home', 'params.toml'), 'utf8'),
    ).resolves.toBe(before)
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
    ).resolves.toMatchObject({ status: 'already_registered' })
    expect(gateway.mutate).not.toHaveBeenCalled()
  })

  it('rejects invalid workspaces, design mismatches, and crossed identities', async () => {
    const invalidRoot = await mkdtemp(join(tmpdir(), 'ecos-workspace-import-invalid-'))
    temporaryDirectories.push(invalidRoot)
    const { manifest, projectRoot, workspaceRoot } = await createFixture({
      design: 'other',
    })
    const service = new ProjectWorkspaceImportService(gatewayFixture(manifest))
    await expect(service.importWorkspace(projectRoot, invalidRoot)).rejects.toMatchObject(
      {
        code: 'workspace_not_importable',
      },
    )
    await expect(service.importWorkspace(projectRoot, workspaceRoot)).rejects.toThrow(
      'does not match project design',
    )

    const matching = await createFixture()
    const second = join(matching.projectRoot, '..', 'other', 'recovered')
    await mkdir(join(second, 'home'), { recursive: true })
    await writeFile(
      join(second, 'home', 'params.toml'),
      await readFile(join(matching.workspaceRoot, 'home', 'params.toml')),
    )
    await writeFile(
      join(second, 'home', 'flow.json'),
      await readFile(join(matching.workspaceRoot, 'home', 'flow.json')),
    )
    const registered = manifestFixture(matching.projectRoot, [
      { workspace_id: 'recovered', workspace_path: matching.workspaceRoot },
    ])
    await expect(
      new ProjectWorkspaceImportService(gatewayFixture(registered)).importWorkspace(
        matching.projectRoot,
        second,
      ),
    ).rejects.toMatchObject({ code: 'workspace_id_conflict' })
  })
})
