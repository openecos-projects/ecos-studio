import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceConfig } from '@/types'
import {
  projectContextFromWorkspaceConfig,
  registerProjectManagedWorkspace,
  resolveManagedProjectContext,
  resolveProjectRouteContextForWorkspace,
  workspaceRouteQueryFromProjectContext,
} from './projectManifestRegistration'

const registerProjectRoot = vi.fn()
const registerProjectReadRoot = vi.fn()
const mutateProjectManifest = vi.fn()
const discoverProjectForWorkspace = vi.fn()

vi.mock('@/platform/desktop', () => ({
  getDesktopApi: vi.fn(() => ({
    workspace: {
      registerProjectRoot,
      registerProjectReadRoot,
    },
  })),
}))

vi.mock('@/api/projectManifest', () => ({
  mutateProjectManifest: (...args: unknown[]) => mutateProjectManifest(...args),
}))

vi.mock('@/utils/projectManagementRead', () => ({
  discoverProjectForWorkspace: (...args: unknown[]) =>
    discoverProjectForWorkspace(...args),
}))

describe('projectManifestRegistration', () => {
  beforeEach(() => {
    registerProjectRoot.mockReset()
    registerProjectReadRoot.mockReset()
    mutateProjectManifest.mockReset()
    discoverProjectForWorkspace.mockReset()
    registerProjectRoot.mockImplementation(async (path: string) => path)
    mutateProjectManifest.mockResolvedValue(undefined)
    discoverProjectForWorkspace.mockResolvedValue(null)
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

  it('keeps managed Project identity when entering a newly created Workspace', () => {
    expect(
      workspaceRouteQueryFromProjectContext('/projects/gcd/ws_0036/', {
        projectRoot: '/projects/gcd/',
        projectName: 'gcd',
      }),
    ).toEqual({
      projectRoot: '/projects/gcd',
      projectName: 'gcd',
      workspaceId: 'ws_0036',
    })
    expect(workspaceRouteQueryFromProjectContext('/workspaces/standalone', null)).toEqual(
      {},
    )
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
    expect(registerProjectReadRoot).toHaveBeenCalledWith('/projects/gcd')
    expect(mutateProjectManifest).toHaveBeenCalledWith(
      '/projects/gcd',
      expect.objectContaining({
        type: 'register-workspace',
        input: expect.objectContaining({
          workspacePath: '/projects/gcd/ws_0001',
          startStep: 'Synth',
          endStep: 'Harden',
        }),
      }),
    )
  })

  it('canonicalizes wizard and route Flow step names before registration', async () => {
    await registerProjectManagedWorkspace({
      workspacePath: '/projects/gcd/ws_0002',
      config: {
        directory: '/projects/gcd/ws_0002',
        pdk: 'ics55',
        pdk_root: '',
        parameters: {},
        origin_def: '',
        origin_verilog: '',
        rtl_list: [],
        flow_config: {
          start_step: 'Floorplan',
          end_step: 'Timing optimization',
          steps: [],
        },
      },
      projectContext: { projectRoot: '/projects/gcd', projectName: 'gcd' },
      routeQuery: {
        sourceStep: 'postRouteLec',
        startStep: 'legalization',
        endStep: 'sta',
      },
    })

    expect(mutateProjectManifest).toHaveBeenCalledWith(
      '/projects/gcd',
      expect.objectContaining({
        type: 'register-workspace',
        input: expect.objectContaining({
          sourceStep: 'Post-route LEC',
          startStep: 'Legal',
          endStep: 'STA',
        }),
      }),
    )
  })

  it('reports the real project.json failure after workspace creation', async () => {
    const warnings: Array<{ summary: string; detail: string }> = []
    mutateProjectManifest.mockRejectedValueOnce(
      new Error('workspaces[0] start_step is not on the canonical flow chain: Synthesis'),
    )

    await registerProjectManagedWorkspace({
      workspacePath: '/projects/gcd/ws_0001',
      projectContext: { projectRoot: '/projects/gcd', projectName: 'gcd' },
      onWarning: (summary, detail) => warnings.push({ summary, detail }),
    })

    expect(warnings).toEqual([
      {
        summary: 'Project manifest not updated',
        detail:
          'Workspace was created. project.json was not updated: workspaces[0] start_step is not on the canonical flow chain: Synthesis',
      },
    ])
  })

  it('rejects unknown Flow step names before writing project.json', async () => {
    const warnings: Array<{ summary: string; detail: string }> = []

    await registerProjectManagedWorkspace({
      workspacePath: '/projects/gcd/ws_0001',
      config: {
        directory: '/projects/gcd/ws_0001',
        pdk: 'ics55',
        pdk_root: '',
        parameters: {},
        origin_def: '',
        origin_verilog: '',
        rtl_list: [],
        flow_config: {
          start_step: 'fixFanout',
          end_step: 'Harden',
          steps: [],
        },
      },
      projectContext: { projectRoot: '/projects/gcd', projectName: 'gcd' },
      onWarning: (summary, detail) => warnings.push({ summary, detail }),
    })

    expect(mutateProjectManifest).not.toHaveBeenCalled()
    expect(warnings).toEqual([
      {
        summary: 'Project manifest not updated',
        detail:
          'Workspace was created. project.json was not updated: Flow step "fixFanout" is not a canonical project.json step. Use names such as Synth or Harden.',
      },
    ])
  })

  it('reports a project-root registration failure without claiming project.json was written', async () => {
    const warnings: Array<{ summary: string; detail: string }> = []
    registerProjectRoot.mockRejectedValueOnce(new Error('EACCES'))

    await registerProjectManagedWorkspace({
      workspacePath: '/projects/gcd/ws_0001',
      projectContext: { projectRoot: '/projects/gcd', projectName: 'gcd' },
      onWarning: (summary, detail) => warnings.push({ summary, detail }),
    })

    expect(mutateProjectManifest).not.toHaveBeenCalled()
    expect(warnings).toEqual([
      {
        summary: 'Project manifest not updated',
        detail:
          'Workspace was created. The project root could not be registered, so project.json was not updated.',
      },
    ])
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

  it('resolves project route context from a parent project.json that lists the workspace', async () => {
    const manifest = {
      schema_version: 1,
      project_id: 'proj_gcd',
      name: 'gcd',
      design_name: 'gcd',
      root_path: '/projects/gcd',
      created_at: '2026-08-04T00:00:00.000Z',
      updated_at: '2026-08-04T00:00:00.000Z',
      objectives: {},
      workspaces: [
        {
          workspace_id: 'ws_0036',
          name: 'ws_0036',
          workspace_path: '/projects/gcd/runs/ws_0036',
          source_workspace_id: null,
          lifecycle: 'active',
          created_at: '2026-08-04T00:00:00.000Z',
          updated_at: '2026-08-04T00:00:00.000Z',
        },
      ],
      mpc: null,
      best_workspace: null,
      qor_baseline: null,
    }
    discoverProjectForWorkspace.mockResolvedValue(manifest)

    await expect(
      resolveProjectRouteContextForWorkspace('/projects/gcd/runs/ws_0036'),
    ).resolves.toEqual({
      projectRoot: '/projects/gcd',
      projectName: 'gcd',
    })

    expect(registerProjectRoot).not.toHaveBeenCalled()
    expect(discoverProjectForWorkspace).toHaveBeenCalledWith('/projects/gcd/runs/ws_0036')
  })

  it('returns null when the parent directory is not a managed project for the workspace', async () => {
    discoverProjectForWorkspace.mockResolvedValue(null)

    await expect(
      resolveProjectRouteContextForWorkspace('/workspaces/orphan/ws_0001'),
    ).resolves.toBeNull()
    expect(registerProjectRoot).not.toHaveBeenCalled()
  })

  it('prefers an explicit project context when resolving managed ownership', async () => {
    await expect(
      resolveManagedProjectContext({
        preferred: {
          projectRoot: '/projects/gcd/',
          projectName: 'gcd',
        },
        workspacePath: '/projects/gcd/ws_0030',
      }),
    ).resolves.toEqual({
      projectRoot: '/projects/gcd',
      projectName: 'gcd',
    })
    expect(discoverProjectForWorkspace).not.toHaveBeenCalled()
  })

  it('falls back to a parent directory that already has project.json', async () => {
    discoverProjectForWorkspace.mockResolvedValue({
      name: 'gcd-project',
      root_path: '/projects/gcd',
      workspaces: [{ workspace_path: '/projects/gcd/ws_0030' }],
    })

    await expect(
      resolveManagedProjectContext({
        workspacePath: '/projects/gcd/ws_0030',
      }),
    ).resolves.toEqual({
      projectRoot: '/projects/gcd',
      projectName: 'gcd-project',
    })
    expect(registerProjectRoot).not.toHaveBeenCalled()
    expect(discoverProjectForWorkspace).toHaveBeenCalledWith('/projects/gcd/ws_0030')
  })

  it('does not invent a project when the parent has no project.json', async () => {
    await expect(
      resolveManagedProjectContext({
        workspacePath: '/orphan/ws_0030',
      }),
    ).resolves.toBeNull()
    expect(mutateProjectManifest).not.toHaveBeenCalled()
  })
})
