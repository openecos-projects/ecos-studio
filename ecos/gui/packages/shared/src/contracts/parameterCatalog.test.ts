import { describe, expect, it } from 'vitest'

import {
  buildWorkspaceDisplayKeyIndex,
  buildWorkspaceKnobIndex,
  workspaceParameterCatalogEntries,
} from './parameterCatalog'

const DISCOVERY = {
  parameterCatalog: [
    {
      id: 'design.frequency_mhz',
      display_key: 'frequency_max',
      knob_id: 'design.frequency_max',
      type: 'positive',
      default: 100,
    },
    {
      id: 'floorplan.core_util',
      display_key: 'utilization',
      knob_id: 'floorplan.utilization',
      type: 'number',
      default: 0.6,
    },
    {
      // Agent-only knob: no display key.
      id: 'place.routability_opt',
      knob_id: 'place.routability_opt',
      type: 'boolean',
    },
    {
      // Wizard-only field: no knob id.
      id: 'floorplan.die_builder.die_size.width_micron',
      display_key: 'die_width',
    },
  ],
}

describe('workspaceParameterCatalogEntries', () => {
  it('extracts the catalog from a discovery document or a raw array', () => {
    expect(workspaceParameterCatalogEntries(DISCOVERY)).toHaveLength(4)
    expect(workspaceParameterCatalogEntries(DISCOVERY.parameterCatalog)).toHaveLength(4)
  })

  it('returns an empty list for missing or malformed catalogs', () => {
    expect(workspaceParameterCatalogEntries(undefined)).toEqual([])
    expect(workspaceParameterCatalogEntries({})).toEqual([])
    expect(workspaceParameterCatalogEntries({ parameterCatalog: 'nope' })).toEqual([])
  })
})

describe('buildWorkspaceDisplayKeyIndex', () => {
  it('indexes display keys onto spec keys', () => {
    expect(
      buildWorkspaceDisplayKeyIndex(workspaceParameterCatalogEntries(DISCOVERY)),
    ).toEqual({
      frequency_max: 'design.frequency_mhz',
      utilization: 'floorplan.core_util',
      die_width: 'floorplan.die_builder.die_size.width_micron',
    })
  })

  it('returns an empty index when no entry carries a display_key (old ECC)', () => {
    const legacy = [{ id: 'design.frequency_mhz' }, { id: 'floorplan.core_util' }]
    expect(buildWorkspaceDisplayKeyIndex(legacy)).toEqual({})
  })
})

describe('buildWorkspaceKnobIndex', () => {
  it('indexes knob ids onto spec keys', () => {
    expect(buildWorkspaceKnobIndex(workspaceParameterCatalogEntries(DISCOVERY))).toEqual({
      'design.frequency_max': 'design.frequency_mhz',
      'floorplan.utilization': 'floorplan.core_util',
      'place.routability_opt': 'place.routability_opt',
    })
  })

  it('returns an empty index when no entry carries a knob_id (old ECC)', () => {
    const legacy = [{ id: 'design.frequency_mhz', display_key: 'frequency_max' }]
    expect(buildWorkspaceKnobIndex(legacy)).toEqual({})
  })
})
