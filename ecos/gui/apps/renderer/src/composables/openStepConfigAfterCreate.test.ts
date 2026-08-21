import { describe, expect, it } from 'vitest'
import {
  requestOpenStepConfigAfterCreate,
  usePendingOpenStepConfigAfterCreate,
} from './openStepConfigAfterCreate'

describe('openStepConfigAfterCreate', () => {
  it('marks Edit/Config to open only after a successful workspace create requests it', () => {
    const pending = usePendingOpenStepConfigAfterCreate()
    pending.value = false

    requestOpenStepConfigAfterCreate()
    expect(pending.value).toBe(true)

    pending.value = false
    expect(pending.value).toBe(false)
  })
})
