import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadProjectHistory,
  rememberProjectHistoryEntry,
  removeProjectHistoryEntry,
} from './projectHistory'
import type { Project } from '@/types'

const settings = new Map<string, unknown>()
const settingsGet = vi.fn(async (key: string) => settings.get(key) ?? null)
const settingsSet = vi.fn(async (key: string, value: unknown) => {
  settings.set(key, value)
})
const readManifest = vi.fn(async (projectRoot: string) => {
  if (projectRoot !== '/projects/gcd') return null
  return gcdManifest()
})

vi.mock('@/platform/desktop', () => ({
  getDesktopApi: vi.fn(() => ({
    settings: {
      get: settingsGet,
      set: settingsSet,
    },
    projectManagement: {
      readManifest,
    },
  })),
}))

function project(input: Partial<Project> & Pick<Project, 'name' | 'path'>): Project {
  return {
    id: input.path,
    name: input.name,
    path: input.path,
    lastOpened: input.lastOpened ?? new Date('2026-07-02T08:00:00.000Z'),
    status: input.status ?? 'not_started',
    pdk: input.pdk,
    topModule: input.topModule,
  }
}

function ioError(code: string, message = code): Error {
  return Object.assign(new Error(message), { code })
}

function historyEntry(
  path: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: path,
    name: extra.name ?? path.split('/').pop(),
    path,
    lastOpened: extra.lastOpened ?? '2026-07-02T08:00:00.000Z',
    ...extra,
  }
}

describe('project history', () => {
  beforeEach(() => {
    settings.clear()
    settingsGet.mockClear()
    settingsSet.mockClear()
    readManifest.mockReset()
    readManifest.mockImplementation(async (projectRoot: string) => {
      if (projectRoot !== '/projects/gcd') return null
      return gcdManifest()
    })
  })

  it('loads stored project roots without re-reading workspace recent_projects', async () => {
    settings.set('recent_projects', [
      {
        id: '/work/ws_0001',
        name: 'workspace',
        path: '/work/ws_0001',
        lastOpened: '2026-07-02T07:00:00.000Z',
      },
    ])
    settings.set('project_history', [
      {
        id: '/projects/gcd',
        name: 'gcd',
        path: '/projects/gcd/',
        lastOpened: '2026-07-02T08:00:00.000Z',
        pdk: 'ics55',
        topModule: 'gcd',
      },
    ])

    const history = await loadProjectHistory()

    expect(settingsGet).toHaveBeenCalledWith('project_history')
    expect(settingsGet).not.toHaveBeenCalledWith('recent_projects')
    expect(readManifest).toHaveBeenCalledWith('/projects/gcd')
    expect(history).toEqual([
      expect.objectContaining({
        id: '/projects/gcd',
        name: 'gcd',
        path: '/projects/gcd',
        lastOpened: new Date('2026-07-02T08:00:00.000Z'),
        pdk: 'ics55',
        topModule: 'gcd',
      }),
    ])
  })

  it('migrates legacy recent workspace paths to their validated Project root', async () => {
    settings.set('recent_projects', [
      {
        id: '/projects/gcd/ws_0001',
        name: 'gcd/ws_0001',
        path: '/projects/gcd/ws_0001',
        lastOpened: '2026-07-02T08:00:00.000Z',
        status: 'success',
      },
      {
        id: '/projects/gcd/ws_0002',
        name: 'gcd/ws_0002',
        path: '/projects/gcd/ws_0002',
        lastOpened: '2026-07-02T09:00:00.000Z',
      },
    ])

    const history = await loadProjectHistory()

    expect(readManifest).toHaveBeenCalledWith('/projects/gcd')
    expect(history).toEqual([
      expect.objectContaining({
        id: '/projects/gcd',
        name: 'gcd',
        path: '/projects/gcd',
        lastOpened: new Date('2026-07-02T09:00:00.000Z'),
        pdk: 'ics55',
        topModule: 'gcd',
      }),
    ])
    expect(settings.get('project_history')).toEqual([
      expect.objectContaining({
        id: '/projects/gcd',
        path: '/projects/gcd',
        lastOpened: '2026-07-02T09:00:00.000Z',
      }),
    ])
  })

  it('remembers project roots without writing workspace recent_projects', async () => {
    await rememberProjectHistoryEntry(
      project({
        name: 'gcd',
        path: '/projects/gcd/',
        lastOpened: new Date('2026-07-02T08:00:00.000Z'),
      }),
    )
    await rememberProjectHistoryEntry(
      project({
        name: 'gcd updated',
        path: '/projects/gcd',
        lastOpened: new Date('2026-07-02T09:00:00.000Z'),
        pdk: 'ics55',
      }),
    )

    expect(settingsSet).toHaveBeenCalledWith('project_history', [
      expect.objectContaining({
        id: '/projects/gcd',
        name: 'gcd updated',
        path: '/projects/gcd',
        lastOpened: '2026-07-02T09:00:00.000Z',
        pdk: 'ics55',
      }),
    ])
    expect(settings.has('recent_projects')).toBe(false)
    expect(await loadProjectHistory()).toHaveLength(1)
  })

  it('prunes gone roots before remembering another project', async () => {
    settings.set('project_history', [
      historyEntry('/projects/missing', { name: 'missing' }),
    ])
    readManifest.mockImplementation(async (projectRoot: string) => {
      if (projectRoot === '/projects/gcd') return gcdManifest()
      throw ioError('ENOENT')
    })

    const history = await rememberProjectHistoryEntry(
      project({
        name: 'gcd',
        path: '/projects/gcd',
        lastOpened: new Date('2026-07-02T09:00:00.000Z'),
      }),
    )

    expect(history).toEqual([expect.objectContaining({ path: '/projects/gcd' })])
    expect(settings.get('project_history')).toEqual([
      expect.objectContaining({ path: '/projects/gcd' }),
    ])
  })

  it('removes a project root from project_history only', async () => {
    settings.set('project_history', [
      {
        id: '/projects/gcd',
        name: 'gcd',
        path: '/projects/gcd',
        lastOpened: '2026-07-02T08:00:00.000Z',
      },
      {
        id: '/projects/uart',
        name: 'uart',
        path: '/projects/uart',
        lastOpened: '2026-07-02T07:00:00.000Z',
      },
    ])

    const history = await removeProjectHistoryEntry('/projects/gcd')

    expect(history).toEqual([expect.objectContaining({ path: '/projects/uart' })])
    expect(settingsSet).toHaveBeenCalledWith('project_history', [
      expect.objectContaining({
        id: '/projects/uart',
        path: '/projects/uart',
      }),
    ])
  })

  it('forgets stored roots whose directories are gone and writes the remainder', async () => {
    settings.set('project_history', [
      historyEntry('/projects/gcd'),
      historyEntry('/projects/missing', { name: 'missing' }),
    ])
    readManifest.mockImplementation(async (projectRoot: string) => {
      if (projectRoot === '/projects/gcd') return gcdManifest()
      throw ioError('ENOENT')
    })

    const history = await loadProjectHistory()

    expect(history).toEqual([expect.objectContaining({ path: '/projects/gcd' })])
    expect(settings.get('project_history')).toEqual([
      expect.objectContaining({ id: '/projects/gcd', path: '/projects/gcd' }),
    ])
  })

  it('forgets stored roots that resolve to a non-directory', async () => {
    settings.set('project_history', [historyEntry('/projects/gcd')])
    readManifest.mockRejectedValue(ioError('ENOTDIR'))

    await expect(loadProjectHistory()).resolves.toEqual([])
    expect(settings.get('project_history')).toEqual([])
  })

  it('keeps a stored root when project.json is missing or the read is not gone', async () => {
    settings.set('project_history', [
      historyEntry('/projects/empty'),
      historyEntry('/projects/denied'),
    ])
    readManifest.mockImplementation(async (projectRoot: string) => {
      if (projectRoot === '/projects/empty') return null
      throw ioError('EACCES')
    })

    const history = await loadProjectHistory()

    expect(history.map((item) => item.path)).toEqual([
      '/projects/empty',
      '/projects/denied',
    ])
    expect(settingsSet).not.toHaveBeenCalled()
  })

  it('does not migrate recent_projects once project_history has been written as empty', async () => {
    settings.set('project_history', [])
    settings.set('recent_projects', [
      historyEntry('/projects/gcd/ws_0001', { name: 'gcd/ws_0001' }),
    ])

    await expect(loadProjectHistory()).resolves.toEqual([])
    expect(settingsGet).not.toHaveBeenCalledWith('recent_projects')
    expect(readManifest).not.toHaveBeenCalled()
  })

  it('does not migrate recent_projects after auto-forgetting the last stored root', async () => {
    settings.set('project_history', [
      historyEntry('/projects/missing', { name: 'missing' }),
    ])
    settings.set('recent_projects', [
      historyEntry('/projects/gcd/ws_0001', { name: 'gcd/ws_0001' }),
    ])
    readManifest.mockRejectedValue(ioError('ENOENT'))

    await expect(loadProjectHistory()).resolves.toEqual([])
    expect(settings.get('project_history')).toEqual([])
    expect(settingsGet).not.toHaveBeenCalledWith('recent_projects')
  })
})

function gcdManifest() {
  return {
    schema_version: 1,
    project_id: 'proj_gcd',
    name: 'gcd',
    design_name: 'gcd',
    root_path: '/projects/gcd',
    created_at: '2026-07-02T07:00:00.000Z',
    updated_at: '2026-07-02T07:00:00.000Z',
    base_design: { pdk: 'ics55', top_module: 'gcd', parameters: { design: 'gcd' } },
    objectives: { primary: 'timing', directions: {} },
    workspaces: [],
    mpc: null,
    best_workspace: null,
    qor_baseline: null,
  }
}
