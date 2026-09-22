import { describe, expect, it } from 'vitest'

import {
  findTableSpan,
  formatTomlValue,
  removeScopedKey,
  setScopedKey,
} from './eccTomlEdit'

/**
 * ecc.toml fixture mirroring a CLI-generated project file: preset comment,
 * multi-line arrays, unknown keys, and nested tables. Edits must preserve
 * everything except the targeted key, matching ECC toml_edit.py behavior.
 */
const ECC_TOML_SAMPLE = `# preset: rtl2gds | pdk: ics55
[design]
name = "gcd"
top = "gcd"
rtl = ["rtl/gcd.v"]

[pdk]
name = "ics55"
root = "/pdks/ics55"

[pdk.overrides]
lefs = [
  "IP/STD_cell/lef/a.lef",
  "IP/STD_cell/lef/b.lef",
]

[params]
target_density = 0.2
skip_steps = ["lec"]

[params.macro]
placements = []
`

describe('eccTomlEdit findTableSpan', () => {
  it('locates table bodies and stops at the next header', () => {
    const text = '[pdk]\nname = "ics55"\n\n[params]\nx = 1\n'
    const [start, end] = findTableSpan(text, 'pdk')!
    expect(text.slice(start, end)).toBe('name = "ics55"\n\n')
    expect(findTableSpan(text, 'missing')).toBeNull()
  })

  it('matches dotted table names and ignores headers inside strings', () => {
    const text = '[pdk.overrides]\nlefs = []\nnote = "see [pdk.overrides] docs"\n'
    const [start, end] = findTableSpan(text, 'pdk.overrides')!
    expect(text.slice(start, end)).toContain('lefs = []')
    expect(text.slice(start, end)).toContain('[pdk.overrides] docs')
  })
})

describe('eccTomlEdit setScopedKey', () => {
  it('replaces a key in place while preserving comments and layout', () => {
    const updated = setScopedKey(ECC_TOML_SAMPLE, 'pdk', 'root', '/pdks/ics55-v2')
    expect(updated).toContain('root = "/pdks/ics55-v2"')
    expect(updated).toContain('# preset: rtl2gds | pdk: ics55')
    expect(updated).toContain('name = "gcd"')
    expect(updated.indexOf('/pdks/ics55-v2')).toBeGreaterThan(updated.indexOf('[pdk]'))
  })

  it('replaces a multi-line array value as a whole', () => {
    const updated = setScopedKey(ECC_TOML_SAMPLE, 'pdk.overrides', 'lefs', [
      'IP/STD_cell/lef/a.lef',
      '/macros/sram/sram.lef',
    ])
    expect(updated).toContain('lefs = ["IP/STD_cell/lef/a.lef", "/macros/sram/sram.lef"]')
    // The old multi-line tail lines are gone, not left behind.
    expect(updated).not.toContain('"IP/STD_cell/lef/b.lef",')
    expect(updated).toContain('[params]')
    expect(updated).toContain('placements = []')
  })

  it('inserts a new key at the top of the table body', () => {
    const updated = setScopedKey(ECC_TOML_SAMPLE, 'pdk', 'external_paths', [
      '/macros/sram',
    ])
    const pdkBody = updated.slice(
      updated.indexOf('[pdk]'),
      updated.indexOf('[pdk.overrides]'),
    )
    expect(pdkBody).toContain('external_paths = ["/macros/sram"]')
    expect(pdkBody).toContain('name = "ics55"')
  })

  it('creates a missing table after [params] or at the end of the file', () => {
    // ECC toml_edit anchors new tables after the params table (or at the
    // end when no later table header exists), never inside another table.
    const withParams = setScopedKey(
      '[params]\nx = 1\n\n[design]\nname = "gcd"\n',
      'pdk.overrides',
      'lefs',
      ['a.lef'],
    )
    expect(withParams.indexOf('[pdk.overrides]')).toBeGreaterThan(
      withParams.indexOf('x = 1'),
    )
    expect(withParams.indexOf('[pdk.overrides]')).toBeLessThan(
      withParams.indexOf('[design]'),
    )

    const tailOnly = setScopedKey('[params]\nx = 1\n', 'pdk.overrides', 'lefs', ['a.lef'])
    expect(tailOnly.endsWith('[pdk.overrides]\nlefs = ["a.lef"]\n')).toBe(true)

    const withoutParams = setScopedKey(
      '[design]\nname = "gcd"\n',
      'pdk',
      'root',
      '/pdks/ics55',
    )
    expect(withoutParams.endsWith('[pdk]\nroot = "/pdks/ics55"\n')).toBe(true)
  })

  it('never edits key-like text inside string values', () => {
    const text = '[params]\nnote = "external_paths = fake"\n'
    const updated = setScopedKey(text, 'params', 'external_paths', ['/a'])
    expect(updated).toContain('note = "external_paths = fake"')
    expect(updated).toContain('external_paths = ["/a"]')
  })
})

describe('eccTomlEdit removeScopedKey', () => {
  it('removes a key with its multi-line value and drops the emptied table', () => {
    // lefs is the only key in [pdk.overrides], so removing it removes the
    // table header too, exactly like ECC toml_edit.remove_scoped_key.
    const updated = removeScopedKey(ECC_TOML_SAMPLE, 'pdk.overrides', 'lefs')
    expect(updated).not.toContain('lefs')
    expect(updated).not.toContain('[pdk.overrides]')
    expect(updated).toContain('[pdk]')
    expect(updated).toContain('[params]')
  })

  it('keeps the table when other keys remain', () => {
    const text = '[pdk.overrides]\ntech = "t.lef"\nlefs = ["a.lef"]\n'
    const updated = removeScopedKey(text, 'pdk.overrides', 'lefs')
    expect(updated).toContain('[pdk.overrides]')
    expect(updated).toContain('tech = "t.lef"')
    expect(updated).not.toContain('a.lef')
  })

  it('returns null for absent keys', () => {
    expect(removeScopedKey(ECC_TOML_SAMPLE, 'pdk', 'missing')).toBeNull()
    expect(removeScopedKey('[design]\nname = "gcd"\n', 'pdk', 'root')).toBeNull()
  })
})

describe('eccTomlEdit formatTomlValue', () => {
  it('renders scalars, arrays, and escaped strings', () => {
    expect(formatTomlValue(true)).toBe('true')
    expect(formatTomlValue(0.5)).toBe('0.5')
    expect(formatTomlValue(['a', 'b'])).toBe('["a", "b"]')
    expect(formatTomlValue('path "quoted"')).toBe('"path \\"quoted\\""')
    expect(() => formatTomlValue({})).toThrow('TOML representation')
  })
})
