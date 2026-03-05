import type {
  RawHeaderJSON,
  RawDataJSON,
  RawGroup,
  LayoutHeader,
  LayoutGroup,
  LayoutBox,
  LayerDef,
  Rect,
} from './types'
import { pathToRect, classifyGroup, parseUnits, GroupType } from './types'

export class LayoutDataStore {
  private _header: LayoutHeader | null = null
  private _groups: LayoutGroup[] = []
  private _allBoxes: LayoutBox[] = []

  /** layer id → boxes on that layer */
  private _boxesByLayer = new Map<number, LayoutBox[]>()
  /** group structName → index in _groups */
  private _groupNameIndex = new Map<string, number>()
  /** Set of layer ids actually present in the data */
  private _activeLayers = new Set<number>()

  get header(): LayoutHeader | null {
    return this._header
  }

  get groups(): readonly LayoutGroup[] {
    return this._groups
  }

  get designName(): string {
    return this._header?.designName ?? ''
  }

  get dbuPerMicron(): number {
    return this._header?.dbuPerMicron ?? 1000
  }

  get dieArea(): Rect | null {
    return this._header?.dieArea ?? null
  }

  get activeLayers(): ReadonlySet<number> {
    return this._activeLayers
  }

  get totalBoxes(): number {
    return this._allBoxes.length
  }

  get totalGroups(): number {
    return this._groups.length
  }

  loadHeader(json: RawHeaderJSON): LayoutHeader {
    const dbuPerMicron = parseUnits(json.units)
    const dieArea = pathToRect(json.diearea.path)
    const layerInfo = new Map<number, LayerDef>()
    const layerList: LayerDef[] = []

    for (const raw of json.layerInfo) {
      const def: LayerDef = { id: raw.id, layername: raw.layername }
      layerInfo.set(raw.id, def)
      layerList.push(def)
    }

    this._header = {
      designName: json['design name'],
      version: json.version,
      lastModify: json.lastModify,
      dbuPerMicron,
      dieArea,
      layerInfo,
      layerList,
    }

    return this._header
  }

  loadData(json: RawDataJSON): void {
    this._groups = []
    this._allBoxes = []
    this._boxesByLayer.clear()
    this._groupNameIndex.clear()
    this._activeLayers.clear()

    const rawGroups: RawGroup[] = json.data ?? []

    for (let gi = 0; gi < rawGroups.length; gi++) {
      const raw = rawGroups[gi]
      const structName = raw['struct name']
      const groupType = classifyGroup(structName)

      const children: LayoutBox[] = []
      let gMinX = Infinity
      let gMinY = Infinity
      let gMaxX = -Infinity
      let gMaxY = -Infinity

      if (raw.children) {
        for (const rawBox of raw.children) {
          if (!rawBox.path || rawBox.path.length < 4) {
            console.warn(`Skipping invalid box in group "${structName}": path has ${rawBox.path?.length ?? 0} points`)
            continue
          }

          const rect = pathToRect(rawBox.path)
          const box: LayoutBox = {
            type: 'box',
            id: rawBox.id,
            layer: rawBox.layer,
            path: rawBox.path,
            rect,
            groupIndex: gi,
          }

          children.push(box)
          this._allBoxes.push(box)

          this._activeLayers.add(rawBox.layer)

          let layerBucket = this._boxesByLayer.get(rawBox.layer)
          if (!layerBucket) {
            layerBucket = []
            this._boxesByLayer.set(rawBox.layer, layerBucket)
          }
          layerBucket.push(box)

          if (rect.x < gMinX) gMinX = rect.x
          if (rect.y < gMinY) gMinY = rect.y
          if (rect.x + rect.width > gMaxX) gMaxX = rect.x + rect.width
          if (rect.y + rect.height > gMaxY) gMaxY = rect.y + rect.height
        }
      }

      const bbox: Rect =
        children.length > 0
          ? { x: gMinX, y: gMinY, width: gMaxX - gMinX, height: gMaxY - gMinY }
          : { x: 0, y: 0, width: 0, height: 0 }

      const group: LayoutGroup = {
        type: 'group',
        structName,
        groupType,
        children,
        bbox,
      }

      this._groups.push(group)
      this._groupNameIndex.set(structName, gi)
    }
  }

  getGroupByName(name: string): LayoutGroup | undefined {
    const idx = this._groupNameIndex.get(name)
    return idx !== undefined ? this._groups[idx] : undefined
  }

  getGroupIndexByName(name: string): number {
    return this._groupNameIndex.get(name) ?? -1
  }

  getGroupsByType(type: GroupType): LayoutGroup[] {
    return this._groups.filter((g) => g.groupType === type)
  }

  getBoxesByLayer(layerId: number): readonly LayoutBox[] {
    return this._boxesByLayer.get(layerId) ?? []
  }

  getGroupForBox(box: LayoutBox): LayoutGroup | undefined {
    return this._groups[box.groupIndex]
  }

  getLayerDef(layerId: number): LayerDef | undefined {
    return this._header?.layerInfo.get(layerId)
  }

  getLayerName(layerId: number): string {
    return this._header?.layerInfo.get(layerId)?.layername ?? `Layer ${layerId}`
  }

  /** Sorted array of layer ids that have actual data */
  getActiveLayerIds(): number[] {
    return Array.from(this._activeLayers).sort((a, b) => a - b)
  }

  /** Get unique set of layers used by a specific group */
  getGroupLayers(group: LayoutGroup): number[] {
    const layers = new Set<number>()
    for (const box of group.children) {
      layers.add(box.layer)
    }
    return Array.from(layers).sort((a, b) => a - b)
  }

  clear(): void {
    this._header = null
    this._groups = []
    this._allBoxes = []
    this._boxesByLayer.clear()
    this._groupNameIndex.clear()
    this._activeLayers.clear()
  }
}
