import {
  isProjectManifestType,
  parseProjectManifest,
  type DesktopSettingsValue,
  type ProjectManifestType,
} from '@ecos-studio/shared'
import { waitForDesktopApi } from '@/platform/desktop'
import type { Project, ProjectStatus } from '@/types'
import { readProjectManagementManifest } from './projectManagementRead'

const PROJECT_HISTORY_SETTING_KEY = 'project_history'
const LEGACY_RECENT_PROJECTS_SETTING_KEY = 'recent_projects'
const LEGACY_PROJECT_ROOT_READ_CONCURRENCY = 2

interface SerializedProjectHistoryEntry {
  id: string
  name: string
  path: string
  lastOpened: string
  projectType?: ProjectManifestType
  pdk?: string
  topModule?: string
  status?: ProjectStatus
}

export async function loadProjectHistory(): Promise<Project[]> {
  const savedProjects = await getSetting<unknown>(PROJECT_HISTORY_SETTING_KEY)
  const history = Array.isArray(savedProjects)
    ? savedProjects
        .map(deserializeProjectHistoryEntry)
        .filter((project): project is Project => project !== null)
    : []
  if (history.length > 0) return history

  const legacyProjects = await getSetting<unknown>(LEGACY_RECENT_PROJECTS_SETTING_KEY)
  if (!Array.isArray(legacyProjects)) return []

  const migratedHistory = await migrateLegacyWorkspaceHistory(legacyProjects)
  if (migratedHistory.length > 0) await saveProjectHistory(migratedHistory)
  return migratedHistory
}

export async function rememberProjectHistoryEntry(project: Project): Promise<Project[]> {
  const history = await loadProjectHistory()
  const normalizedProject = normalizeProjectHistoryEntry(project)
  const filtered = history.filter(
    (item) => normalizePath(item.path) !== normalizedProject.path,
  )
  const nextHistory = [normalizedProject, ...filtered]

  await saveProjectHistory(nextHistory)
  return nextHistory
}

export async function removeProjectHistoryEntry(
  projectIdOrPath: string,
): Promise<Project[]> {
  const target = normalizePath(projectIdOrPath)
  const history = await loadProjectHistory()
  const nextHistory = history.filter(
    (project) =>
      normalizePath(project.id) !== target && normalizePath(project.path) !== target,
  )

  await saveProjectHistory(nextHistory)
  return nextHistory
}

async function saveProjectHistory(projects: Project[]): Promise<void> {
  await setSetting(
    PROJECT_HISTORY_SETTING_KEY,
    projects.map(serializeProjectHistoryEntry),
  )
}

async function getSetting<T>(key: string): Promise<T | null> {
  const desktopApi = await waitForDesktopApi()
  return (await desktopApi.settings.get(key)) as T | null
}

async function setSetting(key: string, value: unknown): Promise<void> {
  const desktopApi = await waitForDesktopApi()
  await desktopApi.settings.set(key, value as DesktopSettingsValue)
}

/**
 * Older desktop builds only recorded opened workspaces. Recover their enclosing
 * Project roots through the bounded Project Management IPC, never renderer FS access.
 */
async function migrateLegacyWorkspaceHistory(values: unknown[]): Promise<Project[]> {
  const candidates = values.flatMap((value) => {
    const workspace = deserializeProjectHistoryEntry(value)
    if (!workspace) return []
    return projectRootCandidates(workspace.path).map((projectRoot) => ({
      projectRoot,
      workspace,
    }))
  })

  const discovered = await mapWithConcurrency(
    candidates,
    LEGACY_PROJECT_ROOT_READ_CONCURRENCY,
    async ({ projectRoot, workspace }) => {
      try {
        const manifestText = await readProjectManagementManifest(projectRoot)
        if (!manifestText) return null
        const manifest = parseProjectManifest(manifestText)
        return projectFromLegacyWorkspace(manifest, workspace)
      } catch {
        // A stale workspace history entry is expected during migration.
        return null
      }
    },
  )

  const projectsByPath = new Map<string, Project>()
  for (const project of discovered) {
    if (!project) continue
    const existing = projectsByPath.get(project.path)
    if (!existing || existing.lastOpened < project.lastOpened) {
      projectsByPath.set(project.path, project)
    }
  }
  return [...projectsByPath.values()].sort(
    (left, right) => right.lastOpened.getTime() - left.lastOpened.getTime(),
  )
}

function projectRootCandidates(workspacePath: string): string[] {
  const normalizedPath = normalizePath(workspacePath)
  const parentPath = parentLocalPath(normalizedPath)
  return [...new Set([normalizedPath, parentPath].filter(Boolean))]
}

function parentLocalPath(path: string): string {
  const separatorIndex = path.lastIndexOf('/')
  if (separatorIndex < 0) return ''
  if (separatorIndex === 0) return '/'
  return path.slice(0, separatorIndex)
}

function projectFromLegacyWorkspace(
  manifest: ReturnType<typeof parseProjectManifest>,
  workspace: Project,
): Project {
  const path = normalizePath(manifest.root_path)
  return {
    id: path,
    name: manifest.name,
    path,
    lastOpened: workspace.lastOpened,
    pdk: manifest.base_design.pdk,
    topModule: manifest.base_design.top_module,
    projectType: manifest.project_type,
    status: workspace.status,
  }
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  results.length = values.length
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

function normalizeProjectHistoryEntry(project: Project): Project {
  const path = normalizePath(project.path)
  return {
    ...project,
    id: path,
    path,
    lastOpened: new Date(project.lastOpened),
    projectType: project.projectType ?? 'backend',
  }
}

function serializeProjectHistoryEntry(project: Project): SerializedProjectHistoryEntry {
  return {
    id: normalizePath(project.path),
    name: project.name,
    path: normalizePath(project.path),
    lastOpened: new Date(project.lastOpened).toISOString(),
    projectType: project.projectType ?? 'backend',
    pdk: project.pdk,
    topModule: project.topModule,
    status: project.status,
  }
}

function deserializeProjectHistoryEntry(value: unknown): Project | null {
  if (!isRecord(value)) return null
  const path = asString(value.path)
  const name = asString(value.name)
  const lastOpened = asString(value.lastOpened)
  if (!path || !name || !lastOpened) return null

  const normalizedPath = normalizePath(path)
  return {
    id: normalizedPath,
    name,
    path: normalizedPath,
    lastOpened: new Date(lastOpened),
    projectType: isProjectManifestType(value.projectType) ? value.projectType : 'backend',
    pdk: asString(value.pdk),
    topModule: asString(value.topModule),
    status: asProjectStatus(value.status),
  }
}

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  if (normalized.endsWith('/') && normalized.length > 1) return normalized.slice(0, -1)
  return normalized
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asProjectStatus(value: unknown): ProjectStatus | undefined {
  if (
    value === 'success' ||
    value === 'failed' ||
    value === 'running' ||
    value === 'in_progress' ||
    value === 'not_started'
  ) {
    return value
  }
  return undefined
}
