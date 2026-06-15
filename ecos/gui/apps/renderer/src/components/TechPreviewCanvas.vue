<script setup lang="ts">
import { Application, Container, Graphics } from 'pixi.js'
import { markRaw, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { TechCellMaster, TechLayer, TechPreviewGeometry, TechViaMaster } from '@/applications/editor/tech-library/types'
import { buildCellPreviewGeometry, buildViaPreviewGeometry } from '@/applications/editor/tech-library/previewGeometry'
import { buildTechPreviewRenderGroups } from '@/applications/editor/tech-library/previewRendering'

const props = defineProps<{
  mode: 'cell' | 'via' | 'empty'
  cell?: TechCellMaster | null
  via?: TechViaMaster | null
  layers?: TechLayer[]
}>()

const host = ref<HTMLDivElement | null>(null)
let app: Application | null = null
let root: Container | null = null
let resizeObserver: ResizeObserver | null = null

async function ensurePixi(): Promise<void> {
  if (!host.value || app) return
  const bounds = host.value.getBoundingClientRect()
  app = markRaw(new Application())
  await app.init({
    width: Math.max(1, Math.floor(bounds.width)),
    height: Math.max(1, Math.floor(bounds.height)),
    backgroundAlpha: 0,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  })
  root = markRaw(new Container())
  app.stage.addChild(root)
  host.value.appendChild(app.canvas as HTMLCanvasElement)
  resizeObserver = new ResizeObserver(() => resizeCanvas())
  resizeObserver.observe(host.value)
}

function resizeCanvas(): void {
  if (!host.value || !app) return
  const bounds = host.value.getBoundingClientRect()
  app.renderer.resize(Math.max(1, Math.floor(bounds.width)), Math.max(1, Math.floor(bounds.height)))
  draw()
}

function geometryForSelection(): TechPreviewGeometry | null {
  if (props.mode === 'cell' && props.cell) return buildCellPreviewGeometry(props.cell)
  if (props.mode === 'via' && props.via) return buildViaPreviewGeometry(props.via)
  return null
}

function fitGraphics(g: Graphics, geometry: TechPreviewGeometry): void {
  if (!app) return
  const screenW = app.screen.width
  const screenH = app.screen.height
  const padding = 26
  const scale = Math.min(
    (screenW - padding * 2) / Math.max(geometry.bounds.w, 1),
    (screenH - padding * 2) / Math.max(geometry.bounds.h, 1),
  )
  g.scale.set(Math.max(scale, 0.001))
  g.position.set(
    (screenW - geometry.bounds.w * g.scale.x) / 2,
    (screenH - geometry.bounds.h * g.scale.y) / 2,
  )
}

function draw(): void {
  if (!root) return
  root.removeChildren().forEach((child) => child.destroy())
  const geometry = geometryForSelection()
  if (!geometry) return

  const boundsGraphics = new Graphics()
  boundsGraphics.rect(geometry.bounds.x, geometry.bounds.y, geometry.bounds.w, geometry.bounds.h)
    .fill({ color: 0x111827, alpha: 0.12 })
    .stroke({ color: 0x9ca3af, alpha: 0.75, width: 1 })
  fitGraphics(boundsGraphics, geometry)
  root.addChild(boundsGraphics)

  const groups = buildTechPreviewRenderGroups(geometry, props.layers ?? [])
  for (const group of groups) {
    const g = new Graphics()
    for (const rect of group.drawRects) {
      g.rect(rect.x, rect.y, rect.w, rect.h)
    }
    g.fill({ color: group.color, alpha: group.fillAlpha })
    g.stroke({ color: group.color, alpha: group.strokeAlpha, width: 1 })
    fitGraphics(g, geometry)
    root.addChild(g)
  }
}

watch(
  () => [props.mode, props.cell?.id, props.via?.id, props.layers?.length ?? 0],
  async () => {
    await nextTick()
    await ensurePixi()
    draw()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  app?.destroy(true, { children: true })
  app = null
  root = null
})
</script>

<template>
  <div ref="host" class="tech-preview-canvas">
    <div v-if="mode === 'empty'" class="preview-empty">
      <i class="ri-crosshair-2-line"></i>
      <span>Select a via or cell master</span>
    </div>
  </div>
</template>

<style scoped>
.tech-preview-canvas {
  position: relative;
  width: 100%;
  height: 280px;
  min-height: 220px;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-primary) 64%, var(--bg-secondary));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--bg-primary) 72%, transparent);
}

.tech-preview-canvas :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
}

.preview-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 12px;
}

.preview-empty i {
  font-size: 26px;
  opacity: 0.8;
}
</style>
