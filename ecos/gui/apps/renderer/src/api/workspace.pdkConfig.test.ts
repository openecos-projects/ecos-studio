import { describe, expect, it } from 'vitest'
import type { WorkspaceConfig } from '@ecos-studio/shared'
import { backendWorkspaceOptions } from './workspace'

function baseConfig(overrides: Partial<WorkspaceConfig> = {}): WorkspaceConfig {
  return {
    directory: '/projects/gcd/runs/baseline',
    pdk: 'ics55',
    pdk_root: '/pdks/ics55',
    parameters: { design: 'gcd', top_module: 'gcd', clock: 'clk' },
    origin_def: '',
    origin_verilog: '/projects/gcd/origin/gcd.v',
    rtl_list: ['/projects/gcd/origin/gcd.v'],
    ...overrides,
  }
}

describe('backendWorkspaceOptions ecc.toml persistence payload', () => {
  it('omits eccPdkConfig when no external paths or manual selection exist', () => {
    const options = backendWorkspaceOptions(
      baseConfig({ pdk_config_mode: 'default' }),
      '/projects/gcd/runs/baseline',
    )
    expect(options).not.toHaveProperty('eccPdkConfig')
  })

  it('carries external paths alone in default mode', () => {
    const options = backendWorkspaceOptions(
      baseConfig({
        pdk_config_mode: 'default',
        pdk_external_paths: ['/macros/sram'],
      }),
      '/projects/gcd/runs/baseline',
    )
    expect(options.eccPdkConfig).toEqual({ externalPaths: ['/macros/sram'] })
  })

  it('records the manual selection as pdk overrides with absolute paths', () => {
    const options = backendWorkspaceOptions(
      baseConfig({
        pdk_config_mode: 'manual',
        pdk_external_paths: ['/macros/sram'],
        pdk_config: {
          mode: 'manual',
          tech_lef: ['/pdks/ics55/prtech/tech.lef'],
          cell_lef: ['/pdks/ics55/IP/lef/std.lef', '/macros/sram/sram.lef'],
          liberty: ['/macros/sram/sram.lib'],
        },
      }),
      '/projects/gcd/runs/baseline',
    )
    expect(options.eccPdkConfig).toEqual({
      externalPaths: ['/macros/sram'],
      overrides: {
        tech: '/pdks/ics55/prtech/tech.lef',
        lefs: ['/pdks/ics55/IP/lef/std.lef', '/macros/sram/sram.lef'],
        libs: ['/macros/sram/sram.lib'],
      },
    })
  })
})
