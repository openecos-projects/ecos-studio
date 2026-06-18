import { describe, expect, it } from 'vitest'
import { __viewJsonFullRendererInternals } from './fullRenderer'
import { getViewJsonDisplayLOD } from './displayPolicy'
import type { ViewJsonPackageData, ViewJsonRoutingDetail } from './types'

describe('view-json full renderer memory guards', () => {
  it('builds a transient routing detail package without mutating the lightweight package', () => {
    const pkg = createPackageData()
    const detail: ViewJsonRoutingDetail = {
      regularWires: [{
        id: 1,
        kind: 'path',
        layer_id: 1,
        width: 10,
        points: [[0, 0], [100, 0]],
      }],
      specialWires: [],
      overview: {
        routing: [],
        countsByObjectKind: {},
      },
      countsByObjectKind: {
        regular_wires: 1,
      },
    }

    const renderData = __viewJsonFullRendererInternals.viewJsonPackageWithRoutingDetail(pkg, detail)

    expect(renderData).not.toBe(pkg)
    expect(renderData.regularWires).toBe(detail.regularWires)
    expect(renderData.routingDetailAvailable).toBe(false)
    expect(pkg.regularWires).toEqual([])
    expect(pkg.routingDetailAvailable).toBe(true)
  })

  it('can reject oversized interactive snapshots before allocating a texture', () => {
    const pixels = __viewJsonFullRendererInternals.getViewJsonInteractiveSnapshotPixelCount(
      { width: 20000, height: 20000 },
      20,
    )

    expect(pixels).toBeGreaterThan(__viewJsonFullRendererInternals.VIEW_JSON_INTERACTIVE_SNAPSHOT_MAX_PIXELS)
  })

  it('keeps generated interactive snapshots disabled to avoid stale Pixi texture sources', () => {
    expect(__viewJsonFullRendererInternals.VIEW_JSON_INTERACTIVE_SNAPSHOT_ENABLED).toBe(false)
  })

  it('does not cache oversized visible query results', () => {
    const oversizedDirect = {
      rects: new Array(__viewJsonFullRendererInternals.VIEW_JSON_VISIBLE_RENDER_CACHE_MAX_ITEMS + 1).fill(null),
      paths: [],
      guides: [],
    }

    expect(__viewJsonFullRendererInternals.shouldCacheVisibleRenderResult(
      oversizedDirect,
      [],
    )).toBe(false)
  })

  it('defers full detail model construction near the detail LOD threshold', () => {
    expect(getViewJsonDisplayLOD(0.094)).toBe('detail')
    expect(__viewJsonFullRendererInternals.shouldUseViewJsonFullDetailModel(0.094, 'debug')).toBe(false)
    expect(__viewJsonFullRendererInternals.shouldUseViewJsonFullDetailModel(
      __viewJsonFullRendererInternals.VIEW_JSON_FULL_DETAIL_MODEL_MIN_SCALE,
      'debug',
    )).toBe(true)
  })

  it('does not request legacy full detail builds when geometry tiles are available', () => {
    const pkg = createPackageData()
    pkg.geometryTileIndex = {
      schema: 'ieda.view.v1',
      kind: 'geometry_tile_index',
      version: 1,
      encoding: 'ecostudio.view_geometry_tile.bin.v1',
      world_bbox: [0, 0, 1000, 1000],
      tiles: [],
    }

    expect(__viewJsonFullRendererInternals.shouldUseLegacyFullDetailModel(
      pkg,
      __viewJsonFullRendererInternals.VIEW_JSON_FULL_DETAIL_MODEL_MIN_SCALE,
      'debug',
    )).toBe(false)

    delete pkg.geometryTileIndex
    expect(__viewJsonFullRendererInternals.shouldUseLegacyFullDetailModel(
      pkg,
      __viewJsonFullRendererInternals.VIEW_JSON_FULL_DETAIL_MODEL_MIN_SCALE,
      'debug',
    )).toBe(true)
  })

  it('releases retained full detail models below the full detail build threshold', () => {
    expect(__viewJsonFullRendererInternals.shouldReleaseViewJsonFullDetailModel(0.094, 'debug', true)).toBe(true)
    expect(__viewJsonFullRendererInternals.shouldReleaseViewJsonFullDetailModel(
      __viewJsonFullRendererInternals.VIEW_JSON_FULL_DETAIL_MODEL_MIN_SCALE,
      'debug',
      true,
    )).toBe(false)
    expect(__viewJsonFullRendererInternals.shouldReleaseViewJsonFullDetailModel(0.094, 'routing', true)).toBe(true)
    expect(__viewJsonFullRendererInternals.shouldReleaseViewJsonFullDetailModel(0.094, 'debug', false)).toBe(false)
  })

  it('cancels pending full detail model construction while interacting', () => {
    expect(__viewJsonFullRendererInternals.shouldCancelViewJsonFullDetailModelBuild(
      0.2,
      'debug',
      true,
      true,
    )).toBe(true)
    expect(__viewJsonFullRendererInternals.shouldCancelViewJsonFullDetailModelBuild(
      0.2,
      'debug',
      false,
      true,
    )).toBe(false)
    expect(__viewJsonFullRendererInternals.shouldCancelViewJsonFullDetailModelBuild(
      0.094,
      'debug',
      false,
      true,
    )).toBe(true)
    expect(__viewJsonFullRendererInternals.shouldCancelViewJsonFullDetailModelBuild(
      0.094,
      'debug',
      true,
      false,
    )).toBe(false)
  })

  it('does not switch away from an active full detail model until interaction ends', () => {
    expect(__viewJsonFullRendererInternals.shouldSwitchViewJsonFullDetailModelToLightweight(
      0.094,
      'debug',
      true,
      true,
    )).toBe(false)
    expect(__viewJsonFullRendererInternals.shouldSwitchViewJsonFullDetailModelToLightweight(
      0.094,
      'debug',
      false,
      true,
    )).toBe(true)
    expect(__viewJsonFullRendererInternals.shouldSwitchViewJsonFullDetailModelToLightweight(
      0.2,
      'debug',
      false,
      true,
    )).toBe(false)
  })

  it('expires interactive freeze after an idle watchdog delay', () => {
    expect(__viewJsonFullRendererInternals.shouldExpireViewJsonInteractiveFreeze(
      1_000,
      1_200,
    )).toBe(false)
    expect(__viewJsonFullRendererInternals.shouldExpireViewJsonInteractiveFreeze(
      1_000,
      1_350,
    )).toBe(true)
    expect(__viewJsonFullRendererInternals.shouldExpireViewJsonInteractiveFreeze(
      null,
      1_350,
    )).toBe(false)
  })

})

function createPackageData(): ViewJsonPackageData {
  const layer = { id: 1, name: 'M1' }
  return {
    manifest: {
      schema: 'ieda.view.v1',
      format: 'layout_view_package',
      files: {},
    },
    dbuPerMicron: 1000,
    die: {
      die_area: [0, 0, 1000, 1000],
    },
    worldWidth: 1000,
    worldHeight: 1000,
    layers: [layer],
    vias: [],
    cellMasters: [],
    rows: [],
    tracks: [],
    gcellGrids: [],
    instances: [],
    ioPins: [],
    regularWires: [],
    specialWires: [],
    blockages: [],
    fills: [],
    regions: [],
    layerById: new Map([[1, layer]]),
    viaById: new Map(),
    cellMasterById: new Map(),
    overview: {
      routing: [],
      countsByObjectKind: {},
    },
    routingDetailAvailable: true,
    loadStats: {
      readMs: 0,
      parseMs: 0,
      transformMs: 0,
      chunkMs: 0,
      totalMs: 0,
    },
  }
}
