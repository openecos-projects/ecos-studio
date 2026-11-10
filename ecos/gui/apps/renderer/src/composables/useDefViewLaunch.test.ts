import { beforeEach, describe, expect, it, vi } from 'vitest'

const desktopApi = {
  productCommands: { execute: vi.fn() },
  chipViewer: { open: vi.fn() },
}

vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => desktopApi,
}))

import { defViewWorkspaceIssue, launchDefView } from './useDefViewLaunch'

function deps(overrides: Partial<Parameters<typeof launchDefView>[1]> = {}) {
  return {
    showToast: vi.fn(),
    workspaceHandle: 'workspace-handle-1',
    workspacePath: '/projects/demo/ws_1',
    ...overrides,
  }
}

describe('launchDefView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    desktopApi.productCommands.execute.mockResolvedValue({
      defPath: '/data/gcd.def.gz',
      directory: '/projects/demo/ws_1/defview',
      geometryManifestPath:
        '/projects/demo/ws_1/defview/output/geometry/geometry.manifest',
      workspaceHandle: 'workspace-handle-1',
    })
    desktopApi.chipViewer.open.mockResolvedValue({ spawned: true })
  })

  it('generates geometry in the active Workspace and opens Chip Viewer', async () => {
    const dependency = deps()

    await launchDefView('/data/gcd.def.gz', dependency)

    expect(desktopApi.productCommands.execute).toHaveBeenCalledWith({
      command: 'workspace.defView',
      payload: {
        defPath: '/data/gcd.def.gz',
        workspaceHandle: 'workspace-handle-1',
      },
    })
    expect(desktopApi.chipViewer.open).toHaveBeenCalledWith({
      projectPath: '/projects/demo/ws_1',
      step: 'defview',
      mode: 'view',
    })
    expect(dependency.showToast).not.toHaveBeenCalled()
  })

  it('reports generation errors without opening Chip Viewer', async () => {
    desktopApi.productCommands.execute.mockRejectedValue(
      new Error('ECC could not read the selected DEF'),
    )
    const dependency = deps()

    await launchDefView('/data/gcd.def', dependency)

    expect(desktopApi.chipViewer.open).not.toHaveBeenCalled()
    expect(dependency.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: 'ECC could not read the selected DEF',
        severity: 'error',
        summary: 'DEF View Error',
      }),
    )
  })

  it('reports Chip Viewer launch errors', async () => {
    desktopApi.chipViewer.open.mockRejectedValue(new Error('No display environment'))
    const dependency = deps()

    await launchDefView('/data/gcd.def', dependency)

    expect(dependency.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: 'No display environment',
        severity: 'error',
        summary: 'DEF View Error',
      }),
    )
  })
})

describe('defViewWorkspaceIssue', () => {
  it('requires an active Workspace', () => {
    expect(
      defViewWorkspaceIssue({ path: '', state: 'active', designTool: 'backend' }),
    ).toBe('Open a Workspace before viewing a DEF layout.')
    expect(
      defViewWorkspaceIssue({
        path: '/projects/demo/ws_1',
        state: 'loading',
        designTool: 'backend',
      }),
    ).toBe('Open a Workspace before viewing a DEF layout.')
  })

  it('rejects frontend Workspaces before the file picker opens', () => {
    expect(
      defViewWorkspaceIssue({
        path: '/projects/demo/ws_1',
        state: 'active',
        designTool: 'frontend',
      }),
    ).toBe('DEF Layout is only available for backend Workspaces.')
  })

  it('accepts an active backend Workspace', () => {
    expect(
      defViewWorkspaceIssue({
        path: '/projects/demo/ws_1',
        state: 'active',
        designTool: 'backend',
      }),
    ).toBeNull()
    expect(
      defViewWorkspaceIssue({
        path: '/projects/demo/ws_1',
        state: 'active',
      }),
    ).toBeNull()
  })
})
