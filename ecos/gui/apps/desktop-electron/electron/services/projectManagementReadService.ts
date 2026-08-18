import { open, readdir, realpath, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import {
  parseProjectManifest,
  projectManagementWorkspaceSummaryPaths,
} from '@ecos-studio/shared'
import type {
  DesktopProjectManagementWorkspaceTextsRequest,
  DesktopProjectManagementWorkspaceTextsResult,
} from '@ecos-studio/shared'
import { isPathWithinRoot } from './pathScope'

const PROJECT_MANIFEST_MAX_BYTES = 512 * 1024
const PROJECT_WORKSPACE_TEXT_MAX_BYTES = 256 * 1024
const PROJECT_WORKSPACE_READ_CONCURRENCY = 4
const PROJECT_WORKSPACE_READ_LIMIT = 40

const PROJECT_MANAGEMENT_WORKSPACE_PATHS = new Set(projectManagementWorkspaceSummaryPaths)

class ProjectManagementWorkspacePathError extends Error {}

function pathsEqual(leftPath: string, rightPath: string): boolean {
  return relative(resolve(leftPath), resolve(rightPath)) === ''
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === code
  )
}

async function canonicalizeExistingDirectory(path: string): Promise<string> {
  const canonicalPath = await realpath(path)
  const pathStats = await stat(canonicalPath)
  if (!pathStats.isDirectory()) {
    throw new Error(`Project management path is not a directory: ${path}`)
  }
  return canonicalPath
}

async function readOptionalBoundedTextFile(
  path: string,
  maxBytes: number,
): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(path, 'r')
    const buffer = Buffer.alloc(maxBytes + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (bytesRead > maxBytes) {
      throw new Error(`Project management file exceeds ${maxBytes} bytes: ${path}`)
    }
    return buffer.subarray(0, bytesRead).toString('utf8')
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) return null
    throw error
  } finally {
    await handle?.close()
  }
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  let nextIndex = 0
  const workers = Array.from(
    { length: Math.min(Math.max(concurrency, 1), values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex
        nextIndex += 1
        results[index] = await mapper(values[index]!)
      }
    },
  )
  await Promise.all(workers)
  return results
}

export class ProjectManagementReadService {
  async readManifest(projectRoot: string): Promise<string | null> {
    const root = await canonicalizeExistingDirectory(projectRoot)
    return await readOptionalBoundedTextFile(
      join(root, 'project.json'),
      PROJECT_MANIFEST_MAX_BYTES,
    )
  }

  async listProjectEntries(projectRoot: string): Promise<string[]> {
    const project = await this.loadProject(projectRoot)
    if (!project.manifest) {
      throw new Error('Project manifest does not exist.')
    }
    const entries = await readdir(project.root, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
  }

  async readWorkspaceTexts(
    request: DesktopProjectManagementWorkspaceTextsRequest,
  ): Promise<DesktopProjectManagementWorkspaceTextsResult> {
    const paths = normalizeRequestedPaths(request.paths)
    const project = await this.loadProject(request.projectRoot)
    if (!project.manifest) {
      throw new Error('Project manifest does not exist.')
    }
    const workspacePath = await this.resolveDeclaredWorkspace(
      project.root,
      project.manifest.workspaces.map((workspace) => workspace.workspace_path),
      request.workspacePath,
    )
    const entries = await mapWithConcurrency(
      paths,
      PROJECT_WORKSPACE_READ_CONCURRENCY,
      async (path) => {
        try {
          return {
            path,
            text: await this.readWorkspaceTextFile(
              workspacePath,
              path,
              PROJECT_WORKSPACE_TEXT_MAX_BYTES,
            ),
            unavailable: false,
          }
        } catch (error) {
          if (error instanceof ProjectManagementWorkspacePathError) throw error
          return { path, text: null, unavailable: true }
        }
      },
    )
    return {
      texts: Object.fromEntries(entries.map(({ path, text }) => [path, text])),
      unavailablePaths: entries
        .filter(({ unavailable }) => unavailable)
        .map(({ path }) => path),
    }
  }

  private async loadProject(projectRoot: string) {
    const root = await canonicalizeExistingDirectory(projectRoot)
    const content = await readOptionalBoundedTextFile(
      join(root, 'project.json'),
      PROJECT_MANIFEST_MAX_BYTES,
    )
    if (!content) return { content: null, manifest: null, root }

    const manifest = parseProjectManifest(content)
    const manifestRoot = await canonicalizeExistingDirectory(manifest.root_path)
    if (!pathsEqual(root, manifestRoot)) {
      throw new Error(
        'Project manifest root_path does not match its containing directory.',
      )
    }
    for (const workspace of manifest.workspaces) {
      const candidate = resolve(workspace.workspace_path)
      if (!isPathWithinRoot(candidate, root)) {
        throw new Error('Project manifest contains a workspace outside the project root.')
      }
    }
    return { content, manifest, root }
  }

  private async resolveDeclaredWorkspace(
    projectRoot: string,
    declaredWorkspacePaths: string[],
    workspacePath: string,
  ): Promise<string> {
    if (!declaredWorkspacePaths.some((path) => pathsEqual(path, workspacePath))) {
      throw new Error('Workspace is not declared by the requested project.')
    }

    const candidatePath = resolve(workspacePath)
    if (!isPathWithinRoot(candidatePath, projectRoot)) {
      throw new Error('Workspace is outside the requested project.')
    }

    const canonicalPath = await canonicalizeExistingDirectory(candidatePath)
    if (!isPathWithinRoot(canonicalPath, projectRoot)) {
      throw new Error('Workspace resolves outside the requested project.')
    }
    return canonicalPath
  }

  private async readWorkspaceTextFile(
    workspaceRoot: string,
    relativePath: string,
    maxBytes: number,
  ): Promise<string | null> {
    const requestedPath = join(workspaceRoot, relativePath)
    let canonicalPath: string
    try {
      canonicalPath = await realpath(requestedPath)
    } catch (error) {
      if (isNodeErrorWithCode(error, 'ENOENT')) return null
      throw error
    }
    if (!isPathWithinRoot(canonicalPath, workspaceRoot)) {
      throw new ProjectManagementWorkspacePathError(
        'Project management workspace file resolves outside its workspace.',
      )
    }
    return await readOptionalBoundedTextFile(canonicalPath, maxBytes)
  }
}

function normalizeRequestedPaths(paths: string[]): string[] {
  const uniquePaths = [...new Set(paths)]
  if (uniquePaths.length === 0 || uniquePaths.length > PROJECT_WORKSPACE_READ_LIMIT) {
    throw new Error('Project management workspace read has an invalid path count.')
  }
  for (const path of uniquePaths) {
    if (!PROJECT_MANAGEMENT_WORKSPACE_PATHS.has(path)) {
      throw new Error(`Project management workspace path is not allowed: ${path}`)
    }
  }
  return uniquePaths
}
