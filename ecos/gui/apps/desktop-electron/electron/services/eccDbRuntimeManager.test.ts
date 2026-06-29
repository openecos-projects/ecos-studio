import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EccDbRuntimeManager,
  type EccDbRuntimeAdapter,
  type EccDbRuntimeResult,
} from './eccDbRuntimeManager'
import { WorkspaceService } from './workspaceService'

const tempDirectories: string[] = []
type ProjectScopeProviderDouble = ConstructorParameters<typeof WorkspaceService>[0]['projectScopeProvider']

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

async function createTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix))
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

describe('EccDbRuntimeManager', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirectories.splice(0).map((directory) =>
        rm(directory, { force: true, recursive: true }),
      ),
    )
  })

  it('represents mutating DB lifecycle work as active workspace runtime activity', async () => {
    const workspaceRoot = await createTempDir('ecos-db-runtime-workspace-')
    const runtimeLockRoot = await createTempDir('ecos-db-runtime-locks-')
    const filePath = path.join(workspaceRoot, 'home', 'parameters.json')
    await mkdir(path.dirname(filePath), { recursive: true })
    const dbResult: EccDbRuntimeResult = {
      ok: true,
      operation: 'initialize',
      status: 'success',
    }
    const pendingDb = createDeferred<EccDbRuntimeResult>()
    const adapter: EccDbRuntimeAdapter = {
      execute: vi.fn(async (_request, context) => {
        context.emit({
          message: 'initializing DB',
          type: 'progress',
        })
        return await pendingDb.promise
      }),
    }
    const manager = new EccDbRuntimeManager({
      adapter,
      runtimeLockRoot,
    })
    const workspaceService = new WorkspaceService({
      projectScopeProvider: createProjectScopeProvider(workspaceRoot, filePath),
      runtimeMutationGuard: manager,
    })
    const listener = vi.fn()

    const run = manager.execute({
      directory: workspaceRoot,
      operation: 'initialize',
      step: 'floorplan',
    }, listener)

    await vi.waitFor(async () => {
      expect(adapter.execute).toHaveBeenCalledTimes(1)
      await expect(manager.isWorkspaceRuntimeActive(workspaceRoot)).resolves.toBe(true)
    })
    await expect(
      workspaceService.writeProjectTextFile('/workspace/home/parameters.json', '{"PDK":"ics55"}'),
    ).rejects.toThrow('workspace flow is running')

    pendingDb.resolve(dbResult)
    await expect(run).resolves.toEqual(dbResult)
    await expect(manager.isWorkspaceRuntimeActive(workspaceRoot)).resolves.toBe(false)
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      directory: workspaceRoot,
      operation: 'initialize',
      step: 'floorplan',
      type: 'progress',
      workspaceId: workspaceRoot,
    }))
    const jobIds = listener.mock.calls.map(([event]) => event.jobId)
    expect(new Set(jobIds).size).toBe(1)

    await expect(
      workspaceService.writeProjectTextFile('/workspace/home/parameters.json', '{"PDK":"ics55"}'),
    ).resolves.toBeUndefined()
    await expect(readFile(filePath, 'utf8')).resolves.toBe('{"PDK":"ics55"}')
  })

  it('does not block protected workspace writes for non-mutating DB lifecycle work', async () => {
    const workspaceRoot = await createTempDir('ecos-db-runtime-readonly-workspace-')
    const runtimeLockRoot = path.join(tmpdir(), `ecos-db-runtime-locks-${randomUUID()}`)
    const filePath = path.join(workspaceRoot, 'config', 'db_default_config.json')
    await mkdir(path.dirname(filePath), { recursive: true })
    const pendingDb = createDeferred<EccDbRuntimeResult>()
    const adapter: EccDbRuntimeAdapter = {
      execute: vi.fn(async () => await pendingDb.promise),
    }
    const manager = new EccDbRuntimeManager({
      adapter,
      runtimeLockRoot,
    })
    const workspaceService = new WorkspaceService({
      projectScopeProvider: createProjectScopeProvider(workspaceRoot, filePath),
      runtimeMutationGuard: manager,
    })

    const run = manager.execute({
      directory: workspaceRoot,
      mutatesWorkspace: false,
      operation: 'export',
    })

    await vi.waitFor(async () => {
      expect(adapter.execute).toHaveBeenCalledTimes(1)
      await expect(manager.isWorkspaceRuntimeActive(workspaceRoot)).resolves.toBe(false)
    })
    await expect(
      workspaceService.writeProjectTextFile('/workspace/config/db_default_config.json', '{}'),
    ).resolves.toBeUndefined()

    pendingDb.resolve({
      ok: true,
      operation: 'export',
      status: 'success',
    })
    await expect(run).resolves.toEqual({
      ok: true,
      operation: 'export',
      status: 'success',
    })
  })
})
