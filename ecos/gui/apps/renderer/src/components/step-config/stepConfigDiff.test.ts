import { describe, expect, it } from 'vitest'
import { computeStepConfigDiff } from './stepConfigDiff'

describe('computeStepConfigDiff', () => {
  it('reports zero changes for identical documents', () => {
    const config = { a: 1, b: 'x', c: { d: [1, 2, { e: true }] } }
    const diff = computeStepConfigDiff(config, JSON.parse(JSON.stringify(config)))
    expect(diff.count).toBe(0)
    expect(diff.isChanged('a')).toBe(false)
    expect(diff.changedCountUnder('')).toBe(0)
  })

  it('flags changed scalars at their leaf paths', () => {
    const diff = computeStepConfigDiff(
      { ifp: { thread_number: 4, utilization: 0.6 } },
      { ifp: { thread_number: 8, utilization: 0.6 } },
    )
    expect(diff.count).toBe(1)
    expect(diff.isChanged('ifp.thread_number')).toBe(true)
    expect(diff.isChanged('ifp.utilization')).toBe(false)
  })

  it('marks every leaf of a key missing on one side', () => {
    const diff = computeStepConfigDiff(
      { die_builder: { die_util: { utilization: 0.6 } }, keep: 1 },
      { keep: 1 },
    )
    expect(diff.count).toBe(1)
    expect(diff.isChanged('die_builder.die_util.utilization')).toBe(true)
    expect(diff.changedCountUnder('die_builder')).toBe(1)

    const added = computeStepConfigDiff({ keep: 1 }, { keep: 1, new_key: 'v' })
    expect(added.isChanged('new_key')).toBe(true)
  })

  it('formats nested array element paths without a dot', () => {
    const diff = computeStepConfigDiff(
      { pdn_generator: { stripe: [{ width: 1 }, { width: 2 }] } },
      { pdn_generator: { stripe: [{ width: 1 }, { width: 3 }] } },
    )
    expect(diff.count).toBe(1)
    expect(diff.isChanged('pdn_generator.stripe[1].width')).toBe(true)
    expect(diff.isChanged('pdn_generator.stripe[0].width')).toBe(false)
  })

  it('flags positional array length mismatches', () => {
    const diff = computeStepConfigDiff({ list: ['a', 'b'] }, { list: ['a', 'b', 'c'] })
    expect(diff.count).toBe(1)
    expect(diff.isChanged('list[2]')).toBe(true)
  })

  it('handles container vs scalar type mismatches on both sides', () => {
    const diff = computeStepConfigDiff({ a: { x: 1 } }, { a: 5 })
    expect(diff.isChanged('a')).toBe(true)
    expect(diff.changedCountUnder('a')).toBeGreaterThanOrEqual(1)

    const flipped = computeStepConfigDiff({ a: 5 }, { a: { x: 1 } })
    expect(flipped.isChanged('a')).toBe(true)
  })

  it('treats materialized empty containers as unchanged', () => {
    const diff = computeStepConfigDiff(
      { die_builder: { die_util: { utilization: 0.6 } } },
      { die_builder: { die_util: { utilization: 0.6 }, margin: {} } },
    )
    expect(diff.count).toBe(0)
  })

  it('changedCountUnder respects prefix boundaries', () => {
    const diff = computeStepConfigDiff(
      { pdn_generator_rail: 1, pdn_generator: { stripe: [{ w: 1 }] } },
      { pdn_generator_rail: 2, pdn_generator: { stripe: [{ w: 5 }] } },
    )
    expect(diff.changedCountUnder('pdn_generator')).toBe(1)
    expect(diff.changedCountUnder('pdn_generator_rail')).toBe(1)
    expect(diff.changedCountUnder('pdn_generator.stripe[0]')).toBe(1)
    expect(diff.changedCountUnder('pdn_generator.stripe[0].w')).toBe(1)
    expect(diff.changedCountUnder('missing')).toBe(0)
  })

  it('distinguishes null, false and 0 leaves', () => {
    expect(computeStepConfigDiff({ a: null }, { a: false }).count).toBe(1)
    expect(computeStepConfigDiff({ a: 0 }, { a: false }).count).toBe(1)
    expect(computeStepConfigDiff({ a: '1' }, { a: 1 }).count).toBe(1)
    expect(computeStepConfigDiff({ a: null }, { a: null }).count).toBe(0)
  })

  it('supports non-object roots', () => {
    expect(computeStepConfigDiff(null, null).count).toBe(0)
    expect(computeStepConfigDiff('x', 'y').count).toBe(1)
    expect(computeStepConfigDiff({}, {}).count).toBe(0)
  })
})
