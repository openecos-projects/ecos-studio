import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceConfig } from '@/types'
import {
  createProjectManifestDraft,
  registerWorkspaceInManifest,
} from '@ecos-studio/shared'
import {
  projectContextFromWorkspaceConfig,
  registerProjectManagedWorkspace,
  resolveManagedProjectContext,
  resolveProjectRouteContextForWorkspace,
} from './projectManifestRegistration'

const registerProjectRoot = vi.fn()
const registerProjectReadRoot = vi.fn()
const mutateProjectManifest = vi.fn()
const readOptionalProjectTextFile = vi.fn()
const rememberProjectHistoryEntry = vi.fn()

vi.mock('@/platform/desktop', () => ({
  waitForDesktopApi: vi.fn(async () => ({
    workspace: {
      registerProjectRoot,
      registerProjectReadRoot,
    },
  })),
}))

vi.mock('@/api/projectManifest', () => ({
  mutateProjectManifest: (...args: unknown[]) => mutateProjectManifest(...args),
}))

vi.mock('@/utils/projectFiles', () => ({
  readOptionalProjectTextFile: (...args: unknown[]) =>
    readOptionalProjectTextFile(...args),
}))

vi.mock('@/utils/projectHistory', () => ({
  rememberProjectHistoryEntry: (...args: unknown[]) =>
    rememberProjectHistoryEntry(...args),
}))

describe('projectManifestRegistration', () => {
  beforeEach(() => {
    registerProjectRoot.mockReset()
    registerProjectReadRoot.mockReset()
    mutateProjectManifest.mockReset()
    readOptionalProjectTextFile.mockReset()
    rememberProjectHistoryEntry.mockReset()
    registerProjectRoot.mockImplementation(async (path: string) => path)
    mutateProjectManifest.mockResolvedValue(undefined)
    readOptionalProjectTextFile.mockResolvedValue(null)
    rememberProjectHistoryEntry.mockResolvedValue([])
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
      mode: 'select',
      projectId: undefined,
    })
  })

  it('creates a frontend project manifest before registering its first workspace', async () => {
    const manifest = createProjectManifestDraft({
      rootPath: '/projects/frontend-demo',
      name: 'frontend-demo',
      designName: 'cpu_top',
      projectType: 'frontend',
      now: '2026-09-09T00:00:00.000Z',
    })
    mutateProjectManifest.mockResolvedValue(manifest)
    const config = {
      directory: '/projects/frontend-demo/ws_0001',
      designTool: 'frontend',
      pdk: '',
      pdk_root: '',
      origin_def: '',
      origin_verilog: '',
      rtl_list: [],
      parameters: { design: 'cpu_top' },
      project_context: {
        mode: 'create',
        project_name: 'frontend-demo',
        project_root: '/projects/frontend-demo',
        project_json_path: '/projects/frontend-demo/project.json',
      },
    } as WorkspaceConfig

    await registerProjectManagedWorkspace({
      workspacePath: config.directory,
      config,
    })

    expect(mutateProjectManifest).toHaveBeenNthCalledWith(1, '/projects/frontend-demo', {
      type: 'create',
      name: 'frontend-demo',
      designName: 'cpu_top',
      projectType: 'frontend',
    })
    expect(mutateProjectManifest).toHaveBeenNthCalledWith(
      2,
      '/projects/frontend-demo',
      expect.objectContaining({ type: 'register-workspace' }),
    )
    expect(rememberProjectHistoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/projects/frontend-demo',
        projectType: 'frontend',
      }),
    )
  })

  it('does not overwrite an existing project manifest in create mode', async () => {
    const warnings: string[] = []
    readOptionalProjectTextFile.mockResolvedValue('{}')
    const config = {
      directory: '/projects/frontend-demo/ws_0001',
      designTool: 'frontend',
      parameters: { design: 'cpu_top' },
      project_context: {
        mode: 'create',
        project_name: 'frontend-demo',
        project_root: '/projects/frontend-demo',
        project_json_path: '/projects/frontend-demo/project.json',
      },
    } as WorkspaceConfig

    await registerProjectManagedWorkspace({
      workspacePath: config.directory,
      config,
      projectContext: projectContextFromWorkspaceConfig(config),
      onWarning: (summary) => warnings.push(summary),
    })

    expect(mutateProjectManifest).not.toHaveBeenCalled()
    expect(warnings).toEqual(['Project manifest not updated'])
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

  it('resolves project route context from a parent project.json that lists the workspace', async () => {
    const manifest = registerWorkspaceInManifest(
      createProjectManifestDraft({
        rootPath: '/projects/gcd',
        name: 'gcd',
        designName: 'gcd',
        now: '2026-08-04T00:00:00.000Z',
      }),
      {
        projectRoot: '/projects/gcd',
        workspacePath: '/projects/gcd/ws_0036',
        now: '2026-08-04T00:00:00.000Z',
      },
    )
    readOptionalProjectTextFile.mockResolvedValue(JSON.stringify(manifest))

    await expect(
      resolveProjectRouteContextForWorkspace('/projects/gcd/ws_0036'),
    ).resolves.toEqual({
      projectRoot: '/projects/gcd',
      projectName: 'gcd',
    })

    expect(registerProjectRoot).toHaveBeenCalledWith('/projects/gcd')
    expect(registerProjectRoot).toHaveBeenCalledWith('/projects/gcd/ws_0036')
    expect(readOptionalProjectTextFile).toHaveBeenCalledWith('project.json', {
      projectPath: '/projects/gcd',
    })
  })

  it('returns null when the parent directory is not a managed project for the workspace', async () => {
    readOptionalProjectTextFile.mockResolvedValue(null)

    await expect(
      resolveProjectRouteContextForWorkspace('/workspaces/orphan/ws_0001'),
    ).resolves.toBeNull()
    expect(registerProjectRoot).toHaveBeenCalledWith('/workspaces/orphan/ws_0001')
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
    expect(readOptionalProjectTextFile).not.toHaveBeenCalled()
  })

  it('falls back to a parent directory that already has project.json', async () => {
    readOptionalProjectTextFile.mockResolvedValue(
      JSON.stringify({ name: 'gcd-project', workspaces: [] }),
    )

    await expect(
      resolveManagedProjectContext({
        workspacePath: '/projects/gcd/ws_0030',
      }),
    ).resolves.toEqual({
      projectRoot: '/projects/gcd',
      projectName: 'gcd-project',
    })
    expect(registerProjectRoot).toHaveBeenCalledWith('/projects/gcd')
    expect(readOptionalProjectTextFile).toHaveBeenCalledWith('/projects/gcd/project.json')
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
