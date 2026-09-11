import { describe, expect, it, vi } from 'vitest'
import {
  prepareWorkspaceCreateBinding,
  prepareWorkspaceOpenBinding,
} from './workspacePdkBindings'

function createDependencies(
  requirement: Record<string, unknown> = {
    familyId: 'ics55',
    version: '1.0.0',
    mode: 'manual',
    files: [
      { fileId: 'tech', role: 'tech', reference: 'tech.lef' },
      { fileId: 'lef', role: 'lef', reference: 'cells.lef' },
      { fileId: 'lib', role: 'liberty', reference: 'typ.lib' },
    ],
    mpc: {
      resourceId: 'mpc:frame',
      version: '2.0.0',
      designId: 'gcd',
      sourceHash: 'hash',
    },
  },
) {
  const callRuntime = vi.fn().mockResolvedValueOnce(requirement).mockResolvedValueOnce({
    projectId: 'proj_demo',
    projectRoot: '/projects/demo',
  })
  return {
    callRuntime,
    dependencies: {
      eccRuntimeService: { callRuntime },
      pdkInventoryService: {
        bindInstallation: vi.fn(),
        resolveBinding: vi.fn(),
        validateWorkspace: vi
          .fn()
          .mockResolvedValue({ root: '/pdks/ics55', version: '1.0.0' }),
      },
      projectManagementReadService: {
        readManifest: vi.fn(),
      },
      resourceManagerService: {
        getResource: vi.fn().mockResolvedValue({
          installed_version: '2.0.0',
          status: 'installed',
        }),
        readMpcSpec: vi.fn().mockResolvedValue({
          resource_id: 'mpc:frame',
          installed_version: '2.0.0',
          spec_path: '/mpcs/frame/2.0.0/spec/spec.json.in',
          spec: {
            designs: [
              {
                design_name: 'gcd',
                core_template: { name: 'frame', minimum_area: 100 },
              },
            ],
          },
        }),
      },
    },
  }
}

describe('prepareWorkspaceOpenBinding', () => {
  it('resolves portable PDK and MPC requirements on the current machine', async () => {
    const { dependencies } = createDependencies()

    await expect(
      prepareWorkspaceOpenBinding(dependencies, '/projects/demo/runs/workspace'),
    ).resolves.toEqual({
      directory: '/projects/demo/runs/workspace',
      workspaceBindings: {
        inputs: {},
        pdk: {
          root: '/pdks/ics55',
          version: '1.0.0',
          files: {
            tech: '/pdks/ics55/tech.lef',
            lef: '/pdks/ics55/cells.lef',
            lib: '/pdks/ics55/typ.lib',
          },
        },
        mpc: { template: { name: 'frame', minimum_area: 100 } },
      },
    })
    expect(dependencies.pdkInventoryService.validateWorkspace).toHaveBeenCalledWith({
      projectId: 'proj_demo',
      projectRoot: '/projects/demo',
      requirement: expect.objectContaining({ familyId: 'ics55', version: null }),
    })
  })

  it('does not match ECC stdcell version against the inventory package version', async () => {
    const { dependencies } = createDependencies({
      familyId: 'ics55',
      version: 'V1p10C100',
      mode: 'default',
    })
    dependencies.pdkInventoryService.validateWorkspace.mockResolvedValue({
      root: '/pdks/ics55/1.10.102',
      version: '1.10.102',
    })

    await expect(
      prepareWorkspaceOpenBinding(dependencies, '/projects/demo/runs/workspace'),
    ).resolves.toEqual({
      directory: '/projects/demo/runs/workspace',
      workspaceBindings: {
        inputs: {},
        pdk: {
          root: '/pdks/ics55/1.10.102',
          version: '1.10.102',
        },
      },
    })
    expect(dependencies.pdkInventoryService.validateWorkspace).toHaveBeenCalledWith({
      projectId: 'proj_demo',
      projectRoot: '/projects/demo',
      requirement: { familyId: 'ics55', version: null, manualConfig: null },
    })
  })

  it('keeps inspection available when local bindings are unavailable', async () => {
    const { dependencies } = createDependencies()
    dependencies.pdkInventoryService.validateWorkspace.mockRejectedValue(
      new Error('not installed'),
    )

    await expect(
      prepareWorkspaceOpenBinding(dependencies, '/projects/demo/runs/workspace'),
    ).resolves.toEqual({ directory: '/projects/demo/runs/workspace' })
  })
})

describe('prepareWorkspaceCreateBinding', () => {
  it('reuses the persisted Project PDK requirement when the request omits it', async () => {
    const { dependencies } = createDependencies()
    const requirement = { familyId: 'ics55', manualConfig: null, version: null }
    dependencies.projectManagementReadService!.readManifest = vi.fn().mockResolvedValue({
      base_design: { pdk_requirement: requirement },
    })
    dependencies.pdkInventoryService.resolveBinding.mockResolvedValue({})

    await prepareWorkspaceCreateBinding(dependencies, {
      commandId: 'create-1',
      projectId: 'proj_demo',
      projectRoot: '/projects/demo',
      targetDirectory: '/projects/demo/runs/workspace',
      workspaceBindings: { inputs: {}, pdk: { root: '/renderer/pdk' } },
      workspaceSpec: { pdk: { familyId: 'ics55', mode: 'default' } },
    })

    expect(dependencies.projectManagementReadService.readManifest).toHaveBeenCalledWith(
      '/projects/demo',
    )
    expect(dependencies.pdkInventoryService.resolveBinding).toHaveBeenCalledWith({
      projectId: 'proj_demo',
      projectRoot: '/projects/demo',
      requirement,
    })
    expect(dependencies.pdkInventoryService.validateWorkspace).toHaveBeenCalledWith({
      projectId: 'proj_demo',
      projectRoot: '/projects/demo',
      requirement,
    })
  })

  it('resolves the portable MPC requirement instead of trusting presentation placeholders', async () => {
    const { dependencies } = createDependencies()
    dependencies.pdkInventoryService.resolveBinding.mockResolvedValue({})

    const result = await prepareWorkspaceCreateBinding(dependencies, {
      commandId: 'create-1',
      projectId: 'proj_demo',
      projectRoot: '/projects/demo',
      targetDirectory: '/projects/demo/runs/workspace',
      pdkRequirement: { familyId: 'ics55', manualConfig: null, version: '1.0.0' },
      workspaceBindings: {
        inputs: {},
        mpc: { template: {} },
        pdk: { root: '/renderer/pdk' },
      },
      workspaceSpec: {
        mpc: { resourceId: 'mpc:frame', version: '2.0.0', designId: 'gcd' },
        pdk: { familyId: 'ics55', mode: 'default' },
      },
    })

    expect(result.workspaceBindings.mpc).toEqual({
      template: { name: 'frame', minimum_area: 100 },
    })
  })

  it('rejects creation when the portable MPC requirement is not installed', async () => {
    const { dependencies } = createDependencies()
    dependencies.pdkInventoryService.resolveBinding.mockResolvedValue({})
    dependencies.resourceManagerService.getResource.mockResolvedValue({
      installed_version: null,
      status: 'available',
    })

    await expect(
      prepareWorkspaceCreateBinding(dependencies, {
        commandId: 'create-1',
        projectId: 'proj_demo',
        projectRoot: '/projects/demo',
        targetDirectory: '/projects/demo/runs/workspace',
        pdkRequirement: { familyId: 'ics55', manualConfig: null, version: '1.0.0' },
        workspaceBindings: { inputs: {}, pdk: { root: '/renderer/pdk' } },
        workspaceSpec: {
          mpc: { resourceId: 'mpc:frame', version: '2.0.0', designId: 'gcd' },
          pdk: { familyId: 'ics55', mode: 'default' },
        },
      }),
    ).rejects.toThrow('Project MPC Requirement is unbound')
  })
})
