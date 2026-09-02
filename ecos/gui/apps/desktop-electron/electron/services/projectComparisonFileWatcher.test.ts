import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FSWatcher } from 'chokidar'
import { ProjectComparisonFileWatcher } from './projectComparisonFileWatcher'

class FakeWatcher extends EventEmitter {
  close = vi.fn(async () => undefined)
}

describe('ProjectComparisonFileWatcher', () => {
  afterEach(() => vi.useRealTimers())

  it('watches only manifest and snapshot directories at depth zero and survives replace events', async () => {
    vi.useFakeTimers()
    const created: Array<{
      path: string
      options: Record<string, unknown>
      watcher: FakeWatcher
    }> = []
    const watch = vi.fn((path: string, options: Record<string, unknown>) => {
      const watcher = new FakeWatcher()
      created.push({ path, options, watcher })
      return watcher as unknown as FSWatcher
    })
    const onManifestChanged = vi.fn()
    const onSnapshotChanged = vi.fn()
    const watcher = new ProjectComparisonFileWatcher(
      { onError: vi.fn(), onManifestChanged, onSnapshotChanged },
      watch as never,
      async (path) => path,
    )

    const projectReady = watcher.startProject('/project')
    expect(created[0]).toMatchObject({
      path: '/project',
      options: { depth: 0, ignoreInitial: true, persistent: false, usePolling: false },
    })
    created[0]!.watcher.emit('ready')
    await projectReady

    const workspacesReady = watcher.reconcile('/project', [
      '/project/ws_1',
      '/project/ws_2',
    ])
    await vi.waitFor(() => expect(created).toHaveLength(3))
    expect(created.slice(1).map((entry) => entry.path)).toEqual([
      '/project/ws_1/home',
      '/project/ws_2/home',
    ])
    created[1]!.watcher.emit('ready')
    created[2]!.watcher.emit('ready')
    await workspacesReady

    created[0]!.watcher.emit('all', 'change', '/project/ignored.json')
    created[0]!.watcher.emit('all', 'unlink', '/project/project.json')
    created[0]!.watcher.emit('all', 'add', '/project/project.json')
    created[1]!.watcher.emit(
      'all',
      'change',
      '/project/ws_1/home/engineering-snapshot.json',
    )
    await vi.advanceTimersByTimeAsync(50)

    expect(onManifestChanged).toHaveBeenCalledOnce()
    expect(onSnapshotChanged).toHaveBeenCalledOnce()
    expect(onSnapshotChanged).toHaveBeenCalledWith('/project/ws_1')

    await watcher.reconcile('/project', ['/project/ws_2'])
    expect(created[1]!.watcher.close).toHaveBeenCalledOnce()
    await watcher.close()
    expect(created[0]!.watcher.close).toHaveBeenCalledOnce()
    expect(created[2]!.watcher.close).toHaveBeenCalledOnce()
  })

  it('continues observing project.json after consecutive atomic replacements', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'ecos-comparison-watch-'))
    const workspaceRoot = join(projectRoot, 'ws_1')
    await mkdir(join(workspaceRoot, 'home'), { recursive: true })
    await writeFile(join(projectRoot, 'project.json'), '{}')
    await writeFile(join(workspaceRoot, 'home', 'engineering-snapshot.json'), '{}')
    let resolveChange: (() => void) | null = null
    let changeCount = 0
    const nextChange = () =>
      new Promise<void>((resolve) => {
        resolveChange = resolve
      })
    const watcher = new ProjectComparisonFileWatcher({
      onError: (error) => {
        throw error
      },
      onManifestChanged: () => {
        changeCount += 1
        resolveChange?.()
        resolveChange = null
      },
      onSnapshotChanged: vi.fn(),
    })

    try {
      await watcher.startProject(projectRoot)
      await watcher.reconcile(projectRoot, [workspaceRoot])
      for (const revision of [1, 2]) {
        const changed = nextChange()
        const staged = join(projectRoot, `project.${revision}.tmp`)
        await writeFile(staged, JSON.stringify({ revision }))
        await rename(staged, join(projectRoot, 'project.json'))
        await changed
      }
      expect(changeCount).toBe(2)
    } finally {
      await watcher.close()
      await rm(projectRoot, { force: true, recursive: true })
    }
  })

  it('refuses to watch a Workspace symlink outside the Project root', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'ecos-comparison-project-'))
    const outside = await mkdtemp(join(tmpdir(), 'ecos-comparison-outside-'))
    const workspaceRoot = join(projectRoot, 'ws_1')
    await symlink(outside, workspaceRoot, 'dir')
    const watcher = new ProjectComparisonFileWatcher({
      onError: vi.fn(),
      onManifestChanged: vi.fn(),
      onSnapshotChanged: vi.fn(),
    })

    try {
      await expect(watcher.reconcile(projectRoot, [workspaceRoot])).rejects.toThrow(
        'outside the Project root',
      )
    } finally {
      await watcher.close()
      await Promise.all([
        rm(projectRoot, { force: true, recursive: true }),
        rm(outside, { force: true, recursive: true }),
      ])
    }
  })

  it('refuses to watch a home symlink outside its Workspace root', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'ecos-comparison-project-'))
    const outside = await mkdtemp(join(tmpdir(), 'ecos-comparison-home-outside-'))
    const workspaceRoot = join(projectRoot, 'ws_1')
    await mkdir(workspaceRoot)
    await symlink(outside, join(workspaceRoot, 'home'), 'dir')
    const watcher = new ProjectComparisonFileWatcher({
      onError: vi.fn(),
      onManifestChanged: vi.fn(),
      onSnapshotChanged: vi.fn(),
    })

    try {
      await expect(watcher.reconcile(projectRoot, [workspaceRoot])).rejects.toThrow(
        'outside the Workspace root',
      )
    } finally {
      await watcher.close()
      await Promise.all([
        rm(projectRoot, { force: true, recursive: true }),
        rm(outside, { force: true, recursive: true }),
      ])
    }
  })
})
