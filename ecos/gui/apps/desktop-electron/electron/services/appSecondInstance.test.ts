import { describe, expect, it, vi } from 'vitest'
import { extractWorkspacePathFromArgv, handleSecondInstance } from './appSecondInstance'

describe('extractWorkspacePathFromArgv', () => {
  it('returns the last absolute path-like argument after the executable', () => {
    expect(
      extractWorkspacePathFromArgv([
        '/usr/bin/ecos-studio',
        '--enable-logging',
        '/work/demo/',
      ]),
    ).toBe('/work/demo')
  })

  it('ignores the executable even when it is the only absolute path', () => {
    expect(
      extractWorkspacePathFromArgv(['/usr/bin/ecos-studio', '--enable-logging']),
    ).toBeNull()
  })

  it('ignores flags, scripts, and electron runtime paths', () => {
    expect(
      extractWorkspacePathFromArgv(['electron', 'dist/main/index.js', '--dev']),
    ).toBeNull()
    expect(
      extractWorkspacePathFromArgv([
        '/home/dev/node_modules/electron/dist/electron',
        '/home/dev/apps/desktop-electron/node_modules/electron/dist/electron',
      ]),
    ).toBeNull()
  })
})

describe('handleSecondInstance', () => {
  it('opens a new window when no workspace path is provided', async () => {
    const launchWindow = vi.fn()

    await handleSecondInstance(['ecos-studio'], {
      launchWindow,
    })

    expect(launchWindow).toHaveBeenCalledTimes(1)
    expect(launchWindow).toHaveBeenCalledWith()
  })

  it('launches a window when none exist', async () => {
    const launchWindow = vi.fn()

    await handleSecondInstance(['ecos-studio'], {
      launchWindow,
    })

    expect(launchWindow).toHaveBeenCalledTimes(1)
  })

  it('returns early when openOrFocusPath focuses an existing workspace', async () => {
    const launchWindow = vi.fn()
    const openOrFocusPath = vi.fn().mockResolvedValue('focused')

    await handleSecondInstance(['ecos-studio', '/work/demo'], {
      launchWindow,
      openOrFocusPath,
    })

    expect(openOrFocusPath).toHaveBeenCalledWith('/work/demo')
    expect(launchWindow).not.toHaveBeenCalled()
  })

  it('opens a new window for an unbound workspace path', async () => {
    const launchWindow = vi.fn()

    await handleSecondInstance(['ecos-studio', '/work/demo'], {
      launchWindow,
      openOrFocusPath: vi.fn().mockResolvedValue('proceed'),
    })

    expect(launchWindow).toHaveBeenCalledWith({ openWorkspacePath: '/work/demo' })
  })

  it('opens an empty window when argv path fails workspace validation', async () => {
    const launchWindow = vi.fn()
    const openOrFocusPath = vi.fn()

    await handleSecondInstance(
      ['/usr/bin/ecos-studio', '/home/dev/ecos-studio-electron'],
      {
        isWorkspacePath: vi.fn().mockResolvedValue(false),
        launchWindow,
        openOrFocusPath,
      },
    )

    expect(openOrFocusPath).not.toHaveBeenCalled()
    expect(launchWindow).toHaveBeenCalledTimes(1)
    expect(launchWindow).toHaveBeenCalledWith()
  })
})
