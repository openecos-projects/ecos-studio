import { describe, expect, it } from 'vitest'
import { resolveAgentTabContext, resolveAgentTabTitle } from './agentTabContext'

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
        step: 'Timing optimization',
        existingTitles: ['ws_0029 · Timing optimization'],
      }),
    ).toBe('ws_0029 · Timing optimization (2)')
  })
})

describe('resolveAgentTabContext', () => {
  it('prefers open workspace over project-only context', () => {
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
