import { describe, expect, it } from 'vitest'

import { buildWorkspaceCreationModel } from './workspaceCreationModel'

describe('buildWorkspaceCreationModel', () => {
  it('keeps defaulted and inapplicable parameters discoverable', () => {
    const model = buildWorkspaceCreationModel(
      {
        flowDefinitions: [{ flowId: 'synth', stepIds: ['Synthesis'] }],
        parameterCatalog: [
          { id: 'frequency_max', default: 100, appliesTo: 'synthesis' },
          { id: 'top_layer', default: 'MET5', appliesTo: 'routing' },
          { id: 'target_density', default: 0.2, appliesTo: 'placement' },
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
          { default: 100, id: 'frequency_max', type: 'float' },
          { default: 0.6, id: 'core_utilization', type: 'float' },
        ],
      },
      [],
      {
        explicitParameters: { core_utilization: 0.72 },
        flowId: 'harden',
        inputMode: 'rtl',
        mpc,
        pdk: { familyId: 'ics55', mode: 'default', version: '1.10.100' },
        projectPresetParameters: {
          frequency_max: 200,
          core_utilization: 0.65,
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

  it('treats catalog applies names as the same flow steps as workspace identities', () => {
    const model = buildWorkspaceCreationModel(
      {
        flowDefinitions: [
          {
            flowId: 'rtl2gds',
            stepIds: ['Synthesis', 'place', 'route'],
          },
        ],
        parameterCatalog: [
          { id: 'frequency_mhz', default: 100, appliesTo: 'synthesis' },
          { id: 'target_density', default: 0.2, appliesTo: 'placement' },
          { id: 'bottom_layer', default: 'MET2', appliesTo: 'routing' },
          { id: 'tech', default: '', appliesTo: 'pdk' },
        ],
      },
      [],
      { flowId: 'rtl2gds' },
    )

    expect(model.parameters).toEqual([
      expect.objectContaining({
        definition: expect.objectContaining({ id: 'frequency_mhz' }),
        state: 'defaulted',
      }),
      expect.objectContaining({
        definition: expect.objectContaining({ id: 'target_density' }),
        state: 'defaulted',
      }),
      expect.objectContaining({
        definition: expect.objectContaining({ id: 'bottom_layer' }),
        state: 'defaulted',
      }),
      expect.objectContaining({
        definition: expect.objectContaining({ id: 'tech' }),
        inapplicableReason: 'flow:rtl2gds',
        state: 'inapplicable',
      }),
    ])
  })
})
