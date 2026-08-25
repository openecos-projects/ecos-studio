import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import type {
  DesktopHdlDesignCandidate,
  DesktopHdlDesignIndexStatus,
} from '@ecos-studio/shared'
import { parseDesignFiles } from './hdlDesignMetadata'

const execFileAsync = promisify(execFile)
const INDEX_MAX_AGE_MS = 24 * 60 * 60 * 1000
const QUERY_PATH_LIMIT = 500
const PRUNED_NAMES =
  '.cache .git .venv __pycache__ build dist node_modules output release target'
const PRUNED_FILE_SYSTEMS =
  '9p afs autofs binfmt_misc cgroup cgroup2 configfs debugfs devpts devtmpfs ecryptfs hugetlbfs iso9660 lustre mqueue nfs nfs4 proc rpc_pipefs securityfs squashfs sysfs tmpfs tracefs'

type RunCommand = (
  command: string,
  args: string[],
  options: { signal?: AbortSignal },
) => Promise<string>

interface HdlDesignIndexServiceOptions {
  binaryPaths: { plocate: string; updatedb: string }
  homePath: string
  indexDirectory: string
  now?: () => Date
  run?: RunCommand
}

interface IndexManifest {
  indexedAt: string
  rootIndexedAt?: Record<string, string>
  roots: string[]
  schemaVersion: 1
}

export class HdlDesignIndexService {
  private readonly binaryPaths: HdlDesignIndexServiceOptions['binaryPaths']
  private readonly homePath: string
  private readonly indexDirectory: string
  private readonly manifestPath: string
  private readonly now: () => Date
  private readonly run: RunCommand
  private readonly roots = new Set<string>()
  private readonly preferredRoots = new Set<string>()
  private readonly listeners = new Set<(status: DesktopHdlDesignIndexStatus) => void>()
  private activeRoot: string | null = null
  private controller: AbortController | null = null
  private refreshPromise: Promise<void> | null = null
  private refreshRequested = false
  private forceRequested = false
  private status: DesktopHdlDesignIndexStatus = { rootCount: 0, state: 'idle' }

  constructor(options: HdlDesignIndexServiceOptions) {
    this.binaryPaths = options.binaryPaths
    this.homePath = resolve(options.homePath)
    this.indexDirectory = resolve(options.indexDirectory)
    this.manifestPath = join(this.indexDirectory, 'manifest.json')
    this.now = options.now ?? (() => new Date())
    this.run = options.run ?? runCommand
    this.roots.add(this.homePath)
  }

  getStatus(): DesktopHdlDesignIndexStatus {
    return { ...this.status, rootCount: this.roots.size }
  }

  onStatus(listener: (status: DesktopHdlDesignIndexStatus) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start(projectRoots: string[] = []): void {
    this.updateRoots(projectRoots)
    void this.refresh(false)
  }

  updateRoots(projectRoots: string[], activeRoot?: string): void {
    this.activeRoot = activeRoot ? resolve(activeRoot) : null
    let added = false
    for (const value of projectRoots) {
      if (!value || !isAbsolute(value)) continue
      const root = resolve(value)
      this.preferredRoots.add(root)
      if (isWithin(root, this.homePath)) continue
      if (!this.roots.has(root)) {
        this.roots.add(root)
        added = true
      }
    }
    if (added) void this.refresh(false)
    else this.publish({ ...this.status, rootCount: this.roots.size })
  }

  async refresh(force = false): Promise<void> {
    if (this.refreshPromise) {
      this.refreshRequested = true
      this.forceRequested ||= force
      await this.refreshPromise
      if (!this.refreshRequested) return
      const queuedForce = this.forceRequested
      this.refreshRequested = false
      this.forceRequested = false
      return await this.refresh(queuedForce)
    }
    this.refreshPromise = this.refreshOnce(force).finally(() => {
      this.refreshPromise = null
    })
    return this.refreshPromise
  }

  async query(options: {
    designName?: string
    limit: number
  }): Promise<DesktopHdlDesignCandidate[]> {
    const databases = await this.availableDatabases()
    if (databases.length === 0) return []
    const pathsByExtension = new Map<string, string[]>()
    const designName = options.designName?.trim()
    for (const extension of ['v', 'sv', 'sdc', 'f']) {
      const designQuery = Boolean(designName && (extension === 'v' || extension === 'sv'))
      let output = ''
      try {
        output = await this.run(
          this.binaryPaths.plocate,
          [
            '-d',
            databases.join(':'),
            '-0',
            '-e',
            ...(designQuery ? [] : ['-b']),
            '-l',
            String(QUERY_PATH_LIMIT),
            designQuery ? `*${designName}*.${extension}` : `*.${extension}`,
          ],
          {},
        )
      } catch (error) {
        if ((error as { code?: unknown }).code !== 1) throw error
      }
      pathsByExtension.set(extension, splitNullPaths(output))
    }
    return this.cluster(pathsByExtension, options)
  }

  dispose(): void {
    this.controller?.abort()
    this.controller = null
    this.listeners.clear()
  }

  private async refreshOnce(force: boolean): Promise<void> {
    await mkdir(this.indexDirectory, { recursive: true })
    const manifest = await this.readManifest()
    const rootsToBuild = [...this.roots].filter(
      (root) =>
        force ||
        !manifest?.roots.includes(root) ||
        this.isStale(manifest.rootIndexedAt?.[root] ?? manifest.indexedAt),
    )
    if (rootsToBuild.length === 0 && manifest && sameRoots(manifest.roots, this.roots)) {
      this.publish({
        indexedAt: manifest.indexedAt,
        rootCount: this.roots.size,
        state: 'ready',
      })
      return
    }
    this.controller = new AbortController()
    this.publish({
      message: 'Indexing local HDL paths',
      rootCount: this.roots.size,
      state: 'building',
    })
    try {
      for (const root of rootsToBuild) await this.buildRoot(root, this.controller.signal)
      const indexedAt = this.now().toISOString()
      const indexedRoots = new Set([...(manifest?.roots ?? []), ...rootsToBuild])
      const roots = [...this.roots].filter((root) => indexedRoots.has(root)).sort()
      const next: IndexManifest = {
        indexedAt,
        rootIndexedAt: Object.fromEntries(
          roots.map((root) => [
            root,
            rootsToBuild.includes(root)
              ? indexedAt
              : (manifest?.rootIndexedAt?.[root] ?? manifest?.indexedAt ?? indexedAt),
          ]),
        ),
        roots,
        schemaVersion: 1,
      }
      await writeFile(`${this.manifestPath}.tmp`, `${JSON.stringify(next, null, 2)}\n`)
      await rename(`${this.manifestPath}.tmp`, this.manifestPath)
      this.publish({
        indexedAt: next.indexedAt,
        rootCount: this.roots.size,
        state: 'ready',
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).name === 'AbortError') return
      this.publish({
        message: error instanceof Error ? error.message : String(error),
        rootCount: this.roots.size,
        state: 'error',
      })
    } finally {
      this.controller = null
    }
  }

  private async buildRoot(root: string, signal: AbortSignal): Promise<void> {
    await access(root)
    const database = this.databasePath(root)
    const temporary = `${database}.tmp`
    await unlink(temporary).catch(() => undefined)
    await this.run(
      this.binaryPaths.updatedb,
      [
        '-l',
        '0',
        '-U',
        root,
        '-o',
        temporary,
        '--prunenames',
        PRUNED_NAMES,
        '--prunefs',
        PRUNED_FILE_SYSTEMS,
      ],
      { signal },
    )
    await rename(temporary, database)
  }

  private async availableDatabases(): Promise<string[]> {
    const databases = await Promise.all(
      [...this.roots].map(async (root) => {
        const path = this.databasePath(root)
        try {
          await access(path)
          return path
        } catch {
          return null
        }
      }),
    )
    return databases.filter((path): path is string => path !== null)
  }

  private async cluster(
    paths: Map<string, string[]>,
    options: { designName?: string; limit: number },
  ): Promise<DesktopHdlDesignCandidate[]> {
    const rtlPaths = [...(paths.get('v') ?? []), ...(paths.get('sv') ?? [])]
    const sdcPaths = paths.get('sdc') ?? []
    const filelistPaths = paths.get('f') ?? []
    const hint = options.designName?.trim().toLowerCase()
    const candidates = await Promise.all(
      rtlPaths.map(async (rtlPath) => {
        const designName = normalizedStem(rtlPath)
        if (hint && !rtlPath.toLowerCase().includes(hint)) return null
        const sdcPath = await bestSdcPath(rtlPath, sdcPaths, designName)
        const filelistPath = await bestFilelistPath(rtlPath, filelistPaths)
        const parsed = await parseDesignFiles(rtlPath, sdcPath)
        const reasons = ['RTL source found in the local HDL index']
        let confidence = 0.45
        if (sdcPath) {
          confidence += 0.25
          reasons.push('Matching SDC found nearby')
        }
        if (filelistPath) {
          confidence += 0.15
          reasons.push('Matching filelist found nearby')
        }
        if (parsed.topModule) {
          confidence += 0.1
          reasons.push(`Top module ${parsed.topModule} detected`)
        }
        if (this.activeRoot && isWithin(rtlPath, this.activeRoot)) {
          confidence += 0.25
          reasons.push('Source belongs to the current Project')
        } else if ([...this.preferredRoots].some((root) => isWithin(rtlPath, root))) {
          confidence += 0.1
          reasons.push('Source belongs to a recent Project')
        }
        return {
          ...parsed,
          confidence: Math.min(confidence, 0.99),
          designName,
          ...(filelistPath ? { filelistPath } : {}),
          id: createHash('sha256').update(rtlPath).digest('hex').slice(0, 16),
          reasons,
          rtlPath,
          ...(sdcPath ? { sdcPath } : {}),
        } satisfies DesktopHdlDesignCandidate
      }),
    )
    return candidates
      .filter((candidate): candidate is DesktopHdlDesignCandidate => candidate !== null)
      .sort(
        (left, right) =>
          Number(Boolean(this.activeRoot && isWithin(right.rtlPath, this.activeRoot))) -
            Number(Boolean(this.activeRoot && isWithin(left.rtlPath, this.activeRoot))) ||
          right.confidence - left.confidence ||
          left.rtlPath.localeCompare(right.rtlPath),
      )
      .slice(0, Math.max(1, Math.min(options.limit, 10)))
  }

  private databasePath(root: string): string {
    const id = createHash('sha256').update(root).digest('hex').slice(0, 16)
    return join(this.indexDirectory, `${id}.db`)
  }

  private async readManifest(): Promise<IndexManifest | null> {
    try {
      const value = JSON.parse(await readFile(this.manifestPath, 'utf8')) as IndexManifest
      return value.schemaVersion === 1 && Array.isArray(value.roots) ? value : null
    } catch {
      return null
    }
  }

  private isStale(indexedAt: string): boolean {
    return this.now().getTime() - Date.parse(indexedAt) >= INDEX_MAX_AGE_MS
  }

  private publish(status: DesktopHdlDesignIndexStatus): void {
    this.status = status
    for (const listener of this.listeners) listener(this.getStatus())
  }
}

async function runCommand(
  command: string,
  args: string[],
  options: { signal?: AbortSignal },
): Promise<string> {
  const result = await execFileAsync(command, args, {
    encoding: 'buffer',
    maxBuffer: 8 * 1024 * 1024,
    signal: options.signal,
  })
  return result.stdout.toString('utf8')
}

function splitNullPaths(output: string): string[] {
  return [
    ...new Set(
      output
        .split('\0')
        .map((path) => path.trim())
        .filter(isAbsolute),
    ),
  ]
}

function normalizedStem(path: string): string {
  return basename(path)
    .replace(/\.(?:sv|v|sdc|f)$/i, '')
    .replace(/(?:_top|_rtl)$/i, '')
}

function bestRelatedPath(
  rtlPath: string,
  paths: string[],
  designName: string,
): string | undefined {
  return paths
    .map((path) => ({
      path,
      score:
        (normalizedStem(path).toLowerCase() === designName.toLowerCase() ? 100 : 0) +
        commonDirectoryDepth(dirname(rtlPath), dirname(path)),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort(
      (left, right) => right.score - left.score || left.path.localeCompare(right.path),
    )[0]?.path
}

async function bestSdcPath(
  rtlPath: string,
  paths: string[],
  designName: string,
): Promise<string | undefined> {
  const design = designName.toLowerCase()
  const named = paths.filter(
    (path) =>
      directoriesAreRelated(dirname(rtlPath), dirname(path)) &&
      (normalizedStem(path).toLowerCase() === design ||
        (design.length >= 3 && path.toLowerCase().includes(design))),
  )
  if (named.length > 0) return bestRelatedPath(rtlPath, named, designName)
  let rtlSource: string
  try {
    rtlSource = (await readFile(rtlPath, 'utf8')).slice(0, 2 * 1024 * 1024)
  } catch {
    return undefined
  }
  const matches: string[] = []
  for (const path of paths.slice(0, 64)) {
    try {
      const sdcSource = (await readFile(path, 'utf8')).slice(0, 512 * 1024)
      const activeSdc = sdcSource.replace(/^\s*#.*$/gm, '')
      const ports = [
        ...activeSdc.matchAll(/\bget_ports\s+(?:\{)?([A-Za-z_][A-Za-z0-9_$]*)/g),
      ].map((match) => match[1]!)
      if (
        dirname(rtlPath) === dirname(path) &&
        ports.length > 0 &&
        ports.every((port) => new RegExp(`\\b${escapeRegExp(port)}\\b`).test(rtlSource))
      ) {
        matches.push(path)
      }
    } catch {
      // Ignore stale and unreadable constraints.
    }
  }
  return bestRelatedPath(rtlPath, matches, designName)
}

async function bestFilelistPath(
  rtlPath: string,
  paths: string[],
): Promise<string | undefined> {
  for (const path of paths.slice(0, 64)) {
    try {
      const content = (await readFile(path, 'utf8')).slice(0, 256 * 1024)
      const entries = content
        .split(/\r?\n/)
        .map((line) => line.trim().replace(/^['"]|['"]$/g, ''))
        .filter((line) => line && !line.startsWith('#') && !line.startsWith('+'))
      if (entries.some((entry) => resolve(dirname(path), entry) === resolve(rtlPath))) {
        return path
      }
    } catch {
      // Ignore stale and unreadable filelists.
    }
  }
  return undefined
}

function commonDirectoryDepth(left: string, right: string): number {
  const leftParts = resolve(left).split('/').filter(Boolean)
  const rightParts = resolve(right).split('/').filter(Boolean)
  let depth = 0
  while (leftParts[depth] && leftParts[depth] === rightParts[depth]) depth += 1
  return depth
}

function directoriesAreRelated(left: string, right: string): boolean {
  const leftDepth = resolve(left).split('/').filter(Boolean).length
  const rightDepth = resolve(right).split('/').filter(Boolean).length
  return commonDirectoryDepth(left, right) >= Math.min(leftDepth, rightDepth) - 2
}

function isWithin(path: string, root: string): boolean {
  const value = relative(root, path)
  return value === '' || (!value.startsWith('..') && !isAbsolute(value))
}

function sameRoots(left: string[], right: Set<string>): boolean {
  return left.length === right.size && left.every((root) => right.has(root))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
