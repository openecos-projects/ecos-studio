import { nextTick, ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({
  route: { path: '/workspace/home', query: {} as Record<string, string> },
  discoverProjectForWorkspace: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRoute: () => testState.route,
}))
vi.mock('@/utils/projectManagementRead', () => ({
  discoverProjectForWorkspace: testState.discoverProjectForWorkspace,
}))

import { useWorkspaceTitle } from './useWorkspaceTitle'

function manifest(options: { designName?: string; name?: string; workspaces: string[] }) {
  return {
    design_name: options.designName,
    name: options.name,
    workspaces: options.workspaces.map((workspace_path) => ({ workspace_path })),
  }
}

describe('useWorkspaceTitle', () => {
  beforeEach(() => {
    testState.route.path = '/workspace/home'
    testState.route.query = {}
    testState.discoverProjectForWorkspace.mockReset()
    testState.discoverProjectForWorkspace.mockResolvedValue(null)
  })

  it('shows no title outside workspace routes', () => {
    testState.route.path = '/'
    const unnamed = useWorkspaceTitle({
      workspacePath: ref(null),
      fallbackName: ref(null),
    })
    expect(unnamed.value).toBe('')
    // Backend Design (/ecc) must not leak the stale workspace name.
    testState.route.path = '/ecc'
    const named = useWorkspaceTitle({
      workspacePath: ref('/work/gcd/ws_0036'),
      fallbackName: ref('gcd'),
    })
    expect(named.value).toBe('')
  })

  it('builds the Background Tasks label from the route query before workspace state loads', () => {
    testState.route.query = {
      projectRoot: '/work/gcd',
      projectName: 'gcd',
      workspaceId: 'ws_0036',
    }
    const title = useWorkspaceTitle({ workspacePath: ref(null), fallbackName: ref(null) })
    expect(title.value).toBe('gcd / ws_0036')
    expect(testState.discoverProjectForWorkspace).not.toHaveBeenCalled()
  })

  it('derives the owner from the workspace path when no project context exists', () => {
    const title = useWorkspaceTitle({
      workspacePath: ref('/workspaces/orphan/ws_0001'),
      fallbackName: ref('ws_0001'),
    })
    expect(title.value).toBe('orphan / ws_0001')
  })

  it('collapses the label when owner and workspace names match', () => {
    testState.route.query = {
      projectRoot: '/work/ws_0001',
      projectName: 'ws_0001',
      workspaceId: 'ws_0001',
    }
    const title = useWorkspaceTitle({ workspacePath: ref(null), fallbackName: ref(null) })
    expect(title.value).toBe('ws_0001')
  })

  it('uses the route project name while no workspace identity is available', () => {
    testState.route.query = { projectName: 'gcd' }
    const title = useWorkspaceTitle({
      workspacePath: ref(null),
      fallbackName: ref('old'),
    })
    expect(title.value).toBe('gcd')
  })

  it('upgrades the owner to the manifest design name once discovered', async () => {
    testState.route.query = {
      projectRoot: '/work/gcd',
      projectName: 'gcd',
      workspaceId: 'ws_0036',
    }
    testState.discoverProjectForWorkspace.mockResolvedValue(
      manifest({ designName: 'gcd_v2', name: 'gcd', workspaces: ['/work/gcd/ws_0036'] }),
    )
    const title = useWorkspaceTitle({
      workspacePath: ref('/work/gcd/ws_0036'),
      fallbackName: ref(null),
    })
    expect(title.value).toBe('gcd / ws_0036')
    await vi.waitFor(() => {
      expect(title.value).toBe('gcd_v2 / ws_0036')
    })
  })

  it('ignores manifests that do not list the workspace', async () => {
    testState.discoverProjectForWorkspace.mockResolvedValue(
      manifest({
        designName: 'other',
        name: 'other',
        workspaces: ['/work/other/ws_0009'],
      }),
    )
    const title = useWorkspaceTitle({
      workspacePath: ref('/workspaces/orphan/ws_0001'),
      fallbackName: ref('ws_0001'),
    })
    expect(title.value).toBe('orphan / ws_0001')
    await vi.waitFor(() => {
      expect(testState.discoverProjectForWorkspace).toHaveBeenCalled()
    })
    await flushPromises()
    expect(title.value).toBe('orphan / ws_0001')
  })

  it('keeps the synchronous label when manifest discovery fails', async () => {
    testState.route.query = { projectName: 'gcd', workspaceId: 'ws_0036' }
    testState.discoverProjectForWorkspace.mockRejectedValue(new Error('ipc down'))
    const title = useWorkspaceTitle({
      workspacePath: ref('/work/gcd/ws_0036'),
      fallbackName: ref(null),
    })
    expect(title.value).toBe('gcd / ws_0036')
    await flushPromises()
    expect(title.value).toBe('gcd / ws_0036')
  })

  it('discards stale manifest resolutions after the workspace changes', async () => {
    const workspacePath = ref('/work/gcd/ws_0036')
    let resolveFirst: (value: unknown) => void = () => {}
    testState.discoverProjectForWorkspace
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockResolvedValueOnce(
        manifest({ designName: 'second', workspaces: ['/work/second/ws_0002'] }),
      )
    const title = useWorkspaceTitle({ workspacePath, fallbackName: ref(null) })

    workspacePath.value = '/work/second/ws_0002'
    await nextTick()
    resolveFirst(manifest({ designName: 'first', workspaces: ['/work/gcd/ws_0036'] }))
    await vi.waitFor(() => {
      expect(title.value).toBe('second / ws_0002')
    })
  })
})
