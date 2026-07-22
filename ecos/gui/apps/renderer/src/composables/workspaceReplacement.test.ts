import { describe, expect, it } from 'vitest'
import type { WorkspaceConfig } from '@/types'
import { rewriteWorkspaceConfigPathsForReplacement } from './workspaceReplacement'

describe('workspace replacement helpers', () => {
  it('rewrites only workspace-local paths before retaining a replacement backup', () => {
    const config = {
      origin_def: '/projects/gcd/ws_0001/output/gcd.def',
      origin_verilog: '/projects/gcd/ws_0001/output/gcd.v',
      rtl_list: ['/projects/gcd/ws_0001/rtl/gcd.sv', '/shared/cells.sv'],
      filelist: '/projects/gcd/ws_0001/rtl/files.f',
      sdc: '/projects/gcd/ws_0001/constraints/gcd.sdc',
      pdk_json: '/shared/pdk.json',
    } as WorkspaceConfig

    expect(
      rewriteWorkspaceConfigPathsForReplacement(
        config,
        '/projects/gcd/ws_0001',
        '/projects/gcd/ws_0001.backup',
      ),
    ).toMatchObject({
      origin_def: '/projects/gcd/ws_0001.backup/output/gcd.def',
      origin_verilog: '/projects/gcd/ws_0001.backup/output/gcd.v',
      rtl_list: ['/projects/gcd/ws_0001.backup/rtl/gcd.sv', '/shared/cells.sv'],
      filelist: '/projects/gcd/ws_0001.backup/rtl/files.f',
      sdc: '/projects/gcd/ws_0001.backup/constraints/gcd.sdc',
      pdk_json: '/shared/pdk.json',
    })
  })
})
