import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProjectManifestDraft } from '@ecos-studio/shared'
import { FrontendProjectManifestService } from './frontendProjectManifestService'
import { ProjectManifestService } from './projectManifestService'
import { ProjectManagementReadService } from './projectManagementReadService'
import { ProjectWorkspaceImportService } from './projectWorkspaceImportService'
import { ProjectScopeService } from './projectScopeService'
import { runWithWindowScope } from './windowScopeContext'

const directories: string[] = []

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

async function createServices() {
  const root = await mkdtemp(join(tmpdir(), 'ecos-frontend-project-'))
  directories.push(root)
  const scope = {
    resolveProjectRoot: realpath,
    resolveProjectCreationRoot: async (path: string) => path,
  }
  const frontend = new FrontendProjectManifestService(scope)
  const callRuntime = vi.fn().mockRejectedValue(new Error('backend RPC was not expected'))
  const runtime = {
    discoverProject: (directory: string) =>
      callRuntime('project.discover', { directory }),
    loadProjectManifest: (projectRoot: string) =>
      callRuntime('project.manifest.load', { projectRoot }),
    mutateProjectManifest: (projectRoot: string, mutation: unknown) =>
      callRuntime('project.manifest.mutate', { projectRoot, mutation }),
  }
  const manifestService = new ProjectManifestService(scope, undefined, runtime, frontend)
  const readService = new ProjectManagementReadService(manifestService)
  return { root, frontend, manifestService, readService, callRuntime }
}

describe('frontend project management on the main ECC runtime', () => {
  it('creates a frontend project in a missing target directory', async () => {
    const { root, manifestService, callRuntime } = await createServices()
    const projectRoot = join(root, 'new', 'frontend')

    const created = await manifestService.mutate({
      projectRoot,
      mutation: {
        type: 'create',
        name: 'cpu',
        designName: 'core',
        projectType: 'frontend',
      },
    })

    expect(created.manifest.project_type).toBe('frontend')
    expect(await realpath(projectRoot)).toBe(projectRoot)
    expect(callRuntime).not.toHaveBeenCalled()
  })

  it('does not send an unregistered frontend workspace discovery to backend ECC', async () => {
    const { root, manifestService, readService, callRuntime } = await createServices()
    const workspacePath = join(root, 'ws_0001')
    await mkdir(workspacePath)
    await manifestService.mutate({
      projectRoot: root,
      mutation: {
        type: 'create',
        name: 'rtl',
        designName: 'counter',
        projectType: 'frontend',
      },
    })
    // Discovery may run while the workspace registration is still being committed.
    await expect(readService.discoverProject(workspacePath)).resolves.toBeNull()
    expect(callRuntime).not.toHaveBeenCalled()
  })

  it('registers a generic project read scope through the frontend manifest service', async () => {
    const { root, manifestService, callRuntime } = await createServices()
    const workspacePath = join(root, 'ws_0001')
    await mkdir(workspacePath)
    await manifestService.mutate({
      projectRoot: root,
      mutation: {
        type: 'create',
        name: 'rtl',
        designName: 'counter',
        projectType: 'frontend',
      },
    })
    await manifestService.mutate({
      projectRoot: root,
      mutation: {
        type: 'register-workspace',
        input: {
          projectRoot: root,
          workspacePath,
          config: { frontend_design_kind: 'generic_rtl' },
        },
      },
    })
    const scope = new ProjectScopeService({
      loadProjectManifest: (projectRoot) => manifestService.load(projectRoot),
    })
    await runWithWindowScope(1, async () => {
      await scope.registerProjectRoot(workspacePath)
      await expect(scope.registerProjectReadRoot(root)).resolves.toBe(root)
      await expect(
        scope.requestProjectPathAccess(join(root, 'project.json')),
      ).resolves.toBe(join(root, 'project.json'))
    })
    expect(callRuntime).not.toHaveBeenCalled()
  })

  it('creates and registers a frontend workspace without invoking backend manifest RPC', async () => {
    const { root, manifestService, readService, callRuntime } = await createServices()
    const workspacePath = join(root, 'ws_0001')
    await mkdir(workspacePath)

    const created = await manifestService.mutate({
      projectRoot: root,
      mutation: {
        type: 'create',
        name: 'cpu',
        designName: 'core',
        projectType: 'frontend',
      },
    })
    expect(created.manifest.project_type).toBe('frontend')
    await manifestService.mutate({
      projectRoot: root,
      mutation: {
        type: 'register-workspace',
        input: { projectRoot: root, workspacePath },
      },
    })
    expect((await readService.readManifest(root))?.workspaces[0]).toMatchObject({
      workspace_id: 'ws_0001',
      start_step: 'prepare',
      end_step: 'sim',
    })
    expect((await readService.discoverProject(workspacePath))?.root_path).toBe(root)
    expect(callRuntime).not.toHaveBeenCalled()
  })

  it('leaves existing backend manifests to ECC RPC', async () => {
    const { root, frontend, manifestService, callRuntime } = await createServices()
    const backend = createProjectManifestDraft({
      rootPath: root,
      name: 'backend',
      designName: 'top',
      projectType: 'backend',
    })
    await writeFile(join(root, 'project.json'), JSON.stringify(backend))
    expect(await frontend.load(root)).toBeNull()
    callRuntime.mockResolvedValueOnce(backend)
    expect((await manifestService.load(root)).project_type).toBe('backend')
    expect(callRuntime).toHaveBeenCalledWith('project.manifest.load', {
      projectRoot: root,
    })
  })

  it('reads only allowlisted frontend reports in a declared workspace', async () => {
    const { root, manifestService, readService } = await createServices()
    const workspacePath = join(root, 'ws_0001')
    await mkdir(join(workspacePath, 'home'), { recursive: true })
    await writeFile(join(workspacePath, 'home/flow.json'), '{"steps": []}')
    await manifestService.mutate({
      projectRoot: root,
      mutation: {
        type: 'create',
        name: 'cpu',
        designName: 'core',
        projectType: 'frontend',
      },
    })
    await manifestService.mutate({
      projectRoot: root,
      mutation: {
        type: 'register-workspace',
        input: { projectRoot: root, workspacePath },
      },
    })
    const request = { projectRoot: root, workspacePath, paths: ['home/flow.json'] }
    expect((await readService.readFrontendWorkspaceTexts(request)).texts).toEqual({
      'home/flow.json': '{"steps": []}',
    })
    await expect(
      readService.readFrontendWorkspaceTexts({
        ...request,
        paths: ['home/parameters.json'],
      }),
    ).rejects.toThrow('not allowed')

    await writeFile(join(workspacePath, 'home/flow.json'), 'x'.repeat(1024 * 1024 + 1))
    expect(await readService.readFrontendWorkspaceTexts(request)).toEqual({
      texts: { 'home/flow.json': null },
      unavailablePaths: ['home/flow.json'],
    })

    const outside = join(root, 'outside.json')
    await writeFile(outside, '{"secret": true}')
    await rm(join(workspacePath, 'home/flow.json'))
    await symlink(outside, join(workspacePath, 'home/flow.json'))
    await expect(readService.readFrontendWorkspaceTexts(request)).rejects.toThrow(
      'outside its workspace',
    )
    expect(await readFile(outside, 'utf8')).toBe('{"secret": true}')
  })

  it('does not read backend workspace configuration for a frontend project', async () => {
    const { root, manifestService } = await createServices()
    const workspacePath = join(root, 'ws_0001')
    await mkdir(workspacePath)
    await manifestService.mutate({
      projectRoot: root,
      mutation: {
        type: 'create',
        name: 'cpu',
        designName: 'core',
        projectType: 'frontend',
      },
    })
    await manifestService.mutate({
      projectRoot: root,
      mutation: {
        type: 'register-workspace',
        input: { projectRoot: root, workspacePath },
      },
    })
    const readWorkspaceConfiguration = vi
      .fn()
      .mockRejectedValue(
        new Error('Backend workspace reader was called for a frontend project.'),
      )
    const reader = new ProjectManagementReadService(
      manifestService,
      undefined,
      readWorkspaceConfiguration,
    )
    expect((await reader.readManifest(root))?.project_type).toBe('frontend')
    expect(readWorkspaceConfiguration).not.toHaveBeenCalled()
  })

  it('imports a picked frontend workspace only with frontend flow and parameters', async () => {
    const { root, manifestService, callRuntime } = await createServices()
    const workspacePath = join(root, 'ws_0001')
    await mkdir(join(workspacePath, 'home'), { recursive: true })
    await writeFile(join(workspacePath, 'home/flow.json'), '{"steps": []}')
    await writeFile(
      join(workspacePath, 'home/parameters.json'),
      '{"Design Tool": "frontend", "design": "cpu"}',
    )
    await manifestService.mutate({
      projectRoot: root,
      mutation: {
        type: 'create',
        name: 'cpu',
        designName: 'core',
        projectType: 'frontend',
      },
    })
    const importer = new ProjectWorkspaceImportService(manifestService)
    expect((await importer.importWorkspace(root, workspacePath)).status).toBe('imported')
    expect((await importer.importWorkspace(root, workspacePath)).status).toBe(
      'already_registered',
    )
    expect(callRuntime).not.toHaveBeenCalled()
  })
})

describe('frontend design profiles from workspace files', () => {
  it('uses the persisted workspace profile for registration and import', async () => {
    const { root, manifestService } = await createServices()
    await manifestService.mutate({
      projectRoot: root,
      mutation: {
        type: 'create',
        name: 'rtl',
        designName: 'counter',
        projectType: 'frontend',
      },
    })
    const workspacePath = join(root, 'ws_0001')
    await mkdir(join(workspacePath, 'home'), { recursive: true })
    await writeFile(
      join(workspacePath, 'home/parameters.json'),
      JSON.stringify({
        'Design Tool': 'frontend',
        frontend_design_kind: 'generic_rtl',
        'Top module': 'counter',
        Clock: '',
      }),
    )
    await writeFile(
      join(workspacePath, 'home/flow.json'),
      JSON.stringify({
        steps: [
          { name: 'prepare' },
          { name: 'review' },
          { name: 'elab' },
          { name: 'lint' },
        ],
      }),
    )
    const registered = await manifestService.mutate({
      projectRoot: root,
      mutation: {
        type: 'register-workspace',
        input: {
          projectRoot: root,
          workspacePath,
          config: { frontend_design_kind: 'cpu_core' },
        },
      },
    })
    expect(registered.manifest.base_design).toMatchObject({
      frontend_design_kind: 'generic_rtl',
      top_module: 'counter',
      clock: '',
    })
    expect(registered.manifest.workspaces[0]?.end_step).toBe('lint')

    const importedPath = join(root, 'ws_0002')
    await mkdir(join(importedPath, 'home'), { recursive: true })
    await writeFile(
      join(importedPath, 'home/parameters.json'),
      JSON.stringify({ 'Design Tool': 'frontend', frontend_design_kind: 'generic_rtl' }),
    )
    await writeFile(join(importedPath, 'home/flow.json'), '{"steps": []}')
    const importer = new ProjectWorkspaceImportService(manifestService)
    expect((await importer.importWorkspace(root, importedPath)).status).toBe('imported')
    const persisted = JSON.parse(await readFile(join(root, 'project.json'), 'utf8'))
    expect(persisted.workspaces[1].end_step).toBe('lint')
  })

  it('rejects an imported legacy CPU workspace in a generic RTL project', async () => {
    const { root, frontend, manifestService } = await createServices()
    await manifestService.mutate({
      projectRoot: root,
      mutation: {
        type: 'create',
        name: 'rtl',
        designName: 'counter',
        projectType: 'frontend',
      },
    })
    await manifestService.mutate({
      projectRoot: root,
      mutation: {
        type: 'register-workspace',
        input: {
          projectRoot: root,
          workspacePath: join(root, 'ws_0001'),
          config: { frontend_design_kind: 'generic_rtl' },
        },
      },
    })
    const candidate = join(root, 'ws_0002')
    await mkdir(join(candidate, 'home'), { recursive: true })
    await writeFile(join(candidate, 'home/flow.json'), '{"steps": []}')
    await writeFile(
      join(candidate, 'home/parameters.json'),
      '{"Design Tool": "frontend"}',
    )
    await expect(frontend.importWorkspace(root, candidate, 'ws_0002')).rejects.toThrow(
      'locked to generic_rtl',
    )
    expect((await frontend.load(root))?.workspaces).toHaveLength(1)
  })
})
