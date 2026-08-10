import { describe, expect, it } from 'vitest'
import { resolveProjectManagementRouteFocus } from './projectRouteFocus'

const projects = [
  {
    id: '/projects/alpha',
    path: '/projects/alpha',
    workspaces: [{ id: 'ws_0001' }, { id: 'ws_0002' }],
  },
  {
    id: '/projects/gcd',
    path: '/projects/gcd',
    workspaces: [{ id: 'ws_0027' }, { id: 'ws_0036' }],
  },
]

describe('resolveProjectManagementRouteFocus', () => {
  it('selects the routed project and workspace', () => {
    expect(
      resolveProjectManagementRouteFocus({
        projectRoot: '/projects/gcd/',
        workspaceId: 'ws_0036',
        projects,
      }),
    ).toEqual({
      projectId: '/projects/gcd',
      workspaceId: 'ws_0036',
    })
  })

  it('still selects the project when only projectRoot is provided', () => {
    expect(
      resolveProjectManagementRouteFocus({
        projectRoot: '/projects/gcd',
        projects,
      }),
    ).toEqual({
      projectId: '/projects/gcd',
      workspaceId: null,
    })
  })

  it('finds a project by workspace id when projectRoot is absent', () => {
    expect(
      resolveProjectManagementRouteFocus({
        workspaceId: 'ws_0002',
        projects,
      }),
    ).toEqual({
      projectId: '/projects/alpha',
      workspaceId: 'ws_0002',
    })
  })

  it('ignores unknown workspace ids while keeping the project focus', () => {
    expect(
      resolveProjectManagementRouteFocus({
        projectRoot: '/projects/gcd',
        workspaceId: 'ws_missing',
        projects,
      }),
    ).toEqual({
      projectId: '/projects/gcd',
      workspaceId: null,
    })
  })

  it('returns null when the route has no usable focus target', () => {
    expect(
      resolveProjectManagementRouteFocus({
        projectRoot: '/projects/missing',
        workspaceId: 'ws_0036',
        projects: [projects[0]],
      }),
    ).toBeNull()
    expect(
      resolveProjectManagementRouteFocus({
        projects,
      }),
    ).toBeNull()
  })
})
