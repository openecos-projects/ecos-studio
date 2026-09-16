import { describe, expect, it } from 'vitest'
import {
  deriveAgentWorkspaceParameterUpdates,
  readAgentWorkspaceParameterValues,
} from './agentWorkspaceParameterUpdates'

describe('Agent Workspace parameter mapping', () => {
  it('reads logical values only from ECC canonical domain projections', () => {
    const values = readAgentWorkspaceParameterValues(
      {
        parameters: {
          'design.frequency_mhz': 200,
          'place.target_density': 0.4,
          'place.routability_opt': 0,
          'cts.skew_bound': 0.08,
          'route.RT.-thread_number': 8,
        },
      },
      {},
    )

    expect(values).toMatchObject({
      'design.frequency_max': 200,
      'place.target_density': 0.4,
      'place.routability_opt': false,
      'cts.skew_bound': 0.08,
      'route.thread_number': 8,
    })
  })

  it('lets Backend Step Options override the workspace-wide knob values', () => {
    const values = readAgentWorkspaceParameterValues(
      {
        parameters: {
          'place.target_density': 0.4,
          'cts.skew_bound': '0.08',
        },
      },
      {
        place: { 'place.target_density': 0.55 },
        CTS: { 'cts.skew_bound': '0.12' },
      },
    )

    expect(values).toMatchObject({
      'place.target_density': 0.55,
      'cts.skew_bound': 0.12,
    })
  })

  it('derives the exact ECC commands from a validated logical patch', () => {
    expect(
      deriveAgentWorkspaceParameterUpdates([
        { knob_id: 'place.routability_opt', value: false },
        { knob_id: 'cts.skew_bound', value: 0.08 },
        { knob_id: 'route.thread_number', value: 8 },
      ]),
    ).toEqual({
      workspace_parameters: {
        'place.routability_opt': 0,
        'cts.skew_bound': '0.08',
        'route.RT.-thread_number': '8',
      },
      step_configurations: [],
    })
  })
})
