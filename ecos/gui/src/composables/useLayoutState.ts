import { ref, shallowRef, type Ref, type ShallowRef } from 'vue'
import type { LayoutGroup } from '@/applications/editor/layout'
import type { LayoutDataStore } from '@/applications/editor/layout/LayoutDataStore'
import type { LayerStyleSnapshot } from '@/applications/editor/layout/LayerStyleManager'
import type { LayerManagerPlugin } from '@/applications/editor/plugins/LayerManagerPlugin'

export interface LayoutState {
  selectedGroups: ShallowRef<LayoutGroup[]>
  dataStore: ShallowRef<LayoutDataStore | null>
  layerManager: ShallowRef<LayerManagerPlugin | null>
  layerStyleSnapshot: ShallowRef<LayerStyleSnapshot>
  renderMode: Ref<'image' | 'layout'>
  loadingState: Ref<'idle' | 'loading' | 'ready' | 'error'>
  loadingMessage: Ref<string>
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
    }
  }
  return _state
}
