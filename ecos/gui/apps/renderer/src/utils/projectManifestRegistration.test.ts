import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceConfig } from '@/types'
import {
  projectContextFromWorkspaceConfig,
  registerProjectManagedWorkspace,
} from './projectManifestRegistration'

const registerProjectRoot = vi.fn()
const mutateProjectManifest = vi.fn()

vi.mock('@/platform/desktop', () => ({
  waitForDesktopApi: vi.fn(async () => ({
    workspace: {
      registerProjectRoot,
    },
  })),
}))

vi.mock('@/api/projectManifest', () => ({
  mutateProjectManifest: (...args: unknown[]) => mutateProjectManifest(...args),
}))

describe('projectManifestRegistration', () => {
  beforeEach(() => {
    registerProjectRoot.mockReset()
    mutateProjectManifest.mockReset()
    registerProjectRoot.mockImplementation(async (path: string) => path)
    mutateProjectManifest.mockResolvedValue(undefined)
  })

  it('derives project context from wizard project_context payload', () => {
    const config = {
      directory: '/projects/gcd/ws_0001',
      project_context: {
        mode: 'select',
        project_name: 'gcd',
        project_root: '/projects/gcd/',
        project_json_path: '/projects/gcd/project.json',
      },
    } as WorkspaceConfig

    expect(projectContextFromWorkspaceConfig(config)).toEqual({
      projectRoot: '/projects/gcd',
      projectName: 'gcd',
    })
  })

  it('mutates project.json when a project-managed workspace is registered', async () => {
    const warnings: string[] = []
    const config = {
      directory: '/projects/gcd/ws_0001',
      pdk: 'ics55',
      pdk_root: '',
      origin_def: '',
      origin_verilog: '',
      rtl_list: [],
      flow_config: {
        start_step: 'Synthesis',
        end_step: 'Harden',
        steps: [],
      },
      parameters: {
        design: 'gcd',
      },
      project_context: {
        mode: 'select',
        project_name: 'gcd',
        project_root: '/projects/gcd',
        project_json_path: '/projects/gcd/project.json',
      },
    } as WorkspaceConfig

    await registerProjectManagedWorkspace({
      workspacePath: '/projects/gcd/ws_0001',
      config,
      projectContext: projectContextFromWorkspaceConfig(config),
      onWarning: (summary) => warnings.push(summary),
    })

    expect(warnings).toEqual([])
    expect(registerProjectRoot).toHaveBeenCalledWith('/projects/gcd')
    expect(registerProjectRoot).toHaveBeenCalledWith('/projects/gcd/ws_0001')
    expect(mutateProjectManifest).toHaveBeenCalledWith(
      '/projects/gcd',
      expect.objectContaining({
        type: 'register-workspace',
        input: expect.objectContaining({ workspacePath: '/projects/gcd/ws_0001' }),
      }),
    )
  })

  it('skips manifest writes for standalone workspaces without project context', async () => {
    await registerProjectManagedWorkspace({
      workspacePath: '/workspaces/ws_0001',
      config: {
        directory: '/workspaces/ws_0001',
      } as WorkspaceConfig,
    })

    expect(mutateProjectManifest).not.toHaveBeenCalled()
  })
})
