import { describe, expect, it } from 'vitest'

import {
  DESIGN_SECTION_KEYS,
  PDK_SECTION_KEYS,
  parseWorkspaceParametersText,
} from './workspaceParametersFile'

/**
 * params.toml sample mirroring the section classification contract in
 * ecc/chipcompiler/data/workspace_config.py (_DESIGN_SECTION_KEYS maps
 * design/name, top_module/top, clock/clock_port, frequency_max/frequency_mhz;
 * _PDK_SECTION_KEYS maps pdk/name, pdk_root/root, pdk_config/config). This
 * fixture exists to catch double-parsing drift between the GUI and ECC.
 */
const PARAMS_TOML_SAMPLE = `
[params]
target_density = 0.2
max_fanout = 20
"place.target_overflow" = 0.1

[design]
name = "gcd"
top = "gcd"
clock_port = "clk"
frequency_mhz = 100

[pdk]
name = "ics55"
root = "/pdks/ics55"
config = "pdk/config.json"
`

describe('workspaceParametersFile params.toml 对拍', () => {
  it('pins the section-key tables to the ECC workspace_config.py contract', () => {
    expect({ ...DESIGN_SECTION_KEYS }).toEqual({
      design: 'name',
      top_module: 'top',
      clock: 'clock_port',
      frequency_max: 'frequency_mhz',
    })
    expect({ ...PDK_SECTION_KEYS }).toEqual({
      pdk: 'name',
      pdk_root: 'root',
      pdk_config: 'config',
    })
  })

  it('classifies [design] and [pdk] mirror keys into the flat parameter payload', () => {
    const params = parseWorkspaceParametersText(PARAMS_TOML_SAMPLE, 'toml', '/ws/gcd')

    // [params] values pass through as written (ECC persists canonical keys).
    expect(params.target_density).toBe(0.2)
    expect(params.max_fanout).toBe(20)
    expect(params['place.target_overflow']).toBe(0.1)

    // [design] mirror classification (ECC _DESIGN_SECTION_KEYS).
    expect(params.design).toBe('gcd')
    expect(params.top_module).toBe('gcd')
    expect(params.clock).toBe('clk')
    expect(params.frequency_max).toBe(100)

    // [pdk] mirror classification (ECC _PDK_SECTION_KEYS); a relative
    // pdk_config resolves against the workspace root.
    expect(params.pdk).toBe('ics55')
    expect(params.pdk_root).toBe('/pdks/ics55')
    expect(params.pdk_config).toBe('/ws/gcd/pdk/config.json')
  })

  it('keeps an absolute pdk_config path untouched', () => {
    const text = PARAMS_TOML_SAMPLE.replace(
      'config = "pdk/config.json"',
      'config = "/opt/pdk/config.json"',
    )
    const params = parseWorkspaceParametersText(text, 'toml', '/ws/gcd')
    expect(params.pdk_config).toBe('/opt/pdk/config.json')
  })

  it('ignores empty mirror values instead of overriding [params]', () => {
    const text = `
[params]
frequency_max = 250

[design]
frequency_mhz = ""
top = "   "
`
    const params = parseWorkspaceParametersText(text, 'toml', '/ws/gcd')
    expect(params.frequency_max).toBe(250)
    expect(params.top_module).toBeUndefined()
  })

  it('rejects a section that is present but not a table', () => {
    expect(() =>
      parseWorkspaceParametersText('design = ["gcd"]\n', 'toml', '/ws/gcd'),
    ).toThrow(/\[design\] must be a table/)
    expect(() =>
      parseWorkspaceParametersText('pdk = "ics55"\n', 'toml', '/ws/gcd'),
    ).toThrow(/\[pdk\] must be a table/)
  })

  it('accepts documents without optional sections', () => {
    const params = parseWorkspaceParametersText(
      '[params]\nmax_fanout = 32\n',
      'toml',
      '/ws/gcd',
    )
    expect(params).toEqual({ max_fanout: 32 })
  })
})
