import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { DesktopProjectFileChangedEvent } from '@ecos-studio/shared'
import { WorkspaceService } from './workspaceService'

const tempDirectories: string[] = []
type ProjectScopeProviderDouble = ConstructorParameters<typeof WorkspaceService>[0]['projectScopeProvider']

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
    isProjectDirectory: vi.fn(),
    registerProjectRoot: vi.fn(),
    requestProjectPathAccess: vi.fn().mockResolvedValue(canonicalPath),
    scanPdkDirectory: vi.fn(),
  }
}

function createWorkspaceService(
  rootPath: string,
  canonicalPath: string,
): {
  projectScopeProvider: ProjectScopeProviderDouble
  service: WorkspaceService
} {
  const projectScopeProvider = createProjectScopeProvider(rootPath, canonicalPath)
  const service = new WorkspaceService({
    projectScopeProvider,
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
  await vi.waitFor(() => {
    expect(listener).toHaveBeenCalledWith(expect.objectContaining(event))
  }, { timeout: 3000 })
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

describe('WorkspaceService', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirectories.splice(0).map((directory) =>
        rm(directory, { force: true, recursive: true }),
      ),
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
      service.readOptionalProjectTextFileTail('/workspace/Synthesis_yosys/log/Synthesis.log', 10),
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
      service.readOptionalProjectTextFileUpdate('/workspace/Route_openroad/log/Route.log', offset, 32),
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
      service.readOptionalProjectTextFileUpdate('/workspace/Route_openroad/log/Route.log', 0, 10),
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
      ).readProjectBinaryFile('/workspace/.ecos/tile-cache/layout/route/cells.bin'),
    ).resolves.toEqual(Uint8Array.from([0x45, 0x43, 0x4f, 0x53]))
    expect(projectScopeProvider.requestProjectPathAccess).toHaveBeenCalledWith(
      '/workspace/.ecos/tile-cache/layout/route/cells.bin',
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
    expect(projectScopeProvider.requestProjectPathAccess).toHaveBeenCalledWith(
      '/workspace/home/parameters.json',
    )
  })

  it('watches a project-scoped file through the validated canonical path', async () => {
    const directory = await createTempDir('ecos-workspace-service-watch-')
    const filePath = join(directory, 'flow.json')
    await writeFile(filePath, '{"steps":[]}', 'utf8')

    const { projectScopeProvider, service } = createWorkspaceService(directory, filePath)

    const listener = vi.fn()
    const subscriptionId = await service.watchProjectFile('/workspace/home/flow.json', listener)

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
    const subscriptionId = await service.watchProjectFile('/workspace/home/flow.json', listener)

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
    const subscriptionId = await service.watchProjectFile('/workspace/CTS_ecc/log/CTS.log', listener)

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
    const subscriptionId = await service.watchProjectFile('/workspace/home/flow.json', listener)

    try {
      await writeFile(replacementPath, '{"steps":[{"state":"complete"}]}', 'utf8')
      await rename(replacementPath, filePath)

      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalledWith(expect.objectContaining({
          subscriptionId,
          path: filePath,
        }))
        const events = listener.mock.calls.map(([event]) => event.eventType)
        expect(events.some((eventType) => eventType === 'change' || eventType === 'rename')).toBe(
          true,
        )
      }, { timeout: 3000 })
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
    const subscriptionId = await service.watchProjectFile('/workspace/home/flow.json', listener)

    await service.unwatchProjectFile(subscriptionId)
    await writeFile(filePath, '{"steps":[{"state":"ongoing"}]}', 'utf8')
    await delay(150)

    expect(listener).not.toHaveBeenCalled()
  })
})
