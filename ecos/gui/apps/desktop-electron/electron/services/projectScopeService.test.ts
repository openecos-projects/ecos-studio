import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ProjectScopeService } from './projectScopeService'
import { runWithWindowScope } from './windowScopeContext'

const tempDirectories: string[] = []

async function createTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  tempDirectories.push(directory)
  return directory
}

async function writeProjectManifest(
  projectRoot: string,
  workspacePaths: readonly string[],
): Promise<void> {
  await writeFile(
    join(projectRoot, 'project.json'),
    JSON.stringify({
      schema_version: 1,
      design_name: 'gcd',
      root_path: projectRoot,
      workspaces: workspacePaths.map((workspacePath, index) => ({
        workspace_id: `ws_${String(index + 1).padStart(4, '0')}`,
        workspace_path: workspacePath,
      })),
    }),
  )
}

describe('ProjectScopeService', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirectories
        .splice(0)
        .map((directory) => rm(directory, { force: true, recursive: true })),
    )
  })

  it('allows the active project root and descendants, then rejects access after clearing it', async () => {
    const root = await createTempDir('ecos-project-root-')
    const nested = join(root, 'home', 'flow')
    const file = join(nested, 'home.json')
    await mkdir(nested, { recursive: true })
    await writeFile(file, '{}')

    const service = new ProjectScopeService()

    await runWithWindowScope(1, async () => {
      const registeredRoot = await service.registerProjectRoot(root)
      const activeRoot = await service.getProjectRoot()
      const allowedFile = await service.requestProjectPathAccess(file)

      expect(registeredRoot).toBe(root)
      expect(activeRoot).toBe(root)
      expect(allowedFile).toBe(file)

      await service.clearProjectRoot()

      await expect(service.requestProjectPathAccess(file)).rejects.toThrow(
        'Project root is not registered',
      )
    })
  })

  it('canonicalizes a manifest project root without changing the active workspace root', async () => {
    const activeRoot = await createTempDir('ecos-active-project-root-')
    const manifestRoot = await createTempDir('ecos-manifest-project-root-')
    const service = new ProjectScopeService()
    await runWithWindowScope(1, async () => {
      await service.registerProjectRoot(activeRoot)

      await expect(service.resolveProjectRoot(manifestRoot)).resolves.toBe(manifestRoot)
      await expect(service.getProjectRoot()).resolves.toBe(activeRoot)
    })
  })

  it('adds the workspace parent as a read root without replacing the active root', async () => {
    const projectRoot = await createTempDir('ecos-parent-project-root-')
    const workspaceRoot = join(projectRoot, 'ws_0004')
    const siblingWorkspace = join(projectRoot, 'ws_0001')
    const manifestPath = join(projectRoot, 'project.json')
    const siblingFlowPath = join(siblingWorkspace, 'home', 'flow.json')
    const unrelatedFile = join(projectRoot, 'unrelated.txt')
    await mkdir(join(workspaceRoot, 'home'), { recursive: true })
    await mkdir(join(siblingWorkspace, 'home'), { recursive: true })
    await writeProjectManifest(projectRoot, [workspaceRoot, siblingWorkspace])
    await writeFile(siblingFlowPath, '{"steps":[]}')
    await writeFile(unrelatedFile, 'not a workspace artifact')

    const service = new ProjectScopeService()
    await runWithWindowScope(1, async () => {
      await service.registerProjectRoot(workspaceRoot)
      await expect(service.registerProjectReadRoot(projectRoot)).resolves.toBe(
        projectRoot,
      )

      await expect(service.getProjectRoot()).resolves.toBe(workspaceRoot)
      await expect(service.requestProjectPathAccess(manifestPath)).resolves.toBe(
        manifestPath,
      )
      await expect(service.requestProjectPathAccess(siblingFlowPath)).resolves.toBe(
        siblingFlowPath,
      )
      await expect(service.requestProjectPathAccess(unrelatedFile)).rejects.toThrow(
        'outside current project root',
      )
      await expect(
        service.requestWritableProjectPathAccess(manifestPath),
      ).rejects.toThrow('outside current project root')
      await expect(
        service.requestWritableProjectPathAccess(
          join(workspaceRoot, 'home', 'parameters.json'),
        ),
      ).resolves.toBe(join(workspaceRoot, 'home', 'parameters.json'))
    })
  })

  it('allows a declared workspace whose directory name begins with two dots', async () => {
    const projectRoot = await createTempDir('ecos-parent-project-root-')
    const workspaceRoot = join(projectRoot, '.ws_0004')
    const backupWorkspace = join(projectRoot, '..ws_0004.replace-backup-1')
    const backupFlowPath = join(backupWorkspace, 'home', 'flow.json')
    await mkdir(join(workspaceRoot, 'home'), { recursive: true })
    await mkdir(join(backupWorkspace, 'home'), { recursive: true })
    await writeProjectManifest(projectRoot, [workspaceRoot, backupWorkspace])
    await writeFile(backupFlowPath, '{"steps":[]}')

    const service = new ProjectScopeService()
    await runWithWindowScope(1, async () => {
      await service.registerProjectRoot(workspaceRoot)
      await service.registerProjectReadRoot(projectRoot)

      await expect(service.requestProjectPathAccess(backupFlowPath)).resolves.toBe(
        backupFlowPath,
      )
    })
  })

  it('rejects a parent project whose manifest does not declare the active workspace', async () => {
    const projectRoot = await createTempDir('ecos-parent-project-root-')
    const workspaceRoot = join(projectRoot, 'ws_0004')
    const siblingWorkspace = join(projectRoot, 'ws_0001')
    await mkdir(join(workspaceRoot, 'home'), { recursive: true })
    await mkdir(join(siblingWorkspace, 'home'), { recursive: true })
    await writeProjectManifest(projectRoot, [siblingWorkspace])

    const service = new ProjectScopeService()
    await runWithWindowScope(1, async () => {
      await service.registerProjectRoot(workspaceRoot)

      await expect(service.registerProjectReadRoot(projectRoot)).rejects.toThrow(
        'does not declare the active workspace',
      )
      await expect(
        service.requestProjectPathAccess(join(siblingWorkspace, 'home', 'flow.json')),
      ).rejects.toThrow('outside current project root')
    })
  })

  it('rejects a read root that is not the active workspace parent', async () => {
    const workspaceRoot = await createTempDir('ecos-active-project-root-')
    const unrelatedRoot = await createTempDir('ecos-unrelated-project-root-')
    const service = new ProjectScopeService()

    await runWithWindowScope(1, async () => {
      await service.registerProjectRoot(workspaceRoot)
      await expect(service.registerProjectReadRoot(unrelatedRoot)).rejects.toThrow(
        'Project read root must be the active workspace root or its parent directory',
      )
    })
  })

  it('rejects paths that escape the active project root via symlinks', async () => {
    const root = await createTempDir('ecos-project-root-')
    const outside = await createTempDir('ecos-project-outside-')
    const outsideFile = join(outside, 'home.json')
    await writeFile(outsideFile, '{}')

    const linkedPath = join(root, 'linked-home.json')
    await symlink(outsideFile, linkedPath)

    const service = new ProjectScopeService()
    await runWithWindowScope(1, async () => {
      await service.registerProjectRoot(root)

      await expect(service.requestProjectPathAccess(linkedPath)).rejects.toThrow(
        'outside current project scope',
      )
    })
  })

  it('authorizes missing descendants without requiring the final file to exist', async () => {
    const root = await createTempDir('ecos-project-root-')
    await mkdir(join(root, 'Synthesis_yosys'), { recursive: true })

    const service = new ProjectScopeService()
    await runWithWindowScope(1, async () => {
      await service.registerProjectRoot(root)

      await expect(
        service.requestProjectPathAccess(
          join(root, 'Synthesis_yosys', 'log', 'Synthesis.log'),
        ),
      ).resolves.toBe(join(root, 'Synthesis_yosys', 'log', 'Synthesis.log'))
    })
  })

  it('requires explicit approval before allowing frontend source roots', async () => {
    const root = await createTempDir('ecos-project-root-')
    const sourceRoot = await createTempDir('ecos-frontend-source-')
    const sourceFile = join(sourceRoot, 'rtl', 'cpu.sv')
    const outside = await createTempDir('ecos-unrelated-source-')
    const outsideFile = join(outside, 'cpu.sv')
    await mkdir(join(root, 'home'), { recursive: true })
    await mkdir(join(sourceRoot, 'rtl'), { recursive: true })
    await writeFile(sourceFile, 'module cpu; endmodule')
    await writeFile(outsideFile, 'module other; endmodule')
    await writeFile(join(sourceRoot, 'filelist.cpu.f'), 'rtl/cpu.sv')
    await writeFile(
      join(root, 'home', 'parameters.json'),
      JSON.stringify({
        'Design Tool': 'frontend',
        cpu_filelist: join(sourceRoot, 'filelist.cpu.f'),
      }),
    )

    const service = new ProjectScopeService()
    await runWithWindowScope(1, async () => {
      await service.registerProjectRoot(root)

      await expect(service.requestProjectPathAccess(sourceFile)).rejects.toThrow(
        'outside current project root',
      )
      await expect(service.listPendingExternalReadRoots()).resolves.toEqual([
        join(sourceRoot, 'rtl'),
      ])
      await expect(
        service.approvePendingExternalReadRoots(root, [join(sourceRoot, 'rtl')]),
      ).resolves.toEqual([join(sourceRoot, 'rtl')])
      await expect(service.requestProjectPathAccess(sourceFile)).resolves.toBe(sourceFile)
      await expect(service.requestProjectPathAccess(outsideFile)).rejects.toThrow(
        'outside current project scope',
      )
    })
  })

  it('keeps frontend filelist access scoped to discovered source directories', async () => {
    const root = await createTempDir('ecos-project-root-')
    const sourceRoot = await createTempDir('ecos-frontend-source-')
    const rtlDir = join(sourceRoot, 'rtl')
    const notesDir = join(sourceRoot, 'notes')
    const sourceFile = join(rtlDir, 'cpu.sv')
    const siblingFile = join(notesDir, 'private.txt')
    await mkdir(join(root, 'home'), { recursive: true })
    await mkdir(rtlDir, { recursive: true })
    await mkdir(notesDir, { recursive: true })
    await writeFile(sourceFile, 'module cpu; endmodule')
    await writeFile(siblingFile, 'do not expose whole source root')
    await writeFile(join(sourceRoot, 'filelist.cpu.f'), 'rtl/cpu.sv')
    await writeFile(
      join(root, 'home', 'parameters.json'),
      JSON.stringify({
        'Design Tool': 'frontend',
        cpu_filelist: join(sourceRoot, 'filelist.cpu.f'),
      }),
    )

    const service = new ProjectScopeService()
    await runWithWindowScope(1, async () => {
      await service.registerProjectRoot(root)
      await service.approvePendingExternalReadRoots(root, [rtlDir])

      await expect(service.requestProjectPathAccess(sourceFile)).resolves.toBe(sourceFile)
      await expect(service.requestProjectPathAccess(siblingFile)).rejects.toThrow(
        'outside current project scope',
      )
    })
  })

  it('reuses persisted approval only for roots still declared by the project', async () => {
    const root = await createTempDir('ecos-project-root-')
    const sourceRoot = await createTempDir('ecos-frontend-source-')
    const sourceFile = join(sourceRoot, 'cpu.sv')
    const storedGrants = new Map<string, string[]>()
    const readGrantProvider = {
      get: async (projectRoot: string) => storedGrants.get(projectRoot) ?? [],
      set: async (projectRoot: string, roots: string[]) => {
        storedGrants.set(projectRoot, roots)
      },
    }
    await mkdir(join(root, 'home'), { recursive: true })
    await writeFile(sourceFile, 'module cpu; endmodule')
    await writeFile(join(sourceRoot, 'filelist.cpu.f'), 'cpu.sv')
    await writeFile(
      join(root, 'home', 'parameters.json'),
      JSON.stringify({
        'Design Tool': 'frontend',
        cpu_filelist: join(sourceRoot, 'filelist.cpu.f'),
      }),
    )

    const firstService = new ProjectScopeService({ readGrantProvider })
    await runWithWindowScope(1, async () => {
      await firstService.registerProjectRoot(root)
      await firstService.approvePendingExternalReadRoots(root, [sourceRoot])
    })

    const reloadedService = new ProjectScopeService({ readGrantProvider })
    await runWithWindowScope(2, async () => {
      await reloadedService.registerProjectRoot(root)
      await expect(reloadedService.listPendingExternalReadRoots()).resolves.toEqual([])
      await expect(reloadedService.requestProjectPathAccess(sourceFile)).resolves.toBe(
        sourceFile,
      )
    })
  })

  it('rejects an approval snapshot after the active project changes', async () => {
    const rootA = await createTempDir('ecos-project-root-a-')
    const rootB = await createTempDir('ecos-project-root-b-')
    const sourceRootA = await createTempDir('ecos-frontend-source-a-')
    const sourceRootB = await createTempDir('ecos-frontend-source-b-')
    const sourceFileB = join(sourceRootB, 'cpu.sv')
    for (const [root, sourceRoot] of [
      [rootA, sourceRootA],
      [rootB, sourceRootB],
    ]) {
      await mkdir(join(root, 'home'), { recursive: true })
      await writeFile(join(sourceRoot, 'cpu.sv'), 'module cpu; endmodule')
      await writeFile(join(sourceRoot, 'filelist.cpu.f'), 'cpu.sv')
      await writeFile(
        join(root, 'home', 'parameters.json'),
        JSON.stringify({
          'Design Tool': 'frontend',
          cpu_filelist: join(sourceRoot, 'filelist.cpu.f'),
        }),
      )
    }

    const service = new ProjectScopeService()
    await runWithWindowScope(1, async () => {
      await service.registerProjectRoot(rootA)
      const pendingRootsA = await service.listPendingExternalReadRoots()

      await service.registerProjectRoot(rootB)
      await expect(
        service.approvePendingExternalReadRoots(rootA, pendingRootsA),
      ).rejects.toThrow('no longer matches the active project')
      await expect(service.requestProjectPathAccess(sourceFileB)).rejects.toThrow(
        'outside current project root',
      )
    })
  })

  it('never offers a project ancestor as an external read root', async () => {
    const ancestor = await createTempDir('ecos-project-parent-')
    const root = join(ancestor, 'workspace')
    const siblingFile = join(ancestor, 'ecos-private.txt')
    await mkdir(join(root, 'home'), { recursive: true })
    await writeFile(siblingFile, 'private')
    await writeFile(
      join(root, 'home', 'parameters.json'),
      JSON.stringify({
        'Design Tool': 'frontend',
        sim_soc_root: ancestor,
      }),
    )

    const service = new ProjectScopeService()
    await runWithWindowScope(1, async () => {
      await service.registerProjectRoot(root)
      await expect(service.listPendingExternalReadRoots()).resolves.toEqual([])
      await expect(service.requestProjectPathAccess(siblingFile)).rejects.toThrow(
        'outside current project root',
      )
    })
  })

  it('recognizes a workspace only when required home files exist', async () => {
    const root = await createTempDir('ecos-project-root-')
    await mkdir(join(root, 'home'), { recursive: true })
    await writeFile(join(root, 'home', 'flow.json'), '{"steps":[]}')
    await writeFile(join(root, 'home', 'parameters.json'), '{"Design":"demo"}')

    const service = new ProjectScopeService()

    await expect(service.isProjectDirectory(root)).resolves.toBe(true)
  })

  it('recognizes a workspace configured by home/ecc.toml', async () => {
    const root = await createTempDir('ecos-project-root-')
    await mkdir(join(root, 'home'), { recursive: true })
    await writeFile(join(root, 'home', 'flow.json'), '{"steps":[]}')
    await writeFile(join(root, 'home', 'ecc.toml'), '[params]\ndesign = "demo"\n')

    const service = new ProjectScopeService()

    await expect(service.isProjectDirectory(root)).resolves.toBe(true)
  })

  it('rejects a directory with only one workspace marker file', async () => {
    const root = await createTempDir('ecos-project-root-')
    await mkdir(join(root, 'home'), { recursive: true })
    await writeFile(join(root, 'home', 'flow.json'), '{"steps":[]}')

    const service = new ProjectScopeService()

    await expect(service.isProjectDirectory(root)).resolves.toBe(false)
  })

  it('rejects a directory with only a workspace config file', async () => {
    const root = await createTempDir('ecos-project-root-')
    await mkdir(join(root, 'home'), { recursive: true })
    await writeFile(join(root, 'home', 'ecc.toml'), '[params]\ndesign = "demo"\n')

    const service = new ProjectScopeService()

    await expect(service.isProjectDirectory(root)).resolves.toBe(false)
  })

  it('keeps independent roots for different windows', async () => {
    const rootA = await createTempDir('ecos-project-root-a-')
    const rootB = await createTempDir('ecos-project-root-b-')
    const service = new ProjectScopeService()

    await runWithWindowScope(11, async () => {
      await service.registerProjectRoot(rootA)
      await expect(service.getProjectRoot()).resolves.toBe(rootA)
    })
    await runWithWindowScope(22, async () => {
      await service.registerProjectRoot(rootB)
      await expect(service.getProjectRoot()).resolves.toBe(rootB)
    })
    await runWithWindowScope(11, async () => {
      await expect(service.getProjectRoot()).resolves.toBe(rootA)
    })

    service.clearWindow(11)
    await runWithWindowScope(11, async () => {
      await expect(service.getProjectRoot()).rejects.toThrow(
        'Project root is not registered',
      )
    })
    await runWithWindowScope(22, async () => {
      await expect(service.getProjectRoot()).resolves.toBe(rootB)
    })
  })

  it('rejects scoped operations without an active window scope', async () => {
    const service = new ProjectScopeService()
    await expect(service.getProjectRoot()).rejects.toThrow('Window scope is not active')
  })
})
