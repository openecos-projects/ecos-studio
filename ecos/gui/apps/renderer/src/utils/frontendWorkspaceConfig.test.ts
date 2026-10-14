import { describe, expect, it } from 'vitest'
import {
  frontendWorkspaceOptions,
  frontendInputsRequireBackup,
  genericRtlInputIssues,
} from './frontendWorkspaceConfig'
import {
  frontendWorkspaceReconfigureConfig,
  restoreGeneratedRtlSources,
} from './frontendWorkspaceReconfigure'
import {
  parseParametersData,
  transformConfigToParameters,
  transformParametersToConfig,
} from '@/composables/useParameters'

describe('frontend workspace creation and reconfiguration', () => {
  it('sends generic sources and preserves optional clocks without CPU settings', () => {
    const result = frontendWorkspaceOptions(
      {
        frontend_design_kind: 'generic_rtl',
        rtl_list: ['/rtl/counter.sv', '/rtl/defs.svh'],
        parameters: {
          design: 'counter',
          top_module: 'counter',
          clock: '',
          frequency_max: 80,
          cpu_top_module: 'cpu_top',
          core_id: 'ibex',
          soc_variant: 'soc1',
          sim_program_names: ['hello'],
          custom: { keep: true },
        },
      },
      '/project/ws_0001',
    )
    expect(result).toMatchObject({
      frontend_design_kind: 'generic_rtl',
      rtl_list: ['/rtl/counter.sv', '/rtl/defs.svh'],
      parameters: { Clock: '', 'Frequency max [MHz]': 80, custom: { keep: true } },
    })
    for (const key of ['cpu_top_module', 'core_id', 'soc_variant', 'sim_program_names']) {
      expect(result).not.toHaveProperty(key)
      expect(result.parameters).not.toHaveProperty(key)
    }
    expect(
      genericRtlInputIssues({
        ...result,
        parameters: { ...result.parameters, top_module: 'counter', frequency_max: 80 },
      }),
    ).toEqual([])
  })

  it('keeps legacy CPU defaults, file inputs, and simulation configuration', () => {
    const result = frontendWorkspaceOptions(
      {
        cpu_rtl_files: ['/rtl/cpu.v'],
        parameters: {
          top_module: '',
          clock: '',
          core_id: 'custom-filelist',
          cpu_top_module: 'cpu_top',
          soc_harness_id: 'soc',
          sim_program_names: ['hello'],
        },
      },
      '/project/ws_0001',
    )
    expect(result).toMatchObject({
      frontend_design_kind: 'cpu_core',
      cpu_rtl_files: ['/rtl/cpu.v'],
      core_id: 'custom-filelist',
      soc_harness_id: 'soc',
      sim_program_names: ['hello'],
      parameters: { Clock: 'clk', 'Top module': 'ecos_sim_top' },
    })
  })

  it('rehydrates a generic workspace without backend defaults or lost extension fields', () => {
    const config = frontendWorkspaceReconfigureConfig(
      {
        'Design Tool': 'frontend',
        frontend_design_kind: 'generic_rtl',
        Design: 'counter',
        'Top module': 'counter',
        Clock: '',
        'Frequency max [MHz]': 75,
        input_filelist: '/project/ws_0001/origin/input.f',
        extension: { keep: true },
      },
      '/project/ws_0001',
      { projectRoot: '/project', projectName: 'rtl' },
    )
    expect(config).toMatchObject({
      designTool: 'frontend',
      lockWorkspaceDirectory: true,
      replaceExistingWorkspace: true,
      filelist: '/project/ws_0001/origin/input.f',
      parameters: {
        top_module: 'counter',
        clock: '',
        frequency_max: 75,
        extension: { keep: true },
      },
    })
    const payload = frontendWorkspaceOptions(config, config.directory!)
    expect(payload.parameters?.Clock).toBe('')
    expect(payload.parameters?.['Frequency max [MHz]']).toBe(75)
    expect(payload.filelist).toBe(config.filelist)
  })

  it('preserves the design kind when loading and saving frontend parameters', () => {
    const config = transformParametersToConfig(
      parseParametersData(
        JSON.stringify({
          'Design Tool': 'frontend',
          frontend_design_kind: 'generic_rtl',
          Design: 'counter',
          'Top module': 'counter',
          Clock: '',
          input_filelist: '/rtl/design.f',
        }),
      ),
    )
    const saved = transformConfigToParameters(config)
    expect(config.frontend.designKind).toBe('generic_rtl')
    expect(saved).toMatchObject({
      frontend_design_kind: 'generic_rtl',
      input_filelist: '/rtl/design.f',
      Clock: '',
    })
    expect(saved).not.toHaveProperty('core_id')
    expect(saved).not.toHaveProperty('sim_program_names')
  })

  it('rejects ambiguous inputs and header-only RTL selections before creation', () => {
    const parameters = { top_module: 'counter', frequency_max: 100 }
    expect(
      genericRtlInputIssues({
        parameters,
        filelist: '/rtl/design.f',
        rtl_list: ['/rtl/counter.v'],
      }),
    ).toContain('Choose either one filelist or RTL source files.')
    expect(genericRtlInputIssues({ parameters, rtl_list: ['/rtl/defs.svh'] })).toContain(
      'Include at least one .v or .sv source file.',
    )
    expect(genericRtlInputIssues({ parameters, filelist: '/rtl/design.f' })).toEqual([])
  })
})

describe('generic RTL inputs during workspace replacement', () => {
  it('restores selected files instead of retaining the old generated filelist', () => {
    const config = frontendWorkspaceReconfigureConfig(
      {
        frontend_design_kind: 'generic_rtl',
        input_filelist: '/project/ws_0001/origin/.rtl_sources.f',
      },
      '/project/ws_0001',
      null,
    )
    restoreGeneratedRtlSources(
      config,
      "# Generated by ecc-fe from selected RTL files\n+incdir+'/rtl/my counter'\n'/rtl/my counter/top.sv'\n",
    )
    expect(config.filelist).toBe('')
    expect(config.parameters).not.toHaveProperty('input_filelist')
    expect(config.rtl_list).toEqual(['/rtl/my counter/top.sv'])
    expect(frontendWorkspaceOptions(config, config.directory!).rtl_list).toEqual(
      config.rtl_list,
    )
    expect(config.lockWorkspaceDirectory).toBe(true)
  })

  it('does not silently remove manually added filelist options', () => {
    const config = frontendWorkspaceReconfigureConfig(
      {
        frontend_design_kind: 'generic_rtl',
        input_filelist: '/project/ws_0001/origin/.rtl_sources.f',
      },
      '/project/ws_0001',
      null,
    )
    expect(() =>
      restoreGeneratedRtlSources(
        config,
        '# Generated by ecc-fe from selected RTL files\n+define+FEATURE\n/rtl/top.v\n',
      ),
    ).toThrow('The generated RTL filelist was modified')
    expect(config.filelist).toBe('/project/ws_0001/origin/.rtl_sources.f')
  })

  it('requires retaining original sources when inputs are inside the replaced directory', () => {
    const base = {
      directory: '/project/ws_0001',
      designTool: 'frontend' as const,
      frontend_design_kind: 'generic_rtl' as const,
      parameters: {},
      pdk: '',
      pdk_root: '',
      origin_def: '',
      origin_verilog: '',
      rtl_list: [],
    }
    expect(
      frontendInputsRequireBackup(
        { ...base, rtl_list: ['/project/ws_0001/origin/top.v'] },
        base.directory,
      ),
    ).toBe(true)
    expect(
      frontendInputsRequireBackup({ ...base, filelist: '/rtl/design.f' }, base.directory),
    ).toBe(false)
    expect(
      frontendInputsRequireBackup(
        { ...base, rtl_list: ['/project/ws_00010/top.v'] },
        base.directory,
      ),
    ).toBe(false)
  })
})
