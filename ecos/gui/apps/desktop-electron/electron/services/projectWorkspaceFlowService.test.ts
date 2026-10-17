import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectManifest } from '@ecos-studio/shared'
import { ProjectWorkspaceFlowService } from './projectWorkspaceFlowService'
import { readProjectManifest } from './eccCli/persistedState'
import type { ProjectComparisonFileWatcherCallbacks } from './projectComparisonFileWatcher'

const directories: string[] = []
const services: ProjectWorkspaceFlowService[] = []

async function fixture(
  authorizeProject: (root: string) => Promise<string> = async (root) => root,
) {
  const root = await mkdtemp(join(tmpdir(), 'ecos-visible-flows-'))
  directories.push(root)
  for (const id of ['ws_1', 'ws_2']) {
    await mkdir(join(root, id, 'home'), { recursive: true })
    await saveFlow(root, id, 'Success')
  }
  await writeFile(
    join(root, 'project.json'),
    JSON.stringify({
      schema_version: 1,
      project_id: 'project',
      name: 'demo',
      design_name: 'gcd',
      root_path: root,
      base_design: {},
      objectives: {},
      workspaces: ['ws_1', 'ws_2'].map((id) => ({
        workspace_id: id,
        workspace_path: id,
        status: 'not_started',
      })),
    }),
  )
  const project = await readProjectManifest(root)
  const readManifest = vi.fn(async () => project)
  const processIsAlive = vi.fn(async () => true)
  const watchers: Array<{
    callbacks: ProjectComparisonFileWatcherCallbacks
    startProject: ReturnType<typeof vi.fn>
    reconcile: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
  }> = []
  const service = new ProjectWorkspaceFlowService(
    authorizeProject,
    processIsAlive,
    readManifest,
    (callbacks) => {
      const watcher = {
        callbacks,
        startProject: vi.fn(async () => undefined),
        reconcile: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
      }
      watchers.push(watcher)
      return watcher as never
    },
  )
  services.push(service)
  return { root, project, readManifest, processIsAlive, watchers, service }
}

async function saveFlow(root: string, id: string, state: string) {
  await writeFile(
    join(root, id, 'home', 'flow.json'),
    JSON.stringify({ schema_version: 1, steps: [{ name: 'Synthesis', state }] }),
  )
}

function registerProcess(project: ProjectManifest, root: string) {
  project.runtime_processes = {
    ws_1: {
      schema_version: 1,
      run_id: 'run-1',
      pid: 123,
      pgid: 123,
      process_start_id: '100',
      boot_id: 'boot',
      host_id: 'host',
      workspace_path: join(root, 'ws_1'),
      started_at: 1,
      runtime_id: 'external:ecc',
      log_path: 'home/run.log',
    },
  }
}

describe('ProjectWorkspaceFlowService', () => {
  afterEach(async () => {
    for (const service of services.splice(0)) {
      service.clearWindow(1)
      service.clearWindow(2)
    }
    await Promise.all(
      directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    )
    vi.useRealTimers()
  })

  it('reads and watches only requested rows, caches them, and invalidates only the changed flow', async () => {
    const { root, service, watchers, processIsAlive } = await fixture()
    const request = { projects: [{ projectRoot: root, workspaceIds: ['ws_1'] }] }
    expect(await service.watch(1, request)).toEqual({
      [root]: { ws_1: { steps: { Synthesis: 'success' }, running: false } },
    })
    expect(watchers[0]!.reconcile).toHaveBeenCalledWith(root, [join(root, 'ws_1')])
    await saveFlow(root, 'ws_1', 'Incomplete')
    await writeFile(join(root, 'ws_2', 'home', 'flow.json'), 'invalid hidden data')
    expect((await service.watch(1, request))[root]!.ws_1!.steps).toEqual({
      Synthesis: 'success',
    })
    watchers[0]!.callbacks.onSnapshotChanged(join(root, 'ws_1'))
    expect(await service.watch(1, request)).toEqual({
      [root]: { ws_1: { steps: { Synthesis: 'failed' }, running: false } },
    })
    expect(processIsAlive).not.toHaveBeenCalled()
  })

  it('waits for a transient Project Management authorization race', async () => {
    const denied = Object.assign(new Error('Project scope is still registering'), {
      code: 'PROJECT_PATH_ACCESS_DENIED',
    })
    const authorizeProject = vi
      .fn<(root: string) => Promise<string>>()
      .mockRejectedValueOnce(denied)
      .mockImplementationOnce(async (root) => root)
    const { root, service } = await fixture(authorizeProject)
    vi.useFakeTimers()

    const result = service.watch(1, {
      projects: [{ projectRoot: root, workspaceIds: ['ws_1'] }],
    })
    await vi.advanceTimersByTimeAsync(500)

    await expect(result).resolves.toEqual({
      [root]: { ws_1: { steps: { Synthesis: 'success' }, running: false } },
    })
  })

  it('closes watchers when rows disappear and reads new facts when expanded again', async () => {
    const { root, service, watchers } = await fixture()
    const request = { projects: [{ projectRoot: root, workspaceIds: ['ws_1'] }] }
    await service.watch(1, request)
    expect(await service.watch(1, { projects: [] })).toEqual({})
    expect(watchers[0]!.close).toHaveBeenCalledOnce()
    await saveFlow(root, 'ws_1', 'Unstart')
    expect((await service.watch(1, request))[root]!.ws_1!.steps).toEqual({
      Synthesis: 'unstart',
    })
  })

  it('preserves actual flow steps that share a Project Management phase', async () => {
    const { root, service } = await fixture()
    await writeFile(
      join(root, 'ws_1', 'home', 'flow.json'),
      JSON.stringify({
        schema_version: 1,
        steps: [
          { name: 'preFloorplan', state: 'Success' },
          { name: 'macroPlacement', state: 'Success' },
          { name: 'postFloorplan', state: 'Unstart' },
        ],
      }),
    )
    expect(
      await service.watch(1, {
        projects: [{ projectRoot: root, workspaceIds: ['ws_1'] }],
      }),
    ).toEqual({
      [root]: {
        ws_1: {
          steps: {
            preFloorplan: 'success',
            macroPlacement: 'success',
            postFloorplan: 'unstart',
          },
          running: false,
        },
      },
    })
  })

  it('reports a stale Ongoing ledger as interrupted and checks only registered processes', async () => {
    const { root, service, project, processIsAlive } = await fixture()
    await saveFlow(root, 'ws_1', 'Ongoing')
    const request = { projects: [{ projectRoot: root, workspaceIds: ['ws_1'] }] }
    expect((await service.watch(1, request))[root]!.ws_1).toMatchObject({
      issue: 'interrupted',
      running: false,
    })
    expect(processIsAlive).not.toHaveBeenCalled()
    service.clearWindow(1)
    registerProcess(project, root)
    expect((await service.watch(1, request))[root]!.ws_1).toEqual({
      steps: { Synthesis: 'running' },
      running: true,
    })
    expect(processIsAlive).toHaveBeenCalledWith(root, 'ws_1', 'run-1')
  })

  it('keeps a completed flow visible when process inspection is unavailable', async () => {
    const { root, service, project, processIsAlive } = await fixture()
    registerProcess(project, root)
    await saveFlow(root, 'ws_1', 'Success')
    processIsAlive.mockRejectedValueOnce(new Error('process inspect unavailable'))

    expect(
      (
        await service.watch(1, {
          projects: [{ projectRoot: root, workspaceIds: ['ws_1'] }],
        })
      )[root]!.ws_1,
    ).toEqual({
      steps: { Synthesis: 'success' },
      running: false,
    })
  })

  it('rechecks only visible running rows so force-killed processes stop showing Running', async () => {
    const { root, service, project, processIsAlive } = await fixture()
    vi.useFakeTimers()
    registerProcess(project, root)
    await saveFlow(root, 'ws_1', 'Ongoing')
    const changed = vi.fn()
    service.onChanged(changed)
    const request = { projects: [{ projectRoot: root, workspaceIds: ['ws_1', 'ws_2'] }] }
    await service.watch(1, request)
    processIsAlive.mockResolvedValue(false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(changed).toHaveBeenCalledWith(1)
    expect((await service.watch(1, request))[root]!.ws_1).toMatchObject({
      issue: 'interrupted',
      running: false,
    })
    expect(processIsAlive).toHaveBeenCalledTimes(2)
    await service.watch(1, { projects: [] })
    changed.mockClear()
    await vi.advanceTimersByTimeAsync(10000)
    expect(changed).not.toHaveBeenCalled()
  })

  it('rechecks interrupted rows after a transient process inspection miss', async () => {
    const { root, service, project, processIsAlive } = await fixture()
    vi.useFakeTimers()
    registerProcess(project, root)
    await saveFlow(root, 'ws_1', 'Ongoing')
    processIsAlive.mockResolvedValueOnce(false).mockResolvedValue(true)
    const request = { projects: [{ projectRoot: root, workspaceIds: ['ws_1'] }] }

    expect((await service.watch(1, request))[root]!.ws_1).toMatchObject({
      issue: 'interrupted',
      running: false,
    })
    await vi.advanceTimersByTimeAsync(5000)
    expect((await service.watch(1, request))[root]!.ws_1).toEqual({
      steps: { Synthesis: 'running' },
      running: true,
    })
  })

  it('keeps missing, corrupt and unsupported flow states unavailable instead of Not started', async () => {
    const { root, service } = await fixture()
    const request = { projects: [{ projectRoot: root, workspaceIds: ['ws_1', 'ws_2'] }] }
    await rm(join(root, 'ws_1', 'home', 'flow.json'))
    await saveFlow(root, 'ws_2', 'future-state')
    expect(await service.watch(1, request)).toEqual({
      [root]: {
        ws_1: { issue: 'unavailable', running: false, steps: {} },
        ws_2: { issue: 'unavailable', running: false, steps: {} },
      },
    })
    service.clearWindow(1)
    await writeFile(join(root, 'ws_2', 'home', 'flow.json'), '{')
    expect((await service.watch(1, request))[root]!.ws_2!.issue).toBe('unavailable')
  })

  it('rejects undeclared IDs and does not follow flow symlinks outside the workspace', async () => {
    const { root, service } = await fixture()
    const external = join(root, 'external.json')
    await writeFile(external, await readFile(join(root, 'ws_1', 'home', 'flow.json')))
    await rm(join(root, 'ws_1', 'home', 'flow.json'))
    await symlink(external, join(root, 'ws_1', 'home', 'flow.json'))
    expect(
      (
        await service.watch(1, {
          projects: [{ projectRoot: root, workspaceIds: ['ws_1'] }],
        })
      )[root]!.ws_1!.issue,
    ).toBe('unavailable')
    expect(
      (
        await service.watch(1, {
          projects: [{ projectRoot: root, workspaceIds: ['unknown'] }],
        })
      )[root]!.unknown!.issue,
    ).toBe('unavailable')
    await expect(
      service.watch(1, {
        projects: [{ projectRoot: root, workspaceIds: ['ws_1', 'ws_1'] }],
      }),
    ).rejects.toThrow('Invalid visible Workspace')
  })

  it('does not resurrect a watcher after the visible rows were cleared during a read', async () => {
    const { root, service, readManifest, watchers } = await fixture()
    let release!: (manifest: ProjectManifest) => void
    readManifest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const pending = service.watch(1, {
      projects: [{ projectRoot: root, workspaceIds: ['ws_1'] }],
    })
    await vi.waitFor(() => expect(readManifest).toHaveBeenCalledOnce())
    await service.watch(1, { projects: [] })
    release(await readProjectManifest(root))
    await pending
    expect(watchers).toHaveLength(0)
  })

  it('retries unavailable visible state after its files have been restored', async () => {
    const { root, service, processIsAlive } = await fixture()
    vi.useFakeTimers()
    await rm(join(root, 'ws_1', 'home', 'flow.json'))
    const request = { projects: [{ projectRoot: root, workspaceIds: ['ws_1'] }] }
    expect((await service.watch(1, request))[root]!.ws_1!.issue).toBe('unavailable')
    await saveFlow(root, 'ws_1', 'Success')
    await vi.advanceTimersByTimeAsync(5000)
    expect((await service.watch(1, request))[root]!.ws_1).toEqual({
      steps: { Synthesis: 'success' },
      running: false,
    })
    expect(processIsAlive).not.toHaveBeenCalled()
  })

  it('rejects requests that exceed the visible Workspace budget', async () => {
    const { service } = await fixture()
    await expect(
      service.watch(1, {
        projects: [
          {
            projectRoot: '/project',
            workspaceIds: Array.from({ length: 513 }, (_, index) => `ws_${index}`),
          },
        ],
      }),
    ).rejects.toThrow('Too many visible Workspaces')
  })
})
