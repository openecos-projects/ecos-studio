import { watch, type FSWatcher } from 'chokidar'
import { realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { isPathWithinRoot } from './pathScope'

const DEBOUNCE_MS = 50

export interface ProjectComparisonFileWatcherCallbacks {
  onError(error: unknown): void
  onManifestChanged(): void
  onSnapshotChanged(workspaceRoot: string): void
}

type Watch = typeof watch
type Canonicalize = (path: string) => Promise<string>

export class ProjectComparisonFileWatcher {
  private projectWatcher: FSWatcher | null = null
  private readonly workspaceWatchers = new Map<string, FSWatcher>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private failed = false

  constructor(
    private readonly callbacks: ProjectComparisonFileWatcherCallbacks,
    private readonly watchDirectory: Watch = watch,
    private readonly canonicalize: Canonicalize = realpath,
  ) {}

  async startProject(projectRoot: string): Promise<void> {
    const root = resolve(projectRoot)
    const target = join(root, 'project.json')
    const watcher = this.create(root, target, () => this.callbacks.onManifestChanged())
    this.projectWatcher = watcher
    try {
      await ready(watcher)
    } catch (error) {
      this.projectWatcher = null
      await watcher.close()
      throw error
    }
  }

  async reconcile(projectRoot: string, workspaceRoots: readonly string[]): Promise<void> {
    const project = resolve(projectRoot)
    const expected = new Map<string, string>()
    for (const root of workspaceRoots) {
      const locator = resolve(root)
      const canonical = await this.canonicalize(locator)
      if (canonical === project || !isPathWithinRoot(canonical, project)) {
        throw new Error('Workspace watcher path resolves outside the Project root.')
      }
      const home = await this.canonicalize(join(canonical, 'home'))
      if (!isPathWithinRoot(home, canonical)) {
        throw new Error(
          'Workspace home watcher path resolves outside the Workspace root.',
        )
      }
      expected.set(locator, home)
    }
    await Promise.all(
      [...this.workspaceWatchers].flatMap(([root, watcher]) => {
        if (expected.has(root)) return []
        this.workspaceWatchers.delete(root)
        return [watcher.close()]
      }),
    )
    await Promise.all(
      [...expected].flatMap(([workspaceRoot, homeDirectory]) => {
        if (this.workspaceWatchers.has(workspaceRoot)) return []
        const target = join(homeDirectory, 'engineering-snapshot.json')
        const watcher = this.create(homeDirectory, target, () =>
          this.callbacks.onSnapshotChanged(workspaceRoot),
        )
        this.workspaceWatchers.set(workspaceRoot, watcher)
        return [
          ready(watcher).catch(async (error) => {
            this.workspaceWatchers.delete(workspaceRoot)
            await watcher.close()
            throw error
          }),
        ]
      }),
    )
  }

  async close(): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    const watchers = [
      ...(this.projectWatcher ? [this.projectWatcher] : []),
      ...this.workspaceWatchers.values(),
    ]
    this.projectWatcher = null
    this.workspaceWatchers.clear()
    await Promise.all(watchers.map((watcher) => watcher.close()))
  }

  private create(directory: string, target: string, callback: () => void): FSWatcher {
    const watcher = this.watchDirectory(directory, {
      depth: 0,
      ignored: (path) => {
        const candidate = resolve(path)
        return candidate !== directory && candidate !== target
      },
      ignoreInitial: true,
      persistent: false,
      usePolling: false,
    })
    watcher.on('all', (event, changedPath) => {
      if (!['add', 'change', 'unlink'].includes(event)) return
      if (resolve(changedPath) !== target) return
      this.schedule(target, callback)
    })
    watcher.on('error', (error) => {
      if (this.failed) return
      this.failed = true
      this.callbacks.onError(error)
    })
    return watcher
  }

  private schedule(key: string, callback: () => void): void {
    const pending = this.timers.get(key)
    if (pending) clearTimeout(pending)
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key)
        callback()
      }, DEBOUNCE_MS),
    )
  }
}

function ready(watcher: FSWatcher): Promise<void> {
  return new Promise((resolveReady, rejectReady) => {
    const cleanup = () => {
      watcher.off('ready', onReady)
      watcher.off('error', onError)
    }
    const onReady = () => {
      cleanup()
      resolveReady()
    }
    const onError = (error: unknown) => {
      cleanup()
      rejectReady(error)
    }
    watcher.once('ready', onReady)
    watcher.once('error', onError)
  })
}
