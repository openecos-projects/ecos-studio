import { describe, expect, it } from 'vitest'
import {
  createProjectManifestMpcSnapshot,
  parseMpcSpecDesigns,
  previewMpcCoreTemplate,
} from './mpcSpec'

describe('MPC spec parsing', () => {
  it('keeps every design with a core template and snapshots the selected template', () => {
    const designs = parseMpcSpecDesigns({
      designs: [
        {
          design_name: 'small-frame',
          directory: 'small',
          core_template: { minimum_area: 100, parameters: [{ name: 'WIDTH' }] },
        },
        {
          design_name: 'large-frame',
          core_template: { minimum_area: 200 },
        },
      ],
    })

    expect(designs.map((design) => design.designName)).toEqual([
      'small-frame',
      'large-frame',
    ])
    const snapshot = createProjectManifestMpcSnapshot(
      {
        resource_id: 'mpc:mpc-frame',
        display_name: 'MPC Frame',
        installed_version: '0.1.0',
        path: '/resources/mpcs/mpc-frame/0.1.0',
        spec_path: '/resources/mpcs/mpc-frame/0.1.0/spec/spec.json.in',
      },
      designs[0],
    )
    designs[0].coreTemplate.minimum_area = 999

    expect(snapshot).toEqual({
      resource_id: 'mpc:mpc-frame',
      display_name: 'MPC Frame',
      installed_version: '0.1.0',
      path: '/resources/mpcs/mpc-frame/0.1.0',
      spec_path: '/resources/mpcs/mpc-frame/0.1.0/spec/spec.json.in',
      design: { index: 0, design_name: 'small-frame', directory: 'small' },
      core_template: { minimum_area: 100, parameters: [{ name: 'WIDTH' }] },
    })
  })

  it('uses stable fallback labels and rejects specs without usable designs', () => {
    expect(
      parseMpcSpecDesigns({ designs: [{ core_template: { name: 'frame' } }] }),
    ).toMatchObject([{ index: 0, designName: 'Design 1' }])
    expect(() => parseMpcSpecDesigns({ designs: [{ core_template: [] }] })).toThrow(
      'no design with a core_template object',
    )
    expect(() => parseMpcSpecDesigns({})).toThrow('must contain a designs array')
  })

  it('groups known template fields while retaining unknown constraints', () => {
    const preview = previewMpcCoreTemplate({
      name: 'frame',
      minimum_area: 100,
      maximum_area: 1000,
      parameters: [{ name: 'WIDTH', default: 66 }],
      ports: [{ name: 'clock', direction: 'input' }],
      frame_io: { payload_width: 66 },
      template_behavior: { replaceable: true },
      future_constraint: { required: true },
    })

    expect(preview.template).toEqual({ name: 'frame' })
    expect(preview.limits).toEqual({ minimum_area: 100, maximum_area: 1000 })
    expect(preview.parameters).toEqual([{ name: 'WIDTH', default: 66 }])
    expect(preview.ports).toEqual([{ name: 'clock', direction: 'input' }])
    expect(preview.other).toEqual({ future_constraint: { required: true } })
  })
})
