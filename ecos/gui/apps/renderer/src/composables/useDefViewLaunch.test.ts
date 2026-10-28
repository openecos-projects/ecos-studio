import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceConfig } from '@/types'

const desktopApi = {
  workspace: { pathExists: vi.fn() },
  pdkInventory: { list: vi.fn() },
  workspaceResources: { readFlow: vi.fn() },
  chipViewer: { open: vi.fn() },
}

vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => desktopApi,
}))

const startFlowOperationApi = vi.fn()

vi.mock('@/api/flow', () => ({
  startFlowOperationApi: (...args: unknown[]) => startFlowOperationApi(...args),
}))

import { launchDefView } from './useDefViewLaunch'

function deps(overrides: Partial<Parameters<typeof launchDefView>[1]> = {}) {
  return {
    createProject: vi.fn().mockResolvedValue(true),
    workspaceHandle: vi.fn().mockReturnValue('ws-handle'),
    workspaceRevision: vi.fn().mockReturnValue(3),
    showToast: vi.fn(),
    ...overrides,
  }
}

describe('launchDefView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    desktopApi.workspace.pathExists.mockResolvedValue(false)
    desktopApi.pdkInventory.list.mockResolvedValue([
      { id: 'pdk-1', familyId: 'ics55', version: 'v1', root: '/pdk', readiness: 'ready' },
    ])
    desktopApi.workspaceResources.readFlow.mockResolvedValue({
      steps: [{ name: 'defview', state: 'Success' }],
    })
    desktopApi.chipViewer.open.mockResolvedValue({ spawned: true })
    startFlowOperationApi.mockResolvedValue({ operationId: 'op' })
  })

  it('creates a defview workspace, runs the step, and opens Chip Viewer', async () => {
    const createProject = vi.fn().mockResolvedValue(true)
    const dep = deps({ createProject })
    await launchDefView('/data/gcd.def.gz', dep)

    expect(createProject).toHaveBeenCalledTimes(1)
    const config: WorkspaceConfig = createProject.mock.calls[0]![0]
    expect(config).toMatchObject({
      directory: '/data/gcd-defview',
      origin_def: '/data/gcd.def.gz',
      design_input_mode: 'def',
      flow_config: { start_step: 'defview', end_step: 'defview', steps: ['defview'] },
    })
    expect(startFlowOperationApi).toHaveBeenCalledWith(
      expect.objectContaining({ rerun: false, workspaceHandle: 'ws-handle' }),
    )
    expect(desktopApi.chipViewer.open).toHaveBeenCalledWith({
      projectPath: '/data/gcd-defview',
      step: 'defview',
      mode: 'view',
    })
    expect(dep.showToast).not.toHaveBeenCalled()
  })

  it('reports an error and skips the viewer when creation fails', async () => {
    const dep = deps({ createProject: vi.fn().mockResolvedValue(false) })
    await launchDefView('/data/gcd.def', dep)

    expect(startFlowOperationApi).not.toHaveBeenCalled()
    expect(desktopApi.chipViewer.open).not.toHaveBeenCalled()
  })

  it('reports an error when the defview step ends unsuccessfully', async () => {
    desktopApi.workspaceResources.readFlow.mockResolvedValue({
      steps: [{ name: 'defview', state: 'Incomplete' }],
    })
    const dep = deps()
    await launchDefView('/data/gcd.def', dep)

    expect(desktopApi.chipViewer.open).not.toHaveBeenCalled()
    expect(dep.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', summary: 'DEF View Error' }),
    )
  })
})
