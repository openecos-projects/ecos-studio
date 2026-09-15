import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  createProjectManifestDraft,
  registerWorkspaceInManifest,
  serializeProjectManifest,
} from '@ecos-studio/shared'
import { ProjectWorkspaceImportService } from './projectWorkspaceImportService'

const temporaryDirectories: string[] = []

async function createFixture(options: { design?: string; pdk?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ecos-workspace-import-'))
  temporaryDirectories.push(root)
  const projectRoot = join(root, 'project')
  const workspaceRoot = join(root, 'external', 'recovered')
  await mkdir(projectRoot, { recursive: true })
  await mkdir(join(workspaceRoot, 'home'), { recursive: true })
  const manifest = createProjectManifestDraft({
    rootPath: projectRoot,
    name: 'gcd',
    designName: 'gcd',
  })
  manifest.base_design.pdk = 'ics55'
  manifest.base_design.parameters = {
    design: 'gcd',
    frequency_max: 100,
  }
  await writeFile(join(projectRoot, 'project.json'), serializeProjectManifest(manifest))
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
  return { manifest, projectRoot, workspaceRoot }
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
    const { projectRoot, workspaceRoot } = await createFixture()
    const before = await readFile(join(workspaceRoot, 'home', 'params.toml'), 'utf8')
    const mutateWithWorkspaceLock = vi.fn(async (request, _workspacePath, revalidate) => {
      await revalidate()
      return { content: JSON.stringify(request) }
    })
    const service = new ProjectWorkspaceImportService({ mutateWithWorkspaceLock })

    await expect(
      service.importWorkspace(projectRoot, workspaceRoot),
    ).resolves.toMatchObject({
      status: 'imported',
      workspaceId: 'recovered',
      workspacePath: workspaceRoot,
    })
    expect(mutateWithWorkspaceLock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot,
        mutation: expect.objectContaining({
          input: expect.objectContaining({
            startStep: 'Synth',
            endStep: 'Synth',
            status: 'success',
            parameterPatch: {
              frequency_max: { from: 100, to: 125 },
              max_fanout: { from: null, to: 16 },
            },
          }),
        }),
      }),
      workspaceRoot,
      expect.any(Function),
    )
    await expect(
      readFile(join(workspaceRoot, 'home', 'params.toml'), 'utf8'),
    ).resolves.toBe(before)
  })

  it('returns an existing identical registration without mutating the manifest', async () => {
    const { manifest, projectRoot, workspaceRoot } = await createFixture()
    const registered = registerWorkspaceInManifest(manifest, {
      projectRoot,
      workspacePath: workspaceRoot,
    })
    await writeFile(
      join(projectRoot, 'project.json'),
      serializeProjectManifest(registered),
    )
    const mutateWithWorkspaceLock = vi.fn(
      async (_request, _workspacePath, revalidate) => {
        await revalidate()
        throw new Error('Registration should have stopped during revalidation.')
      },
    )

    await expect(
      new ProjectWorkspaceImportService({ mutateWithWorkspaceLock }).importWorkspace(
        projectRoot,
        workspaceRoot,
      ),
    ).resolves.toMatchObject({ status: 'already_registered' })
    expect(mutateWithWorkspaceLock).toHaveBeenCalledOnce()
  })

  it('rejects invalid workspaces, design mismatches, and crossed identities', async () => {
    const invalidRoot = await mkdtemp(join(tmpdir(), 'ecos-workspace-import-invalid-'))
    temporaryDirectories.push(invalidRoot)
    const { projectRoot, workspaceRoot } = await createFixture({ design: 'other' })
    const service = new ProjectWorkspaceImportService({
      mutateWithWorkspaceLock: vi.fn(),
    })
    await expect(service.importWorkspace(projectRoot, invalidRoot)).rejects.toMatchObject(
      {
        code: 'workspace_not_importable',
      },
    )
    await expect(service.importWorkspace(projectRoot, workspaceRoot)).rejects.toThrow(
      'does not match project design',
    )

    const matching = await createFixture()
    const second = join(matching.workspaceRoot, '..', 'other', 'recovered')
    await mkdir(join(second, 'home'), { recursive: true })
    await writeFile(
      join(second, 'home', 'params.toml'),
      await readFile(join(matching.workspaceRoot, 'home', 'params.toml')),
    )
    await writeFile(
      join(second, 'home', 'flow.json'),
      await readFile(join(matching.workspaceRoot, 'home', 'flow.json')),
    )
    const registered = registerWorkspaceInManifest(matching.manifest, {
      projectRoot: matching.projectRoot,
      workspacePath: matching.workspaceRoot,
    })
    await writeFile(
      join(matching.projectRoot, 'project.json'),
      serializeProjectManifest(registered),
    )
    await expect(
      service.importWorkspace(matching.projectRoot, second),
    ).rejects.toMatchObject({ code: 'workspace_id_conflict' })
  })
})
