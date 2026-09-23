import { afterEach, describe, expect, it } from 'vitest'
import {
  clearWorkspaceParameterCatalogCache,
  rememberWorkspaceParameterCatalog,
} from '../workspaceParameterCatalogCache'
import {
  deriveAgentWorkspaceParameterUpdates,
  readAgentWorkspaceParameterValues,
  resolveAgentWorkspaceKnobs,
} from './agentWorkspaceParameterUpdates'

const CATALOG_DISCOVERY = {
  parameterCatalog: [
    {
      id: 'design.frequency_mhz',
      display_key: 'frequency_max',
      knob_id: 'design.frequency_max',
      type: 'positive',
    },
    {
      id: 'floorplan.core_util',
      display_key: 'utilization',
      knob_id: 'floorplan.utilization',
      type: 'number',
      range: [0.01, 1],
    },
    {
      id: 'place.routability_opt',
      knob_id: 'place.routability_opt',
      type: 'boolean',
    },
    {
      // Catalog-only knob: validated from the catalog type/range.
      id: 'place.gp_noise_ratio',
      knob_id: 'place.gp_noise_ratio',
      type: 'number',
      range: [0, 1],
    },
    {
      // Not an Agent knob: excluded from the whitelist.
      id: 'floorplan.core_margin',
      display_key: 'margin',
      type: 'number',
    },
  ],
}

afterEach(() => {
  clearWorkspaceParameterCatalogCache()
})

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

  it('keeps the legacy misspelled utilization knob id readable', () => {
    expect(
      deriveAgentWorkspaceParameterUpdates([
        { knob_id: 'floorplan.utilitization', value: 0.7 },
      ]),
    ).toEqual({
      workspace_parameters: { 'floorplan.core_util': 0.7 },
      step_configurations: [],
    })
  })
})

describe('catalog-driven Agent Workspace knob table', () => {
  it('whitelists catalog knob ids and maps them to the catalog spec keys', () => {
    rememberWorkspaceParameterCatalog(CATALOG_DISCOVERY)
    const knobs = resolveAgentWorkspaceKnobs()

    expect(Object.keys(knobs).sort()).toEqual([
      'design.frequency_max',
      'floorplan.utilization',
      'place.gp_noise_ratio',
      'place.routability_opt',
    ])
    expect(knobs['floorplan.utilization'].parameter).toBe('floorplan.core_util')
    expect(knobs['place.gp_noise_ratio'].range).toEqual([0, 1])
  })

  it('derives updates from the catalog whitelist, honoring catalog ranges', () => {
    rememberWorkspaceParameterCatalog(CATALOG_DISCOVERY)

    expect(
      deriveAgentWorkspaceParameterUpdates([
        { knob_id: 'floorplan.utilization', value: 0.7 },
        { knob_id: 'place.routability_opt', value: true },
      ]),
    ).toEqual({
      workspace_parameters: {
        'floorplan.core_util': 0.7,
        'place.routability_opt': 1,
      },
      step_configurations: [],
    })
    expect(
      deriveAgentWorkspaceParameterUpdates([
        { knob_id: 'floorplan.utilization', value: 1.5 },
      ]),
    ).toBeNull()
    // Not a knob per the catalog (no knob_id).
    expect(
      deriveAgentWorkspaceParameterUpdates([
        { knob_id: 'floorplan.core_margin', value: 2 },
      ]),
    ).toBeNull()
  })

  it('reads workspace values through the catalog knob mapping', () => {
    rememberWorkspaceParameterCatalog(CATALOG_DISCOVERY)

    const values = readAgentWorkspaceParameterValues(
      {
        parameters: {
          'design.frequency_mhz': 120,
          'floorplan.core_util': 0.55,
          'place.routability_opt': 1,
        },
      },
      {},
    )
    expect(values).toEqual({
      'design.frequency_max': 120,
      'floorplan.utilization': 0.55,
      'place.routability_opt': true,
    })
  })

  it('falls back to the built-in table when the catalog lacks knob_id fields', () => {
    rememberWorkspaceParameterCatalog({
      parameterCatalog: [{ id: 'design.frequency_mhz', display_key: 'frequency_max' }],
    })
    expect(resolveAgentWorkspaceKnobs()['design.frequency_max'].parameter).toBe(
      'design.frequency_mhz',
    )
    expect(resolveAgentWorkspaceKnobs()['cts.max_fanout']).toBeDefined()

    clearWorkspaceParameterCatalogCache()
    expect(resolveAgentWorkspaceKnobs()['cts.max_fanout']).toBeDefined()
  })
})
