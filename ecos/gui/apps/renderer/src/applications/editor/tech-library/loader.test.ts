import { describe, expect, it } from 'vitest'
import type { WorkspaceResourceIndex } from '@ecos-studio/shared'
import { loadTechLibrary } from './loader'

function indexWithTech(): WorkspaceResourceIndex {
  return {
    root: '/workspace/demo',
    design: 'gcd',
    topModule: 'gcd',
    pdk: 'ics55',
    home: {
      homeJson: { path: '/workspace/demo/home/home.json', exists: true, kind: 'home' },
      flowJson: { path: '/workspace/demo/home/flow.json', exists: true, kind: 'flow' },
      parametersJson: { path: '/workspace/demo/home/parameters.json', exists: true, kind: 'parameters' },
      checklistJson: { path: '/workspace/demo/home/checklist.json', exists: false, kind: 'checklist' },
    },
    homeData: null,
    parameters: null,
    flow: { steps: [] },
    tech: {
      packageRoot: '/workspace/demo/gcd_view',
      source: 'view-package',
      manifest: { path: '/workspace/demo/gcd_view/manifest.json', exists: true, kind: 'tech-json' },
      layers: { path: '/workspace/demo/gcd_view/tech/layers.json', exists: true, kind: 'tech-json' },
      sites: { path: '/workspace/demo/gcd_view/tech/sites.json', exists: true, kind: 'tech-json' },
      vias: { path: '/workspace/demo/gcd_view/tech/vias.json', exists: true, kind: 'tech-json' },
      cellMasters: { path: '/workspace/demo/gcd_view/tech/cell_masters.json', exists: true, kind: 'tech-json' },
    },
    status: 'available',
    messages: [],
  }
}

describe('loadTechLibrary', () => {
  it('loads workspace tech files and builds lookup maps without reading design data', async () => {
    const reads: string[] = []
    const files: Record<string, unknown> = {
      '/workspace/demo/gcd_view/tech/layers.json': {
        schema: 'ieda.view.v1',
        kind: 'layers',
        count: 2,
        data: [
          { id: 7, name: 'MET1', type: 'ROUTING', order: 7, direction: 'HORIZONTAL' },
          { id: 8, name: 'VIA1', type: 'CUT', order: 8, direction: '' },
        ],
      },
      '/workspace/demo/gcd_view/tech/sites.json': {
        schema: 'ieda.view.v1',
        kind: 'sites',
        count: 1,
        data: [
          { id: 1, name: 'core7', class: 'CORE', size: [200, 1400], orient: 'N_R0', symmetry: [] },
        ],
      },
      '/workspace/demo/gcd_view/tech/vias.json': {
        schema: 'ieda.view.v1',
        kind: 'via_masters',
        count: 1,
        data: [
          {
            id: 0,
            name: 'MET2_MET1_VIA1_0',
            type: 'FIXED',
            is_default: true,
            cut_rows: 1,
            cut_cols: 1,
            shapes: [{ layer_id: 7, rects: [[-50, -85, 50, 85]] }],
          },
        ],
      },
      '/workspace/demo/gcd_view/tech/cell_masters.json': {
        schema: 'ieda.view.v1',
        kind: 'cell_masters',
        count: 1,
        data: [
          {
            id: 0,
            name: 'INVX1',
            type: 'CORE',
            origin: [0, 0],
            size: [800, 1400],
            site: 'core7',
            symmetry: ['X', 'Y'],
            pins: [],
            obs: [],
          },
        ],
      },
    }

    const data = await loadTechLibrary(indexWithTech(), {
      readText: async (path) => {
        reads.push(path)
        return JSON.stringify(files[path])
      },
    })

    expect(data.summary).toMatchObject({
      pdk: 'ics55',
      design: 'gcd',
      layerCount: 2,
      siteCount: 1,
      viaCount: 1,
      cellMasterCount: 1,
    })
    expect(data.layerById.get(7)?.name).toBe('MET1')
    expect(data.cellMasterById.get(0)?.name).toBe('INVX1')
    expect(reads).toEqual([
      '/workspace/demo/gcd_view/tech/layers.json',
      '/workspace/demo/gcd_view/tech/sites.json',
      '/workspace/demo/gcd_view/tech/vias.json',
      '/workspace/demo/gcd_view/tech/cell_masters.json',
    ])
  })

  it('rejects unsupported tech schema with a clear error', async () => {
    await expect(loadTechLibrary(indexWithTech(), {
      readText: async () => JSON.stringify({ schema: 'unknown', kind: 'layers', data: [] }),
    })).rejects.toThrow('Unsupported layers tech file')
  })
})
