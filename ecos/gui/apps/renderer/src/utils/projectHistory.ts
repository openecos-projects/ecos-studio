import type { DesktopSettingsValue } from '@ecos-studio/shared'
import { waitForDesktopApi } from '@/platform/desktop'
import type { Project, ProjectStatus } from '@/types'

const PROJECT_HISTORY_SETTING_KEY = 'project_history'

interface SerializedProjectHistoryEntry {
  id: string
  name: string
  path: string
  lastOpened: string
  pdk?: string
  topModule?: string
  status?: ProjectStatus
}

export async function loadProjectHistory(): Promise<Project[]> {
  const savedProjects = await getSetting<unknown>(PROJECT_HISTORY_SETTING_KEY)
  if (!Array.isArray(savedProjects)) return []

  return savedProjects
    .map(deserializeProjectHistoryEntry)
    .filter((project): project is Project => project !== null)
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

function normalizeProjectHistoryEntry(project: Project): Project {
  const path = normalizePath(project.path)
  return {
    ...project,
    id: path,
    path,
    lastOpened: new Date(project.lastOpened),
  }
}

function serializeProjectHistoryEntry(project: Project): SerializedProjectHistoryEntry {
  return {
    id: normalizePath(project.path),
    name: project.name,
    path: normalizePath(project.path),
    lastOpened: new Date(project.lastOpened).toISOString(),
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
