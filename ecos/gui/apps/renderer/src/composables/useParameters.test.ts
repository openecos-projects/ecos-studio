import { describe, expect, it } from 'vitest'
import {
  parseParametersData,
  transformConfigToParameters,
  transformParametersToConfig,
  type ConfigData,
} from './useParameters'

describe('useParameters helpers', () => {
  it('parses the current parameters schema into normalized data', () => {
    const parsed = parseParametersData(JSON.stringify({
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
    }))

    expect(parsed).toEqual({
      PDK: 'ics55',
      Design: 'demo',
      design: undefined,
      description: undefined,
      'Design Tool': undefined,
      'Top module': 'top',
      top_module: undefined,
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
      clock: undefined,
      'Frequency max [MHz]': 250,
      frequency_max: undefined,
      'Bottom layer': 'MET3',
      'Top layer': 'MET6',
      'PDK Root': '/pdks/ics55',
      cpu_filelist: undefined,
      soc_filelist: undefined,
      soc_variant: undefined,
      soc_harness_id: undefined,
      frontend_core_id: undefined,
      core_id: undefined,
      toolchain_id: undefined,
      test_suite_id: undefined,
      input_filelist: undefined,
      sim_program_names: [],
      sim_all_tests: false,
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
      topLayer: 'MET7',
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

    expect(transformParametersToConfig(transformConfigToParameters(config))).toEqual(config)
  })

  it('keeps frontend catalog selections for read-only Home summaries', () => {
    const config = transformParametersToConfig(parseParametersData(JSON.stringify({
      design: 'frontend_demo',
      top_module: 'ecos_sim_top',
      clock: 'clk',
      frequency_max: 100,
      'Design Tool': 'frontend',
      cpu_filelist: '/cpu/filelist.cpu.f',
      soc_filelist: '/soc/filelist.soc.f',
      soc_variant: 'soc1',
      soc_harness_id: 'ysyx-am-soc',
      soc_wrapper_id: 'ysyx-am-soc',
      soc_wrapper_contract: 'ecos-sim-wrapper-v1',
      frontend_core_id: 'custom-filelist',
      cpu_wrapper_id: 'custom-filelist',
      cpu_wrapper_contract: 'ecos-cpu-wrapper-v1',
      cpu_socket_contract: 'ysyx-axi-cpu-socket-v1',
      cpu_wrapper_top: 'ysyx_00000000',
      toolchain_id: 'riscv32-unknown-elf',
      test_suite_id: 'cpu-tests',
      input_filelist: '/workspace/prepare_fe/output/merged_rtl.f',
      sim_program_names: ['add'],
      sim_all_tests: false,
    })))

    expect(config.designTool).toBe('frontend')
    expect(config.design).toBe('frontend_demo')
    expect(config.topModule).toBe('ecos_sim_top')
    expect(config.frontend).toEqual({
      coreId: 'custom-filelist',
      cpuWrapperId: 'custom-filelist',
      cpuWrapperContract: 'ecos-cpu-wrapper-v1',
      cpuSocketContract: 'ysyx-axi-cpu-socket-v1',
      cpuWrapperTop: 'ysyx_00000000',
      socHarnessId: 'ysyx-am-soc',
      socWrapperId: 'ysyx-am-soc',
      socWrapperContract: 'ecos-sim-wrapper-v1',
      socVariant: 'soc1',
      toolchainId: 'riscv32-unknown-elf',
      testSuiteId: 'cpu-tests',
      cpuFilelist: '/cpu/filelist.cpu.f',
      socFilelist: '/soc/filelist.soc.f',
      inputFilelist: '/workspace/prepare_fe/output/merged_rtl.f',
      simProgramNames: ['add'],
      simAllTests: false,
    })
  })
})
