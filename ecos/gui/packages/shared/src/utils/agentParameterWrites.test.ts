import { describe, expect, it } from 'vitest'

import type { DesktopAgentWorkspaceParameterWrite } from '../contracts/desktopAgent.ts'
import {
  canonicalParameterWriteKey,
  parameterWritesMatchPatch,
} from './agentParameterWrites.ts'

const densityWrite = (
  overrides: Partial<DesktopAgentWorkspaceParameterWrite> = {},
): DesktopAgentWorkspaceParameterWrite => ({
  file: 'home/params.toml',
  json_path: ['params', 'step_params', 'placement', 'place.target_density'],
  knob_id: 'place.target_density',
  surface: 'parameters',
  value: 0.55,
  ...overrides,
})

describe('parameterWritesMatchPatch', () => {
  it('accepts a 1:1 knob/value/surface match', () => {
    expect(
      parameterWritesMatchPatch(
        [{ knob_id: 'place.target_density', value: 0.55 }],
        [densityWrite()],
      ),
    ).toBe(true)
  })

  it('rejects a write whose path or value does not match the advertised patch', () => {
    expect(
      parameterWritesMatchPatch(
        [{ knob_id: 'place.target_density', value: 0.55 }],
        [densityWrite({ json_path: ['pdk_root'], value: '/tmp/other' })],
      ),
    ).toBe(false)
  })

  it('rejects a same-value write aimed at a different parameter leaf', () => {
    expect(
      parameterWritesMatchPatch(
        [{ knob_id: 'place.target_density', value: 0.55 }],
        [densityWrite({ json_path: ['pdk_root'] })],
      ),
    ).toBe(false)
  })

  it('rejects a write whose path only shares the knob leaf', () => {
    expect(
      parameterWritesMatchPatch(
        [{ knob_id: 'place.target_density', value: 0.55 }],
        [densityWrite({ json_path: ['future', 'target_density'] })],
      ),
    ).toBe(false)
  })

  it('rejects a write that parks the knob leaf under an unrelated table', () => {
    expect(
      parameterWritesMatchPatch(
        [{ knob_id: 'place.target_density', value: 0.55 }],
        [densityWrite({ json_path: ['core', 'target_density'] })],
      ),
    ).toBe(false)
  })

  it('rejects a step-config write aimed at the wrong tool file', () => {
    expect(
      parameterWritesMatchPatch(
        [{ knob_id: 'place.density_weight', value: 0.1 }],
        [
          {
            file: 'config/cts_ecc.json',
            json_path: ['density_weight'],
            knob_id: 'place.density_weight',
            surface: 'step_config',
            value: 0.1,
          },
        ],
      ),
    ).toBe(false)
  })

  it('accepts routability_opt_flag as the workspace-config leaf for place.routability_opt', () => {
    expect(
      parameterWritesMatchPatch(
        [{ knob_id: 'place.routability_opt', value: true }],
        [
          {
            file: 'home/params.toml',
            json_path: [
              'params',
              'step_params',
              'placement',
              'place.routability_opt_flag',
            ],
            knob_id: 'place.routability_opt',
            surface: 'parameters',
            value: 1,
          },
        ],
      ),
    ).toBe(true)
  })

  it('accepts the canonical workspace utilization path', () => {
    expect(
      parameterWritesMatchPatch(
        [{ knob_id: 'floorplan.utilitization', value: 0.7 }],
        [
          {
            file: 'home/params.toml',
            json_path: ['params', 'core', 'utilitization'],
            knob_id: 'floorplan.utilitization',
            surface: 'parameters',
            value: 0.7,
          },
        ],
      ),
    ).toBe(true)
  })

  it('rejects prototype-related json_path segments', () => {
    expect(
      parameterWritesMatchPatch(
        [{ knob_id: 'place.target_density', value: 0.55 }],
        [densityWrite({ json_path: ['__proto__', 'toString'] })],
      ),
    ).toBe(false)
  })

  it('rejects a parameters surface aimed at a step-config file', () => {
    expect(
      parameterWritesMatchPatch(
        [{ knob_id: 'place.target_density', value: 0.55 }],
        [
          densityWrite({
            file: 'config/cts_ecc.json',
            json_path: ['density_weight'],
          }),
        ],
      ),
    ).toBe(false)
  })

  it('rejects a second knob writing to an unrelated parameter', () => {
    expect(
      parameterWritesMatchPatch(
        [
          { knob_id: 'place.target_density', value: 0.55 },
          { knob_id: 'place.target_overflow', value: 0.1 },
        ],
        [
          densityWrite(),
          densityWrite({
            file: 'home/params.toml',
            json_path: ['Target density'],
            knob_id: 'place.target_overflow',
            value: 0.1,
          }),
        ],
      ),
    ).toBe(false)
  })

  it('accepts an empty patch with no writes', () => {
    expect(parameterWritesMatchPatch([], [])).toBe(true)
  })
})

describe('canonicalParameterWriteKey', () => {
  it('includes the step when comparing parameter paths', () => {
    expect(canonicalParameterWriteKey(densityWrite())).not.toBe(
      canonicalParameterWriteKey(
        densityWrite({
          json_path: ['params', 'step_params', 'diff_opt', 'place.target_density'],
        }),
      ),
    )
  })
})
