import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { generateLayoutTiles } from '../generate'

const tempRoots: string[] = []

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempRoots.push(dir)
  return dir
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

describe('generateLayoutTiles', () => {
  it('writes the bundle root files and low-z vector companion tiles expected by the renderer', async () => {
    const rootDir = await createTempDir('tile-helper-generate-')
    const layoutDir = join(rootDir, 'home')
    const outDir = join(rootDir, '.ecos', 'tile-cache', 'layout', 'route')
    await mkdir(layoutDir, { recursive: true })
    const layoutJsonPath = join(layoutDir, 'layout.json')
    await writeFile(
      layoutJsonPath,
      JSON.stringify({
        'design name': 'demo-layout',
        units: '1000 dbu/um',
        diearea: {
          path: [
            [0, 0],
            [512, 0],
            [512, 512],
            [0, 512],
          ],
        },
        layerInfo: [{ id: 7, layername: 'Metal 1' }],
        data: [
          {
            type: 'group',
            'struct name': 'inst_a',
            children: [
              {
                type: 'box',
                layer: 7,
                path: [
                  [32, 32],
                  [32, 160],
                  [160, 160],
                  [160, 32],
                ],
              },
            ],
          },
        ],
      }),
      'utf8',
    )

    await generateLayoutTiles(layoutJsonPath, outDir)

    const manifest = JSON.parse(await readFile(join(outDir, 'manifest.json'), 'utf8')) as {
      dbuPerMicron: number
      dieArea: { w: number; h: number }
      tileConfig: { rasterMaxZ: number; rasterFormat: string; vectorFormat: string }
      layers: Array<{ name: string }>
      cellsFile: { path: string }
      globalFile: { path: string }
    }

    expect(manifest.dbuPerMicron).toBe(1000)
    expect(manifest.dieArea).toEqual({ w: 512, h: 512, x: 0, y: 0 })
    expect(manifest.tileConfig.rasterMaxZ).toBe(0)
    expect(manifest.tileConfig.rasterFormat).toBe('png')
    expect(manifest.tileConfig.vectorFormat).toBe('bin')
    expect(manifest.layers[0]?.name).toBe('metal_1')
    expect(manifest.cellsFile.path).toBe('cells.bin')
    expect(manifest.globalFile.path).toBe('global.bin')

    expect((await stat(join(outDir, 'cells.bin'))).isFile()).toBe(true)
    expect((await stat(join(outDir, 'global.bin'))).isFile()).toBe(true)
    expect((await stat(join(outDir, 'tiles', 'raster', '0', '0', '0.png'))).isFile()).toBe(true)
    expect((await stat(join(outDir, 'tiles', 'vector', '0', '0', '0.bin'))).isFile()).toBe(true)
  })
})
