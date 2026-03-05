import { describe, it, expect, beforeEach } from 'vitest'
import { LayoutDataStore } from '../LayoutDataStore'
import { SpatialIndex } from '../SpatialIndex'
import { LayerStyleManager } from '../LayerStyleManager'
import { GroupType, dbuToMicron, formatMicron } from '../types'
import type { RawHeaderJSON, RawDataJSON } from '../types'

const HEADER: RawHeaderJSON = {
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
    { id: 1, layername: 'ACT' },
    { id: 7, layername: 'MET1' },
    { id: 8, layername: 'VIA1' },
    { id: 9, layername: 'MET2' },
    { id: 15, layername: 'MET5' },
  ],
}

const DATA: RawDataJSON = {
  data: [
    {
      type: 'group',
      'struct name': 'Instance_A',
      children: [
        { type: 'box', id: '0', layer: 0, path: [[100, 100], [500, 100], [500, 500], [100, 500], [100, 100]] },
        { type: 'box', id: '1', layer: 7, path: [[150, 150], [450, 150], [450, 200], [150, 200], [150, 150]] },
        { type: 'box', id: '2', layer: 9, path: [[200, 250], [400, 250], [400, 300], [200, 300], [200, 250]] },
      ],
    },
    {
      type: 'group',
      'struct name': 'Instance_B',
      children: [
        { type: 'box', id: '3', layer: 0, path: [[1000, 1000], [1400, 1000], [1400, 1400], [1000, 1400], [1000, 1000]] },
        { type: 'box', id: '4', layer: 7, path: [[1050, 1050], [1350, 1050], [1350, 1100], [1050, 1100], [1050, 1050]] },
      ],
    },
    {
      type: 'group',
      'struct name': 'VDD',
      children: [
        { type: 'box', id: '5', layer: 7, path: [[0, 0], [84710, 0], [84710, 50], [0, 50], [0, 0]] },
      ],
    },
    {
      type: 'group',
      'struct name': 'clk',
      children: [],
    },
  ],
}

// 8.1 Full pipeline test
describe('Integration: Header → Data → SpatialIndex → Interaction', () => {
  let store: LayoutDataStore
  let index: SpatialIndex

  beforeEach(() => {
    store = new LayoutDataStore()
    store.loadHeader(HEADER)
    store.loadData(DATA)
    index = new SpatialIndex()
    const allBoxes = store.groups.flatMap((g) => g.children)
    index.buildFromBoxes(allBoxes)
  })

  it('parses header correctly', () => {
    expect(store.designName).toBe('gcd')
    expect(store.dbuPerMicron).toBe(1000)
    expect(store.dieArea).toEqual({ x: 0, y: 0, width: 84710, height: 84710 })
  })

  it('parses data and classifies groups', () => {
    expect(store.totalGroups).toBe(4)
    expect(store.totalBoxes).toBe(6)
    expect(store.getGroupsByType(GroupType.Cell).length).toBe(2)
    expect(store.getGroupsByType(GroupType.PowerNet).length).toBe(1)
    expect(store.getGroupsByType(GroupType.SignalNet).length).toBe(1)
  })

  it('spatial index picks correct box via point query', () => {
    // Point inside Instance_A's box 0 (100-500, 100-500)
    const hits = index.queryPoint(300, 300)
    expect(hits.length).toBeGreaterThan(0)
    const groupIndices = new Set(hits.map((b) => b.groupIndex))
    expect(groupIndices.has(0)).toBe(true) // Instance_A
  })

  it('spatial index returns empty for empty area', () => {
    const hits = index.queryPoint(50000, 50000)
    expect(hits.length).toBe(0)
  })

  it('box selection (contained mode) works', () => {
    const hits = index.queryContained({ x: 50, y: 50, width: 500, height: 500 })
    const groups = new Set(hits.map((b) => b.groupIndex))
    expect(groups.has(0)).toBe(true)
    expect(groups.has(1)).toBe(false)
  })

  it('box selection (intersect mode) works', () => {
    const hits = index.queryRect({ x: 400, y: 400, width: 700, height: 700 })
    const groups = new Set(hits.map((b) => b.groupIndex))
    expect(groups.has(0)).toBe(true) // Instance_A overlaps
    expect(groups.has(1)).toBe(true) // Instance_B overlaps
  })

  it('selects highest layer box on overlap', () => {
    // Point at (300, 170) - inside both layer 0 box and layer 7 box of Instance_A
    const hits = index.queryPoint(300, 170)
    expect(hits.length).toBeGreaterThanOrEqual(2)
    const sorted = [...hits].sort((a, b) => b.layer - a.layer)
    expect(sorted[0].layer).toBe(7) // MET1 is highest
  })
})

// 8.2 Layer control test
describe('Integration: Layer style and visibility', () => {
  it('builds styles from layer defs with correct colors', () => {
    const store = new LayoutDataStore()
    store.loadHeader(HEADER)

    const styles = new LayerStyleManager()
    styles.buildFromLayerDefs(store.header!.layerList)

    const met1 = styles.getStyle(7)!
    expect(met1.fillColor).toBe(0x4444ff)
    expect(met1.visible).toBe(true)
    expect(met1.fillMode).toBe('solid')
    expect(met1.texturePattern).toBe('diagonal')

    const via1 = styles.getStyle(8)!
    expect(via1.fillColor).toBe(0xaaaaaa)

    const overlap = styles.getStyle(0)!
    expect(overlap.fillColor).toBe(0x888888)
  })

  it('toggles layer visibility', () => {
    const styles = new LayerStyleManager()
    const store = new LayoutDataStore()
    store.loadHeader(HEADER)
    styles.buildFromLayerDefs(store.header!.layerList)

    expect(styles.isVisible(7)).toBe(true)
    styles.toggleLayer(7)
    expect(styles.isVisible(7)).toBe(false)
    styles.toggleLayer(7)
    expect(styles.isVisible(7)).toBe(true)
  })

  it('show/hide all layers', () => {
    const styles = new LayerStyleManager()
    const store = new LayoutDataStore()
    store.loadHeader(HEADER)
    styles.buildFromLayerDefs(store.header!.layerList)

    styles.hideAll()
    expect(styles.isVisible(7)).toBe(false)
    expect(styles.isVisible(9)).toBe(false)

    styles.showAll()
    expect(styles.isVisible(7)).toBe(true)
    expect(styles.isVisible(9)).toBe(true)
  })

  it('adjusts transparency', () => {
    const styles = new LayerStyleManager()
    const store = new LayoutDataStore()
    store.loadHeader(HEADER)
    styles.buildFromLayerDefs(store.header!.layerList)

    styles.setFillAlpha(7, 0.5)
    expect(styles.getStyle(7)!.fillAlpha).toBe(0.5)
  })

  it('switches texture style properties', () => {
    const styles = new LayerStyleManager()
    const store = new LayoutDataStore()
    store.loadHeader(HEADER)
    styles.buildFromLayerDefs(store.header!.layerList)

    styles.setFillMode(7, 'texture')
    styles.setTexturePattern(7, 'cross')
    styles.setTextureScale(7, 1.8)
    styles.setTextureAngle(7, 45)

    const met1 = styles.getStyle(7)!
    expect(met1.fillMode).toBe('texture')
    expect(met1.texturePattern).toBe('cross')
    expect(met1.textureScale).toBe(1.8)
    expect(met1.textureAngle).toBe(45)
  })

  it('layer names come from header', () => {
    const store = new LayoutDataStore()
    store.loadHeader(HEADER)
    expect(store.getLayerName(7)).toBe('MET1')
    expect(store.getLayerName(8)).toBe('VIA1')
    expect(store.getLayerName(9)).toBe('MET2')
    expect(store.getLayerName(15)).toBe('MET5')
  })
})

// 8.4 Coordinate display test
describe('Integration: Coordinate and unit display', () => {
  it('converts DBU to μm correctly', () => {
    expect(dbuToMicron(10000, 1000)).toBe(10)
    expect(dbuToMicron(84710, 1000)).toBeCloseTo(84.71)
  })

  it('formats micron string', () => {
    expect(formatMicron(10000, 1000)).toBe('10.000 μm')
    expect(formatMicron(84710, 1000)).toBe('84.710 μm')
  })

  it('properties panel data for group', () => {
    const store = new LayoutDataStore()
    store.loadHeader(HEADER)
    store.loadData(DATA)

    const group = store.getGroupByName('Instance_A')!
    expect(group.structName).toBe('Instance_A')
    expect(group.groupType).toBe(GroupType.Cell)
    expect(group.children.length).toBe(3)

    const layers = store.getGroupLayers(group)
    expect(layers).toEqual([0, 7, 9])

    const bbox = group.bbox
    expect(bbox.x).toBe(100)
    expect(bbox.y).toBe(100)
    expect(formatMicron(bbox.x, 1000)).toBe('0.100 μm')
    expect(formatMicron(bbox.width, 1000)).toBe('0.400 μm')
  })
})

// 8.5 Memory management test
describe('Integration: Memory and cleanup', () => {
  it('LayoutDataStore clears all references', () => {
    const store = new LayoutDataStore()
    store.loadHeader(HEADER)
    store.loadData(DATA)
    expect(store.totalGroups).toBeGreaterThan(0)

    store.clear()
    expect(store.header).toBeNull()
    expect(store.totalGroups).toBe(0)
    expect(store.totalBoxes).toBe(0)
    expect(store.dieArea).toBeNull()
    expect(store.getActiveLayerIds().length).toBe(0)
  })

  it('SpatialIndex clears', () => {
    const store = new LayoutDataStore()
    store.loadHeader(HEADER)
    store.loadData(DATA)

    const idx = new SpatialIndex()
    idx.buildFromBoxes(store.groups.flatMap((g) => g.children))
    expect(idx.built).toBe(true)

    idx.clear()
    expect(idx.built).toBe(false)
    expect(idx.queryPoint(300, 300).length).toBe(0)
  })

  it('LayerStyleManager clears', () => {
    const styles = new LayerStyleManager()
    const store = new LayoutDataStore()
    store.loadHeader(HEADER)
    styles.buildFromLayerDefs(store.header!.layerList)
    expect(styles.getStyle(7)).toBeDefined()

    styles.clear()
    expect(styles.getStyle(7)).toBeUndefined()
  })

  it('can reload after clear without issues', () => {
    const store = new LayoutDataStore()

    store.loadHeader(HEADER)
    store.loadData(DATA)
    store.clear()

    store.loadHeader(HEADER)
    store.loadData(DATA)
    expect(store.totalGroups).toBe(4)
    expect(store.totalBoxes).toBe(6)
  })
})
