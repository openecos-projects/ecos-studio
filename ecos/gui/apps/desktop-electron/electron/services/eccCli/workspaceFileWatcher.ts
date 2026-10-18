import { watch, type FSWatcher } from 'chokidar'
import { join } from 'node:path'

export interface OperationFileWatcher {
  close(): Promise<void>
}

export interface WorkspaceOperationFileWatcher extends OperationFileWatcher {
  ready: Promise<void>
}

export interface WorkspaceOperationWatcherOptions {
  projectRoot: string
  workspaceDirectory: string
  debounceMs: number
  onTrigger: () => void
  onError: (error: unknown) => void
}

const PROJECT_FILE_PATTERN = /(^|[\\/])project\.json$/
const FLOW_FILE_PATTERN = /(^|[\\/])flow\.json$/

/**
 * Watch the files that drive a running workspace operation.
 *
 * ECC publishes `project.json` and `home/flow.json` through a same-directory
 * temp file + atomic rename, so the watcher observes the containing
 * directories (non-recursive) and treats `add`/`change`/`unlink` of the
 * target filename as triggers instead of holding the old inode.
 */
export function watchWorkspaceOperationFiles(
  options: WorkspaceOperationWatcherOptions,
): WorkspaceOperationFileWatcher {
  const watchers: FSWatcher[] = [
    watch(options.projectRoot, {
      depth: 0,
      followSymlinks: false,
      ignoreInitial: true,
      persistent: false,
    }),
    watch(join(options.workspaceDirectory, 'home'), {
      depth: 0,
      followSymlinks: false,
      ignoreInitial: true,
      persistent: false,
    }),
  ]
  let timer: ReturnType<typeof setTimeout> | null = null
  const onChange = (path: string, filter: RegExp) => {
    if (!filter.test(path)) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(options.onTrigger, options.debounceMs)
  }
  watchers[0]!.on('all', (event, path) => {
    if (event === 'addDir' || event === 'unlinkDir') return
    onChange(path, PROJECT_FILE_PATTERN)
  })
  watchers[1]!.on('all', (event, path) => {
    if (event === 'addDir' || event === 'unlinkDir') return
    onChange(path, FLOW_FILE_PATTERN)
  })
  for (const watcher of watchers) {
    watcher.on('error', (error) => options.onError(error))
  }
  const ready = Promise.all(
    watchers.map(
      (watcher) =>
        new Promise<void>((resolvePromise) => watcher.once('ready', resolvePromise)),
    ),
  ).then(() => undefined)
  return {
    ready,
    close: async () => {
      if (timer) clearTimeout(timer)
      await Promise.all(watchers.map((watcher) => watcher.close()))
    },
  }
}
