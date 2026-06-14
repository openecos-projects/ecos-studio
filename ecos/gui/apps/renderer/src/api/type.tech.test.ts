import { describe, expect, it } from 'vitest'
import { STEP_METADATA } from './type'

describe('STEP_METADATA Tech Library entry', () => {
  it('adds Tech as a workspace setup route shown in the sidebar', () => {
    expect(STEP_METADATA.tech).toMatchObject({
      label: 'Tech',
      icon: 'ri-database-2-line',
      path: 'tech',
      showInSidebar: true,
      group: 'setup',
    })
  })
})
