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

vi.mock('@/platform/desktop', () => ({
  waitForDesktopApi: vi.fn(async () => ({
    settings: {
      get: settingsGet,
      set: settingsSet,
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

describe('project history', () => {
  beforeEach(() => {
    settings.clear()
    settingsGet.mockClear()
    settingsSet.mockClear()
  })

  it('loads project roots from project_history rather than workspace recent_projects', async () => {
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
})
