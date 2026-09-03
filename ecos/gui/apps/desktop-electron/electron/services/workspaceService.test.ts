import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { DesktopProjectFileChangedEvent } from '@ecos-studio/shared'
import { WorkspaceService } from './workspaceService'

const tempDirectories: string[] = []
type ProjectScopeProviderDouble = ConstructorParameters<
  typeof WorkspaceService
>[0]['projectScopeProvider']

async function createTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  tempDirectories.push(directory)
  return directory
}

function createProjectScopeProvider(
  rootPath: string,
  canonicalPath: string,
): ProjectScopeProviderDouble {
  return {
    clearProjectRoot: vi.fn(),
    getProjectRoot: vi.fn().mockResolvedValue(rootPath),
    isProjectDirectory: vi.fn().mockResolvedValue(true),
    registerProjectReadRoot: vi.fn(),
    registerProjectRoot: vi.fn(),
    requestProjectPathAccess: vi.fn().mockResolvedValue(canonicalPath),
    requestWritableProjectPathAccess: vi.fn().mockResolvedValue(canonicalPath),
    scanPdkDirectory: vi.fn(),
  }
}

function createWorkspaceService(
  rootPath: string,
  canonicalPath: string,
  options: {
    runtimeMutationGuard?: ConstructorParameters<
      typeof WorkspaceService
    >[0]['runtimeMutationGuard']
  } = {},
): {
  projectScopeProvider: ProjectScopeProviderDouble
  service: WorkspaceService
} {
  const projectScopeProvider = createProjectScopeProvider(rootPath, canonicalPath)
  const service = new WorkspaceService({
    projectScopeProvider,
    replacementJournalDirectory: join(rootPath, '.workspace-replacement-journals'),
    ...options,
  })

  return {
    projectScopeProvider,
    service,
  }
}

async function waitForProjectFileEvent(
  listener: ReturnType<typeof vi.fn>,
  event: Partial<DesktopProjectFileChangedEvent>,
): Promise<void> {
  await vi.waitFor(
    () => {
      expect(listener).toHaveBeenCalledWith(expect.objectContaining(event))
    },
    { timeout: 3000 },
  )
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

describe('WorkspaceService', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirectories
        .splice(0)
        .map((directory) => rm(directory, { force: true, recursive: true })),
    )
  })

  it('reads project-scoped text through the validated canonical path', async () => {
    const directory = await createTempDir('ecos-workspace-service-')
    const filePath = join(directory, 'flow.json')
    await writeFile(filePath, '{"steps":[]}', 'utf8')

    const { projectScopeProvider, service } = createWorkspaceService(directory, filePath)

    await expect(
      (
        service as WorkspaceService & {
          readProjectTextFile(path: string): Promise<string>
        }
      ).readProjectTextFile('/workspace/home/flow.json'),
    ).resolves.toBe('{"steps":[]}')
    expect(projectScopeProvider.requestProjectPathAccess).toHaveBeenCalledWith(
      '/workspace/home/flow.json',
    )
  })

  it('returns null for optional project text reads when the file is absent', async () => {
    const directory = await createTempDir('ecos-workspace-service-optional-')
    const filePath = join(directory, 'Synthesis_yosys', 'log', 'Synthesis.log')

    const { projectScopeProvider, service } = createWorkspaceService(directory, filePath)

    await expect(
      service.readOptionalProjectTextFile('/workspace/Synthesis_yosys/log/Synthesis.log'),
    ).resolves.toBeNull()
    expect(projectScopeProvider.requestProjectPathAccess).toHaveBeenCalledWith(
      '/workspace/Synthesis_yosys/log/Synthesis.log',
    )
  })

  it('reads UTF-8 project text in bounded sequential chunks', async () => {
    const directory = await createTempDir('ecos-workspace-service-chunk-')
    const filePath = join(directory, 'place_dreamplace', 'log', 'place.log')
    await mkdir(join(directory, 'place_dreamplace', 'log'), { recursive: true })
    await writeFile(filePath, 'ab中cd', 'utf8')

    const { service } = createWorkspaceService(directory, filePath)
    const first = await service.readOptionalProjectTextFileChunk(
      '/workspace/place_dreamplace/log/place.log',
      0,
      4,
    )
    const second = await service.readOptionalProjectTextFileChunk(
      '/workspace/place_dreamplace/log/place.log',
      first?.nextOffsetBytes ?? 0,
      4,
    )
    const third = await service.readOptionalProjectTextFileChunk(
      '/workspace/place_dreamplace/log/place.log',
      second?.nextOffsetBytes ?? 0,
      4,
    )

    expect(first).toEqual({
      content: 'ab',
      eof: false,
      nextOffsetBytes: 2,
      sizeBytes: Buffer.byteLength('ab中cd'),
    })
    expect(second).toEqual({
      content: '中c',
      eof: false,
      nextOffsetBytes: 6,
      sizeBytes: Buffer.byteLength('ab中cd'),
    })
    expect(third).toEqual({
      content: 'd',
      eof: true,
      nextOffsetBytes: Buffer.byteLength('ab中cd'),
      sizeBytes: Buffer.byteLength('ab中cd'),
    })
  })

  it('caps a project text chunk to the desktop bridge byte limit', async () => {
    const directory = await createTempDir('ecos-workspace-service-chunk-limit-')
    const filePath = join(directory, 'Route_openroad', 'log', 'Route.log')
    await mkdir(join(directory, 'Route_openroad', 'log'), { recursive: true })
    await writeFile(filePath, 'x'.repeat(300 * 1024), 'utf8')

    const { service } = createWorkspaceService(directory, filePath)
    const chunk = await service.readOptionalProjectTextFileChunk(
      '/workspace/Route_openroad/log/Route.log',
      0,
      Number.MAX_SAFE_INTEGER,
    )

    expect(chunk).toMatchObject({
      eof: false,
      nextOffsetBytes: 256 * 1024,
      sizeBytes: 300 * 1024,
    })
    expect(chunk?.content).toHaveLength(256 * 1024)
  })

  it('reads only the tail of a project-scoped text file', async () => {
    const directory = await createTempDir('ecos-workspace-service-tail-')
    const filePath = join(directory, 'Synthesis_yosys', 'log', 'Synthesis.log')
    await mkdir(join(directory, 'Synthesis_yosys', 'log'), { recursive: true })
    await writeFile(filePath, 'first line\nsecond line\nthird line', 'utf8')

    const { projectScopeProvider, service } = createWorkspaceService(directory, filePath)

    await expect(
      service.readProjectTextFileTail('/workspace/Synthesis_yosys/log/Synthesis.log', 10),
    ).resolves.toBe('third line')
    expect(projectScopeProvider.requestProjectPathAccess).toHaveBeenCalledWith(
      '/workspace/Synthesis_yosys/log/Synthesis.log',
    )
  })

  it('returns tail metadata for optional project-scoped text reads', async () => {
    const directory = await createTempDir('ecos-workspace-service-tail-meta-')
    const filePath = join(directory, 'Synthesis_yosys', 'log', 'Synthesis.log')
    await mkdir(join(directory, 'Synthesis_yosys', 'log'), { recursive: true })
    await writeFile(filePath, 'first line\nsecond line\nthird line', 'utf8')

    const { service } = createWorkspaceService(directory, filePath)

    await expect(
      service.readOptionalProjectTextFileTail(
        '/workspace/Synthesis_yosys/log/Synthesis.log',
        10,
      ),
    ).resolves.toEqual({
      content: 'third line',
      truncated: true,
      sizeBytes: Buffer.byteLength('first line\nsecond line\nthird line'),
    })
  })

  it('reads appended text updates from a byte offset', async () => {
    const directory = await createTempDir('ecos-workspace-service-update-')
    const filePath = join(directory, 'Route_openroad', 'log', 'Route.log')
    await mkdir(join(directory, 'Route_openroad', 'log'), { recursive: true })
    await writeFile(filePath, 'alpha\nbeta', 'utf8')

    const { service } = createWorkspaceService(directory, filePath)
    const offset = Buffer.byteLength('alpha')

    await expect(
      service.readOptionalProjectTextFileUpdate(
        '/workspace/Route_openroad/log/Route.log',
        offset,
        32,
      ),
    ).resolves.toMatchObject({
      content: '\nbeta',
      fromOffsetBytes: offset,
      nextOffsetBytes: Buffer.byteLength('alpha\nbeta'),
      sizeBytes: Buffer.byteLength('alpha\nbeta'),
      reset: false,
      truncated: false,
    })
  })

  it('resets text updates when the unread range exceeds the bounded tail window', async () => {
    const directory = await createTempDir('ecos-workspace-service-update-reset-')
    const filePath = join(directory, 'Route_openroad', 'log', 'Route.log')
    await mkdir(join(directory, 'Route_openroad', 'log'), { recursive: true })
    await writeFile(filePath, '0123456789abcdefghijklmnopqrstuvwxyz', 'utf8')

    const { service } = createWorkspaceService(directory, filePath)

    await expect(
      service.readOptionalProjectTextFileUpdate(
        '/workspace/Route_openroad/log/Route.log',
        0,
        10,
      ),
    ).resolves.toMatchObject({
      content: 'qrstuvwxyz',
      nextOffsetBytes: Buffer.byteLength('0123456789abcdefghijklmnopqrstuvwxyz'),
      reset: true,
      truncated: true,
    })
  })

  it('returns null for tail reads when the project-scoped file is absent', async () => {
    const directory = await createTempDir('ecos-workspace-service-tail-missing-')
    const filePath = join(directory, 'Synthesis_yosys', 'log', 'Synthesis.log')

    const { service } = createWorkspaceService(directory, filePath)

    await expect(
      service.readProjectTextFileTail('/workspace/Synthesis_yosys/log/Synthesis.log', 10),
    ).resolves.toBeNull()
  })

  it('reads project-scoped binary through the validated canonical path', async () => {
    const directory = await createTempDir('ecos-workspace-service-bin-')
    const filePath = join(directory, 'cells.bin')
    await writeFile(filePath, Buffer.from([0x45, 0x43, 0x4f, 0x53]))

    const { projectScopeProvider, service } = createWorkspaceService(directory, filePath)

    await expect(
      (
        service as WorkspaceService & {
          readProjectBinaryFile(path: string): Promise<Uint8Array>
        }
      ).readProjectBinaryFile('/workspace/output/preview.bin'),
    ).resolves.toEqual(Uint8Array.from([0x45, 0x43, 0x4f, 0x53]))
    expect(projectScopeProvider.requestProjectPathAccess).toHaveBeenCalledWith(
      '/workspace/output/preview.bin',
    )
  })

  it('writes project-scoped text through the validated canonical path', async () => {
    const directory = await createTempDir('ecos-workspace-service-write-')
    const filePath = join(directory, 'parameters.json')

    const { projectScopeProvider, service } = createWorkspaceService(directory, filePath)

    await expect(
      (
        service as WorkspaceService & {
          writeProjectTextFile(path: string, content: string): Promise<void>
        }
      ).writeProjectTextFile('/workspace/home/parameters.json', '{"PDK":"ics55"}'),
    ).resolves.toBeUndefined()

    await expect(readFile(filePath, 'utf8')).resolves.toBe('{"PDK":"ics55"}')
    expect(projectScopeProvider.requestWritableProjectPathAccess).toHaveBeenCalledWith(
      '/workspace/home/parameters.json',
    )
  })

  it('discards an incomplete failed workspace create but refuses complete workspaces', async () => {
    const projectRoot = await createTempDir('ecos-workspace-service-discard-root-')
    const failedWorkspace = join(projectRoot, 'ws_0036')
    await mkdir(failedWorkspace, { recursive: true })

    const { projectScopeProvider, service } = createWorkspaceService(
      projectRoot,
      failedWorkspace,
    )
    vi.mocked(projectScopeProvider.isProjectDirectory).mockResolvedValue(false)

    await expect(service.pathExists(failedWorkspace)).resolves.toBe(true)
    await expect(service.discardFailedWorkspaceCreate(failedWorkspace)).resolves.toBe(
      true,
    )
    await expect(service.pathExists(failedWorkspace)).resolves.toBe(false)

    const completeWorkspace = join(projectRoot, 'ws_complete')
    await mkdir(join(completeWorkspace, 'home'), { recursive: true })
    vi.mocked(projectScopeProvider.isProjectDirectory).mockResolvedValueOnce(true)
    await expect(service.discardFailedWorkspaceCreate(completeWorkspace)).rejects.toThrow(
      /complete ECOS workspace/,
    )
  })

  it('lists project-scoped directory entries through the validated canonical path', async () => {
    const directory = await createTempDir('ecos-workspace-service-list-dir-')
    const originDirectory = join(directory, 'origin')
    await mkdir(join(originDirectory, 'reports'), { recursive: true })
    await writeFile(join(originDirectory, 'gcd_Floorplan.def.gz'), 'def', 'utf8')
    await writeFile(join(originDirectory, 'gcd_Floorplan.v.gz'), 'verilog', 'utf8')

    const { projectScopeProvider, service } = createWorkspaceService(
      directory,
      originDirectory,
    )

    await expect(service.listProjectDirectory('/workspace/origin')).resolves.toEqual([
      {
        name: 'reports',
        path: join(originDirectory, 'reports'),
        type: 'directory',
      },
      {
        name: 'gcd_Floorplan.def.gz',
        path: join(originDirectory, 'gcd_Floorplan.def.gz'),
        type: 'file',
      },
      {
        name: 'gcd_Floorplan.v.gz',
        path: join(originDirectory, 'gcd_Floorplan.v.gz'),
        type: 'file',
      },
    ])
    expect(projectScopeProvider.requestProjectPathAccess).toHaveBeenCalledWith(
      '/workspace/origin',
    )
  })

  it('prepares a workspace directory replacement by moving the current workspace aside', async () => {
    const directory = await createTempDir('ecos-workspace-service-replace-dir-')
    const workspaceDirectory = join(directory, 'ws_0001')
    const filePath = join(workspaceDirectory, 'origin', 'top.v')
    await mkdir(join(workspaceDirectory, 'origin'), { recursive: true })
    await writeFile(filePath, 'module top; endmodule', 'utf8')

    const { projectScopeProvider, service } = createWorkspaceService(
      directory,
      workspaceDirectory,
    )

    const replacement =
      await service.prepareProjectDirectoryReplacement('/project/ws_0001')

    expect(replacement?.targetPath).toBe(workspaceDirectory)
    expect(replacement?.backupPath).toContain('.ws_0001.replace-backup-')
    await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(
      readFile(join(replacement?.backupPath ?? '', 'origin', 'top.v'), 'utf8'),
    ).resolves.toBe('module top; endmodule')
    expect(projectScopeProvider.requestWritableProjectPathAccess).toHaveBeenCalledWith(
      '/project/ws_0001',
    )
  })

  it('refuses to prepare a replacement for a directory that is not an ECOS workspace', async () => {
    const directory = await createTempDir('ecos-workspace-service-non-workspace-')
    const targetPath = join(directory, 'origin')
    await mkdir(targetPath, { recursive: true })
    const { projectScopeProvider, service } = createWorkspaceService(
      directory,
      targetPath,
    )
    vi.mocked(projectScopeProvider.isProjectDirectory).mockResolvedValueOnce(false)

    await expect(
      service.prepareProjectDirectoryReplacement('/project/origin'),
    ).rejects.toThrow('not an ECOS workspace')
    await expect(readdir(targetPath)).resolves.toEqual([])
  })

  it('prepares an incomplete manifest-owned workspace without relying on active scope', async () => {
    const directory = await createTempDir('ecos-workspace-service-managed-replacement-')
    const targetPath = join(directory, 'ws_0001')
    await mkdir(targetPath, { recursive: true })
    await writeFile(join(targetPath, 'partial.txt'), 'partial workspace', 'utf8')
    const { projectScopeProvider, service } = createWorkspaceService(
      directory,
      targetPath,
    )
    vi.mocked(projectScopeProvider.isProjectDirectory).mockResolvedValueOnce(false)

    const replacement = await service.prepareManagedProjectWorkspaceDirectoryReplacement(
      directory,
      'ws_0001',
      targetPath,
    )

    expect(replacement?.targetPath).toBe(targetPath)
    await expect(readFile(join(targetPath, 'partial.txt'), 'utf8')).rejects.toMatchObject(
      {
        code: 'ENOENT',
      },
    )
    await expect(
      readFile(join(replacement?.backupPath ?? '', 'partial.txt'), 'utf8'),
    ).resolves.toBe('partial workspace')
    expect(projectScopeProvider.isProjectDirectory).not.toHaveBeenCalled()
  })

  it('refuses a manifest workspace path outside its direct project child directory', async () => {
    const directory = await createTempDir('ecos-workspace-service-managed-path-')
    const outsidePath = await createTempDir('ecos-workspace-service-managed-outside-')
    const { service } = createWorkspaceService(directory, join(directory, 'ws_0001'))

    await expect(
      service.prepareManagedProjectWorkspaceDirectoryReplacement(
        directory,
        'ws_0001',
        outsidePath,
      ),
    ).rejects.toThrow('not a direct child')
  })

  it('refuses to replace a workspace while its runtime flow is active', async () => {
    const directory = await createTempDir('ecos-workspace-service-running-replacement-')
    const targetPath = join(directory, 'ws_0001')
    await mkdir(targetPath, { recursive: true })
    const runtimeMutationGuard = {
      isWorkspaceRuntimeActive: vi.fn().mockResolvedValue(true),
    }
    const { service } = createWorkspaceService(directory, targetPath, {
      runtimeMutationGuard,
    })

    await expect(
      service.prepareProjectDirectoryReplacement('/project/ws_0001'),
    ).rejects.toThrow('flow is running')
    await expect(readdir(targetPath)).resolves.toEqual([])
    expect(runtimeMutationGuard.isWorkspaceRuntimeActive).toHaveBeenCalledWith(targetPath)
  })

  it('restores an uncommitted replacement from its durable journal after restart', async () => {
    const directory = await createTempDir('ecos-workspace-service-recovery-rollback-')
    const targetPath = join(directory, 'ws_0001')
    await mkdir(targetPath, { recursive: true })
    await writeFile(join(targetPath, 'marker.txt'), 'original', 'utf8')
    const { service } = createWorkspaceService(directory, targetPath)
    const replacement =
      await service.prepareProjectDirectoryReplacement('/project/ws_0001')
    if (!replacement) throw new Error('Expected replacement token')

    const { service: restartedService } = createWorkspaceService(directory, targetPath)
    await restartedService.recoverProjectDirectoryReplacements()

    await expect(readFile(join(targetPath, 'marker.txt'), 'utf8')).resolves.toBe(
      'original',
    )
    await expect(
      readFile(join(replacement.backupPath, 'marker.txt'), 'utf8'),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('finalizes a manifest-committed deletion during restart recovery', async () => {
    const directory = await createTempDir('ecos-workspace-service-recovery-delete-')
    const targetPath = join(directory, 'ws_0001')
    await mkdir(targetPath, { recursive: true })
    await writeFile(join(targetPath, 'marker.txt'), 'original', 'utf8')
    const { service } = createWorkspaceService(directory, targetPath)
    const replacement =
      await service.prepareProjectDirectoryReplacement('/project/ws_0001')
    if (!replacement) throw new Error('Expected replacement token')
    await service.setProjectDirectoryReplacementRecoveryMode(replacement.id, 'delete')
    await writeFile(
      join(directory, 'project.json'),
      JSON.stringify({ workspaces: [] }),
      'utf8',
    )

    const { service: restartedService } = createWorkspaceService(directory, targetPath)
    await restartedService.recoverProjectDirectoryReplacements()

    await expect(readFile(join(targetPath, 'marker.txt'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(
      readFile(join(replacement.backupPath, 'marker.txt'), 'utf8'),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('retains a manifest-recorded replacement backup during restart recovery', async () => {
    const directory = await createTempDir('ecos-workspace-service-recovery-retain-')
    const targetPath = join(directory, 'ws_0001')
    await mkdir(targetPath, { recursive: true })
    await writeFile(join(targetPath, 'marker.txt'), 'original', 'utf8')
    const { service } = createWorkspaceService(directory, targetPath)
    const replacement =
      await service.prepareProjectDirectoryReplacement('/project/ws_0001')
    if (!replacement) throw new Error('Expected replacement token')
    await mkdir(targetPath, { recursive: true })
    await writeFile(join(targetPath, 'marker.txt'), 'replacement', 'utf8')
    await service.setProjectDirectoryReplacementRecoveryMode(replacement.id, 'retain')
    await writeFile(
      join(directory, 'project.json'),
      JSON.stringify({
        workspaces: [{ workspace_path: replacement.backupPath }],
      }),
      'utf8',
    )

    const { service: restartedService } = createWorkspaceService(directory, targetPath)
    await restartedService.recoverProjectDirectoryReplacements()

    await expect(readFile(join(targetPath, 'marker.txt'), 'utf8')).resolves.toBe(
      'replacement',
    )
    await expect(
      readFile(join(replacement.backupPath, 'marker.txt'), 'utf8'),
    ).resolves.toBe('original')
  })

  it('continues recovering valid replacements when another journal is malformed', async () => {
    const directory = await createTempDir('ecos-workspace-service-recovery-isolation-')
    const targetPath = join(directory, 'ws_0001')
    await mkdir(targetPath, { recursive: true })
    await writeFile(join(targetPath, 'marker.txt'), 'original', 'utf8')
    const { service } = createWorkspaceService(directory, targetPath)
    const replacement =
      await service.prepareProjectDirectoryReplacement('/project/ws_0001')
    if (!replacement) throw new Error('Expected replacement token')
    const journalDirectory = join(directory, '.workspace-replacement-journals')
    await writeFile(join(journalDirectory, 'broken.json'), '{', 'utf8')

    const { service: restartedService } = createWorkspaceService(directory, targetPath)
    await expect(restartedService.recoverProjectDirectoryReplacements()).rejects.toThrow(
      'Unable to read workspace replacement journal',
    )
    await expect(readFile(join(targetPath, 'marker.txt'), 'utf8')).resolves.toBe(
      'original',
    )
  })

  it('recovers a journal whose backup child begins with two dots', async () => {
    const directory = await createTempDir('ecos-workspace-service-recovery-dot-child-')
    const targetPath = join(directory, '.ws_0001')
    await mkdir(targetPath, { recursive: true })
    await writeFile(join(targetPath, 'marker.txt'), 'original', 'utf8')
    const { service } = createWorkspaceService(directory, targetPath)
    const replacement =
      await service.prepareProjectDirectoryReplacement('/project/.ws_0001')
    if (!replacement) throw new Error('Expected replacement token')

    expect(replacement.backupPath).toMatch(/\/\.\.ws_0001\.replace-backup-/)

    const { service: restartedService } = createWorkspaceService(directory, targetPath)
    await restartedService.recoverProjectDirectoryReplacements()

    await expect(readFile(join(targetPath, 'marker.txt'), 'utf8')).resolves.toBe(
      'original',
    )
  })

  it('restores a prepared replacement by replacing a partial target with the backup', async () => {
    const directory = await createTempDir('ecos-workspace-service-restore-dir-')
    const targetPath = join(directory, 'ws_0001')
    await mkdir(join(targetPath, 'home'), { recursive: true })
    await writeFile(join(targetPath, 'origin.v'), 'module top; endmodule', 'utf8')

    const { service } = createWorkspaceService(directory, targetPath)
    const replacement =
      await service.prepareProjectDirectoryReplacement('/project/ws_0001')
    if (!replacement) throw new Error('Expected replacement token')
    await mkdir(join(targetPath, 'home'), { recursive: true })
    await writeFile(join(targetPath, 'home', 'parameters.json'), '{}', 'utf8')

    await expect(
      service.restoreProjectDirectoryReplacement(replacement.id),
    ).resolves.toBeUndefined()

    await expect(readFile(join(targetPath, 'origin.v'), 'utf8')).resolves.toBe(
      'module top; endmodule',
    )
    await expect(
      readFile(join(replacement.backupPath, 'origin.v'), 'utf8'),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('refuses to restore when the replacement backup is missing', async () => {
    const directory = await createTempDir(
      'ecos-workspace-service-restore-missing-backup-',
    )
    const targetPath = join(directory, 'ws_0001')
    await mkdir(join(targetPath, 'home'), { recursive: true })
    await writeFile(join(targetPath, 'origin.v'), 'module top; endmodule', 'utf8')

    const { service } = createWorkspaceService(directory, targetPath)
    const replacement =
      await service.prepareProjectDirectoryReplacement('/project/ws_0001')
    if (!replacement) throw new Error('Expected replacement token')
    await mkdir(join(targetPath, 'home'), { recursive: true })
    await writeFile(join(targetPath, 'home', 'parameters.json'), '{}', 'utf8')
    await rm(replacement.backupPath, { force: true, recursive: true })

    await expect(
      service.restoreProjectDirectoryReplacement(replacement.id),
    ).rejects.toThrow('Workspace replacement backup is missing')

    await expect(
      readFile(join(targetPath, 'home', 'parameters.json'), 'utf8'),
    ).resolves.toBe('{}')
  })

  it('finalizes a prepared replacement by removing the backup directory', async () => {
    const directory = await createTempDir('ecos-workspace-service-finalize-dir-')
    const targetPath = join(directory, 'ws_0001')
    await mkdir(join(targetPath, 'origin'), { recursive: true })
    await writeFile(join(targetPath, 'origin', 'top.v'), 'module top; endmodule', 'utf8')

    const { service } = createWorkspaceService(directory, targetPath)
    const replacement =
      await service.prepareProjectDirectoryReplacement('/project/ws_0001')
    if (!replacement) throw new Error('Expected replacement token')

    await expect(
      service.finalizeProjectDirectoryReplacement(replacement.id),
    ).resolves.toBeUndefined()

    await expect(
      readFile(join(replacement.backupPath, 'origin', 'top.v'), 'utf8'),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('rejects unknown or previously consumed replacement ids', async () => {
    const directory = await createTempDir('ecos-workspace-service-replacement-id-')
    const targetPath = join(directory, 'ws_0001')
    await mkdir(targetPath, { recursive: true })
    await writeFile(join(targetPath, 'marker.txt'), 'retained', 'utf8')

    const { service } = createWorkspaceService(directory, targetPath)
    await expect(service.finalizeProjectDirectoryReplacement('unknown')).rejects.toThrow(
      'Workspace replacement is missing',
    )

    const replacement =
      await service.prepareProjectDirectoryReplacement('/project/ws_0001')
    if (!replacement) throw new Error('Expected replacement token')
    await service.retainProjectDirectoryReplacement(replacement.id)

    await expect(
      service.restoreProjectDirectoryReplacement(replacement.id),
    ).rejects.toThrow('Workspace replacement is missing')
    await expect(
      readFile(join(replacement.backupPath, 'marker.txt'), 'utf8'),
    ).resolves.toBe('retained')
  })

  it('blocks configuration writes while the workspace runtime is active', async () => {
    const directory = await createTempDir('ecos-workspace-service-write-lock-')
    const filePath = join(directory, 'home', 'parameters.json')
    const runtimeMutationGuard = {
      isWorkspaceRuntimeActive: vi.fn().mockReturnValue(true),
    }

    const { service } = createWorkspaceService(directory, filePath, {
      runtimeMutationGuard,
    })

    await expect(
      service.writeProjectTextFile('/workspace/home/parameters.json', '{"PDK":"ics55"}'),
    ).rejects.toThrow('workspace flow is running')

    await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(runtimeMutationGuard.isWorkspaceRuntimeActive).toHaveBeenCalledWith(directory)
  })

  it('blocks step config writes while the workspace runtime is active', async () => {
    const directory = await createTempDir('ecos-workspace-service-step-config-lock-')
    const filePath = join(directory, 'config', 'cts_ecc.json')
    const runtimeMutationGuard = {
      isWorkspaceRuntimeActive: vi.fn().mockReturnValue(true),
    }

    const { service } = createWorkspaceService(directory, filePath, {
      runtimeMutationGuard,
    })

    await expect(
      service.writeProjectTextFile(
        '/workspace/config/cts_ecc.json',
        '{"skew_bound":0.1}',
      ),
    ).rejects.toThrow('workspace flow is running')

    await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(runtimeMutationGuard.isWorkspaceRuntimeActive).toHaveBeenCalledWith(directory)
  })

  it('watches a project-scoped file through the validated canonical path', async () => {
    const directory = await createTempDir('ecos-workspace-service-watch-')
    const filePath = join(directory, 'flow.json')
    await writeFile(filePath, '{"steps":[]}', 'utf8')

    const { projectScopeProvider, service } = createWorkspaceService(directory, filePath)

    const listener = vi.fn()
    const subscriptionId = await service.watchProjectFile(
      '/workspace/home/flow.json',
      listener,
    )

    expect(subscriptionId).toMatch(/^project-file-watch-/)
    expect(projectScopeProvider.requestProjectPathAccess).toHaveBeenCalledWith(
      '/workspace/home/flow.json',
    )

    await service.unwatchProjectFile(subscriptionId)
  })

  it('emits change events for an existing watched file', async () => {
    const directory = await createTempDir('ecos-workspace-service-watch-change-')
    const filePath = join(directory, 'flow.json')
    await writeFile(filePath, '{"steps":[]}', 'utf8')

    const { service } = createWorkspaceService(directory, filePath)
    const listener = vi.fn()
    const subscriptionId = await service.watchProjectFile(
      '/workspace/home/flow.json',
      listener,
    )

    try {
      await writeFile(join(directory, 'unrelated.log'), 'noise', 'utf8')
      await delay(100)
      expect(listener).not.toHaveBeenCalled()

      await writeFile(filePath, '{"steps":[{"state":"ongoing"}]}', 'utf8')
      await waitForProjectFileEvent(listener, {
        subscriptionId,
        path: filePath,
        eventType: 'change',
      })

      listener.mockClear()
      await appendFile(filePath, '\nmore log-like content', 'utf8')
      await waitForProjectFileEvent(listener, {
        subscriptionId,
        path: filePath,
        eventType: 'change',
      })
    } finally {
      await service.unwatchProjectFile(subscriptionId)
    }
  })

  it('emits when a missing watched file is created later', async () => {
    const directory = await createTempDir('ecos-workspace-service-watch-missing-')
    const filePath = join(directory, 'CTS_ecc', 'log', 'CTS.log')
    await mkdir(join(directory, 'CTS_ecc', 'log'), { recursive: true })

    const { projectScopeProvider, service } = createWorkspaceService(directory, filePath)

    const listener = vi.fn()
    const subscriptionId = await service.watchProjectFile(
      '/workspace/CTS_ecc/log/CTS.log',
      listener,
    )

    try {
      expect(projectScopeProvider.requestProjectPathAccess).toHaveBeenCalledWith(
        '/workspace/CTS_ecc/log/CTS.log',
      )

      await writeFile(filePath, 'created after watch', 'utf8')
      await waitForProjectFileEvent(listener, {
        subscriptionId,
        path: filePath,
        eventType: 'change',
      })
    } finally {
      await service.unwatchProjectFile(subscriptionId)
    }
  })

  it('falls back to the project root when parent directories do not exist yet', async () => {
    const directory = await createTempDir('ecos-workspace-service-watch-root-fallback-')
    const filePath = join(directory, 'legalization_dreamplace', 'log', 'legalization.log')
    const { projectScopeProvider, service } = createWorkspaceService(directory, filePath)

    const listener = vi.fn()
    const subscriptionId = await service.watchProjectFile(
      '/workspace/legalization_dreamplace/log/legalization.log',
      listener,
    )

    try {
      expect(projectScopeProvider.requestProjectPathAccess).toHaveBeenCalledWith(
        '/workspace/legalization_dreamplace/log/legalization.log',
      )
      expect(projectScopeProvider.getProjectRoot).toHaveBeenCalledTimes(1)

      await mkdir(join(directory, 'legalization_dreamplace', 'log'), { recursive: true })
      await writeFile(filePath, 'created under missing parents', 'utf8')
      await waitForProjectFileEvent(listener, {
        subscriptionId,
        path: filePath,
        eventType: 'change',
      })
    } finally {
      await service.unwatchProjectFile(subscriptionId)
    }
  })

  it('emits when the watched file is replaced by rename', async () => {
    const directory = await createTempDir('ecos-workspace-service-watch-replace-')
    const filePath = join(directory, 'flow.json')
    const replacementPath = join(directory, 'flow.json.tmp')
    await writeFile(filePath, '{"steps":[]}', 'utf8')

    const { service } = createWorkspaceService(directory, filePath)
    const listener = vi.fn()
    const subscriptionId = await service.watchProjectFile(
      '/workspace/home/flow.json',
      listener,
    )

    try {
      await writeFile(replacementPath, '{"steps":[{"state":"complete"}]}', 'utf8')
      await rename(replacementPath, filePath)

      await vi.waitFor(
        () => {
          expect(listener).toHaveBeenCalledWith(
            expect.objectContaining({
              subscriptionId,
              path: filePath,
            }),
          )
          const events = listener.mock.calls.map(([event]) => event.eventType)
          expect(
            events.some((eventType) => eventType === 'change' || eventType === 'rename'),
          ).toBe(true)
        },
        { timeout: 3000 },
      )
    } finally {
      await service.unwatchProjectFile(subscriptionId)
    }
  })

  it('does not emit after unwatching a project file', async () => {
    const directory = await createTempDir('ecos-workspace-service-watch-unwatch-')
    const filePath = join(directory, 'flow.json')
    await writeFile(filePath, '{"steps":[]}', 'utf8')

    const { service } = createWorkspaceService(directory, filePath)
    const listener = vi.fn()
    const subscriptionId = await service.watchProjectFile(
      '/workspace/home/flow.json',
      listener,
    )

    await service.unwatchProjectFile(subscriptionId)
    await writeFile(filePath, '{"steps":[{"state":"ongoing"}]}', 'utf8')
    await delay(150)

    expect(listener).not.toHaveBeenCalled()
  })
})

describe('editWorkspaceParameters', () => {
  it('refuses to edit parameters through a symlinked config file', async () => {
    const directory = await createTempDir('ecos-workspace-service-')
    const homeDir = join(directory, 'home')
    await mkdir(homeDir, { recursive: true })
    const externalPath = join(directory, 'external.toml')
    await writeFile(externalPath, '[params]\ndesign = "gcd"\n', 'utf8')
    await symlink(externalPath, join(homeDir, 'params.toml'))

    const { service } = createWorkspaceService(directory, externalPath)

    await expect(
      service.editWorkspaceParameters(directory, [{ json_path: ['design'], value: 'x' }]),
    ).rejects.toThrow(/symlink/i)
    await expect(readFile(externalPath, 'utf8')).resolves.toBe(
      '[params]\ndesign = "gcd"\n',
    )
  })

  it('refuses to edit parameters in a nested workspace under the active root', async () => {
    const directory = await createTempDir('ecos-workspace-service-')
    const nested = join(directory, 'archive', 'other')
    await mkdir(join(nested, 'home'), { recursive: true })
    const tomlPath = join(nested, 'home', 'params.toml')
    await writeFile(tomlPath, '[params]\ndesign = "gcd"\n', 'utf8')

    const { service } = createWorkspaceService(directory, tomlPath)
    await expect(
      service.editWorkspaceParameters(nested, [{ json_path: ['design'], value: 'x' }]),
    ).rejects.toThrow(/not the active workspace/)
    await expect(readFile(tomlPath, 'utf8')).resolves.toBe('[params]\ndesign = "gcd"\n')
  })

  it('edits parameters in a real params.toml file', async () => {
    const directory = await createTempDir('ecos-workspace-service-')
    const homeDir = join(directory, 'home')
    await mkdir(homeDir, { recursive: true })
    const tomlPath = join(homeDir, 'params.toml')
    await writeFile(tomlPath, '[params]\ndesign = "gcd"\n', 'utf8')

    const { service } = createWorkspaceService(directory, tomlPath)
    const result = await service.editWorkspaceParameters(directory, [
      { json_path: ['design'], value: 'updated' },
    ])

    expect(result.format).toBe('toml')
    await expect(readFile(tomlPath, 'utf8')).resolves.toContain('design = "updated"')
  })
})

describe('applyWorkspaceParameterWrites', () => {
  function createApplyService(rootPath: string): WorkspaceService {
    const projectScopeProvider = createProjectScopeProvider(rootPath, rootPath)
    projectScopeProvider.requestWritableProjectPathAccess = vi.fn(
      async (path: string) => path,
    )
    return new WorkspaceService({
      projectScopeProvider,
      replacementJournalDirectory: join(rootPath, '.workspace-replacement-journals'),
    })
  }

  it('rolls back the parameter file when a later step-config write fails', async () => {
    const directory = await createTempDir('ecos-workspace-service-apply-rollback-')
    await mkdir(join(directory, 'home'), { recursive: true })
    await mkdir(join(directory, 'config'), { recursive: true })
    const tomlPath = join(directory, 'home', 'params.toml')
    const original = '[params]\ndesign = "gcd"\nmax_fanout = 20\n'
    await writeFile(tomlPath, original, 'utf8')
    await writeFile(
      join(directory, 'config', 'dreamplace_ecc.json'),
      '{\n    "other_key": 1\n}\n',
      'utf8',
    )

    const service = createApplyService(directory)
    await expect(
      service.applyWorkspaceParameterWrites(directory, [
        {
          file: 'home/params.toml',
          json_path: ['max_fanout'],
          knob_id: 'cts.max_fanout',
          surface: 'parameters',
          value: 64,
        },
        {
          file: 'config/dreamplace_ecc.json',
          json_path: ['density_weight'],
          knob_id: 'place.density_weight',
          surface: 'step_config',
          value: 0.1,
        },
      ]),
    ).rejects.toThrow(/does not exist/)

    await expect(readFile(tomlPath, 'utf8')).resolves.toBe(original)
  })

  it('applies parameter and step-config writes together', async () => {
    const directory = await createTempDir('ecos-workspace-service-apply-ok-')
    await mkdir(join(directory, 'home'), { recursive: true })
    await mkdir(join(directory, 'config'), { recursive: true })
    const tomlPath = join(directory, 'home', 'params.toml')
    const stepPath = join(directory, 'config', 'dreamplace_ecc.json')
    await writeFile(tomlPath, '[params]\ndesign = "gcd"\nmax_fanout = 20\n', 'utf8')
    await writeFile(stepPath, '{\n    "density_weight": 0.2\n}\n', 'utf8')

    const service = createApplyService(directory)
    await service.applyWorkspaceParameterWrites(directory, [
      {
        file: 'home/params.toml',
        json_path: ['max_fanout'],
        knob_id: 'cts.max_fanout',
        surface: 'parameters',
        value: 64,
      },
      {
        file: 'config/dreamplace_ecc.json',
        json_path: ['density_weight'],
        knob_id: 'place.density_weight',
        surface: 'step_config',
        value: 0.1,
      },
    ])

    await expect(readFile(tomlPath, 'utf8')).resolves.toContain('max_fanout = 64')
    await expect(readFile(stepPath, 'utf8')).resolves.toContain('"density_weight": 0.1')
  })

  it('serializes step-config editor saves behind the parameter write queue', async () => {
    const directory = await createTempDir('ecos-workspace-service-step-config-queue-')
    await mkdir(join(directory, 'home'), { recursive: true })
    await mkdir(join(directory, 'config'), { recursive: true })
    const stepPath = join(directory, 'config', 'dreamplace_ecc.json')
    await writeFile(stepPath, '{\n    "density_weight": 0.2\n}\n', 'utf8')

    const { enqueueParameterWrite, workspaceParameterWriteQueueKey } =
      await import('./workspaceParametersFile')
    const queueKey = await workspaceParameterWriteQueueKey(directory)
    let release!: () => void
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate
    })
    const hold = enqueueParameterWrite(queueKey, async () => {
      await gate
    })

    const service = createApplyService(directory)
    const editorContent = '{\n    "density_weight": 0.8,\n    "extra": true\n}\n'
    const editor = service.writeProjectTextFile(stepPath, editorContent)

    let editorDone = false
    void editor.then(() => {
      editorDone = true
    })
    await delay(50)
    expect(editorDone).toBe(false)
    await expect(readFile(stepPath, 'utf8')).resolves.toBe(
      '{\n    "density_weight": 0.2\n}\n',
    )

    release()
    await hold
    await editor
    await expect(readFile(stepPath, 'utf8')).resolves.toBe(editorContent)
  })

  it('lets a later agent step-config RMW observe a queued editor save', async () => {
    const directory = await createTempDir('ecos-workspace-service-step-config-overlap-')
    await mkdir(join(directory, 'home'), { recursive: true })
    await mkdir(join(directory, 'config'), { recursive: true })
    const tomlPath = join(directory, 'home', 'params.toml')
    const stepPath = join(directory, 'config', 'dreamplace_ecc.json')
    await writeFile(tomlPath, '[params]\ndesign = "gcd"\nmax_fanout = 20\n', 'utf8')
    await writeFile(stepPath, '{\n    "density_weight": 0.2\n}\n', 'utf8')

    const { enqueueParameterWrite, workspaceParameterWriteQueueKey } =
      await import('./workspaceParametersFile')
    const queueKey = await workspaceParameterWriteQueueKey(directory)
    let release!: () => void
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate
    })
    const hold = enqueueParameterWrite(queueKey, async () => {
      await gate
    })

    const service = createApplyService(directory)
    const editorContent = '{\n    "density_weight": 0.8,\n    "extra": true\n}\n'
    const editor = service.writeProjectTextFile(stepPath, editorContent)
    await delay(20)
    const agent = service.applyWorkspaceParameterWrites(directory, [
      {
        file: 'config/dreamplace_ecc.json',
        json_path: ['density_weight'],
        knob_id: 'place.density_weight',
        surface: 'step_config',
        value: 0.1,
      },
    ])

    release()
    await hold
    await Promise.all([agent, editor])

    const finalDocument = JSON.parse(await readFile(stepPath, 'utf8')) as {
      density_weight: number
      extra?: boolean
    }
    // Without the shared queue the agent can read 0.2, the editor can land
    // `extra`, and the agent rename then drops it. Serialized, the agent
    // RMW sees the editor document and keeps unknown leaves.
    expect(finalDocument.extra).toBe(true)
    expect(finalDocument.density_weight).toBe(0.1)
  })

  it('refuses a queued config-editor save after the active workspace changes', async () => {
    const workspaceA = await createTempDir('ecos-workspace-service-editor-root-a-')
    const workspaceB = await createTempDir('ecos-workspace-service-editor-root-b-')
    await mkdir(join(workspaceA, 'home'), { recursive: true })
    await mkdir(join(workspaceA, 'config'), { recursive: true })
    const stepPath = join(workspaceA, 'config', 'dreamplace_ecc.json')
    const original = '{\n    "density_weight": 0.2\n}\n'
    await writeFile(stepPath, original, 'utf8')

    const projectScopeProvider = createProjectScopeProvider(workspaceA, workspaceA)
    projectScopeProvider.requestWritableProjectPathAccess = vi.fn(
      async (path: string) => path,
    )
    let activeRoot = workspaceA
    projectScopeProvider.getProjectRoot = vi.fn(async () => activeRoot)
    const service = new WorkspaceService({
      projectScopeProvider,
      replacementJournalDirectory: join(workspaceA, '.workspace-replacement-journals'),
    })

    const { enqueueParameterWrite, workspaceParameterWriteQueueKey } =
      await import('./workspaceParametersFile')
    const queueKey = await workspaceParameterWriteQueueKey(workspaceA)
    let release!: () => void
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate
    })
    const hold = enqueueParameterWrite(queueKey, async () => {
      await gate
    })

    const editor = service.writeProjectTextFile(
      stepPath,
      '{\n    "density_weight": 0.8\n}\n',
    )
    await delay(20)
    activeRoot = workspaceB
    release()
    await hold
    await expect(editor).rejects.toThrow(/active workspace/)
    await expect(readFile(stepPath, 'utf8')).resolves.toBe(original)
  })
})
