import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path'
import type { PdkDetectedFiles, ScannedPdkDirectory } from '@ecos-studio/shared'
import { requireWindowScopeId } from './windowScopeContext'

const REQUIRED_PROJECT_FILES = ['flow.json', 'parameters.json']
const PDK_RESOURCE_FILE_EXTENSIONS = ['.lef', '.lib', '.liberty']
const FRONTEND_EXTRA_ROOT_PATH_FIELDS = [
  'sim_soc_root',
  'sim_programs_dir',
  'sim_tests_dir',
]
const FRONTEND_FILELIST_FIELDS = ['cpu_filelist', 'soc_filelist']

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

function isWithinRoot(candidatePath: string, rootPath: string): boolean {
  const relativePath = relative(rootPath, candidatePath)
  return (
    relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  )
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

interface ProjectScopeRoots {
  extraRoots: string[]
  projectRoot: string
}

export class ProjectScopeService {
  private readonly rootsByWindowId = new Map<number, ProjectScopeRoots>()

  async resolveProjectRoot(path: string): Promise<string> {
    return await canonicalizeExistingDirectory(path)
  }

  async getProjectRoot(): Promise<string> {
    const roots = this.rootsByWindowId.get(requireWindowScopeId())
    if (!roots) {
      throw new Error('Project root is not registered')
    }

    return roots.projectRoot
  }

  async registerProjectRoot(path: string): Promise<string> {
    const windowId = requireWindowScopeId()
    const canonicalPath = await this.resolveProjectRoot(path)
    this.rootsByWindowId.set(windowId, {
      extraRoots: await detectFrontendExtraRoots(canonicalPath),
      projectRoot: canonicalPath,
    })
    return canonicalPath
  }

  async clearProjectRoot(): Promise<void> {
    this.rootsByWindowId.delete(requireWindowScopeId())
  }

  clearWindow(windowId: number): void {
    this.rootsByWindowId.delete(windowId)
  }

  async requestProjectPathAccess(path: string): Promise<string> {
    const roots = this.rootsByWindowId.get(requireWindowScopeId())
    if (!roots) {
      throw new Error('Project root is not registered')
    }

    const allowedRoots = [roots.projectRoot, ...roots.extraRoots]
    for (const root of allowedRoots) {
      try {
        const canonicalPath = await canonicalizePotentialPathWithinRoot(path, root)

        if (isWithinRoot(canonicalPath, root)) {
          return canonicalPath
        }
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith('Refusing to grant access outside')
        ) {
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
  return [...roots].filter((root) => !isWithinRoot(root, projectRoot))
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
