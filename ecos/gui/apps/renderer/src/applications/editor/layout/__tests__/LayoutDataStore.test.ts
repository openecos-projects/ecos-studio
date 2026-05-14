import { describe, it, expect, beforeEach } from 'vitest'
import { LayoutDataStore } from '../LayoutDataStore'
import { GroupType, pathToRect, dbuToMicron, micronToDbu, parseUnits, classifyGroup } from '../types'
import type { RawHeaderJSON, RawDataJSON } from '../types'

const SAMPLE_HEADER: RawHeaderJSON = {
  header: '0',
  lastModify: '12/19/2025 17:23:28',
  libname: '',
  units: '0.001 1e-09',
  version: '5.8',
  'design name': 'gcd',
  diearea: {
    path: [[0, 0], [84710, 0], [84710, 84710], [0, 84710], [0, 0]],
  },
  layerInfo: [
    { id: 0, layername: 'OVERLAP' },
    { id: 7, layername: 'MET1' },
    { id: 8, layername: 'VIA1' },
    { id: 9, layername: 'MET2' },
  ],
}

const SAMPLE_DATA: RawDataJSON = {
  data: [
    {
      type: 'group',
      'struct name': 'Instance__269_',
      children: [
        { type: 'box', id: '0', layer: 0, path: [[100, 200], [900, 200], [900, 1600], [100, 1600], [100, 200]] },
        { type: 'box', id: '1', layer: 7, path: [[200, 300], [800, 300], [800, 500], [200, 500], [200, 300]] },
      ],
    },
    {
      type: 'group',
      'struct name': 'VDD',
      children: [
        { type: 'box', id: '2', layer: 7, path: [[0, 0], [84710, 0], [84710, 200], [0, 200], [0, 0]] },
      ],
    },
    {
      type: 'group',
      'struct name': 'clk',
      children: [],
    },
    {
      type: 'group',
      'struct name': 'VSS',
      children: [
        { type: 'box', id: '3', layer: 9, path: [[0, 84510], [84710, 84510], [84710, 84710], [0, 84710], [0, 84510]] },
      ],
    },
  ],
}

// --- Utility function tests ---

describe('pathToRect', () => {
  it('extracts rect from 5-point closed path', () => {
    const rect = pathToRect([[0, 0], [800, 0], [800, 1400], [0, 1400], [0, 0]])
    expect(rect).toEqual({ x: 0, y: 0, width: 800, height: 1400 })
  })

  it('handles non-origin rect', () => {
    const rect = pathToRect([[100, 200], [500, 200], [500, 600], [100, 600], [100, 200]])
    expect(rect).toEqual({ x: 100, y: 200, width: 400, height: 400 })
  })
})

describe('parseUnits', () => {
  it('parses standard units string', () => {
    expect(parseUnits('0.001 1e-09')).toBe(1000)
  })

  it('returns fallback for invalid input', () => {
    expect(parseUnits('')).toBe(1000)
    expect(parseUnits('0 0')).toBe(1000)
  })
})

describe('dbuToMicron / micronToDbu', () => {
  it('converts DBU to micron', () => {
    expect(dbuToMicron(10000, 1000)).toBe(10)
  })

  it('converts micron to DBU', () => {
    expect(micronToDbu(10, 1000)).toBe(10000)
  })
})

describe('classifyGroup', () => {
  it('classifies Instance_ as Cell', () => {
    expect(classifyGroup('Instance__269_')).toBe(GroupType.Cell)
    expect(classifyGroup('Instance_foo')).toBe(GroupType.Cell)
  })

  it('classifies VDD/VSS as PowerNet', () => {
    expect(classifyGroup('VDD')).toBe(GroupType.PowerNet)
    expect(classifyGroup('VSS')).toBe(GroupType.PowerNet)
    expect(classifyGroup('VDDIO')).toBe(GroupType.PowerNet)
    expect(classifyGroup('VSSIO')).toBe(GroupType.PowerNet)
  })

  it('classifies everything else as SignalNet', () => {
    expect(classifyGroup('clk')).toBe(GroupType.SignalNet)
    expect(classifyGroup('reset')).toBe(GroupType.SignalNet)
    expect(classifyGroup('req_msg[3]')).toBe(GroupType.SignalNet)
    expect(classifyGroup('fixio_0')).toBe(GroupType.SignalNet)
  })
})

// --- LayoutDataStore tests ---

describe('LayoutDataStore', () => {
  let store: LayoutDataStore

  beforeEach(() => {
    store = new LayoutDataStore()
  })

  describe('loadHeader', () => {
    it('parses design name', () => {
      store.loadHeader(SAMPLE_HEADER)
      expect(store.designName).toBe('gcd')
    })

    it('calculates dbuPerMicron from units', () => {
      store.loadHeader(SAMPLE_HEADER)
      expect(store.dbuPerMicron).toBe(1000)
    })

    it('extracts die area', () => {
      store.loadHeader(SAMPLE_HEADER)
      expect(store.dieArea).toEqual({ x: 0, y: 0, width: 84710, height: 84710 })
    })

    it('builds layerInfo map', () => {
      const header = store.loadHeader(SAMPLE_HEADER)
      expect(header.layerInfo.size).toBe(4)
      expect(header.layerInfo.get(7)?.layername).toBe('MET1')
      expect(header.layerInfo.get(9)?.layername).toBe('MET2')
    })

    it('preserves layerList order', () => {
      const header = store.loadHeader(SAMPLE_HEADER)
      expect(header.layerList.map((l) => l.id)).toEqual([0, 7, 8, 9])
    })
  })

  describe('loadData', () => {
    beforeEach(() => {
      store.loadHeader(SAMPLE_HEADER)
      store.loadData(SAMPLE_DATA)
    })

    it('parses all groups', () => {
      expect(store.totalGroups).toBe(4)
    })

    it('parses all boxes', () => {
      expect(store.totalBoxes).toBe(4) // 2 + 1 + 0 + 1
    })

    it('classifies groups correctly', () => {
      const cells = store.getGroupsByType(GroupType.Cell)
      expect(cells.length).toBe(1)
      expect(cells[0].structName).toBe('Instance__269_')

      const powerNets = store.getGroupsByType(GroupType.PowerNet)
      expect(powerNets.length).toBe(2)

      const signalNets = store.getGroupsByType(GroupType.SignalNet)
      expect(signalNets.length).toBe(1)
      expect(signalNets[0].structName).toBe('clk')
    })

    it('handles empty children', () => {
      const clk = store.getGroupByName('clk')
      expect(clk).toBeDefined()
      expect(clk!.children.length).toBe(0)
      expect(clk!.bbox).toEqual({ x: 0, y: 0, width: 0, height: 0 })
    })

    it('computes group bounding boxes', () => {
      const inst = store.getGroupByName('Instance__269_')
      expect(inst).toBeDefined()
      expect(inst!.bbox).toEqual({ x: 100, y: 200, width: 800, height: 1400 })
    })

    it('tracks active layers', () => {
      const active = store.getActiveLayerIds()
      expect(active).toEqual([0, 7, 9])
    })

    it('indexes boxes by layer', () => {
      const met1Boxes = store.getBoxesByLayer(7)
      expect(met1Boxes.length).toBe(2) // one from Instance, one from VDD
    })
  })

  describe('queries', () => {
    beforeEach(() => {
      store.loadHeader(SAMPLE_HEADER)
      store.loadData(SAMPLE_DATA)
    })

    it('looks up group by name', () => {
      const group = store.getGroupByName('VDD')
      expect(group).toBeDefined()
      expect(group!.groupType).toBe(GroupType.PowerNet)
    })

    it('returns undefined for unknown group', () => {
      expect(store.getGroupByName('nonexistent')).toBeUndefined()
    })

    it('gets layer definition', () => {
      expect(store.getLayerDef(7)?.layername).toBe('MET1')
    })

    it('gets layer name', () => {
      expect(store.getLayerName(7)).toBe('MET1')
      expect(store.getLayerName(999)).toBe('Layer 999')
    })

    it('box references back to group', () => {
      const met1Boxes = store.getBoxesByLayer(7)
      const firstBox = met1Boxes[0]
      const group = store.getGroupForBox(firstBox)
      expect(group).toBeDefined()
    })

    it('gets group layers', () => {
      const inst = store.getGroupByName('Instance__269_')!
      const layers = store.getGroupLayers(inst)
      expect(layers).toEqual([0, 7])
    })
  })

  describe('clear', () => {
    it('resets all state', () => {
      store.loadHeader(SAMPLE_HEADER)
      store.loadData(SAMPLE_DATA)
      store.clear()

      expect(store.header).toBeNull()
      expect(store.totalGroups).toBe(0)
      expect(store.totalBoxes).toBe(0)
      expect(store.dieArea).toBeNull()
    })
  })
})
