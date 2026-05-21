<script setup lang="ts">
import { shallowRef, markRaw, watch, ref, onUnmounted, onMounted, computed, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { EditorContainer, type Editor } from '@/applications/editor'
import { LayerManagerPlugin } from '@/applications/editor/plugins'
import {
  TileManager,
  TileInteraction,
  ViewportAnimator,
  EditManager,
  PlacementTool,
  DrcViolationOverlay,
} from '@/applications/editor/tile'
import type { CellDefStore } from '@/applications/editor/tile/CellDefStore'
import type { GlobalLayerStore } from '@/applications/editor/tile/GlobalLayerStore'
import DrawingToolbar from './DrawingToolbar.vue'
import { useWorkspace } from '@/composables/useWorkspace'
import { useEDA } from '@/composables/useEDA'
import { useLayoutState } from '@/composables/useLayoutState'
import { isTauri } from '@/composables/useTauri'
import {
  deriveDrcStepPathFromLayoutJsonRelative,
  getLayoutTileGenerationStatus,
  pickDrcJsonPath,
  pickLayoutJsonPath,
  resolveLayoutJsonAbsolutePath,
} from '@/composables/useLayoutTileGen'
import { parseDrcStepJson, violationToFitRect } from '@/composables/drcStepParser'
import { requestProjectPathAccess } from '@/utils/projectFs'
import { readOptionalProjectTextFile } from '@/utils/projectFiles'
import { runLayoutTileGenerationSingleFlight } from '@/composables/layoutTilePipeline'
import { useLayoutTilePrefetchStore } from '@/stores/layoutTilePrefetchStore'
import { getInfoApi } from '@/api/flow'
import { CMDEnum, InfoEnum, StepEnum, ResponseEnum } from '@/api/type'
import { RULER_THICKNESS } from '@/applications/editor/core/rulerConfig'

const route = useRoute()
const { currentProject, runtimeEvents, stepRefreshCounter } = useWorkspace()
const { getResourceUrl } = useEDA()
const layoutState = useLayoutState()
const tilePrefetchStore = useLayoutTilePrefetchStore()

const editor = shallowRef<Editor | null>(null)

/** get_info(layout) 返回的布局 JSON 相对路径，供工具栏生成瓦片 */
const layoutJsonRelativePath = ref<string | null>(null)
/** DRC 结果 JSON 相对路径：get_info 显式字段，或与布局同目录的 `drc.step.json` */
const drcJsonRelativePath = ref<string | null>(null)
/** 当前步骤预览图相对路径（与 handleStageChange 中 info.image 一致），供「矢量 / 预览图」切换 */
const previewImageRelativePath = ref<string | null>(null)
/** 最近一次成功加载的瓦片包（切换回矢量时复用，步骤切换时在 handleStageChange 中清空） */
const lastSuccessfulTileBundle = ref<{ baseUrl: string, outDir?: string } | null>(null)
const currentLayoutTileCacheReady = ref(false)
const tileGenBusy = ref(false)
/** 矢量 ↔ 预览图切换中（与生成瓦片并列禁用工具栏） */
const previewModeSwitchBusy = ref(false)
const showTileGenerate = computed(() => isTauri())

const showPreviewModeToggle = computed(() =>
  showTileGenerate.value
  && previewImageRelativePath.value != null
  && previewImageRelativePath.value.length > 0,
)

const canSwitchToLayoutMode = computed(() => lastSuccessfulTileBundle.value != null)

/** 当前路由阶段名，用作瓦片缓存子目录 stepKey（与 handleStageChange 一致） */
const currentStepKey = computed(() => {
  const pathParts = route.path.split('/')
  return pathParts[pathParts.length - 1] || 'home'
})

/** 鼠标在画布上时的 EDA/显示坐标（屏幕 → 世界 → display，与标尺一致） */
const cursorEda = ref<{ x: number; y: number } | null>(null)

let detachCanvasPointerListeners: (() => void) | null = null

function formatCursorCoord(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString()
}

function attachCanvasPointerTracking(ed: Editor): void {
  detachCanvasPointerListeners?.()
  const canvas = ed.application?.canvas as HTMLCanvasElement | undefined
  const vp = ed.view
  if (!canvas || !vp) return

  const onMove = (e: PointerEvent): void => {
    const world = vp.toWorld(e.offsetX, e.offsetY)
    const d = ed.worldToDisplay(world.x, world.y)
    cursorEda.value = { x: d.x, y: d.y }
  }
  const onLeave = (): void => {
    cursorEda.value = null
  }

  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerleave', onLeave)

  detachCanvasPointerListeners = () => {
    canvas.removeEventListener('pointermove', onMove)
    canvas.removeEventListener('pointerleave', onLeave)
    detachCanvasPointerListeners = null
  }
}

watch(
  () => [currentProject.value?.path ?? null, currentStepKey.value] as const,
  ([projectPath, stepKey], prev) => {
    const prevPath = prev?.[0] ?? null
    if (projectPath !== prevPath) {
      resetLoadingState()
      tilePrefetchStore.setProject(projectPath)
    }
    if (projectPath) {
      tilePrefetchStore.notifyNavigatedStep(stepKey)
    }
  },
  { immediate: true },
)

watch(
  () => editor.value,
  (ed) => {
    detachCanvasPointerListeners?.()
    cursorEda.value = null
    if (ed) attachCanvasPointerTracking(ed)
  },
  { immediate: true }
)

/** 画布底部居中、标尺上方：版图快捷键（可点击，与 TileInteraction / PlacementTool 一致） */
const LAYOUT_HOTKEY_BAR_BOTTOM_PX = RULER_THICKNESS + 10

function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform)
}

const showLayoutHotkeyBar = computed(() =>
  layoutState.renderMode.value === 'layout'
  && layoutState.tileActions.value != null
  && layoutState.tileSelection.value != null,
)

const hotkeyDeleteApplicable = computed(() => {
  if (layoutState.isPlacementMode.value) return false
  const t = layoutState.tileSelection.value?.type
  return t === 'instance' || t === 'segment'
})

const hotkeyCApplicable = computed(() =>
  !layoutState.isPlacementMode.value
  && layoutState.tileSelection.value?.type === 'instance'
  && layoutState.tileSelection.value.cellId != null,
)

const hotkeyRApplicable = computed(() =>
  layoutState.isPlacementMode.value
  || layoutState.tileSelection.value?.type === 'instance',
)

const hotkeyFitApplicable = computed(() => layoutState.tileSelection.value != null)

function dispatchDeleteKey(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))
}

function dispatchBackspaceKey(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }))
}

function dispatchPlaceKey(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true, cancelable: true }))
}

function dispatchEscapeKey(): void {
  if (layoutState.isPlacementMode.value) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  } else {
    layoutState.tileActions.value?.clearSelection()
  }
}

function dispatchRotateKey(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true }))
}

function dispatchUndoChord(): void {
  const mac = isMacPlatform()
  window.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'z',
    bubbles: true,
    cancelable: true,
    ctrlKey: !mac,
    metaKey: mac,
  }))
}

function dispatchRedoChord(): void {
  const mac = isMacPlatform()
  if (mac) {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'z',
      bubbles: true,
      cancelable: true,
      metaKey: true,
      shiftKey: true,
    }))
  } else {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'y',
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    }))
  }
}

// Tile rendering module
let tileManager: TileManager | null = null
let tileInteraction: TileInteraction | null = null
let viewportAnimator: ViewportAnimator | null = null
let editManager: EditManager | null = null
let placementTool: PlacementTool | null = null
let drcViolationOverlay: DrcViolationOverlay | null = null

// 记住最近选中的 instance cell 信息，用于 Place 工具
let lastSelectedCellId: number | null = null
let lastSelectedOrient = 0

const stepEnumValues = Object.values(StepEnum)

function getStepEnumFromPath(path: string): StepEnum | undefined {
  return stepEnumValues.find(step => step.toLowerCase() === path.toLowerCase())
}

function resetLoadingState(): void {
  layoutState.loadingState.value = 'idle'
  layoutState.loadingMessage.value = ''
}

async function refreshCurrentLayoutTileCacheStatus(): Promise<void> {
  const projectPath = currentProject.value?.path
  const rel = layoutJsonRelativePath.value
  const stepKey = currentStepKey.value
  currentLayoutTileCacheReady.value = false
  if (!projectPath || !rel || !isTauri()) {
    return
  }

  try {
    const status = await getLayoutTileGenerationStatus({
      projectPath,
      layoutJsonRelative: rel,
      stepKey,
    })
    if (
      currentProject.value?.path !== projectPath
      || layoutJsonRelativePath.value !== rel
      || currentStepKey.value !== stepKey
    ) {
      return
    }
    currentLayoutTileCacheReady.value = status.fromCache
  } catch {
    if (
      currentProject.value?.path !== projectPath
      || layoutJsonRelativePath.value !== rel
      || currentStepKey.value !== stepKey
    ) {
      return
    }
    currentLayoutTileCacheReady.value = false
  }
}

const onEditorReady = (editorInstance: Editor) => {
  editor.value = editorInstance

  const layerMgrPlugin = editorInstance.getPlugin<LayerManagerPlugin>('layerManager')
  if (layerMgrPlugin) {
    layoutState.layerManager.value = markRaw(layerMgrPlugin)
  }

  const pathParts = route.path.split('/')
  const stage = pathParts[pathParts.length - 1] || 'home'
  handleStageChange(stage)
}

function cleanupLayout(): void {
  // 注意：不在这里清空 lastSuccessfulTileBundle，以便从矢量切到预览图后能再切回缓存瓦片包。
  placementTool?.destroy()
  editManager?.destroy()
  tileInteraction?.destroy()
  viewportAnimator?.destroy()
  tileManager?.destroy()

  placementTool = null
  editManager = null
  tileInteraction = null
  viewportAnimator = null
  tileManager = null

  drcViolationOverlay?.destroy()
  drcViolationOverlay = null
  layoutState.drcOverlayReady.value = false
  layoutState.drcViolationCount.value = 0
  layoutState.drcViolations.value = []
  layoutState.focusDrcViolationByIndex.value = null
  layoutState.tileDieWorldH.value = 0

  layoutState.selectedGroups.value = []
  layoutState.dataStore.value = null
  layoutState.tileSelection.value = null
  layoutState.tileActions.value = null
  layoutState.tileLayers.value = []
  layoutState.tileLayerActions.value = null
  layoutState.tileEditActions.value = null
  layoutState.hasUnsavedEdits.value = false
  layoutState.isPlacementMode.value = false
  layoutState.renderMode.value = 'image'
}

/** manifest.layer id（= layerIdx）在 cells.bin / global.bin 中是否出现几何 */
function manifestLayerIdsWithGeometry(
  cellStore: CellDefStore,
  globalStore: GlobalLayerStore,
): Set<number> {
  const ids = new Set<number>()
  for (const cid of cellStore.getAllCellIds()) {
    const def = cellStore.getCellDef(cid)
    if (!def) continue
    for (const { layerIdx, rects } of def.layers) {
      if (rects.length > 0) ids.add(layerIdx)
    }
  }
  for (const s of globalStore.shapes) {
    ids.add(s.layerIdx)
  }
  return ids
}

async function loadDrcViolationOverlayAfterTiles(_ed: Editor, dieWorldH: number): Promise<void> {
  layoutState.drcOverlayReady.value = false
  layoutState.drcViolationCount.value = 0
  layoutState.drcViolations.value = []
  if (!isTauri() || !drcViolationOverlay) return

  const projectPath = currentProject.value?.path
  const drcRel = drcJsonRelativePath.value
  if (!projectPath || !drcRel) return

  try {
    const abs = await resolveLayoutJsonAbsolutePath(projectPath, drcRel)
    if (!(await requestProjectPathAccess(abs))) return
    const text = await readOptionalProjectTextFile(abs)
    if (text === null) return
    const raw = JSON.parse(text) as unknown
    const violations = parseDrcStepJson(raw, dieWorldH)
    drcViolationOverlay.setViolations(violations)
    layoutState.drcViolations.value = violations
    layoutState.drcViolationCount.value = violations.length
    layoutState.drcOverlayReady.value = true
  } catch (e) {
    console.warn('[drc overlay] load failed:', e)
    drcViolationOverlay.setViolations([])
    layoutState.drcViolations.value = []
  }
}

/** @param localRoot 瓦片输出目录绝对路径；桌面端通过桥接按项目作用域读取该 bundle 根目录下的文件。 */
async function loadTileLayout(baseUrl: string, localRoot?: string): Promise<void> {
  const ed = editor.value
  if (!ed?.view) return

  cleanupLayout()

  layoutState.loadingState.value = 'loading'
  layoutState.loadingMessage.value = 'Loading tile manifest...'

  try {
    tileManager = markRaw(new TileManager(ed.view, baseUrl, localRoot))
    await tileManager.init()
    await Promise.all([tileManager.cellStore.ready, tileManager.globalStore.ready])

    // 与 COORDINATES.md 一致：瓦片数据是 Pixi 世界坐标 [0,dieW)×[0,dieH)，须同步 Editor 世界盒，
    // 否则 worldToDisplay / 标尺使用的 worldHeight 仍是旧值（如默认 4000），鼠标 EDA 读数会错。
    {
      const d = tileManager.manifest!.dieArea
      const worldCenter = { x: d.x + d.w / 2, y: d.y + d.h / 2 }
      ed.setWorldBounds(d.w, d.h)
      ed.fitToWorld(40, { worldCenter })
    }

    // ViewportAnimator
    viewportAnimator = markRaw(new ViewportAnimator(ed.view))
    if (tileManager.manifest) {
      viewportAnimator.setManifest(tileManager.manifest)
    }

    layoutState.focusDrcViolationByIndex.value = (index: number) => {
      const list = layoutState.drcViolations.value
      const v = list[index]
      if (!v || !viewportAnimator) return
      void viewportAnimator.fitToBbox(violationToFitRect(v), 0.18, 450)
    }

    // TileInteraction (RBush + hit-test + selection overlay)
    tileInteraction = markRaw(new TileInteraction(
      ed.view,
      tileManager,
      tileManager.cellStore,
      tileManager.globalStore,
    ))

    // EditManager
    editManager = markRaw(new EditManager(tileManager, tileManager.cellStore))
    ed.view.addChild(editManager.editOverlay)

    tileManager.setEditDirtyGetter(() => editManager!.hasUnsavedChanges)

    // 绑定 EditManager → TileInteraction
    tileInteraction.setEditManager(editManager)

    // 挂载 overlays 到 viewport（渲染顺序：edit → ghost → highlight → drc → selection）
    ed.view.addChild(tileInteraction.ghostOverlay)
    ed.view.addChild(tileInteraction.highlightOverlay)
    drcViolationOverlay = markRaw(new DrcViolationOverlay(ed.view))
    drcViolationOverlay.bindViewportEvents()
    ed.view.addChild(drcViolationOverlay)
    ed.view.addChild(tileInteraction.selectionOverlay)

    // PlacementTool
    placementTool = markRaw(new PlacementTool(
      ed.view,
      editManager,
      tileManager,
      tileManager.cellStore,
    ))
    ed.view.addChild(placementTool.ghostOverlay)

    // EditManager 变更 → 更新 hasUnsavedEdits
    editManager.onChange(() => {
      layoutState.hasUnsavedEdits.value = editManager?.hasUnsavedChanges ?? false
    })

    // 选中回调 → 更新 Vue 响应式状态 + 记住 cellId 供 Place 使用
    tileInteraction.onSelectionChange((info) => {
      layoutState.tileSelection.value = info
      if (info?.type === 'instance' && info.cellId != null) {
        lastSelectedCellId = info.cellId
        lastSelectedOrient = info.orient ?? 0
      }
    })

    // C 键 → 进入放置模式
    tileInteraction.onRequestPlacement((cellId, orient) => {
      _enterPlacement(cellId, orient)
    })

    // PlacementTool 停用 → 回到 select 模式
    placementTool.onDeactivate(() => {
      layoutState.isPlacementMode.value = false
      tileInteraction?.enable()
    })

    // viewport 缩放时刷新选中框线宽
    ed.view.on('zoomed', () => tileInteraction?.refreshSelectionStroke())

    // 注册 tile 操作回调给 PropertiesPanel 使用
    const mf = tileManager.manifest!
    layoutState.tileDbuPerMicron.value = mf.dbuPerMicron
    layoutState.tileDieWorldH.value = mf.dieArea.h
    layoutState.tileActions.value = {
      clearSelection: () => tileInteraction?.clearSelection(),
      fitToView: () => handleFitToView(),
    }

    // 注册编辑操作
    layoutState.tileEditActions.value = {
      deleteSelected: () => {
        const sel = tileInteraction?.currentSelection
        if (sel?.type === 'instance' && sel.instanceId != null && editManager) {
          editManager.deleteInstance(sel.instanceId)
          tileInteraction?.clearSelection()
        }
      },
      undo: () => editManager?.undo(),
      redo: () => editManager?.redo(),
      startPlacement: (cellId: number, orient?: number) => {
        _enterPlacement(cellId, orient ?? 0)
      },
      cancelPlacement: () => {
        placementTool?.deactivate()
      },
    }

    // 注册图层列表和操作给 LayerPanel：只列当前数据集中有几何的 layer（cells + global）
    const usedLayerIds = manifestLayerIdsWithGeometry(tileManager.cellStore, tileManager.globalStore)
    const layersForUi = mf.layers.filter(l => usedLayerIds.has(l.id))
    layoutState.tileLayers.value = layersForUi.map(l => ({
      id: l.id, name: l.name, color: l.color,
      alpha: l.alpha, zOrder: l.zOrder, visible: true,
    }))
    layoutState.tileLayerActions.value = {
      toggleLayer: (id: number) => {
        const vis = !tileManager!.isLayerVisible(id)
        tileManager!.setLayerVisible(id, vis)
        layoutState.tileLayers.value = layoutState.tileLayers.value.map(l =>
          l.id === id ? { ...l, visible: vis } : l,
        )
      },
      showAll: () => {
        for (const l of layersForUi) tileManager!.setLayerVisible(l.id, true)
        layoutState.tileLayers.value = layoutState.tileLayers.value.map(l => ({ ...l, visible: true }))
      },
      hideAll: () => {
        for (const l of layersForUi) tileManager!.setLayerVisible(l.id, false)
        layoutState.tileLayers.value = layoutState.tileLayers.value.map(l => ({ ...l, visible: false }))
      },
    }

    // 瓦片就绪后去掉步骤预览用的底图，避免与矢量/栅格瓦片叠在一起
    ed.clearBackground()

    void loadDrcViolationOverlayAfterTiles(ed, mf.dieArea.h)

    layoutState.renderMode.value = 'layout'
    layoutState.loadingState.value = 'ready'
    layoutState.loadingMessage.value = ''

    {
      const d = tileManager.manifest!.dieArea
      const worldCenter = { x: d.x + d.w / 2, y: d.y + d.h / 2 }
      void nextTick(() => {
        editor.value?.fitToWorld(40, { worldCenter })
        requestAnimationFrame(() => editor.value?.fitToWorld(40, { worldCenter }))
      })
    }

    lastSuccessfulTileBundle.value = { baseUrl, outDir: localRoot }
  } catch (err) {
    console.error('Failed to load tile layout:', err)
    layoutState.loadingState.value = 'error'
    layoutState.loadingMessage.value = String(err)
    cleanupLayout()
    lastSuccessfulTileBundle.value = null
  }
}

function _enterPlacement(cellId: number, orient: number): void {
  if (!placementTool || !tileInteraction) return
  tileInteraction.disable()
  tileInteraction.clearSelection()
  tileInteraction.highlightOverlay.clear()
  placementTool.activate(cellId, orient)
  layoutState.isPlacementMode.value = true
}

const handleStageChange = async (stage: string) => {
  if (!editor.value || !stage) return
  resetLoadingState()

  const stepEnum = getStepEnumFromPath(stage)
  if (!stepEnum) {
    editor.value.clearBackground()
    cleanupLayout()
    layoutJsonRelativePath.value = null
    drcJsonRelativePath.value = null
    previewImageRelativePath.value = null
    lastSuccessfulTileBundle.value = null
    return
  }

  try {
    // Try to load structured layout JSON first
    const layoutResponse = await getInfoApi({
      cmd: CMDEnum.get_info,
      data: { step: stepEnum, id: InfoEnum.layout }
    })

    if (layoutResponse.response === ResponseEnum.success && layoutResponse.data?.info) {
      const info = layoutResponse.data.info
      layoutJsonRelativePath.value = pickLayoutJsonPath(info)
      drcJsonRelativePath.value = pickDrcJsonPath(info)
        ?? deriveDrcStepPathFromLayoutJsonRelative(layoutJsonRelativePath.value ?? '')
        ?? null
      void refreshCurrentLayoutTileCacheStatus()

      const imagePath = typeof info.image === 'string' && info.image.length > 0 ? info.image : null
      previewImageRelativePath.value = imagePath

      lastSuccessfulTileBundle.value = null

      // Fallback to image mode
      if (imagePath) {
        cleanupLayout()
        const imageUrl = await getResourceUrl(imagePath, currentProject.value?.path || '')
        await editor.value?.setBackgroundImage(imageUrl)
        layoutState.renderMode.value = 'image'
        void nextTick(() => {
          editor.value?.fitToWorld(10)
          requestAnimationFrame(() => editor.value?.fitToWorld(10))
        })
        return
      }
    }

    editor.value?.clearBackground()
    cleanupLayout()
    layoutJsonRelativePath.value = null
    drcJsonRelativePath.value = null
    previewImageRelativePath.value = null
    currentLayoutTileCacheReady.value = false
    lastSuccessfulTileBundle.value = null
  } catch (error) {
    console.error('Failed to load stage results:', error)
    editor.value?.clearBackground()
    cleanupLayout()
    layoutJsonRelativePath.value = null
    drcJsonRelativePath.value = null
    previewImageRelativePath.value = null
    currentLayoutTileCacheReady.value = false
    lastSuccessfulTileBundle.value = null
  }
}

async function onGenerateTilesFromToolbar(): Promise<void> {
  const projectPath = currentProject.value?.path
  const rel = layoutJsonRelativePath.value
  if (!projectPath || !rel) {
    layoutState.loadingState.value = 'error'
    layoutState.loadingMessage.value =
      'Layout JSON path was not found. Check that get_info(layout) returns a json or info field for the current step.'
    return
  }

  tileGenBusy.value = true
  layoutState.loadingState.value = 'loading'
  layoutState.loadingMessage.value = 'Rendering layout…'
  try {
    tilePrefetchStore.clearDeferredPrefetchQueue()
    const { baseUrl, outDir, fromCache } = await runLayoutTileGenerationSingleFlight({
      projectPath,
      layoutJsonRelative: rel,
      stepKey: currentStepKey.value,
      source: 'user',
    })
    if (fromCache) {
      layoutState.loadingMessage.value = 'Loading cached layout tiles...'
    }
    await loadTileLayout(baseUrl, outDir)
    currentLayoutTileCacheReady.value = true
  } catch (err) {
    console.error('Tile generation failed:', err)
    layoutState.loadingState.value = 'error'
    layoutState.loadingMessage.value = String(err)
    cleanupLayout()
    currentLayoutTileCacheReady.value = false
    lastSuccessfulTileBundle.value = null
  } finally {
    tileGenBusy.value = false
  }
}

async function onPreviewModeChange(mode: 'layout' | 'image'): Promise<void> {
  if (previewModeSwitchBusy.value || tileGenBusy.value) return
  if (mode === layoutState.renderMode.value) return
  if (mode === 'layout' && !lastSuccessfulTileBundle.value) return
  const rel = previewImageRelativePath.value
  if (mode === 'image' && (!rel || !editor.value)) return

  previewModeSwitchBusy.value = true
  layoutState.loadingState.value = 'loading'
  layoutState.loadingMessage.value = mode === 'image' ? 'Loading preview image...' : 'Loading vector layout...'
  try {
    if (mode === 'image') {
      tilePrefetchStore.clearDeferredPrefetchQueue()
      cleanupLayout()
      const imageUrl = await getResourceUrl(rel!, currentProject.value?.path || '')
      await editor.value!.setBackgroundImage(imageUrl)
      layoutState.renderMode.value = 'image'
      layoutState.loadingState.value = 'ready'
      layoutState.loadingMessage.value = ''
      void nextTick(() => {
        editor.value?.fitToWorld(10)
        requestAnimationFrame(() => editor.value?.fitToWorld(10))
      })
      return
    }

    const bundle = lastSuccessfulTileBundle.value
    if (!bundle) return
    await loadTileLayout(bundle.baseUrl, bundle.outDir)
  } catch (err) {
    console.error('Preview mode switch failed:', err)
    layoutState.loadingState.value = 'error'
    layoutState.loadingMessage.value = String(err)
  } finally {
    previewModeSwitchBusy.value = false
  }
}

watch(() => route.path, (newPath) => {
  const pathParts = newPath.split('/')
  const stage = pathParts[pathParts.length - 1] || 'home'
  handleStageChange(stage)
})

// Runtime event payload 驱动：只有明确携带 subflow/step 路径的事件才直接刷新当前 step 版图。
watch(
  () => runtimeEvents.value.length,
  async (newLen, oldLen) => {
    if (newLen <= (oldLen ?? 0)) return
    const latest = runtimeEvents.value[newLen - 1]
    if (!latest || latest.cmd !== 'notify') return

    const notifyId = latest.data?.id as string | undefined
    const runtimeStep = latest.data?.step as string | undefined
    if (notifyId !== 'subflow' && notifyId !== 'step') return

    const pathParts = route.path.split('/')
    const currentStage = pathParts[pathParts.length - 1] || ''
    if (runtimeStep && currentStage.toLowerCase() === runtimeStep.toLowerCase()) {
      tilePrefetchStore.invalidateStep(currentStage)
      await handleStageChange(currentStage)
    }
  }
)

// CLI 运行命令完成后的兜底刷新信号。
watch(stepRefreshCounter, () => {
  const pathParts = route.path.split('/')
  const stage = pathParts[pathParts.length - 1] || 'home'
  tilePrefetchStore.invalidateStep(stage)
  handleStageChange(stage)
})

// ─── 工具切换 → Tile 交互模式管理 ─────────────────────────────────────────────

function onToolChange(toolId: string): void {
  if (!tileInteraction) return

  // 退出放置模式（如果在）
  placementTool?.deactivate()

  if (toolId === 'select') {
    tileInteraction.enable()
  } else if (toolId === 'place') {
    // 进入放置模式：使用最近选中的 cellId
    if (lastSelectedCellId != null) {
      _enterPlacement(lastSelectedCellId, lastSelectedOrient)
    } else {
      // 没有选过 instance → 回退到 select 模式
      tileInteraction.enable()
    }
  } else {
    tileInteraction.disable()
    tileInteraction.clearSelection()
    tileInteraction.highlightOverlay.clear()
  }
}

// ─── Tile 交互操作 ──────────────────────────────────────────────────────────

function handleFitToView(): void {
  const sel = layoutState.tileSelection.value
  if (!sel || !viewportAnimator) return
  viewportAnimator.fitToBbox({ x: sel.bboxX, y: sel.bboxY, w: sel.bboxW, h: sel.bboxH })
}

/** 版图选中时：F 适应选中包围盒（与 Fit 按钮一致） */
function onWindowKeyDownForLayoutFit(e: KeyboardEvent): void {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
  if (e.key !== 'f' && e.key !== 'F') return
  if (e.ctrlKey || e.metaKey || e.altKey) return
  if (layoutState.renderMode.value !== 'layout') return
  if (!layoutState.tileSelection.value) return
  e.preventDefault()
  handleFitToView()
}

onMounted(() => {
  window.addEventListener('keydown', onWindowKeyDownForLayoutFit)
})

onUnmounted(() => {
  detachCanvasPointerListeners?.()
  window.removeEventListener('keydown', onWindowKeyDownForLayoutFit)
})
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden">
    <DrawingToolbar
      :editor="editor"
      :show-tile-generate="showTileGenerate"
      :tile-gen-busy="tileGenBusy"
      :layout-tile-shortcuts-hint="layoutState.renderMode.value === 'layout' && layoutState.tileSelection.value != null"
      :show-preview-mode-toggle="showPreviewModeToggle"
      :render-mode="layoutState.renderMode.value"
      :can-switch-to-layout-mode="canSwitchToLayoutMode"
      :tile-cache-ready="currentLayoutTileCacheReady"
      :tile-generate-confirm-reset-key="route.path"
      :preview-mode-switch-busy="previewModeSwitchBusy"
      @toolChange="onToolChange"
      @generateTiles="onGenerateTilesFromToolbar"
      @previewModeChange="onPreviewModeChange"
    />

    <div class="relative flex-1 overflow-hidden">
      <EditorContainer @ready="onEditorReady" />

      <!-- Loading overlay -->
      <div
        v-if="layoutState.loadingState.value === 'loading'"
        class="absolute inset-0 flex items-center justify-center bg-black/40 z-10"
      >
        <div class="flex flex-col items-center gap-2 text-white/80 text-sm">
          <div class="w-6 h-6 border-2 border-white/30 border-t-white/80 rounded-full animate-spin"></div>
          <span>{{ layoutState.loadingMessage.value || 'Loading...' }}</span>
        </div>
      </div>

      <!-- Error state -->
      <div
        v-if="layoutState.loadingState.value === 'error'"
        class="absolute bottom-4 left-4 px-3 py-2 bg-red-900/80 text-red-200 text-xs rounded z-10"
      >
        Load error: {{ layoutState.loadingMessage.value }}
      </div>

      <!-- 有选中时展示：底部居中、标尺上方，版图快捷键（可点击） -->
      <div
        v-if="showLayoutHotkeyBar"
        class="absolute left-1/2 z-30 max-w-[min(100%,56rem)] -translate-x-1/2 pointer-events-none px-3"
        :style="{ bottom: `${LAYOUT_HOTKEY_BAR_BOTTOM_PX}px` }"
      >
        <div
          class="pointer-events-auto flex flex-wrap items-center justify-center gap-x-1 gap-y-1 rounded-lg border border-(--border-color) bg-(--bg-primary)/95 px-2 py-1.5 shadow-lg"
          role="toolbar"
          aria-label="版图快捷键"
        >
          <button
            type="button"
            class="rounded border border-(--border-color) bg-(--bg-secondary) px-1.5 py-0.5 font-mono text-[10px] leading-tight text-(--text-primary) hover:bg-(--bg-hover) sm:text-[11px]"
            title="放置模式：退出放置；否则：清除选中"
            @click="dispatchEscapeKey"
          >
            Esc
          </button>
          <button
            type="button"
            class="rounded border border-(--border-color) bg-(--bg-secondary) px-1.5 py-0.5 font-mono text-[10px] leading-tight text-(--text-primary) hover:bg-(--bg-hover) disabled:cursor-not-allowed disabled:opacity-40 sm:text-[11px]"
            :disabled="!hotkeyRApplicable"
            title="旋转（R）：选中 instance 原地旋转 / 放置模式切换朝向"
            @click="dispatchRotateKey"
          >
            R
          </button>
          <button
            type="button"
            class="rounded border border-(--border-color) bg-(--bg-secondary) px-1.5 py-0.5 font-mono text-[10px] leading-tight text-(--text-primary) hover:bg-(--bg-hover) disabled:cursor-not-allowed disabled:opacity-40 sm:text-[11px]"
            :disabled="!hotkeyCApplicable"
            title="选中 instance：复制 cell 并进入放置（C）"
            @click="dispatchPlaceKey"
          >
            C
          </button>
          <button
            type="button"
            class="rounded border border-(--border-color) bg-(--bg-secondary) px-1.5 py-0.5 font-mono text-[10px] leading-tight text-(--text-primary) hover:bg-(--bg-hover) disabled:cursor-not-allowed disabled:opacity-40 sm:text-[11px]"
            :disabled="!hotkeyDeleteApplicable"
            title="删除（Delete）"
            @click="dispatchDeleteKey"
          >
            Del
          </button>
          <button
            type="button"
            class="rounded border border-(--border-color) bg-(--bg-secondary) px-1.5 py-0.5 font-mono text-[10px] leading-tight text-(--text-primary) hover:bg-(--bg-hover) disabled:cursor-not-allowed disabled:opacity-40 sm:text-[11px]"
            :disabled="!hotkeyDeleteApplicable"
            title="删除（Backspace）"
            @click="dispatchBackspaceKey"
          >
            ⌫
          </button>
          <button
            type="button"
            class="rounded border border-(--border-color) bg-(--bg-secondary) px-1.5 py-0.5 font-mono text-[10px] leading-tight text-(--text-primary) hover:bg-(--bg-hover) sm:text-[11px]"
            title="撤销（Ctrl+Z）"
            @click="dispatchUndoChord"
          >
            {{ isMacPlatform() ? '⌘Z' : 'Ctrl+Z' }}
          </button>
          <button
            type="button"
            class="rounded border border-(--border-color) bg-(--bg-secondary) px-1.5 py-0.5 font-mono text-[10px] leading-tight text-(--text-primary) hover:bg-(--bg-hover) sm:text-[11px]"
            :title="isMacPlatform() ? '重做（⇧⌘Z）' : '重做（Ctrl+Y）'"
            @click="dispatchRedoChord"
          >
            {{ isMacPlatform() ? '⇧⌘Z' : 'Ctrl+Y' }}
          </button>
          <button
            type="button"
            class="rounded border border-(--accent-color)/40 bg-(--accent-color)/15 px-1.5 py-0.5 font-mono text-[10px] leading-tight text-(--text-primary) hover:bg-(--accent-color)/25 disabled:cursor-not-allowed disabled:opacity-40 sm:text-[11px]"
            :disabled="!hotkeyFitApplicable"
            title="适应选中（F）"
            aria-label="适应选中到视口（F）"
            @click="handleFitToView"
          >
            F
          </button>
        </div>
      </div>

      <!-- 鼠标 EDA 坐标（屏幕 → 世界 → 显示） -->
      <div
        class="absolute top-2 right-2 z-20 flex flex-col items-end gap-1 pointer-events-none"
      >
        <div
          v-if="cursorEda"
          class="rounded border border-(--border-color) bg-(--bg-primary)/90 px-2 py-1 font-mono text-[11px] text-(--text-primary) tabular-nums shadow-sm"
        >
          <span class="text-(--text-secondary)">X</span> {{ formatCursorCoord(cursorEda.x) }}
          <span class="ml-2 text-(--text-secondary)">Y</span> {{ formatCursorCoord(cursorEda.y) }}
        </div>
        <div
          v-if="layoutState.renderMode.value === 'layout'"
          class="px-2 py-1 bg-green-900/60 text-green-300 text-[10px] rounded"
        >
          Layout Mode
        </div>
      </div>
    </div>
  </div>
</template>
