import { describe, expect, it } from 'vitest'
import { STEP_METADATA, StepEnum } from './type'

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

  it('registers Harden as a visible canonical workspace step', () => {
    expect(StepEnum.HARDEN).toBe('Harden')
    expect(STEP_METADATA.harden).toMatchObject({
      label: 'Harden',
      path: StepEnum.HARDEN,
      showInSidebar: true,
      group: 'run',
    })
  })
})
