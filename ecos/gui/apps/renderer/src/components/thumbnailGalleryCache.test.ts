import { describe, expect, it } from 'vitest'

import { clearStepTabCache } from './thumbnailGalleryCache'

describe('thumbnailGalleryCache', () => {
  it('removes only tab info and errors for the selected step', () => {
    const tabInfoCache = {
      Floorplan_maps: { density: 'old-map' },
      Floorplan_analysis: { timing: 'old-report' },
      place_maps: { density: 'other-step' },
    }
    const tabErrorCache = {
      Floorplan_maps: 'old maps error',
      Floorplan_sta: 'old sta error',
      place_maps: 'keep me',
    }
    const checklistItemsCache = {
      Floorplan_checklist_items: [{ step: 'route', type: 'Route', item: 'x', state: 'Passed' }],
      place_checklist_items: [{ step: 'place', type: 'Density', item: 'y', state: 'Passed' }],
    }

    clearStepTabCache(tabInfoCache, tabErrorCache, 'Floorplan', checklistItemsCache)

    expect(tabInfoCache).toEqual({
      place_maps: { density: 'other-step' },
    })
    expect(tabErrorCache).toEqual({
      place_maps: 'keep me',
    })
    expect(checklistItemsCache).toEqual({
      place_checklist_items: [{ step: 'place', type: 'Density', item: 'y', state: 'Passed' }],
    })
  })

  it('does nothing when there is no current step', () => {
    const tabInfoCache = {
      Floorplan_maps: { density: 'old-map' },
    }
    const tabErrorCache = {
      Floorplan_maps: 'old maps error',
    }

    clearStepTabCache(tabInfoCache, tabErrorCache, undefined)

    expect(tabInfoCache).toEqual({
      Floorplan_maps: { density: 'old-map' },
    })
    expect(tabErrorCache).toEqual({
      Floorplan_maps: 'old maps error',
    })
  })
})
