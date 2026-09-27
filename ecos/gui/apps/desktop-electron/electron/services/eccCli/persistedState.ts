import { open, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import {
  projectManifestForPresentation,
  type EccProjectManifest,
  type ProjectManifest,
} from '@ecos-studio/shared'

const PROJECT_MAX_BYTES = 4 * 1024 * 1024
const FLOW_MAX_BYTES = 4 * 1024 * 1024
// ECC publishes JSON via a same-directory temp file + atomic rename, so a
// read can briefly race the replacement and observe ENOENT on the old path.
const ENOENT_RETRY_ATTEMPTS = 2
const ENOENT_RETRY_DELAY_MS = 75

export interface PersistedFlowStep {
  name: string
  peakMemory: number
  runtime: string
  state: string
  tool: string
}

export interface PersistedFlow {
  steps: PersistedFlowStep[]
}

export async function readProjectManifest(projectRoot: string): Promise<ProjectManifest> {
  const root = await realpath(projectRoot)
  if (!(await stat(root)).isDirectory())
    throw new Error('Project root is not a directory.')
  const raw = await readBoundedJson(join(root, 'project.json'), PROJECT_MAX_BYTES)
  if (!isProjectManifest(raw)) throw new Error('Project Manifest is invalid.')
  return projectManifestForPresentation(raw, root)
}

export async function discoverProject(
  directory: string,
  knownProjectRoots: readonly string[] = [],
): Promise<{ projectId: string; projectRoot: string } | null> {
  const target = await realpath(directory)
  const candidates = [...ancestorPaths(target), ...knownProjectRoots]
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const root = resolve(candidate)
    if (seen.has(root)) continue
    seen.add(root)
    let manifest: ProjectManifest
    try {
      manifest = await readProjectManifest(root)
    } catch {
      continue
    }
    if (
      manifest.workspaces.some(
        (workspace) => resolve(workspace.workspace_path) === resolve(target),
      ) ||
      resolve(root) === resolve(target)
    ) {
      return { projectId: manifest.project_id, projectRoot: root }
    }
  }
  return null
}

export async function readWorkspaceFlow(directory: string): Promise<PersistedFlow> {
  const raw = await readBoundedJson(join(directory, 'home', 'flow.json'), FLOW_MAX_BYTES)
  if (
    !isRecord(raw) ||
    raw.schema_version !== 1 ||
    !Array.isArray(raw.steps) ||
    raw.steps.length > 4096
  ) {
    throw new Error('Workspace flow is invalid.')
  }
  const steps = raw.steps.map((value) => {
    if (
      !isRecord(value) ||
      typeof value.name !== 'string' ||
      !value.name ||
      value.name.length > 256 ||
      typeof value.state !== 'string' ||
      !value.state ||
      value.state.length > 64 ||
      (value.tool !== undefined &&
        (typeof value.tool !== 'string' || value.tool.length > 256)) ||
      (value.runtime !== undefined &&
        (typeof value.runtime !== 'string' || value.runtime.length > 128)) ||
      (value['peak memory (mb)'] !== undefined &&
        (typeof value['peak memory (mb)'] !== 'number' ||
          !Number.isFinite(value['peak memory (mb)']) ||
          value['peak memory (mb)'] < 0))
    ) {
      throw new Error('Workspace flow step is invalid.')
    }
    return {
      name: value.name,
      peakMemory:
        typeof value['peak memory (mb)'] === 'number' ? value['peak memory (mb)'] : 0,
      runtime: typeof value.runtime === 'string' ? value.runtime : '',
      state: value.state,
      tool: typeof value.tool === 'string' ? value.tool : '',
    }
  })
  return { steps }
}

export function workspaceEntryForDirectory(
  manifest: ProjectManifest,
  directory: string,
): ProjectManifest['workspaces'][number] | null {
  const target = resolve(directory)
  return (
    manifest.workspaces.find(
      (workspace) => resolve(workspace.workspace_path) === target,
    ) ?? null
  )
}

export function workspaceDirectoryForId(
  manifest: ProjectManifest,
  workspaceId: string,
): string {
  const entry = manifest.workspaces.find(
    (workspace) => workspace.workspace_id === workspaceId,
  )
  if (!entry) throw new Error(`Workspace is not declared: ${workspaceId}`)
  return resolve(entry.workspace_path)
}

async function readBoundedJson(path: string, maxBytes: number): Promise<unknown> {
  let attempt = 0
  while (true) {
    try {
      return await readBoundedJsonOnce(path, maxBytes)
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== 'ENOENT' ||
        attempt >= ENOENT_RETRY_ATTEMPTS
      ) {
        throw error
      }
      attempt += 1
      await delay(ENOENT_RETRY_DELAY_MS)
    }
  }
}

async function readBoundedJsonOnce(path: string, maxBytes: number): Promise<unknown> {
  const handle = await open(path, 'r')
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > maxBytes)
      throw new Error(`File is too large: ${path}`)
    const buffer = Buffer.alloc(info.size)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'))
  } finally {
    await handle.close()
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function isProjectManifest(value: unknown): value is EccProjectManifest {
  if (!isRecord(value)) return false
  return (
    value.schema_version === 1 &&
    typeof value.project_id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.design_name === 'string' &&
    typeof value.root_path === 'string' &&
    isRecord(value.base_design) &&
    isRecord(value.objectives) &&
    Array.isArray(value.workspaces) &&
    value.workspaces.length <= 4096 &&
    value.workspaces.every(isWorkspaceEntry)
  )
}

function isWorkspaceEntry(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.workspace_id === 'string' &&
    typeof value.workspace_path === 'string' &&
    (isAbsolute(value.workspace_path) ||
      value.workspace_path
        .replace(/\\/g, '/')
        .split('/')
        .every((part) => part !== '..'))
  )
}

function ancestorPaths(path: string): string[] {
  const result: string[] = []
  let current = resolve(path)
  while (true) {
    result.push(current)
    const parent = dirname(current)
    if (parent === current) return result
    current = parent
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
