import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path'
import type { PdkDetectedFiles, ScannedPdkDirectory } from '@ecos-studio/shared'

const REQUIRED_PROJECT_FILES = ['flow.json', 'parameters.json']
const TOP_LEVEL_ENTRY_LIMIT = 20
const FRONTEND_EXTRA_ROOT_PATH_FIELDS = [
  'cpu_filelist',
  'soc_filelist',
  'sim_soc_root',
  'sim_programs_dir',
  'sim_tests_dir',
]

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
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === code
  )
}

function isWithinRoot(candidatePath: string, rootPath: string): boolean {
  const relativePath = relative(rootPath, candidatePath)
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

async function canonicalizePotentialPathWithinRoot(
  path: string,
  rootPath: string,
): Promise<string> {
  const candidatePath = resolve(path)

  if (!isWithinRoot(candidatePath, rootPath)) {
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

async function scanTopLevelEntries(path: string): Promise<PdkDetectedFiles> {
  const entries = await readdir(path, { withFileTypes: true })
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .slice(0, TOP_LEVEL_ENTRY_LIMIT)
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort()
    .slice(0, TOP_LEVEL_ENTRY_LIMIT)

  return {
    directories,
    files,
  }
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
  private activeProjectRoot: string | null = null
  private activeExtraRoots: string[] = []

  async getProjectRoot(): Promise<string> {
    if (!this.activeProjectRoot) {
      throw new Error('Project root is not registered')
    }

    return this.activeProjectRoot
  }

  async registerProjectRoot(path: string): Promise<string> {
    const canonicalPath = await canonicalizeExistingDirectory(path)
    this.activeProjectRoot = canonicalPath
    this.activeExtraRoots = await detectFrontendExtraRoots(canonicalPath)
    return canonicalPath
  }

  async clearProjectRoot(): Promise<void> {
    this.activeProjectRoot = null
    this.activeExtraRoots = []
  }

  async requestProjectPathAccess(path: string): Promise<string> {
    if (!this.activeProjectRoot) {
      throw new Error('Project root is not registered')
    }

    const allowedRoots = [this.activeProjectRoot, ...this.activeExtraRoots]
    for (const root of allowedRoots) {
      try {
        const canonicalPath = await canonicalizePotentialPathWithinRoot(path, root)

        if (isWithinRoot(canonicalPath, root)) {
          return canonicalPath
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Refusing to grant access outside')) {
          continue
        }

        throw error
      }
    }

    throw new Error(
      `Refusing to grant access outside current project scope: ${resolve(path)}`,
    )
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
    } else if (detectedFiles.directories.some((directory) => directory.startsWith('sky130'))) {
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
    parameters = JSON.parse(await readFile(parametersPath, 'utf8')) as Record<string, unknown>
  } catch {
    return []
  }

  if (parameters['Design Tool'] !== 'frontend') {
    return []
  }

  const roots = new Set<string>()
  await Promise.all(
    FRONTEND_EXTRA_ROOT_PATH_FIELDS.map(async (field) => {
      const value = parameters[field]
      if (typeof value !== 'string' || !value.trim()) return

      try {
        const path = resolve(value)
        const pathStats = await stat(path)
        const root = pathStats.isDirectory() ? path : dirname(path)
        roots.add(await canonicalizeExistingDirectory(root))
      } catch {
        // Missing optional frontend inputs should not block opening the workspace.
      }
    }),
  )

  roots.delete(projectRoot)
  return [...roots].filter((root) => !isWithinRoot(root, projectRoot))
}
