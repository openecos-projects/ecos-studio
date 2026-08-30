import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve, win32 } from 'node:path'
import {
  parseProjectManifest,
  type PdkDetectedFiles,
  type ProjectManifest,
  type ScannedPdkDirectory,
} from '@ecos-studio/shared'
import { requireWindowScopeId } from './windowScopeContext'
import { isPathWithinRoot } from './pathScope'

const REQUIRED_PROJECT_FILES = ['flow.json']
// A workspace persists its configuration as either home/ecc.toml (preferred)
// or home/parameters.json (JSON workspaces, including ecc-fe).
const WORKSPACE_CONFIG_FILES = ['ecc.toml', 'parameters.json']
const PDK_RESOURCE_FILE_EXTENSIONS = ['.lef', '.lib', '.liberty']
const FRONTEND_EXTRA_ROOT_PATH_FIELDS = [
  'sim_soc_root',
  'sim_programs_dir',
  'sim_tests_dir',
]
const FRONTEND_FILELIST_FIELDS = ['cpu_filelist', 'soc_filelist']

interface ProjectReadScope {
  projectRoot: string
  workspaceRoots: string[]
}

export interface ProjectReadGrantProvider {
  get(projectRoot: string): Promise<string[]>
  set(projectRoot: string, roots: string[]): Promise<void>
}

export interface ProjectScopeServiceOptions {
  readGrantProvider?: ProjectReadGrantProvider
}

async function canonicalizeExistingPath(path: string): Promise<string> {
  return await realpath(path)
}

async function canonicalizeExistingDirectory(path: string): Promise<string> {
  const canonicalPath = await canonicalizeExistingPath(path)
  const pathStats = await stat(canonicalPath)

  if (!pathStats.isDirectory()) {
    throw new Error(`${canonicalPath} is not a directory`)
  }

  return canonicalPath
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === code
  )
}

function pathsEqual(leftPath: string, rightPath: string): boolean {
  return relative(resolve(leftPath), resolve(rightPath)) === ''
}

function uniquePaths(paths: string[]): string[] {
  const unique: string[] = []
  for (const path of paths) {
    if (!unique.some((candidate) => pathsEqual(candidate, path))) unique.push(path)
  }
  return unique
}

function isSafeExternalReadRoot(path: string, projectRoot: string): boolean {
  // An external source root must not contain the workspace itself. This rejects
  // filesystem roots, home directories, and other overly broad ancestors.
  return !isPathWithinRoot(projectRoot, path)
}

async function canonicalizePotentialPathWithinRoot(
  path: string,
  rootPath: string,
): Promise<string> {
  const candidatePath = resolve(path)

  if (!isPathWithinRoot(candidatePath, rootPath)) {
    throw new Error(
      `Refusing to grant access outside current project root: ${candidatePath}`,
    )
  }

  const relativePath = relative(rootPath, candidatePath)
  if (!relativePath) return rootPath

  const segments = relativePath.split(/[\\/]+/).filter(Boolean)
  let resolvedPrefix = rootPath
  let lexicalPrefix = rootPath

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    lexicalPrefix = join(lexicalPrefix, segment)

    try {
      resolvedPrefix = await realpath(lexicalPrefix)
    } catch (error) {
      if (isNodeErrorWithCode(error, 'ENOENT')) {
        return join(resolvedPrefix, ...segments.slice(index))
      }

      throw error
    }
  }

  return resolvedPrefix
}

async function manifestWorkspaceRoots(
  manifest: ProjectManifest,
  projectRoot: string,
): Promise<string[]> {
  const manifestRoot = await canonicalizeExistingDirectory(manifest.root_path)
  if (!pathsEqual(manifestRoot, projectRoot)) {
    throw new Error('Project read root manifest does not match the requested directory')
  }

  return await Promise.all(
    manifest.workspaces.map(async (workspace) => {
      const workspacePath = resolve(workspace.workspace_path)
      if (!pathsEqual(dirname(workspacePath), projectRoot)) {
        throw new Error(
          'Project read root manifest contains a workspace outside the project',
        )
      }
      return await canonicalizePotentialPathWithinRoot(workspacePath, projectRoot)
    }),
  )
}

async function scanTopLevelEntries(path: string): Promise<PdkDetectedFiles> {
  const directories: string[] = []
  const files: string[] = []

  async function walk(currentPath: string, relativeDirectory = ''): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name
      const entryPath = join(currentPath, entry.name)

      if (entry.isDirectory()) {
        directories.push(relativePath)
        await walk(entryPath, relativePath)
        continue
      }

      if (entry.isFile() && isPdkResourceFile(entry.name)) {
        files.push(relativePath)
      }
    }
  }

  await walk(path)

  return {
    directories: directories.sort((left, right) => left.localeCompare(right)),
    files: files.sort((left, right) => left.localeCompare(right)),
  }
}

function isPdkResourceFile(path: string): boolean {
  const lower = path.toLowerCase()
  return PDK_RESOURCE_FILE_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

async function isProjectDirectoryCandidate(path: string): Promise<boolean> {
  const homeDirectory = `${path}/home`

  try {
    const homeStats = await stat(homeDirectory)

    if (!homeStats.isDirectory()) {
      return false
    }
  } catch {
    return false
  }

  const requiredFileChecks = await Promise.all(
    REQUIRED_PROJECT_FILES.map(async (fileName) => {
      try {
        const fileStats = await stat(`${homeDirectory}/${fileName}`)
        return fileStats.isFile()
      } catch {
        return false
      }
    }),
  )
  if (!requiredFileChecks.every(Boolean)) {
    return false
  }

  const configFileChecks = await Promise.all(
    WORKSPACE_CONFIG_FILES.map(async (fileName) => {
      try {
        const fileStats = await stat(`${homeDirectory}/${fileName}`)
        return fileStats.isFile()
      } catch {
        return false
      }
    }),
  )
  return configFileChecks.some(Boolean)
}

function getPathLeafName(path: string): string | null {
  const trimmedPath = path.replace(/[\\/]+$/, '')
  const leafName = win32.basename(trimmedPath)

  return leafName || null
}

export class ProjectScopeService {
  private readonly rootsByWindowId = new Map<number, string>()
  private readonly readScopesByWindowId = new Map<number, ProjectReadScope>()
  private readonly extraRootsByWindowId = new Map<number, string[]>()
  private readonly pendingExtraRootsByWindowId = new Map<number, string[]>()
  private readonly approvedExtraRootsByProject = new Map<string, string[]>()
  private readonly readGrantProvider: ProjectReadGrantProvider | undefined

  constructor(options: ProjectScopeServiceOptions = {}) {
    this.readGrantProvider = options.readGrantProvider
  }

  async resolveProjectRoot(path: string): Promise<string> {
    return await canonicalizeExistingDirectory(path)
  }

  async getProjectRoot(): Promise<string> {
    const root = this.rootsByWindowId.get(requireWindowScopeId())
    if (!root) {
      throw new Error('Project root is not registered')
    }

    return root
  }

  async registerProjectRoot(path: string): Promise<string> {
    const windowId = requireWindowScopeId()
    const canonicalPath = await this.resolveProjectRoot(path)
    const candidateExtraRoots = (await detectFrontendExtraRoots(canonicalPath)).filter(
      (root) => isSafeExternalReadRoot(root, canonicalPath),
    )
    const persistedRoots = await this.readGrantProvider?.get(canonicalPath)
    const approvedRoots = uniquePaths([
      ...(this.approvedExtraRootsByProject.get(canonicalPath) ?? []),
      ...(persistedRoots ?? []),
    ]).filter((root) =>
      candidateExtraRoots.some((candidate) => pathsEqual(candidate, root)),
    )
    const pendingRoots = candidateExtraRoots.filter(
      (candidate) => !approvedRoots.some((root) => pathsEqual(candidate, root)),
    )

    this.rootsByWindowId.set(windowId, canonicalPath)
    this.extraRootsByWindowId.set(windowId, approvedRoots)
    this.pendingExtraRootsByWindowId.set(windowId, pendingRoots)
    this.approvedExtraRootsByProject.set(canonicalPath, approvedRoots)
    this.readScopesByWindowId.delete(windowId)
    return canonicalPath
  }

  async listPendingExternalReadRoots(): Promise<string[]> {
    return [...(this.pendingExtraRootsByWindowId.get(requireWindowScopeId()) ?? [])]
  }

  async approvePendingExternalReadRoots(
    expectedProjectRoot: string,
    expectedRoots: string[],
  ): Promise<string[]> {
    const windowId = requireWindowScopeId()
    const projectRoot = this.rootsByWindowId.get(windowId)
    if (!projectRoot) {
      throw new Error('Project root is not registered')
    }
    if (!pathsEqual(projectRoot, expectedProjectRoot)) {
      throw new Error('External read approval no longer matches the active project')
    }

    const pendingRoots = this.pendingExtraRootsByWindowId.get(windowId) ?? []
    if (pendingRoots.length === 0) return []
    if (
      pendingRoots.length !== expectedRoots.length ||
      pendingRoots.some(
        (root) => !expectedRoots.some((expectedRoot) => pathsEqual(root, expectedRoot)),
      )
    ) {
      throw new Error('External read approval no longer matches the pending roots')
    }

    const approvedRoots = uniquePaths([
      ...(this.extraRootsByWindowId.get(windowId) ?? []),
      ...pendingRoots,
    ])
    this.extraRootsByWindowId.set(windowId, approvedRoots)
    this.pendingExtraRootsByWindowId.set(windowId, [])
    this.approvedExtraRootsByProject.set(projectRoot, approvedRoots)
    await this.readGrantProvider?.set(projectRoot, approvedRoots)
    return [...pendingRoots]
  }

  /**
   * Allows a managed workspace to read its containing project without replacing
   * the active workspace root used by WorkspaceResourceService.
   */
  async registerProjectReadRoot(path: string): Promise<string> {
    const windowId = requireWindowScopeId()
    const activeProjectRoot = this.rootsByWindowId.get(windowId)
    if (!activeProjectRoot) {
      throw new Error('Project root is not registered')
    }

    const canonicalPath = await this.resolveProjectRoot(path)
    if (pathsEqual(canonicalPath, activeProjectRoot)) {
      this.readScopesByWindowId.delete(windowId)
      return canonicalPath
    }
    if (!pathsEqual(canonicalPath, dirname(activeProjectRoot))) {
      throw new Error(
        'Project read root must be the active workspace root or its parent directory',
      )
    }

    let manifest: ProjectManifest
    try {
      manifest = parseProjectManifest(
        await readFile(join(canonicalPath, 'project.json'), 'utf8'),
      )
    } catch (error) {
      throw new Error(
        `Project read root must have a valid project.json: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
    const workspaceRoots = await manifestWorkspaceRoots(manifest, canonicalPath)
    if (
      !workspaceRoots.some((workspaceRoot) =>
        pathsEqual(workspaceRoot, activeProjectRoot),
      )
    ) {
      throw new Error('Project read root manifest does not declare the active workspace')
    }

    this.readScopesByWindowId.set(windowId, {
      projectRoot: canonicalPath,
      workspaceRoots,
    })
    return canonicalPath
  }

  async clearProjectRoot(): Promise<void> {
    const windowId = requireWindowScopeId()
    this.rootsByWindowId.delete(windowId)
    this.extraRootsByWindowId.delete(windowId)
    this.pendingExtraRootsByWindowId.delete(windowId)
    this.readScopesByWindowId.delete(windowId)
  }

  clearWindow(windowId: number): void {
    this.rootsByWindowId.delete(windowId)
    this.extraRootsByWindowId.delete(windowId)
    this.pendingExtraRootsByWindowId.delete(windowId)
    this.readScopesByWindowId.delete(windowId)
  }

  async requestProjectPathAccess(path: string): Promise<string> {
    const windowId = requireWindowScopeId()
    const activeProjectRoot = this.rootsByWindowId.get(windowId)
    if (!activeProjectRoot) {
      throw new Error('Project root is not registered')
    }

    const candidatePath = resolve(path)
    const readScope = this.readScopesByWindowId.get(windowId)
    const extraRoots = this.extraRootsByWindowId.get(windowId) ?? []
    const roots = [activeProjectRoot, ...extraRoots]
    if (readScope) {
      if (pathsEqual(candidatePath, join(readScope.projectRoot, 'project.json'))) {
        roots.push(readScope.projectRoot)
      } else {
        roots.push(...readScope.workspaceRoots)
      }
    }

    let matchedLexicalRoot = false
    for (const root of roots) {
      if (!isPathWithinRoot(candidatePath, root)) continue
      matchedLexicalRoot = true
      const canonicalPath = await canonicalizePotentialPathWithinRoot(path, root)
      if (isPathWithinRoot(canonicalPath, root)) return canonicalPath
    }

    if (matchedLexicalRoot || extraRoots.length > 0) {
      throw new Error(
        `Refusing to grant access outside current project scope: ${candidatePath}`,
      )
    }

    throw new Error(
      `Refusing to grant access outside current project root: ${candidatePath}`,
    )
  }

  /**
   * Mutating APIs must stay within the active workspace even when a managed
   * project has supplied additional read-only artifact roots.
   */
  async requestWritableProjectPathAccess(path: string): Promise<string> {
    const activeProjectRoot = await this.getProjectRoot()
    const candidatePath = resolve(path)
    if (!isPathWithinRoot(candidatePath, activeProjectRoot)) {
      throw new Error(
        `Refusing to grant access outside current project root: ${candidatePath}`,
      )
    }

    const canonicalPath = await canonicalizePotentialPathWithinRoot(
      path,
      activeProjectRoot,
    )
    if (!isPathWithinRoot(canonicalPath, activeProjectRoot)) {
      throw new Error(
        `Refusing to grant access outside current project root: ${candidatePath}`,
      )
    }
    return canonicalPath
  }

  async isProjectDirectory(path: string): Promise<boolean> {
    try {
      const canonicalPath = await canonicalizeExistingDirectory(path)
      return await isProjectDirectoryCandidate(canonicalPath)
    } catch {
      return false
    }
  }

  async scanPdkDirectory(path: string): Promise<ScannedPdkDirectory> {
    const canonicalPath = await canonicalizeExistingDirectory(path)
    const detectedFiles = await scanTopLevelEntries(canonicalPath)

    let name = getPathLeafName(canonicalPath) || 'Unknown PDK'
    let description = ''
    let techNode = ''
    let pdkId = name.toLowerCase().replace(/[^a-z0-9]+/g, '_')

    if (
      detectedFiles.directories.includes('prtech') &&
      detectedFiles.directories.includes('IP')
    ) {
      name = 'ics55'
      description = 'ICSPROUT 55nm process library (auto-detected)'
      techNode = '55nm'
      pdkId = 'ics55'
    } else if (
      detectedFiles.directories.some((directory) => directory.startsWith('sky130'))
    ) {
      name = 'SkyWater SKY130 PDK'
      description = 'SkyWater 130nm open-source PDK (auto-detected)'
      techNode = '130nm'
      pdkId = 'sky130'
    } else if (
      detectedFiles.files.some((fileName) => fileName.endsWith('.lef')) ||
      detectedFiles.files.some((fileName) => fileName.endsWith('.lib'))
    ) {
      description = 'Process library files detected'
    }

    return {
      canonicalPath,
      name,
      description,
      techNode,
      pdkId,
      detectedFiles,
    }
  }
}

async function detectFrontendExtraRoots(projectRoot: string): Promise<string[]> {
  const parametersPath = join(projectRoot, 'home', 'parameters.json')
  let parameters: Record<string, unknown>
  try {
    parameters = JSON.parse(await readFile(parametersPath, 'utf8')) as Record<
      string,
      unknown
    >
  } catch {
    return []
  }

  if (parameters['Design Tool'] !== 'frontend') return []

  const roots = new Set<string>()
  await Promise.all(
    FRONTEND_EXTRA_ROOT_PATH_FIELDS.map(async (field) => {
      const value = parameters[field]
      if (typeof value !== 'string' || !value.trim()) return
      try {
        const path = resolve(value)
        const pathStats = await stat(path)
        roots.add(
          await canonicalizeExistingDirectory(
            pathStats.isDirectory() ? path : dirname(path),
          ),
        )
      } catch {
        // Optional frontend inputs may be stale; ecc-fe reports required inputs.
      }
    }),
  )
  await Promise.all(
    FRONTEND_FILELIST_FIELDS.map(async (field) => {
      const value = parameters[field]
      if (typeof value !== 'string' || !value.trim()) return
      try {
        const filelistPath = resolve(value)
        const filelistRoot = dirname(await canonicalizeExistingPath(filelistPath))
        for (const sourceRoot of await readFrontendFilelistSourceRoots(
          filelistPath,
          filelistRoot,
        )) {
          roots.add(sourceRoot)
        }
      } catch {
        // Optional frontend filelists may be stale; ecc-fe reports required inputs.
      }
    }),
  )

  roots.delete(projectRoot)
  return [...roots].filter((root) => !isPathWithinRoot(root, projectRoot))
}

async function readFrontendFilelistSourceRoots(
  filelistPath: string,
  filelistRoot: string,
): Promise<string[]> {
  const raw = await readFile(filelistPath, 'utf8')
  const roots = new Set<string>()
  const pending: Array<{ path: string; root: string }> = [
    { path: filelistPath, root: filelistRoot },
  ]
  const visited = new Set<string>()

  while (pending.length) {
    const current = pending.pop()
    if (!current) break
    let canonicalFilelist: string
    try {
      canonicalFilelist = await canonicalizeExistingPath(current.path)
    } catch {
      continue
    }
    if (visited.has(canonicalFilelist)) continue
    visited.add(canonicalFilelist)

    let content: string
    try {
      content =
        current.path === filelistPath ? raw : await readFile(canonicalFilelist, 'utf8')
    } catch {
      continue
    }
    for (const line of content.split(/\r?\n/)) {
      const token = normalizeFrontendFilelistToken(line)
      if (!token) continue
      if (token.startsWith('+incdir+')) {
        const incdir = token.slice('+incdir+'.length).trim()
        if (incdir) {
          try {
            roots.add(await canonicalizeExistingDirectory(resolve(current.root, incdir)))
          } catch {
            // Ignore stale include directories.
          }
        }
        continue
      }
      if (token.startsWith('-f')) {
        const includePath = token.slice(2).trim()
        if (includePath) {
          const resolvedInclude = resolve(current.root, includePath)
          pending.push({
            path: resolvedInclude,
            root: dirname(resolvedInclude),
          })
        }
        continue
      }
      if (!/\.(sv|svh|v|vh|f|fl|filelist)$/i.test(token)) continue
      const resolvedPath = resolve(current.root, token)
      if (/\.(f|fl|filelist)$/i.test(token)) {
        pending.push({ path: resolvedPath, root: dirname(resolvedPath) })
        continue
      }
      try {
        roots.add(dirname(await canonicalizeExistingPath(resolvedPath)))
      } catch {
        // Ignore stale entries; ecc-fe reports required missing inputs.
      }
    }
  }

  return [...roots]
}

function normalizeFrontendFilelistToken(line: string): string {
  const withoutComment = line.replace(/\/\/.*$/, '').trim()
  if (!withoutComment || withoutComment.startsWith('+define+')) return ''
  const parts = withoutComment.split(/\s+/)
  const first = parts[0] ?? ''
  const second = parts[1] ?? ''
  if (first === '-f' && second) return `-f${second}`
  return first.replace(/^['"]|['"]$/g, '')
}
