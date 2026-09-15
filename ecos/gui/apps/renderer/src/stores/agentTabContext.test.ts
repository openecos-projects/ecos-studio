import { describe, expect, it } from 'vitest'
import {
  existingTabIdForMode,
  resolveAgentTabContext,
  resolveAgentTabTitle,
} from './agentTabContext'

describe('resolveAgentTabTitle', () => {
  it('uses workspace name, then project, then New Agent', () => {
    expect(
      resolveAgentTabTitle({
        mode: 'workspace',
        workspaceName: 'ws_0029',
        existingTitles: [],
      }),
    ).toBe('ws_0029')
    expect(
      resolveAgentTabTitle({
        mode: 'home',
        projectName: 'gcd',
        existingTitles: [],
      }),
    ).toBe('gcd')
    expect(
      resolveAgentTabTitle({
        mode: 'home',
        existingTitles: [],
      }),
    ).toBe('New Agent')
  })

  it('appends step and dedupes titles', () => {
    expect(
      resolveAgentTabTitle({
        mode: 'workspace',
        workspaceName: 'ws_0029',
        workspacePath: '/tmp/ws_0029',
        step: 'place',
        existingTitles: ['ws_0029 · place'],
      }),
    ).toBe('ws_0029 · place (2)')
  })
})

describe('resolveAgentTabContext', () => {
  it('keeps home shell on the project even when a workspace is still open', () => {
    expect(
      resolveAgentTabContext({
        shell: 'home',
        currentWorkspacePath: '/proj/ws_0003',
        currentWorkspaceName: 'ws_0003',
        currentProjectRoot: '/proj',
        routeProjectRoot: '/other',
        step: 'place',
      }),
    ).toEqual({
      mode: 'home',
      projectRoot: '/proj',
      projectName: 'proj',
    })
  })

  it('uses the open workspace only on the workspace shell', () => {
    expect(
      resolveAgentTabContext({
        shell: 'workspace',
        currentWorkspacePath: '/proj/ws_0003',
        currentWorkspaceName: 'ws_0003',
        currentProjectRoot: '/proj',
        routeProjectRoot: '/other',
        step: 'place',
      }),
    ).toEqual({
      mode: 'workspace',
      workspacePath: '/proj/ws_0003',
      workspaceName: 'ws_0003',
      projectRoot: '/proj',
      step: 'place',
    })
  })

  it('falls back to route project root on home', () => {
    expect(
      resolveAgentTabContext({
        shell: 'home',
        routeProjectRoot: '/proj',
      }),
    ).toEqual({
      mode: 'home',
      projectRoot: '/proj',
      projectName: 'proj',
    })
  })
})

describe('existingTabIdForMode', () => {
  const tabs = [
    { id: 'home-1', mode: 'home' as const },
    { id: 'ws-1', mode: 'workspace' as const },
    { id: 'home-2', mode: 'home' as const },
  ]

  it('keeps the active tab when it already matches the shell', () => {
    expect(existingTabIdForMode(tabs, 'home', 'home-1')).toBe('home-1')
  })

  it('reuses the latest matching tab when the active tab belongs to the other shell', () => {
    expect(existingTabIdForMode(tabs, 'home', 'ws-1')).toBe('home-2')
    expect(existingTabIdForMode(tabs, 'workspace', 'home-2')).toBe('ws-1')
  })
})
