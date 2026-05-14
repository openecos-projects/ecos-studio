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
    }

    expect(transformParametersToConfig(transformConfigToParameters(config))).toEqual(config)
  })
})
