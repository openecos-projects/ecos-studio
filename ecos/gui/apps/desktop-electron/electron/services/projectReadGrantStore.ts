import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

interface ProjectReadGrantRecord {
  project_root: string
  roots: string[]
}

interface ProjectReadGrantFile {
  version: 1
  projects: ProjectReadGrantRecord[]
}

export interface ProjectReadGrantStoreOptions {
  filePath: string
}

function emptyGrantFile(): ProjectReadGrantFile {
  return { version: 1, projects: [] }
}

function parseGrantFile(value: unknown): ProjectReadGrantFile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return emptyGrantFile()
  }

  const record = value as Record<string, unknown>
  if (record.version !== 1 || !Array.isArray(record.projects)) {
    return emptyGrantFile()
  }

  const projects = record.projects.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return []
    const candidate = entry as Record<string, unknown>
    if (typeof candidate.project_root !== 'string' || !Array.isArray(candidate.roots)) {
      return []
    }
    const roots = candidate.roots.filter(
      (root): root is string => typeof root === 'string' && root.length > 0,
    )
    return [{ project_root: candidate.project_root, roots }]
  })

  return { version: 1, projects }
}

export class ProjectReadGrantStore {
  private readonly filePath: string
  private writeChain: Promise<void> = Promise.resolve()

  constructor(options: ProjectReadGrantStoreOptions) {
    this.filePath = options.filePath
  }

  async get(projectRoot: string): Promise<string[]> {
    await this.writeChain
    const grants = await this.read()
    return [
      ...(grants.projects.find((entry) => entry.project_root === projectRoot)?.roots ??
        []),
    ]
  }

  async set(projectRoot: string, roots: string[]): Promise<void> {
    const operation = this.writeChain.then(async () => {
      const grants = await this.read()
      const projects = grants.projects.filter(
        (entry) => entry.project_root !== projectRoot,
      )
      projects.push({ project_root: projectRoot, roots: [...new Set(roots)] })
      await this.write({ version: 1, projects })
    })
    this.writeChain = operation.then(
      () => undefined,
      () => undefined,
    )
    await operation
  }

  private async read(): Promise<ProjectReadGrantFile> {
    try {
      return parseGrantFile(JSON.parse(await readFile(this.filePath, 'utf8')) as unknown)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyGrantFile()
      if (error instanceof SyntaxError) return emptyGrantFile()
      throw error
    }
  }

  private async write(grants: ProjectReadGrantFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(grants, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, this.filePath)
  }
}
