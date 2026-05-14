import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ProjectScopeService } from './projectScopeService'

const tempDirectories: string[] = []

async function createTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  tempDirectories.push(directory)
  return directory
}

describe('ProjectScopeService', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirectories.splice(0).map((directory) =>
        rm(directory, { force: true, recursive: true }),
      ),
    )
  })

  it('allows the active project root and descendants, then rejects access after clearing it', async () => {
    const root = await createTempDir('ecos-project-root-')
    const nested = join(root, 'home', 'flow')
    const file = join(nested, 'home.json')
    await mkdir(nested, { recursive: true })
    await writeFile(file, '{}')

    const service = new ProjectScopeService()

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

  it('rejects paths that escape the active project root via symlinks', async () => {
    const root = await createTempDir('ecos-project-root-')
    const outside = await createTempDir('ecos-project-outside-')
    const outsideFile = join(outside, 'home.json')
    await writeFile(outsideFile, '{}')

    const linkedPath = join(root, 'linked-home.json')
    await symlink(outsideFile, linkedPath)

    const service = new ProjectScopeService()
    await service.registerProjectRoot(root)

    await expect(service.requestProjectPathAccess(linkedPath)).rejects.toThrow(
      'outside current project root',
    )
  })

  it('authorizes missing descendants without requiring the final file to exist', async () => {
    const root = await createTempDir('ecos-project-root-')
    await mkdir(join(root, 'Synthesis_yosys'), { recursive: true })

    const service = new ProjectScopeService()
    await service.registerProjectRoot(root)

    await expect(
      service.requestProjectPathAccess(join(root, 'Synthesis_yosys', 'log', 'Synthesis.log')),
    ).resolves.toBe(join(root, 'Synthesis_yosys', 'log', 'Synthesis.log'))
  })
})
