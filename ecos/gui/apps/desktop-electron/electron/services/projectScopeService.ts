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

const REQUIRED_PROJECT_FILES = ['flow.json', 'parameters.json']
const PDK_RESOURCE_FILE_EXTENSIONS = ['.lef', '.lib', '.liberty']

interface ProjectReadScope {
  projectRoot: string
  workspaceRoots: string[]
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

  return requiredFileChecks.every(Boolean)
}

function getPathLeafName(path: string): string | null {
  const trimmedPath = path.replace(/[\\/]+$/, '')
  const leafName = win32.basename(trimmedPath)

  return leafName || null
}

export class ProjectScopeService {
  private readonly rootsByWindowId = new Map<number, string>()
  private readonly readScopesByWindowId = new Map<number, ProjectReadScope>()

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
    this.rootsByWindowId.set(windowId, canonicalPath)
    this.readScopesByWindowId.delete(windowId)
    return canonicalPath
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
    this.readScopesByWindowId.delete(windowId)
  }

  clearWindow(windowId: number): void {
    this.rootsByWindowId.delete(windowId)
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
    const roots = [activeProjectRoot]
    if (readScope) {
      if (pathsEqual(candidatePath, join(readScope.projectRoot, 'project.json'))) {
        roots.push(readScope.projectRoot)
      } else {
        roots.push(...readScope.workspaceRoots)
      }
    }

    for (const root of roots) {
      if (!isPathWithinRoot(candidatePath, root)) continue
      const canonicalPath = await canonicalizePotentialPathWithinRoot(path, root)
      if (isPathWithinRoot(canonicalPath, root)) return canonicalPath
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
