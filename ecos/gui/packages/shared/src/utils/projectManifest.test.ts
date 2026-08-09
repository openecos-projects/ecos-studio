import { describe, expect, it } from 'vitest'
import {
  archiveWorkspaceInManifest,
  createProjectManifestDraft,
  deleteWorkspaceFromManifest,
  parseProjectManifest,
  registerWorkspaceInManifest,
  synchronizeProjectBaseline,
} from './projectManifest'

describe('project manifest parsing', () => {
  it('records an optional MPC association with the canonical spec path', () => {
    const manifest = createProjectManifestDraft({
      rootPath: '/work/gcd',
      name: 'gcd',
      designName: 'gcd_core',
      mpc: {
        resource_id: 'mpc:mpc-frame',
        display_name: 'MPC Frame',
        installed_version: '0.1.0',
        path: '/work/resources/mpcs/mpc-frame/0.1.0/',
        spec_path: '/work/resources/mpcs/mpc-frame/0.1.0/spec/spec.json.in',
        design: { index: 0, design_name: 'frame' },
        core_template: { minimum_area: 100, maximum_area: 500 },
      },
    })

    expect(manifest.mpc).toEqual({
      resource_id: 'mpc:mpc-frame',
      display_name: 'MPC Frame',
      installed_version: '0.1.0',
      path: '/work/resources/mpcs/mpc-frame/0.1.0',
      spec_path: '/work/resources/mpcs/mpc-frame/0.1.0/spec/spec.json.in',
      design: { index: 0, design_name: 'frame' },
      core_template: { minimum_area: 100, maximum_area: 500 },
    })
  })

  it('requires design_name and rejects a mismatched MPC spec path', () => {
    const legacyManifest = {
      schema_version: 1,
      project_id: 'proj_gcd',
      name: 'gcd',
      root_path: '/work/gcd',
      created_at: '2026-07-01T00:00:00.000Z',
      updated_at: '2026-07-01T00:00:00.000Z',
      base_design: { rtl_list: [] },
      objectives: { primary: 'timing', directions: {} },
      workspaces: [],
      best_workspace: null,
    }

    expect(() => parseProjectManifest(JSON.stringify(legacyManifest))).toThrow(
      'design_name is required',
    )
    expect(() =>
      parseProjectManifest(
        JSON.stringify({
          ...legacyManifest,
          design_name: 'gcd',
          mpc: {
            resource_id: 'mpc:mpc-frame',
            display_name: 'MPC Frame',
            installed_version: '0.1.0',
            path: '/work/resources/mpcs/mpc-frame/0.1.0',
            spec_path: '/work/resources/mpcs/mpc-frame/0.1.0/spec.json.in',
            design: { index: 0, design_name: 'frame' },
            core_template: { minimum_area: 100, maximum_area: 500 },
          },
        }),
      ),
    ).toThrow('mpc.spec_path must reference spec/spec.json.in')
  })

  it('rejects a non-null MPC association without a selected design snapshot', () => {
    expect(() =>
      parseProjectManifest(
        JSON.stringify({
          schema_version: 1,
          project_id: 'proj_gcd',
          name: 'gcd',
          design_name: 'gcd',
          root_path: '/work/gcd',
          created_at: '2026-07-01T00:00:00.000Z',
          updated_at: '2026-07-01T00:00:00.000Z',
          base_design: { rtl_list: [] },
          objectives: { primary: 'timing', directions: {} },
          workspaces: [],
          best_workspace: null,
          mpc: {
            resource_id: 'mpc:mpc-frame',
            display_name: 'MPC Frame',
            installed_version: '0.1.0',
            path: '/work/resources/mpcs/mpc-frame/0.1.0',
            spec_path: '/work/resources/mpcs/mpc-frame/0.1.0/spec/spec.json.in',
          },
        }),
      ),
    ).toThrow('mpc.design requires a non-negative index and design_name')
  })

  it('preserves unknown fields while normalizing a manifest mutation', () => {
    const manifest = parseProjectManifest(
      JSON.stringify({
        schema_version: 1,
        project_id: 'proj_gcd',
        name: 'gcd',
        design_name: 'gcd',
        root_path: '/work/gcd',
        created_at: '2026-07-01T00:00:00.000Z',
        updated_at: '2026-07-01T00:00:00.000Z',
        base_design: { rtl_list: [], vendor_setting: 'preserve-me' },
        objectives: { primary: 'timing', directions: {} },
        workspaces: [
          {
            workspace_id: 'ws_0001',
            workspace_path: '/work/gcd/ws_0001',
            created_at: '2026-07-01T00:00:00.000Z',
            updated_at: '2026-07-01T00:00:00.000Z',
            custom_workspace_setting: { keep: true },
          },
          {
            workspace_id: 'ws_0002',
            workspace_path: '/work/gcd/ws_0002',
            created_at: '2026-07-01T00:00:00.000Z',
            updated_at: '2026-07-01T00:00:00.000Z',
          },
        ],
        best_workspace: null,
        vendor_metadata: { version: 2 },
      }),
    )

    const updated = deleteWorkspaceFromManifest(
      manifest,
      'ws_0002',
      '2026-07-02T00:00:00.000Z',
    )

    expect((updated as unknown as Record<string, unknown>).vendor_metadata).toEqual({
      version: 2,
    })
    expect((updated.base_design as Record<string, unknown>).vendor_setting).toBe(
      'preserve-me',
    )
    expect(updated.workspaces).toHaveLength(1)
    expect(
      (updated.workspaces[0] as unknown as Record<string, unknown> | undefined)
        ?.custom_workspace_setting,
    ).toEqual({ keep: true })
  })

  it('keeps extension fields when an existing workspace is registered again', () => {
    const manifest = parseProjectManifest(
      JSON.stringify({
        schema_version: 1,
        project_id: 'proj_gcd',
        name: 'gcd',
        design_name: 'gcd',
        root_path: '/work/gcd',
        created_at: '2026-07-01T00:00:00.000Z',
        updated_at: '2026-07-01T00:00:00.000Z',
        base_design: { rtl_list: [] },
        objectives: { primary: 'timing', directions: {} },
        workspaces: [
          {
            workspace_id: 'ws_0001',
            workspace_path: '/work/gcd/ws_0001',
            created_at: '2026-07-01T00:00:00.000Z',
            updated_at: '2026-07-01T00:00:00.000Z',
            custom_workspace_setting: { keep: true },
          },
        ],
        best_workspace: null,
      }),
    )

    const updated = registerWorkspaceInManifest(manifest, {
      projectRoot: '/work/gcd',
      workspacePath: '/work/gcd/ws_0001',
      now: '2026-07-02T00:00:00.000Z',
    })

    expect(
      (updated.workspaces[0] as unknown as Record<string, unknown> | undefined)
        ?.custom_workspace_setting,
    ).toEqual({ keep: true })
  })

  it('persists the first available workspace as the default QoR baseline', () => {
    const first = registerWorkspaceInManifest(
      createProjectManifestDraft({
        rootPath: '/work/gcd',
        name: 'gcd',
        designName: 'gcd',
      }),
      {
        projectRoot: '/work/gcd',
        workspacePath: '/work/gcd/ws_0001',
        now: '2026-08-04T00:00:00.000Z',
      },
    )
    const second = registerWorkspaceInManifest(first, {
      projectRoot: '/work/gcd',
      workspacePath: '/work/gcd/ws_0002',
      now: '2026-08-04T01:00:00.000Z',
    })

    expect(first.qor_baseline).toEqual({
      workspace_id: 'ws_0001',
      reason: 'Default project QoR baseline',
    })
    expect(second.qor_baseline).toEqual(first.qor_baseline)
  })

  it('moves the QoR baseline when its workspace is archived or deleted', () => {
    const first = registerWorkspaceInManifest(
      createProjectManifestDraft({
        rootPath: '/work/gcd',
        name: 'gcd',
        designName: 'gcd',
      }),
      {
        projectRoot: '/work/gcd',
        workspacePath: '/work/gcd/ws_0001',
        now: '2026-08-04T00:00:00.000Z',
      },
    )
    const second = registerWorkspaceInManifest(first, {
      projectRoot: '/work/gcd',
      workspacePath: '/work/gcd/ws_0002',
      now: '2026-08-04T01:00:00.000Z',
    })

    expect(archiveWorkspaceInManifest(second, 'ws_0001').qor_baseline).toEqual({
      workspace_id: 'ws_0002',
      reason: 'Default project QoR baseline',
    })
    expect(deleteWorkspaceFromManifest(second, 'ws_0001').qor_baseline).toEqual({
      workspace_id: 'ws_0002',
      reason: 'Default project QoR baseline',
    })
  })

  it('keeps project design_name authoritative for workspace registration and baseline sync', () => {
    const manifest = createProjectManifestDraft({
      rootPath: '/work/gcd',
      name: 'Dashboard label',
      designName: 'gcd_project',
      now: '2026-08-04T00:00:00.000Z',
    })
    const registered = registerWorkspaceInManifest(manifest, {
      projectRoot: '/work/gcd',
      workspacePath: '/work/gcd/ws_0001',
      config: {
        parameters: { design: 'workspace_override', top_module: 'core' },
      },
    })
    const synchronized = synchronizeProjectBaseline(registered, {
      workspaceId: 'ws_0001',
      baseDesign: {
        parameters: { design: 'baseline_override', top_module: 'baseline_core' },
        rtl_list: ['/work/gcd/ws_0001/origin/gcd_project.sv'],
      },
      now: '2026-08-05T00:00:00.000Z',
    })

    expect(registered.workspaces[0]).toMatchObject({ name: 'gcd_project' })
    expect(registered.base_design.parameters?.design).toBe('gcd_project')
    expect(synchronized.design_name).toBe('gcd_project')
    expect(synchronized.base_design.parameters).toMatchObject({
      design: 'gcd_project',
      top_module: 'baseline_core',
    })
  })
})
