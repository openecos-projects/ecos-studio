import { describe, expect, it } from 'vitest'
import {
  FRONTEND_FLOW_STEPS,
  parseFrontendWorkspaceFlowStateMap,
} from './frontendProjectWorkspaceData'

describe('frontend project workspace data', () => {
  it('uses the ECC-FE flow order', () => {
    expect(FRONTEND_FLOW_STEPS).toEqual(['prepare', 'review', 'elab', 'lint', 'sim'])
  })

  it('normalizes ECC-FE flow states without accepting backend steps', () => {
    expect(
      parseFrontendWorkspaceFlowStateMap(
        JSON.stringify({
          steps: [
            { name: 'prepare', state: 'Success' },
            { name: 'review', state: 'Ongoing' },
            { name: 'elab', state: 'Pending' },
            { name: 'lint', state: 'Incomplete' },
            { name: 'sim', state: 'Invalid' },
            { name: 'Synthesis', state: 'Success' },
          ],
        }),
      ),
    ).toEqual({
      prepare: 'success',
      review: 'running',
      elab: 'running',
      lint: 'failed',
      sim: 'failed',
    })
  })
})
