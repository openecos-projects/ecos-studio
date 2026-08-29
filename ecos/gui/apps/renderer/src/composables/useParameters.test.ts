import { describe, expect, it } from 'vitest'
import {
  parametersHaveChipIdentity,
  parseParametersData,
  parseParametersRecord,
  transformConfigToParameters,
  transformParametersToConfig,
  type ConfigData,
} from './useParameters'

describe('useParameters helpers', () => {
  it('parses the current parameters schema into normalized data', () => {
    const parsed = parseParametersData(
      JSON.stringify({
        PDK: 'ics55',
        Design: 'demo',
        'Top module': 'top',
        Die: { Size: ['100', 200], Area: '300' },
        Core: {
          Size: [80, '120'],
          Area: '9600',
          'Bounding box': '(0,0) (10,10)',
          Utilitization: '0.55',
          Margin: ['3', 4],
          'Aspect ratio': '1.2',
        },
        'Max fanout': '42',
        'Target density': '0.61',
        'Target overflow': '0.09',
        'Global right padding': '7',
        'Cell padding x': '900',
        'Routability opt flag': 0,
        Clock: 'clk',
        'Frequency max [MHz]': '250',
        'Bottom layer': 'MET3',
        'Top layer': 'MET6',
        'PDK Root': '/pdks/ics55',
      }),
    )

    expect(parsed).toMatchObject({
      PDK: 'ics55',
      Design: 'demo',
      'Top module': 'top',
      Die: { Size: [100, 200], Area: 300 },
      Core: {
        Size: [80, 120],
        Area: 9600,
        'Bounding box': '(0,0) (10,10)',
        Utilitization: 0.55,
        Margin: [3, 4],
        'Aspect ratio': 1.2,
      },
      'Max fanout': 42,
      'Target density': 0.61,
      'Target overflow': 0.09,
      'Global right padding': 7,
      'Cell padding x': 900,
      'Routability opt flag': 0,
      Clock: 'clk',
      'Frequency max [MHz]': 250,
      'Bottom layer': 'MET3',
      'Top layer': 'MET6',
      'PDK Root': '/pdks/ics55',
    })
  })

  it('round-trips the current config schema without dropping supported fields', () => {
    const config: ConfigData = {
      designTool: 'backend',
      description: '',
      pdk: 'ics55',
      pdkRoot: '/pdks/ics55',
      design: 'chip_top',
      topModule: 'chip_top',
      die: { Size: [2000, 1800], area: 3600000 },
      core: {
        Size: [1600, 1400],
        area: 2240000,
        boundingBox: '(0,0) (1600,1400)',
        utilization: 0.58,
        margin: [8, 12],
        aspectRatio: 1.14,
      },
      maxFanout: 32,
      targetDensity: 0.63,
      targetOverflow: 0.12,
      globalRightPadding: 5,
      cellPaddingX: 640,
      routabilityOptFlag: true,
      clock: 'clk',
      frequencyMax: 500,
      bottomLayer: 'MET2',
      topLayer: 'MET5',
      frontend: {
        coreId: '',
        cpuWrapperId: '',
        cpuWrapperContract: '',
        cpuSocketContract: '',
        cpuWrapperTop: '',
        socHarnessId: '',
        socWrapperId: '',
        socWrapperContract: '',
        socVariant: '',
        toolchainId: '',
        testSuiteId: '',
        cpuFilelist: '',
        socFilelist: '',
        inputFilelist: '',
        simProgramNames: [],
        simAllTests: false,
      },
    }

    expect(transformParametersToConfig(transformConfigToParameters(config))).toEqual(
      config,
    )
  })

  it('round-trips frontend workspace metadata', () => {
    const parsed = parseParametersData(
      JSON.stringify({
        'Design Tool': 'frontend',
        design: 'cpu-demo',
        top_module: 'ecos_sim_top',
        clock: 'clk',
        frequency_max: 100,
        frontend_core_id: 'custom-filelist',
        cpu_filelist: '/work/cpu/filelist.f',
        soc_harness_id: 'ysyx-am',
        toolchain_id: 'riscv64-unknown-elf',
        test_suite_id: 'am-tests',
        sim_program_names: ['cpu-tests'],
        sim_all_tests: true,
      }),
    )
    const config = transformParametersToConfig(parsed)

    expect(config.designTool).toBe('frontend')
    expect(config.frontend).toMatchObject({
      coreId: 'custom-filelist',
      cpuFilelist: '/work/cpu/filelist.f',
      socHarnessId: 'ysyx-am',
      toolchainId: 'riscv64-unknown-elf',
      testSuiteId: 'am-tests',
      simProgramNames: ['cpu-tests'],
      simAllTests: true,
    })
    expect(transformConfigToParameters(config)).toMatchObject({
      'Design Tool': 'frontend',
      frontend_core_id: 'custom-filelist',
      cpu_filelist: '/work/cpu/filelist.f',
      soc_harness_id: 'ysyx-am',
    })
  })

  it('pins routing layer fields to the ics55 MET2-MET5 route window', () => {
    const config = transformParametersToConfig(
      parseParametersData(
        JSON.stringify({
          PDK: 'ics55',
          Design: 'demo',
          'Top module': 'top',
          Die: { Size: [100, 200], Area: 300 },
          Core: {
            Size: [80, 120],
            Area: 9600,
            'Bounding box': '(0,0) (10,10)',
            Utilitization: 0.55,
            Margin: [3, 4],
            'Aspect ratio': 1.2,
          },
          'Max fanout': 42,
          'Target density': 0.61,
          'Target overflow': 0.09,
          'Global right padding': 7,
          'Cell padding x': 900,
          'Routability opt flag': 0,
          Clock: 'clk',
          'Frequency max [MHz]': 250,
          'Bottom layer': 'MET3',
          'Top layer': 'MET6',
          'PDK Root': '/pdks/ics55',
        }),
      ),
    )

    expect(config.bottomLayer).toBe('MET2')
    expect(config.topLayer).toBe('MET5')

    const parameters = transformConfigToParameters({
      ...config,
      bottomLayer: 'MET3',
      topLayer: 'MET6',
    })

    expect(parameters['Bottom layer']).toBe('MET2')
    expect(parameters['Top layer']).toBe('MET5')
  })
  it('reads canonical die_area geometry when Die/Core tables are absent', () => {
    const parsed = parseParametersRecord({
      pdk: 'ics55',
      design: 'demo',
      die_area: { width: 120, height: 80, utilitization: 0.5, margin: 3 },
    })
    expect(parsed.Die.Size).toEqual([120, 80])
    expect(parsed.Core.Utilitization).toBe(0.5)
    expect(parsed.Core.Margin).toEqual([3, 3])
  })

  it('rejects bigint parameters instead of rounding them silently', () => {
    expect(() =>
      parseParametersRecord({
        pdk: 'ics55',
        design: 'demo',
        max_fanout: 9007199254740993n,
      }),
    ).toThrow(/safe integer range/)
    expect(() =>
      parseParametersRecord({ pdk: 'ics55', design: 'demo', die: { size: [100n, 200] } }),
    ).toThrow(/safe integer range/)
  })

  it('rejects non-finite parameter values instead of propagating them', () => {
    expect(() =>
      parseParametersRecord({ pdk: 'ics55', design: 'demo', target_density: Infinity }),
    ).toThrow(/not a finite number/)
    expect(() =>
      parseParametersRecord({
        pdk: 'ics55',
        design: 'demo',
        core: { utilitization: NaN },
      }),
    ).toThrow(/not a finite number/)
  })

  it('rejects TOML date values in GUI-known fields instead of corrupting them', () => {
    const when = new Date('2026-08-27T00:00:00Z')
    expect(() => parseParametersRecord({ pdk: 'ics55', design: when })).toThrow(
      /TOML date/,
    )
    expect(() =>
      parseParametersRecord({ pdk: 'ics55', design: 'demo', top_module: when }),
    ).toThrow(/TOML date/)
    expect(() =>
      parseParametersRecord({ pdk: 'ics55', design: 'demo', max_fanout: when }),
    ).toThrow(/TOML date/)
    expect(() =>
      parseParametersRecord({ pdk: 'ics55', design: 'demo', die: { size: when } }),
    ).toThrow(/table or array was expected/)
  })

  it('rejects tables and arrays in GUI-known scalar fields instead of stringifying them', () => {
    expect(() =>
      parseParametersRecord({ pdk: 'ics55', design: { extra: 'keep-me' } }),
    ).toThrow(/must be a scalar, not a table/)
    expect(() => parseParametersRecord({ pdk: 'ics55', design: ['gcd'] })).toThrow(
      /must be a scalar, not an array/,
    )
    expect(() =>
      parseParametersRecord({ pdk: 'ics55', design: 'demo', clock: { port: 'clk' } }),
    ).toThrow(/must be a scalar, not a table/)
    expect(() =>
      parseParametersRecord({
        pdk: 'ics55',
        design: 'demo',
        sim_program_names: [{ name: 'cpu-tests' }],
      }),
    ).toThrow(/must be a scalar, not a table/)
  })

  it('treats empty snapshots as missing chip identity', () => {
    expect(parametersHaveChipIdentity({})).toBe(false)
    expect(parametersHaveChipIdentity({ Die: { Size: [], Area: 0 } })).toBe(false)
    expect(
      parametersHaveChipIdentity({
        PDK: 'ics55',
        Design: 'demo',
        'Top module': 'top',
        Clock: 'clk',
      }),
    ).toBe(true)
    expect(parametersHaveChipIdentity({ pdk: 'ics55', design: 'demo' })).toBe(true)
    expect(parametersHaveChipIdentity({ die: { area: 1200 } })).toBe(true)
  })
})
