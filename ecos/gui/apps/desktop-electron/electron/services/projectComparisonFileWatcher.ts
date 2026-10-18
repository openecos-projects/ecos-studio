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
type WorkspaceFilename = string | readonly string[]

export class ProjectComparisonFileWatcher {
  private projectWatcher: FSWatcher | null = null
  private readonly workspaceWatchers = new Map<string, FSWatcher>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private failed = false

  constructor(
    private readonly callbacks: ProjectComparisonFileWatcherCallbacks,
    private readonly watchDirectory: Watch = watch,
    private readonly canonicalize: Canonicalize = realpath,
    private readonly workspaceFilename: WorkspaceFilename = 'engineering-snapshot.json',
  ) {}

  async startProject(projectRoot: string): Promise<void> {
    const root = resolve(projectRoot)
    const target = join(root, 'project.json')
    const watcher = this.create(root, [target], () => this.callbacks.onManifestChanged())
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
    const expected = new Map<
      string,
      { directory: string; targets: string[]; allowedParents: string[] }
    >()
    const filenames = this.workspaceFilenames()
    for (const root of workspaceRoots) {
      const locator = resolve(root)
      let canonical: string
      try {
        canonical = await this.canonicalize(locator)
      } catch (error) {
        if (isNodeErrorWithCode(error, 'ENOENT')) continue
        throw error
      }
      if (canonical === project || isPathWithinRoot(project, canonical)) {
        throw new Error('Workspace watcher path resolves to a protected Project path.')
      }
      const unresolvedHome = join(canonical, 'home')
      try {
        const home = await this.canonicalize(unresolvedHome)
        if (!isPathWithinRoot(home, canonical)) {
          throw new Error(
            'Workspace home watcher path resolves outside the Workspace root.',
          )
        }
        expected.set(locator, {
          directory: home,
          targets: filenames.map((filename) => join(home, filename)),
          allowedParents: [],
        })
      } catch (error) {
        if (!isNodeErrorWithCode(error, 'ENOENT')) throw error
        expected.set(locator, {
          directory: canonical,
          targets: filenames.map((filename) => join(unresolvedHome, filename)),
          allowedParents: [unresolvedHome],
        })
      }
    }
    await Promise.all(
      [...this.workspaceWatchers].flatMap(([root, watcher]) => {
        if (expected.has(root)) return []
        this.workspaceWatchers.delete(root)
        return [watcher.close()]
      }),
    )
    await Promise.all(
      [...expected].flatMap(([workspaceRoot, targetInfo]) => {
        if (this.workspaceWatchers.has(workspaceRoot)) return []
        const watcher = this.create(
          targetInfo.directory,
          targetInfo.targets,
          () => this.callbacks.onSnapshotChanged(workspaceRoot),
          targetInfo.allowedParents,
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

  private create(
    directory: string,
    targets: readonly string[],
    callback: () => void,
    allowedParents: readonly string[] = [],
  ): FSWatcher {
    const allowed = new Set(
      [directory, ...targets, ...allowedParents].map((path) => resolve(path)),
    )
    const targetSet = new Set(targets.map((path) => resolve(path)))
    const scheduleKey = targets.map((path) => resolve(path)).join('\0')
    const watcher = this.watchDirectory(directory, {
      depth: allowedParents.length ? 1 : 0,
      followSymlinks: false,
      ignored: (path) => {
        const candidate = resolve(path)
        return !allowed.has(candidate)
      },
      ignoreInitial: true,
      persistent: false,
      usePolling: false,
    })
    watcher.on('all', (event, changedPath) => {
      if (!['add', 'change', 'unlink'].includes(event)) return
      if (!targetSet.has(resolve(changedPath))) return
      this.schedule(scheduleKey, callback)
    })
    watcher.on('error', (error) => {
      if (this.failed) return
      this.failed = true
      this.callbacks.onError(error)
    })
    return watcher
  }

  private workspaceFilenames(): readonly string[] {
    return typeof this.workspaceFilename === 'string'
      ? [this.workspaceFilename]
      : this.workspaceFilename
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

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  )
}

function ready(watcher: FSWatcher): Promise<void> {
  return new Promise((resolveReady, rejectReady) => {
    const cleanup = () => {
      watcher.off('ready', onReady)
      watcher.off('error', onError)
      watcher.off('close', onClose)
    }
    const onReady = () => {
      cleanup()
      resolveReady()
    }
    const onError = (error: unknown) => {
      cleanup()
      rejectReady(error)
    }
    const onClose = () => {
      cleanup()
      rejectReady(new Error('File watcher closed before becoming ready.'))
    }
    watcher.once('ready', onReady)
    watcher.once('error', onError)
    watcher.once('close', onClose)
  })
}
