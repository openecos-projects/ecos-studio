import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdkInstallationSnapshot } from '@ecos-studio/shared'
import type { WorkspaceConfig } from '@/types'
import { backendWorkspaceOptions, createWorkspaceApi } from '@/api/workspace'
import { mutateProjectManifest } from '@/api/projectManifest'
import { prepareWorkspaceCreateBinding } from '../../../desktop-electron/electron/services/workspacePdkBindings'
import { ProjectManifestService } from '../../../desktop-electron/electron/services/projectManifestService'
import { prepareAgentWorkspaceConfig } from './agentWorkspaceSetup'

const mocks = vi.hoisted(() => ({
  importInstallation: vi.fn(),
  executeCommand: vi.fn(),
  mutateProjectManifest: vi.fn(),
  pathExists: vi.fn(),
  readManifest: vi.fn(),
}))

vi.mock('@/api/projectManifest', () => ({
  mutateProjectManifest: mocks.mutateProjectManifest,
}))

vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({
    pdkInventory: { import: mocks.importInstallation },
    productCommands: { execute: mocks.executeCommand },
    projectManagement: { readManifest: mocks.readManifest },
    workspace: { pathExists: mocks.pathExists },
  }),
}))

const installation: PdkInstallationSnapshot = {
  id: 'pdk:ics55:local:selected',
  familyId: 'ics55',
  displayName: 'ICS55',
  root: '/pdks/ics55',
  version: null,
  ownership: 'imported',
  registrySha256: null,
  readiness: 'ready',
  reason: null,
  supportsEccDefaults: true,
}

const config: WorkspaceConfig = {
  directory: '/projects/gcd/ws_0008',
  pdk: 'ics55',
  pdk_root: '/pdks/ics55-link/',
  parameters: { design: 'gcd', top_module: 'gcd', clock: 'clk' },
  origin_def: '',
  origin_verilog: '',
  rtl_list: ['/design/gcd.v'],
  project_context: {
    mode: 'create',
    project_name: 'gcd',
    project_root: '/projects/gcd',
    project_json_path: '/projects/gcd/project.json',
  },
}

const initializedManifest = {
  project_id: 'proj_gcd_ab12cd34ef56',
  name: 'gcd',
  root_path: '/projects/gcd',
  workspaces: [],
}

describe('Agent workspace PDK preparation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.importInstallation.mockResolvedValue(installation)
    mocks.pathExists.mockResolvedValue(true)
    mocks.readManifest.mockResolvedValue(null)
    mocks.mutateProjectManifest.mockResolvedValue(initializedManifest)
  })

  it('initializes a new project before binding its PDK', async () => {
    mocks.pathExists.mockResolvedValue(false)
    mocks.mutateProjectManifest.mockResolvedValue({
      project_id: 'proj_gcd_ab12cd34ef56',
      name: 'gcd',
      root_path: '/projects/gcd',
      workspaces: [],
    })

    const prepared = await prepareAgentWorkspaceConfig(config)
    const request = backendWorkspaceOptions(prepared, prepared.directory)

    expect(mutateProjectManifest).toHaveBeenCalledWith('/projects/gcd', {
      type: 'create',
      name: 'gcd',
      designName: 'gcd',
      rtlImport: { verilog: ['/design/gcd.v'] },
    })
    expect(mocks.readManifest).not.toHaveBeenCalled()
    expect(prepared.project_context).toMatchObject({
      mode: 'select',
      project_id: 'proj_gcd_ab12cd34ef56',
    })
    expect(request.projectId).toBe('proj_gcd_ab12cd34ef56')
    expect(mocks.importInstallation).toHaveBeenCalled()
  })

  it('reuses a project initialized by an earlier failed workspace attempt', async () => {
    mocks.readManifest.mockResolvedValue({
      project_id: 'proj_gcd_existing',
      name: 'GCD',
      root_path: '/projects/gcd',
      workspaces: [],
    })

    const prepared = await prepareAgentWorkspaceConfig(config)

    expect(mutateProjectManifest).not.toHaveBeenCalled()
    expect(prepared.project_context).toMatchObject({
      mode: 'select',
      project_id: 'proj_gcd_existing',
      project_name: 'GCD',
    })
  })

  it('adds an actionable recovery hint when a non-empty folder is not a project', async () => {
    mocks.mutateProjectManifest.mockRejectedValue(
      new Error('Project directory is not empty'),
    )

    await expect(prepareAgentWorkspaceConfig(config)).rejects.toThrow(
      'Choose an empty project directory or an existing project',
    )
    expect(mocks.importInstallation).not.toHaveBeenCalled()
  })

  it('uses the persisted project identity when its name differs from the directory name', async () => {
    const manifest = {
      project_id: 'proj_original_gcd',
      name: 'Original GCD',
      workspaces: [],
    }
    mocks.readManifest.mockResolvedValue(manifest)
    const service = new ProjectManifestService(
      { resolveProjectRoot: async (root) => root },
      undefined,
      {
        discoverProject: vi.fn(),
        loadProjectManifest: vi.fn().mockResolvedValue(manifest),
        mutateProjectManifest: vi.fn(),
      },
    )

    const prepared = await prepareAgentWorkspaceConfig(config)
    const request = backendWorkspaceOptions(prepared, prepared.directory)

    await expect(
      service.inspectWorkspaceRegistration(
        request.projectRoot!,
        request.targetDirectory,
        request.projectId,
      ),
    ).resolves.toBeNull()
    expect(request.projectId).toBe(manifest.project_id)
    expect(mocks.readManifest).toHaveBeenCalledWith('/projects/gcd')
    expect(config.project_context).not.toHaveProperty('project_id')
  })

  it('preserves an explicit expected identity so a replaced manifest still fails validation', async () => {
    const manifest = { project_id: 'proj_replaced', workspaces: [] }
    mocks.readManifest.mockResolvedValue(manifest)
    const service = new ProjectManifestService(
      { resolveProjectRoot: async (root) => root },
      undefined,
      {
        discoverProject: vi.fn(),
        loadProjectManifest: vi.fn().mockResolvedValue(manifest),
        mutateProjectManifest: vi.fn(),
      },
    )
    const prepared = await prepareAgentWorkspaceConfig({
      ...config,
      project_context: { ...config.project_context!, project_id: 'proj_expected' },
    })
    const request = backendWorkspaceOptions(prepared, prepared.directory)

    await expect(
      service.inspectWorkspaceRegistration(
        request.projectRoot!,
        request.targetDirectory,
        request.projectId,
      ),
    ).rejects.toThrow('Project manifest identity changed after Workspace creation')
    expect(mocks.readManifest).not.toHaveBeenCalled()
  })

  it('does not change the inventory or create a workspace when manifest reading fails', async () => {
    mocks.readManifest.mockRejectedValue(new Error('Project manifest is invalid'))

    await expect(prepareAgentWorkspaceConfig(config)).rejects.toThrow(
      'Project manifest is invalid',
    )
    expect(mocks.importInstallation).not.toHaveBeenCalled()
    expect(mocks.executeCommand).not.toHaveBeenCalled()
  })

  it.each([null, '1.10.102'])(
    'resolves the selected installation with version %s',
    async (version) => {
      mocks.importInstallation.mockResolvedValue({ ...installation, version })

      const prepared = await prepareAgentWorkspaceConfig(config)

      expect(mocks.importInstallation).toHaveBeenCalledWith({
        root: config.pdk_root,
        familyId: 'ics55',
        displayName: 'ics55',
      })
      expect(prepared).toEqual({
        ...config,
        project_context: {
          ...config.project_context,
          mode: 'select',
          project_id: initializedManifest.project_id,
        },
        pdk_root: installation.root,
        pdk_installation_id: installation.id,
        pdk_requirement: { familyId: 'ics55', version, manualConfig: null },
      })
      expect(config).not.toHaveProperty('pdk_requirement')
    },
  )

  it('binds a newly initialized project using its persisted identity', async () => {
    const dependencies = {
      pdkInventoryService: {
        resolveBinding: vi.fn().mockResolvedValue(null),
        bindInstallation: vi.fn(),
        validateWorkspace: vi.fn().mockResolvedValue(installation),
      },
    }
    mocks.executeCommand.mockImplementation(async ({ payload }) => {
      await prepareWorkspaceCreateBinding(dependencies, payload)
      return { directory: config.directory, workspaceHandle: 'workspace-1' }
    })

    await expect(
      createWorkspaceApi(backendWorkspaceOptions(config, config.directory)),
    ).rejects.toThrow('PDK Requirement is required for backend workspace creation')

    const prepared = await prepareAgentWorkspaceConfig(config)
    await expect(
      createWorkspaceApi(backendWorkspaceOptions(prepared, prepared.directory)),
    ).resolves.toMatchObject({ response: 'success' })
    expect(dependencies.pdkInventoryService.bindInstallation).toHaveBeenCalledWith({
      installationId: installation.id,
      projectId: initializedManifest.project_id,
      projectRoot: '/projects/gcd',
      requirement: { familyId: 'ics55', version: null, manualConfig: null },
    })
    expect(dependencies.pdkInventoryService.validateWorkspace).toHaveBeenCalled()
  })

  it('propagates inventory failure without submitting a workspace create command', async () => {
    mocks.importInstallation.mockRejectedValue(new Error('PDK root is unavailable'))

    await expect(prepareAgentWorkspaceConfig(config)).rejects.toThrow(
      'PDK root is unavailable',
    )
    expect(mocks.executeCommand).not.toHaveBeenCalled()
  })

  it('reuses the declared project design RTL instead of re-importing it', async () => {
    mocks.readManifest.mockResolvedValue({
      project_id: 'proj_gcd',
      base_design: { rtl_list: ['/projects/gcd/rtl/gcd.v'] },
      workspaces: [],
    })
    const selectConfig: WorkspaceConfig = {
      ...config,
      rtl_list: ['/projects/gcd/rtl/gcd.v'],
      project_context: {
        mode: 'select',
        project_id: 'proj_gcd',
        project_name: 'gcd',
        project_root: '/projects/gcd',
        project_json_path: '/projects/gcd/project.json',
      },
    }

    const prepared = await prepareAgentWorkspaceConfig(selectConfig)

    expect(prepared.rtl_list).toEqual([])
    expect(prepared.filelist ?? '').toBe('')
    expect(selectConfig.rtl_list).toEqual(['/projects/gcd/rtl/gcd.v'])
  })

  it('imports a selected filelist while initializing a new project', async () => {
    mocks.pathExists.mockResolvedValue(false)

    await prepareAgentWorkspaceConfig({
      ...config,
      filelist: '/design/sources.f',
      rtl_list: [],
    })

    expect(mutateProjectManifest).toHaveBeenCalledWith('/projects/gcd', {
      type: 'create',
      name: 'gcd',
      designName: 'gcd',
      rtlImport: { filelist: '/design/sources.f' },
    })
  })
})
