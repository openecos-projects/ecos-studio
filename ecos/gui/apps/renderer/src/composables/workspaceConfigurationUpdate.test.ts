import { describe, expect, it } from 'vitest'
import { parseParametersData, transformParametersToConfig } from './useParameters'
import { workspaceConfigurationPatch } from './workspaceConfigurationUpdate'

function config(dieSize: number[]) {
  return transformParametersToConfig(
    parseParametersData(
      JSON.stringify({
        PDK: 'ics55',
        Design: 'gcd',
        'Top module': 'gcd',
        Die: { Size: dieSize, Area: 0 },
        Core: { Utilitization: 0.3, Margin: [2, 2], 'Aspect ratio': 1 },
        Clock: 'clk',
      }),
    ),
  )
}

describe('workspaceConfigurationPatch', () => {
  it('adds both dimensions when selecting a fixed die', () => {
    expect(
      workspaceConfigurationPatch(config([120, 140]), config([])).parameters,
    ).toEqual({
      'floorplan.die_builder.mode': 'die_size',
      'floorplan.die_builder.die_size.width_micron': 120,
      'floorplan.die_builder.die_size.height_micron': 140,
    })
  })

  it('clears both dimensions when returning to utilization sizing', () => {
    expect(
      workspaceConfigurationPatch(config([]), config([120, 140])).parameters,
    ).toEqual({
      'floorplan.die_builder.mode': 'die_util',
      'floorplan.die_builder.die_size.width_micron': 0,
      'floorplan.die_builder.die_size.height_micron': 0,
    })
  })
})
