import { describe, expect, it } from 'vitest'

import { buildWorkspaceCreationModel } from './workspaceCreationModel'

describe('buildWorkspaceCreationModel', () => {
  it('keeps defaulted and inapplicable parameters discoverable', () => {
    const model = buildWorkspaceCreationModel(
      {
        flowDefinitions: [{ flowId: 'synth', stepIds: ['Synthesis'] }],
        parameterCatalog: [
          { id: 'design.frequency_mhz', default: 100, appliesTo: 'synthesis' },
          { id: 'route.top_layer', default: 'MET5', appliesTo: 'routing' },
        ],
      },
      [],
      { flowId: 'synth' },
    )

    expect(model.parameters).toEqual([
      expect.objectContaining({
        state: 'defaulted',
        value: 100,
      }),
      expect.objectContaining({
        inapplicableReason: 'flow:synth',
        state: 'inapplicable',
      }),
    ])
    expect(model.controls).toEqual({
      flowBoundaries: true,
      manualPdkFiles: true,
      mpc: true,
      pdkVersion: true,
    })
  })

  it('combines project, input, PDK, MPC, and explicit parameter context', () => {
    const mpc = { designId: 'cpu', resourceId: 'mpc:cpu', version: '1' }
    const model = buildWorkspaceCreationModel(
      {
        parameterCatalog: [
          { default: 100, id: 'design.frequency_mhz', type: 'float' },
          { default: 0.6, id: 'floorplan.core_util', type: 'float' },
        ],
      },
      [],
      {
        explicitParameters: { 'floorplan.core_util': 0.72 },
        flowId: 'harden',
        inputMode: 'rtl',
        mpc,
        pdk: { familyId: 'ics55', mode: 'default', version: '1.10.100' },
        projectPresetParameters: {
          'design.frequency_mhz': 200,
          'floorplan.core_util': 0.65,
        },
      },
    )

    expect(model.context).toEqual({
      flowId: 'harden',
      inputMode: 'rtl',
      mpc,
      pdk: { familyId: 'ics55', mode: 'default', version: '1.10.100' },
    })
    expect(model.parameters).toMatchObject([
      { source: 'projectPreset', state: 'defaulted', value: 200 },
      { source: 'user', state: 'explicit', value: 0.72 },
    ])
  })
})
