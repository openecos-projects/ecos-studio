import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdkInstallationSnapshot } from '@ecos-studio/shared'
import type { WorkspaceConfig } from '@/types'
import { backendWorkspaceOptions, createWorkspaceApi } from '@/api/workspace'
import { prepareWorkspaceCreateBinding } from '../../../desktop-electron/electron/services/workspacePdkBindings'
import { ProjectManifestService } from '../../../desktop-electron/electron/services/projectManifestService'
import { prepareAgentWorkspaceConfig } from './agentWorkspaceSetup'

const mocks = vi.hoisted(() => ({
  importInstallation: vi.fn(),
  executeCommand: vi.fn(),
  readManifest: vi.fn(),
}))

vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({
    pdkInventory: { import: mocks.importInstallation },
    productCommands: { execute: mocks.executeCommand },
    projectManagement: { readManifest: mocks.readManifest },
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

describe('Agent workspace PDK preparation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.importInstallation.mockResolvedValue(installation)
    mocks.readManifest.mockResolvedValue(null)
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
      { callRuntime: vi.fn().mockResolvedValue(manifest) },
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
      { callRuntime: vi.fn().mockResolvedValue(manifest) },
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
        pdk_root: installation.root,
        pdk_installation_id: installation.id,
        pdk_requirement: { familyId: 'ics55', version, manualConfig: null },
      })
      expect(config).not.toHaveProperty('pdk_requirement')
    },
  )

  it('creates an unbound project workspace without a persisted PDK Requirement', async () => {
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
      projectId: 'proj_gcd',
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
})
