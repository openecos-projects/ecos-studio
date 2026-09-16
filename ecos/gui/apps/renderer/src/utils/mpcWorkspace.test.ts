import { describe, expect, it } from 'vitest'
import type { ProjectManifestMpc } from '@ecos-studio/shared'
import { mpcDieAreaConstraint, validateMpcDieArea } from './mpcWorkspace'

const mpc: ProjectManifestMpc = {
  resource_id: 'mpc:mpc-frame',
  display_name: 'MPC Frame',
  installed_version: '0.1.0',
  path: '/resources/mpcs/mpc-frame/0.1.0',
  spec_path: '/resources/mpcs/mpc-frame/0.1.0/spec/spec.json.in',
  design: { index: 0, design_name: 'frame' },
  core_template: { minimum_area: 100, maximum_area: 500 },
}

describe('MPC workspace die-area constraints', () => {
  it('derives numeric bounds from the selected core template', () => {
    expect(mpcDieAreaConstraint(mpc)).toEqual({
      minimumArea: 100,
      maximumArea: 500,
    })
  })

  it('rejects Width / Height areas outside the MPC bounds', () => {
    expect(validateMpcDieArea(mpc, 'width_height', 5, 10).error).toContain('at least 100')
    expect(validateMpcDieArea(mpc, 'width_height', 30, 20).error).toContain('at most 500')
    expect(validateMpcDieArea(mpc, 'width_height', 20, 20)).toMatchObject({
      area: 400,
      error: null,
    })
  })

  it('does not apply area bounds to Utilitization / Margin mode', () => {
    expect(validateMpcDieArea(mpc, 'utilitization_margin', 1, 1)).toMatchObject({
      area: null,
      error: null,
    })
  })

  it('reports an invalid core-template range', () => {
    const invalidMpc: ProjectManifestMpc = {
      ...mpc,
      core_template: { minimum_area: 600, maximum_area: 500 },
    }
    expect(validateMpcDieArea(invalidMpc, 'width_height', 20, 20).error).toContain(
      'invalid die-area range',
    )
  })
})
