import { describe, expect, it, vi } from 'vitest'

import { consumeOpenWorkspaceLaunchQuery } from './openWorkspaceLaunchQuery'

describe('consumeOpenWorkspaceLaunchQuery', () => {
  it('opens the workspace and navigates on success', async () => {
    const openProject = vi.fn().mockResolvedValue(true)
    const replaceWorkspaceRoute = vi.fn().mockResolvedValue(undefined)
    const clearOpenWorkspaceQuery = vi.fn().mockResolvedValue(undefined)

    await expect(
      consumeOpenWorkspaceLaunchQuery('/work/demo', {
        clearOpenWorkspaceQuery,
        openProject,
        replaceWorkspaceRoute,
      }),
    ).resolves.toBe(true)

    expect(openProject).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '/work/demo',
        name: 'demo',
        path: '/work/demo',
      }),
      { quiet: true },
    )
    expect(replaceWorkspaceRoute).toHaveBeenCalledTimes(1)
    expect(clearOpenWorkspaceQuery).not.toHaveBeenCalled()
  })

  it('clears the query when openProject fails', async () => {
    const openProject = vi.fn().mockResolvedValue(false)
    const replaceWorkspaceRoute = vi.fn().mockResolvedValue(undefined)
    const clearOpenWorkspaceQuery = vi.fn().mockResolvedValue(undefined)

    await expect(
      consumeOpenWorkspaceLaunchQuery(['/work/demo/'], {
        clearOpenWorkspaceQuery,
        openProject,
        replaceWorkspaceRoute,
      }),
    ).resolves.toBe(false)

    expect(openProject).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/work/demo/',
        name: 'demo',
      }),
      { quiet: true },
    )
    expect(replaceWorkspaceRoute).not.toHaveBeenCalled()
    expect(clearOpenWorkspaceQuery).toHaveBeenCalledTimes(1)
  })

  it('no-ops for missing or blank query values', async () => {
    const handlers = {
      clearOpenWorkspaceQuery: vi.fn(),
      openProject: vi.fn(),
      replaceWorkspaceRoute: vi.fn(),
    }

    await expect(consumeOpenWorkspaceLaunchQuery(undefined, handlers)).resolves.toBe(
      false,
    )
    await expect(consumeOpenWorkspaceLaunchQuery('   ', handlers)).resolves.toBe(false)
    await expect(consumeOpenWorkspaceLaunchQuery([], handlers)).resolves.toBe(false)

    expect(handlers.openProject).not.toHaveBeenCalled()
  })
})
