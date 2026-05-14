import { ref, shallowRef, type Ref, type ShallowRef } from 'vue'
import type { LayoutGroup } from '@/applications/editor/layout'
import type { LayoutDataStore } from '@/applications/editor/layout/LayoutDataStore'
import type { LayerStyleSnapshot } from '@/applications/editor/layout/LayerStyleManager'
import type { LayerManagerPlugin } from '@/applications/editor/plugins/LayerManagerPlugin'
import type { SelectionInfo } from '@/applications/editor/tile'
import type { DrcViolation } from '@/composables/drcStepParser'

export interface TileActions {
  clearSelection: () => void
  fitToView: () => void
}

export interface TileEditActions {
  deleteSelected: () => void
  undo: () => void
  redo: () => void
  /** 进入放置模式（需要先选中一个 instance 获取 cellId，或直接传入） */
  startPlacement: (cellId: number, orient?: number) => void
  cancelPlacement: () => void
}

export interface TileLayerItem {
  id:      number
  name:    string
  color:   string   // hex from manifest
  alpha:   number   // 0-1 from manifest
  zOrder:  number
  visible: boolean
}

export interface TileLayerActions {
  toggleLayer: (id: number) => void
  showAll: () => void
  hideAll: () => void
}

export interface LayoutState {
  selectedGroups: ShallowRef<LayoutGroup[]>
  dataStore: ShallowRef<LayoutDataStore | null>
  layerManager: ShallowRef<LayerManagerPlugin | null>
  layerStyleSnapshot: ShallowRef<LayerStyleSnapshot>
  renderMode: Ref<'image' | 'layout'>
  loadingState: Ref<'idle' | 'loading' | 'ready' | 'error'>
  loadingMessage: Ref<string>
  /** Tile 模式下的选中信息 */
  tileSelection: ShallowRef<SelectionInfo | null>
  /** Tile 模式下的 dbuPerMicron（来自 manifest） */
  tileDbuPerMicron: Ref<number>
  /** 瓦片 die 世界高度（与 manifest.dieArea.h / 坐标换算一致，供 DRC 列表显示 EDA 坐标） */
  tileDieWorldH: Ref<number>
  /** Tile 模式下的交互操作（由 DrawingArea 注册） */
  tileActions: ShallowRef<TileActions | null>
  /** Tile 图层列表（来自 manifest） */
  tileLayers: ShallowRef<TileLayerItem[]>
  /** Tile 图层操作（由 DrawingArea 注册） */
  tileLayerActions: ShallowRef<TileLayerActions | null>
  /** Tile 编辑操作 */
  tileEditActions: ShallowRef<TileEditActions | null>
  /** 是否有未保存的编辑 */
  hasUnsavedEdits: Ref<boolean>
  /** 当前是否处于放置模式 */
  isPlacementMode: Ref<boolean>
  /** DRC 违例叠加层是否已成功解析（无文件或失败则为 false） */
  drcOverlayReady: Ref<boolean>
  /** 当前展示的 DRC 违例条数 */
  drcViolationCount: Ref<number>
  /** 当前加载的 DRC 违例列表（供列表面板） */
  drcViolations: ShallowRef<DrcViolation[]>
  /** 按索引跳转视口到违例（由 DrawingArea 注入） */
  focusDrcViolationByIndex: ShallowRef<((index: number) => void) | null>
}

let _state: LayoutState | null = null

export function useLayoutState(): LayoutState {
  if (!_state) {
    _state = {
      selectedGroups: shallowRef([]),
      dataStore: shallowRef(null),
      layerManager: shallowRef(null),
      layerStyleSnapshot: shallowRef({}),
      renderMode: ref('image'),
      loadingState: ref('idle'),
      loadingMessage: ref(''),
      tileSelection: shallowRef(null),
      tileDbuPerMicron: ref(1000),
      tileDieWorldH: ref(0),
      tileActions: shallowRef(null),
      tileLayers: shallowRef([]),
      tileLayerActions: shallowRef(null),
      tileEditActions: shallowRef(null),
      hasUnsavedEdits: ref(false),
      isPlacementMode: ref(false),
      drcOverlayReady: ref(false),
      drcViolationCount: ref(0),
      drcViolations: shallowRef([]),
      focusDrcViolationByIndex: shallowRef(null),
    }
  }
  return _state
}
