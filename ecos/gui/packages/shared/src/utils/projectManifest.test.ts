import { describe, expect, it } from 'vitest'
import {
  deleteWorkspaceFromManifest,
  parseProjectManifest,
  registerWorkspaceInManifest,
} from './projectManifest'

describe('project manifest parsing', () => {
  it('preserves unknown fields while normalizing a manifest mutation', () => {
    const manifest = parseProjectManifest(
      JSON.stringify({
        schema_version: 1,
        project_id: 'proj_gcd',
        name: 'gcd',
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
})
