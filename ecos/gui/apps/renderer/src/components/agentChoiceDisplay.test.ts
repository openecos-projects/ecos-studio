import { describe, expect, it } from 'vitest'
import { choiceOptionDetail, choiceSelectionText } from './agentChoiceDisplay'

describe('agentChoiceDisplay', () => {
  it('exposes path values under short recommendation labels', () => {
    const option = {
      id: 'rtl-1',
      label: 'Use recommended path',
      value: '/tmp/projects/gcd/gcd.v',
    }

    expect(choiceOptionDetail(option)).toBe('/tmp/projects/gcd/gcd.v')
    expect(choiceSelectionText(option)).toBe(
      'Use recommended path\n/tmp/projects/gcd/gcd.v',
    )
  })

  it('hides numeric and empty sentinel values from the detail line', () => {
    expect(choiceOptionDetail({ id: '1', label: 'Confirm and start', value: '1' })).toBe(
      '',
    )
    expect(choiceOptionDetail({ id: '2', label: 'Skip', value: '__empty__' })).toBe('')
    expect(
      choiceOptionDetail({
        id: '3',
        label: '/tmp/projects/gcd',
        value: '/tmp/projects/gcd',
      }),
    ).toBe('')
  })
})
