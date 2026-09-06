import { describe, expect, it, vi } from 'vitest'
import {
  prepareWorkspaceCreateBinding,
  prepareWorkspaceOpenBinding,
} from './workspacePdkBindings'

function createDependencies() {
  const callRuntime = vi
    .fn()
    .mockResolvedValueOnce({
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
    })
    .mockResolvedValueOnce({
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
        validateWorkspace: vi.fn().mockResolvedValue({ root: '/pdks/ics55' }),
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
      requirement: expect.objectContaining({ familyId: 'ics55', version: '1.0.0' }),
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
