import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  decodeViewJsonGeometryTile,
  generateViewJsonGeometryTiles,
  scanViewJsonDataArray,
} from '../viewJsonTiles'

const tempRoots: string[] = []

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempRoots.push(dir)
  return dir
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (root) => {
      await import('node:fs/promises').then(({ rm }) =>
        rm(root, { recursive: true, force: true }),
      )
    }),
  )
})

describe('view-json geometry tiles', () => {
  it('streams data array objects without parsing the whole file shape', async () => {
    const root = await createTempDir('view-json-scan-')
    const file = join(root, 'regular_wires.json')
    await writeJson(file, {
      schema: 'ieda.view.v1',
      kind: 'regular_wires',
      data: [
        { id: 1, name: 'escaped ] } text', bbox: [0, 0, 1, 1] },
        { id: 2, nested: { points: [[0, 0], [10, 0]] } },
      ],
    })

    const ids: number[] = []
    for await (const item of scanViewJsonDataArray(file)) {
      ids.push((item as { id: number }).id)
    }

    expect(ids).toEqual([1, 2])
  })

  it('generates geometry tile index, binary tile payloads, and manifest capability', async () => {
    const packageRoot = await createViewJsonPackage()

    const result = await generateViewJsonGeometryTiles({ packageRoot, force: true, maxTilePrimitives: 2 })

    const manifest = JSON.parse(await readFile(join(packageRoot, 'manifest.json'), 'utf8')) as {
      files: Record<string, string>
      capabilities: Record<string, boolean>
    }
    const index = JSON.parse(await readFile(join(packageRoot, 'design', 'geometry_tile_index.json'), 'utf8')) as {
      kind: string
      tiles: Array<{ file: string; counts: Record<string, number> }>
    }

    expect(result.tileCount).toBeGreaterThan(0)
    expect(manifest.files.geometry_tile_index).toBe('design/geometry_tile_index.json')
    expect(manifest.capabilities.geometry_tiles).toBe(true)
    expect(index.kind).toBe('geometry_tile_index')
    expect(index.tiles.some(tile => (tile.counts.regular_wires ?? 0) > 0)).toBe(true)

    const firstWireTile = index.tiles.find(tile => (tile.counts.regular_wires ?? 0) > 0)
    expect(firstWireTile).toBeTruthy()
    const bytes = await readFile(join(packageRoot, firstWireTile!.file))
    const decoded = decodeViewJsonGeometryTile(new Uint8Array(bytes))
    expect(decoded.paths.length + decoded.rects.length).toBeGreaterThan(0)
    expect((await stat(join(packageRoot, firstWireTile!.file))).isFile()).toBe(true)
  })

  it('keeps very long path objects out of many normal tiles', async () => {
    const packageRoot = await createViewJsonPackage({
      regularWires: [{
        id: 99,
        kind: 'path',
        layer_id: 1,
        width: 10,
        points: [[0, 500], [1000, 500]],
        bbox: [0, 495, 1000, 505],
        layers: [1],
      }],
    })

    await generateViewJsonGeometryTiles({
      packageRoot,
      force: true,
      maxTilePrimitives: 1,
      maxTilesPerObject: 1,
    })

    const index = JSON.parse(await readFile(join(packageRoot, 'design', 'geometry_tile_index.json'), 'utf8')) as {
      tiles: Array<{ counts: Record<string, number> }>
      large_objects?: { file: string; count: number }
    }

    const duplicatedCount = index.tiles.reduce((sum, tile) => sum + (tile.counts.regular_wires ?? 0), 0)
    expect(duplicatedCount).toBe(0)
    expect(index.large_objects?.count).toBe(1)
    expect((await stat(join(packageRoot, index.large_objects!.file))).isFile()).toBe(true)
  })

  it('reports missing source files with the manifest key that failed', async () => {
    const packageRoot = await createViewJsonPackage()
    await writeJson(join(packageRoot, 'manifest.json'), {
      schema: 'ieda.view.v1',
      format: 'layout_view_package',
      files: {
        die: 'design/die.json',
        regular_wires: 'design/missing_regular_wires.json',
      },
    })

    await expect(generateViewJsonGeometryTiles({ packageRoot, force: true }))
      .rejects.toThrow('regular_wires')
  })
})

async function createViewJsonPackage(options: {
  regularWires?: unknown[]
} = {}): Promise<string> {
  const packageRoot = await createTempDir('view-json-package-')
  await mkdir(join(packageRoot, 'design'), { recursive: true })
  await writeJson(join(packageRoot, 'manifest.json'), {
    schema: 'ieda.view.v1',
    format: 'layout_view_package',
    version: 1,
    unit: { dbu_per_micron: 1000 },
    files: {
      die: 'design/die.json',
      layers: 'design/layers.json',
      vias: 'design/vias.json',
      instances: 'design/instances.json',
      io_pins: 'design/io_pins.json',
      regular_wires: 'design/regular_wires.json',
      special_wires: 'design/special_wires.json',
      blockages: 'design/blockages.json',
      fills: 'design/fills.json',
      regions: 'design/regions.json',
    },
  })
  await writeJson(join(packageRoot, 'design', 'die.json'), {
    schema: 'ieda.view.v1',
    kind: 'die',
    data: { die_area: [0, 0, 1000, 1000] },
  })
  await writeJson(join(packageRoot, 'design', 'layers.json'), {
    schema: 'ieda.view.v1',
    kind: 'layers',
    data: [{ id: 1, name: 'M1' }],
  })
  await writeJson(join(packageRoot, 'design', 'vias.json'), {
    schema: 'ieda.view.v1',
    kind: 'via_masters',
    data: [],
  })
  await writeJson(join(packageRoot, 'design', 'instances.json'), {
    schema: 'ieda.view.v1',
    kind: 'instances',
    data: [{ id: 1, name: 'u1', master_id: 0, origin: [20, 20], orient: 'N', bbox: [20, 20, 120, 120] }],
  })
  await writeJson(join(packageRoot, 'design', 'io_pins.json'), {
    schema: 'ieda.view.v1',
    kind: 'io_pins',
    data: [],
  })
  await writeJson(join(packageRoot, 'design', 'regular_wires.json'), {
    schema: 'ieda.view.v1',
    kind: 'regular_wires',
    data: options.regularWires ?? [
      { id: 1, kind: 'path', layer_id: 1, width: 8, points: [[10, 10], [200, 10]], bbox: [10, 6, 200, 14], layers: [1] },
      { id: 2, kind: 'patch', layer_id: 1, rect: [300, 300, 340, 340], bbox: [300, 300, 340, 340], layers: [1] },
    ],
  })
  await writeJson(join(packageRoot, 'design', 'special_wires.json'), {
    schema: 'ieda.view.v1',
    kind: 'special_wires',
    data: [],
  })
  await writeJson(join(packageRoot, 'design', 'blockages.json'), {
    schema: 'ieda.view.v1',
    kind: 'blockages',
    data: [],
  })
  await writeJson(join(packageRoot, 'design', 'fills.json'), {
    schema: 'ieda.view.v1',
    kind: 'fills',
    data: [],
  })
  await writeJson(join(packageRoot, 'design', 'regions.json'), {
    schema: 'ieda.view.v1',
    kind: 'regions',
    data: [],
  })
  return packageRoot
}
