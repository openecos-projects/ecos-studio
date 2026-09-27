import { describe, expect, it } from 'vitest'
import { parseEccLineRecords, parseJsonLiteral } from './lineRecords'

describe('ECC catalog line records', () => {
  it('parses ordered records and the specified escapes', () => {
    expect(
      parseEccLineRecords(
        'record=parameter id=place.density description="two words\\nnext" default_literal=0.7\n',
      ),
    ).toEqual([
      {
        record: 'parameter',
        id: 'place.density',
        description: 'two words\nnext',
        default_literal: '0.7',
      },
    ])
  })

  it.each([
    'id=x record=parameter\n',
    'record=parameter id=x id=y\n',
    'record=parameter  id=x\n',
    'record=parameter description="bad\\u0000"\n',
  ])('rejects malformed input: %s', (input) => {
    expect(() => parseEccLineRecords(input)).toThrow(/ECC catalog record|field|escape/i)
  })

  it('accepts only finite JSON literals', () => {
    expect(parseJsonLiteral('{"a":[1,true]}')).toEqual({ a: [1, true] })
    expect(() => parseJsonLiteral('1e400')).toThrow(/finite JSON literal/)
  })
})
