import { describe, expect, it, vi } from 'vitest'
import {
  loadViewJsonPackageData,
  loadViewJsonRoutingDetail,
  parseViewJsonPackageDataFromTexts,
} from './packageData'

const manifest = {
  schema: 'ieda.view.v1',
  format: 'layout_view_package',
  version: 1,
  unit: { dbu_per_micron: 1000 },
  files: {
    die: 'design/die.json',
    layers: 'design/layers.json',
    vias: 'design/vias.json',
    regular_wires: 'design/regular_wires.json',
    special_wires: 'design/special_wires.json',
  },
}

const jsonFile = (kind: string, data: unknown[]) => JSON.stringify({
  schema: 'ieda.view.v1',
  kind,
  data,
})

const dieText = JSON.stringify({
  schema: 'ieda.view.v1',
  kind: 'die',
  data: {
    die_area: [0, 0, 1000, 1000],
    core_area: [100, 100, 900, 900],
  },
})

describe('view-json packageData', () => {
  it('uses spatial index as the deferred routing overview without reading full wires', async () => {
    const spatialManifest = {
      ...manifest,
      files: {
        ...manifest.files,
        spatial_index: 'design/spatial_index.json',
      },
    }
    const readOptionalText = vi.fn(async (path: string) => {
      expect(path).toBe('/pkg/design/routing_overview.json')
      return null
    })
    const readText = vi.fn(async (path: string) => {
      switch (path) {
        case '/pkg/manifest.json':
          return JSON.stringify(spatialManifest)
        case '/pkg/design/die.json':
          return dieText
        case '/pkg/design/layers.json':
          return jsonFile('layers', [{ id: 1, name: 'M1' }])
        case '/pkg/design/vias.json':
          return jsonFile('via_masters', [])
        case '/pkg/design/spatial_index.json':
          return JSON.stringify({
            schema: 'ieda.view.v1',
            kind: 'spatial_index',
            tiles: [{
              bbox: [0, 0, 500, 500],
              objects: {
                regular_wires: [{
                  id: 7,
                  bbox: [0, 0, 100, 10],
                  layers: [1],
                }],
              },
            }],
          })
        default:
          throw new Error(`unexpected read: ${path}`)
      }
    })

    const pkg = await loadViewJsonPackageData('/pkg', {
      reader: { readText, readOptionalText },
      deferRoutingDetail: true,
    })

    expect(readOptionalText).toHaveBeenCalledWith('/pkg/design/routing_overview.json')
    expect(readText).toHaveBeenCalledWith('/pkg/design/spatial_index.json')
    expect(readText).not.toHaveBeenCalledWith('/pkg/design/regular_wires.json')
    expect(readText).not.toHaveBeenCalledWith('/pkg/design/special_wires.json')
    expect(pkg.routingDetailAvailable).toBe(true)
    expect(pkg.overview?.routing).toHaveLength(1)
    expect(pkg.overview?.countsByObjectKind.regular_wires).toBe(1)
  })

  it('keeps routing detail deferred when overview files are absent', async () => {
    const readOptionalText = vi.fn(async (path: string) => {
      expect(path).toBe('/pkg/design/routing_overview.json')
      return null
    })
    const readText = vi.fn(async (path: string) => {
      switch (path) {
        case '/pkg/manifest.json':
          return JSON.stringify(manifest)
        case '/pkg/design/die.json':
          return dieText
        case '/pkg/design/layers.json':
          return jsonFile('layers', [{ id: 1, name: 'M1' }])
        case '/pkg/design/vias.json':
          return jsonFile('via_masters', [])
        default:
          throw new Error(`unexpected read: ${path}`)
      }
    })

    const pkg = await loadViewJsonPackageData('/pkg', {
      reader: { readText, readOptionalText },
      deferRoutingDetail: true,
    })

    expect(readOptionalText).toHaveBeenCalledWith('/pkg/design/routing_overview.json')
    expect(readText).not.toHaveBeenCalledWith('/pkg/design/regular_wires.json')
    expect(readText).not.toHaveBeenCalledWith('/pkg/design/special_wires.json')
    expect(pkg.regularWires).toEqual([])
    expect(pkg.specialWires).toEqual([])
    expect(pkg.routingDetailAvailable).toBe(true)
    expect(pkg.overview?.routing).toEqual([])
  })

  it('recognizes geometry tile index packages without reading full routing detail', async () => {
    const tiledManifest = {
      ...manifest,
      files: {
        ...manifest.files,
        geometry_tile_index: 'design/geometry_tile_index.json',
      },
      capabilities: {
        geometry_tiles: true,
      },
    }
    const readOptionalText = vi.fn(async (path: string) => {
      expect(path).toBe('/pkg/design/routing_overview.json')
      return null
    })
    const readText = vi.fn(async (path: string) => {
      switch (path) {
        case '/pkg/manifest.json':
          return JSON.stringify(tiledManifest)
        case '/pkg/design/die.json':
          return dieText
        case '/pkg/design/layers.json':
          return jsonFile('layers', [{ id: 1, name: 'M1' }])
        case '/pkg/design/vias.json':
          return jsonFile('via_masters', [])
        case '/pkg/design/geometry_tile_index.json':
          return JSON.stringify({
            schema: 'ieda.view.v1',
            kind: 'geometry_tile_index',
            version: 1,
            encoding: 'ecostudio.view_geometry_tile.bin.v1',
            world_bbox: [0, 0, 1000, 1000],
            tiles: [{
              id: '0:0:0',
              bbox: [0, 0, 1000, 1000],
              file: 'design/geometry_tiles/0/0/0.bin',
              byte_size: 32,
              counts: { regular_wires: 1 },
              layers: [1],
            }],
          })
        default:
          throw new Error(`unexpected read: ${path}`)
      }
    })

    const pkg = await loadViewJsonPackageData('/pkg', {
      reader: { readText, readOptionalText },
      deferRoutingDetail: true,
    })

    expect(readText).toHaveBeenCalledWith('/pkg/design/geometry_tile_index.json')
    expect(readText).not.toHaveBeenCalledWith('/pkg/design/regular_wires.json')
    expect(readText).not.toHaveBeenCalledWith('/pkg/design/special_wires.json')
    expect(pkg.geometryTileIndex?.tiles).toHaveLength(1)
    expect(pkg.routingDetailAvailable).toBe(false)
  })

  it('does not synthesize overview from full wire files while routing detail is deferred', () => {
    const pkg = parseViewJsonPackageDataFromTexts({
      packageRoot: '/pkg',
      manifestPath: '/pkg/manifest.json',
      manifestText: JSON.stringify(manifest),
      readMs: 0,
      totalStartedAt: performance.now(),
      deferRoutingDetail: true,
      files: {
        die: { path: '/pkg/design/die.json', text: dieText },
        layers: { path: '/pkg/design/layers.json', text: jsonFile('layers', [{ id: 1, name: 'M1' }]) },
        vias: { path: '/pkg/design/vias.json', text: jsonFile('via_masters', []) },
        regular_wires: {
          path: '/pkg/design/regular_wires.json',
          text: jsonFile('regular_wires', [{
            id: 1,
            kind: 'path',
            layer_id: 1,
            width: 10,
            points: [[0, 0], [100, 0]],
          }]),
        },
        special_wires: {
          path: '/pkg/design/special_wires.json',
          text: jsonFile('special_wires', []),
        },
      },
    })

    expect(pkg.regularWires).toEqual([])
    expect(pkg.specialWires).toEqual([])
    expect(pkg.routingDetailAvailable).toBe(true)
    expect(pkg.overview?.routing).toEqual([])
  })

  it('cancels stale routing detail loads before starting worker parsing', async () => {
    const readText = vi.fn(async (path: string) => {
      switch (path) {
        case '/pkg/manifest.json':
          return JSON.stringify(manifest)
        case '/pkg/design/die.json':
          return dieText
        case '/pkg/design/vias.json':
          return jsonFile('via_masters', [])
        case '/pkg/design/regular_wires.json':
          return jsonFile('regular_wires', [])
        case '/pkg/design/special_wires.json':
          return jsonFile('special_wires', [])
        default:
          throw new Error(`unexpected read: ${path}`)
      }
    })
    const workerClient = {
      parsePackage: vi.fn(),
      parseRoutingDetail: vi.fn(),
      destroy: vi.fn(),
    }

    await expect(loadViewJsonRoutingDetail('/pkg', {
      reader: { readText },
      workerClient,
      shouldCancel: () => true,
    })).rejects.toThrow('View JSON load cancelled.')

    expect(workerClient.parseRoutingDetail).not.toHaveBeenCalled()
  })

  it('cancels in-flight routing detail worker parsing when the request becomes stale', async () => {
    vi.useFakeTimers()
    let cancelled = false
    const readText = vi.fn(async (path: string) => {
      switch (path) {
        case '/pkg/manifest.json':
          return JSON.stringify(manifest)
        case '/pkg/design/die.json':
          return dieText
        case '/pkg/design/vias.json':
          return jsonFile('via_masters', [])
        case '/pkg/design/regular_wires.json':
          return jsonFile('regular_wires', [])
        case '/pkg/design/special_wires.json':
          return jsonFile('special_wires', [])
        default:
          throw new Error(`unexpected read: ${path}`)
      }
    })
    const workerClient = {
      parsePackage: vi.fn(),
      parseRoutingDetail: vi.fn(() => new Promise<Awaited<ReturnType<typeof loadViewJsonRoutingDetail>>>(() => undefined)),
      cancelPending: vi.fn(),
      destroy: vi.fn(),
    }

    const load = loadViewJsonRoutingDetail('/pkg', {
      reader: { readText },
      workerClient,
      shouldCancel: () => cancelled,
    }).catch(error => error)

    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve()
    }
    expect(workerClient.parseRoutingDetail).toHaveBeenCalledTimes(1)

    cancelled = true
    await vi.advanceTimersByTimeAsync(20)

    expect(workerClient.cancelPending).toHaveBeenCalledTimes(1)
    const error = await load
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('cancelled')
    vi.useRealTimers()
  })
})
