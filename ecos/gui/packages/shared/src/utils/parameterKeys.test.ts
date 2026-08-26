import { describe, expect, it } from 'vitest'

import { normalizeParameterKey, normalizeParameterKeys } from './parameterKeys'

describe('normalizeParameterKey', () => {
  it.each([
    ['Frequency max [MHz]', 'frequency_max'],
    ['Max fanout', 'max_fanout'],
    ['Top module', 'top_module'],
    ['PDK', 'pdk'],
    ['PDN', 'pdn'],
    ['DreamPlace', 'dreamplace'],
    ['STA max paths', 'sta_max_paths'],
    ['Cell padding x', 'cell_padding_x'],
    ['Routability opt flag', 'routability_opt_flag'],
    ['Bounding box', 'bounding_box'],
    ['Aspect ratio', 'aspect_ratio'],
    ['Design Tool', 'design_tool'],
    ['PDK Root', 'pdk_root'],
  ])('normalizes display key %s to %s', (input, expected) => {
    expect(normalizeParameterKey(input)).toBe(expected)
  })

  it.each([['frequency_max'], ['die'], ['core'], ['pdk_root'], ['sta_max_paths']])(
    'keeps canonical key %s unchanged',
    (input) => {
      expect(normalizeParameterKey(input)).toBe(input)
    },
  )
})

describe('normalizeParameterKeys', () => {
  it('recurses into nested objects and arrays', () => {
    const legacy = {
      'Top module': 'gcd',
      Die: { Size: [38.6, 39.0], Area: 1505.4 },
      Core: { 'Bounding box': '(2 , 2) (36.6 , 37.0)', Margin: [2, 2] },
      Fillers: [{ 'Cell name': 'FILL1' }],
    }
    expect(normalizeParameterKeys(legacy)).toEqual({
      top_module: 'gcd',
      die: { size: [38.6, 39.0], area: 1505.4 },
      core: { bounding_box: '(2 , 2) (36.6 , 37.0)', margin: [2, 2] },
      fillers: [{ cell_name: 'FILL1' }],
    })
  })

  it('does not mutate the input', () => {
    const legacy = { 'Top module': 'gcd' }
    normalizeParameterKeys(legacy)
    expect(legacy).toEqual({ 'Top module': 'gcd' })
  })

  it('is idempotent', () => {
    const legacy = { 'Frequency max [MHz]': 100, Core: { 'Aspect ratio': 1 } }
    const once = normalizeParameterKeys(legacy)
    expect(normalizeParameterKeys(once)).toEqual(once)
  })

  it('keeps the long-key value when a flat duplicate collides', () => {
    const payload = { frequency_max: 50, 'Frequency max [MHz]': 100 }
    expect(normalizeParameterKeys(payload)).toEqual({ frequency_max: 100 })
  })

  it('drops a flat key that arrives after the long key', () => {
    const payload = { 'Frequency max [MHz]': 100, frequency_max: 50 }
    expect(normalizeParameterKeys(payload)).toEqual({ frequency_max: 100 })
  })

  it('passes through scalars', () => {
    expect(normalizeParameterKeys('text')).toBe('text')
    expect(normalizeParameterKeys(42)).toBe(42)
    expect(normalizeParameterKeys(null)).toBe(null)
  })
})
