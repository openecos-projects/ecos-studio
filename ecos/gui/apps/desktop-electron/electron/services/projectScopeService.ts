import { readdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, win32 } from 'node:path'
import type { PdkDetectedFiles, ScannedPdkDirectory } from '@ecos-studio/shared'

const PROJECT_MARKER_FILES = ['home.json', 'flow.json', 'parameters.json']
const TOP_LEVEL_ENTRY_LIMIT = 20

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

  const markerChecks = await Promise.all(
    PROJECT_MARKER_FILES.map(async (markerFileName) => {
      try {
        const markerStats = await stat(`${homeDirectory}/${markerFileName}`)
        return markerStats.isFile()
      } catch {
        return false
      }
    }),
  )

  return markerChecks.some(Boolean)
}

function getPathLeafName(path: string): string | null {
  const trimmedPath = path.replace(/[\\/]+$/, '')
  const leafName = win32.basename(trimmedPath)

  return leafName || null
}

export class ProjectScopeService {
  private activeProjectRoot: string | null = null

  async getProjectRoot(): Promise<string> {
    if (!this.activeProjectRoot) {
      throw new Error('Project root is not registered')
    }

    return this.activeProjectRoot
  }

  async registerProjectRoot(path: string): Promise<string> {
    const canonicalPath = await canonicalizeExistingDirectory(path)
    this.activeProjectRoot = canonicalPath
    return canonicalPath
  }

  async clearProjectRoot(): Promise<void> {
    this.activeProjectRoot = null
  }

  async requestProjectPathAccess(path: string): Promise<string> {
    if (!this.activeProjectRoot) {
      throw new Error('Project root is not registered')
    }

    const canonicalPath = await canonicalizePotentialPathWithinRoot(path, this.activeProjectRoot)

    if (!isWithinRoot(canonicalPath, this.activeProjectRoot)) {
      throw new Error(
        `Refusing to grant access outside current project root: ${canonicalPath}`,
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
