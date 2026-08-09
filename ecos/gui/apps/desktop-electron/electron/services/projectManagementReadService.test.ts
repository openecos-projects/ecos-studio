import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  createProjectManifestDraft,
  registerWorkspaceInManifest,
} from '@ecos-studio/shared'
import { ProjectManagementReadService } from './projectManagementReadService'

const temporaryDirectories: string[] = []

async function createProject(): Promise<{ projectRoot: string; workspaceRoot: string }> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'ecos-project-management-read-'))
  temporaryDirectories.push(projectRoot)
  const workspaceRoot = join(projectRoot, 'ws_0001')
  await mkdir(join(workspaceRoot, 'home'), { recursive: true })

  const manifest = registerWorkspaceInManifest(
    createProjectManifestDraft({
      rootPath: projectRoot,
      name: 'gcd',
      designName: 'gcd',
    }),
    {
      projectRoot,
      workspacePath: workspaceRoot,
      now: '2026-08-09T00:00:00.000Z',
    },
  )
  await writeFile(join(projectRoot, 'project.json'), JSON.stringify(manifest))
  await writeFile(join(workspaceRoot, 'home', 'flow.json'), '{"steps":[]}')
  return { projectRoot, workspaceRoot }
}

describe('ProjectManagementReadService', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
    )
  })

  it('reads a historical project and its declared workspace without an active workspace scope', async () => {
    const { projectRoot, workspaceRoot } = await createProject()
    const service = new ProjectManagementReadService()

    await expect(service.readManifest(projectRoot)).resolves.toContain('"workspace_id":"ws_0001"')
    await expect(service.listProjectEntries(projectRoot)).resolves.toEqual([
      'project.json',
      'ws_0001',
    ])
    await expect(
      service.readWorkspaceTexts({
        projectRoot,
        workspacePath: workspaceRoot,
        paths: ['home/flow.json', 'sta_ecc/analysis/qor_metrics.json'],
      }),
    ).resolves.toEqual({
      'home/flow.json': '{"steps":[]}',
      'sta_ecc/analysis/qor_metrics.json': null,
    })
  })

  it('rejects undeclared workspaces and files outside the summary allowlist', async () => {
    const { projectRoot } = await createProject()
    const undeclaredWorkspace = join(projectRoot, 'ws_0002')
    await mkdir(undeclaredWorkspace)
    const service = new ProjectManagementReadService()

    await expect(
      service.readWorkspaceTexts({
        projectRoot,
        workspacePath: undeclaredWorkspace,
        paths: ['home/flow.json'],
      }),
    ).rejects.toThrow('not declared')
    await expect(
      service.readWorkspaceTexts({
        projectRoot,
        workspacePath: join(projectRoot, 'ws_0001'),
        paths: ['../../settings.json'],
      }),
    ).rejects.toThrow('not allowed')
  })

  it('requires a valid manifest before listing project root entries', async () => {
    const emptyRoot = await mkdtemp(join(tmpdir(), 'ecos-project-management-empty-'))
    temporaryDirectories.push(emptyRoot)
    const service = new ProjectManagementReadService()

    await expect(service.listProjectEntries(emptyRoot)).rejects.toThrow(
      'Project manifest does not exist.',
    )
  })

  it('bounds individual NFS-backed summary reads', async () => {
    const { projectRoot, workspaceRoot } = await createProject()
    const metricsPath = join(workspaceRoot, 'sta_ecc', 'analysis', 'qor_metrics.json')
    await mkdir(join(workspaceRoot, 'sta_ecc', 'analysis'), { recursive: true })
    await writeFile(metricsPath, 'x'.repeat(256 * 1024 + 1))
    const service = new ProjectManagementReadService()

    await expect(
      service.readWorkspaceTexts({
        projectRoot,
        workspacePath: workspaceRoot,
        paths: ['sta_ecc/analysis/qor_metrics.json'],
      }),
    ).rejects.toThrow('exceeds')
  })

  it('rejects an allowed artifact path that resolves outside its workspace', async () => {
    const { projectRoot, workspaceRoot } = await createProject()
    const flowPath = join(workspaceRoot, 'home', 'flow.json')
    await unlink(flowPath)
    await symlink(join(projectRoot, 'project.json'), flowPath)
    const service = new ProjectManagementReadService()

    await expect(
      service.readWorkspaceTexts({
        projectRoot,
        workspacePath: workspaceRoot,
        paths: ['home/flow.json'],
      }),
    ).rejects.toThrow('outside its workspace')
  })
})
