<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { TechCellMaster, TechLayer, TechPreviewGeometry, TechViaMaster } from '@/applications/editor/tech-library/types'
import { buildCellPreviewGeometry, buildViaPreviewGeometry } from '@/applications/editor/tech-library/previewGeometry'
import { buildTechPreviewRenderGroups } from '@/applications/editor/tech-library/previewRendering'
import { colorNumberToCss } from '@/applications/image-preview/themeUtils'

const props = defineProps<{
  mode: 'cell' | 'via' | 'empty'
  cell?: TechCellMaster | null
  via?: TechViaMaster | null
  layers?: TechLayer[]
}>()

const host = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
let resizeObserver: ResizeObserver | null = null
let screenWidth = 0
let screenHeight = 0
let devicePixelRatio = 1

function geometryForSelection(): TechPreviewGeometry | null {
  if (props.mode === 'cell' && props.cell) return buildCellPreviewGeometry(props.cell)
  if (props.mode === 'via' && props.via) return buildViaPreviewGeometry(props.via)
  return null
}

function ensureCanvasSize(width: number, height: number): CanvasRenderingContext2D | null {
  const canvas = canvasRef.value
  if (!canvas) return null

  screenWidth = Math.max(1, Math.floor(width))
  screenHeight = Math.max(1, Math.floor(height))
  devicePixelRatio = window.devicePixelRatio || 1
  canvas.width = Math.max(1, Math.floor(screenWidth * devicePixelRatio))
  canvas.height = Math.max(1, Math.floor(screenHeight * devicePixelRatio))
  canvas.style.width = `${screenWidth}px`
  canvas.style.height = `${screenHeight}px`
  return canvas.getContext('2d')
}

function fitTransform(geometry: TechPreviewGeometry): { scale: number; offsetX: number; offsetY: number } {
  const padding = 26
  const scale = Math.min(
    (screenWidth - padding * 2) / Math.max(geometry.bounds.w, 1),
    (screenHeight - padding * 2) / Math.max(geometry.bounds.h, 1),
  )
  const safeScale = Math.max(scale, 0.001)
  return {
    scale: safeScale,
    offsetX: (screenWidth - geometry.bounds.w * safeScale) / 2,
    offsetY: (screenHeight - geometry.bounds.h * safeScale) / 2,
  }
}

function drawRectGroup(
  ctx: CanvasRenderingContext2D,
  transform: { scale: number; offsetX: number; offsetY: number },
  color: number,
  fillAlpha: number,
  strokeAlpha: number,
  rects: Array<{ x: number; y: number; w: number; h: number }>,
): void {
  ctx.save()
  ctx.translate(transform.offsetX, transform.offsetY)
  ctx.scale(transform.scale, transform.scale)
  ctx.fillStyle = colorNumberToCss(color)
  ctx.globalAlpha = fillAlpha
  for (const rect of rects) {
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
  }
  ctx.globalAlpha = strokeAlpha
  ctx.strokeStyle = colorNumberToCss(color)
  ctx.lineWidth = 1 / transform.scale
  for (const rect of rects) {
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h)
  }
  ctx.restore()
}

function draw(): void {
  const hostEl = host.value
  const canvas = canvasRef.value
  if (!hostEl || !canvas) return

  const bounds = hostEl.getBoundingClientRect()
  const ctx = ensureCanvasSize(bounds.width, bounds.height)
  if (!ctx) return

  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
  ctx.clearRect(0, 0, screenWidth, screenHeight)

  const geometry = geometryForSelection()
  if (!geometry) return

  const transform = fitTransform(geometry)

  drawRectGroup(
    ctx,
    transform,
    0x9ca3af,
    0.12,
    0.75,
    [{ x: geometry.bounds.x, y: geometry.bounds.y, w: geometry.bounds.w, h: geometry.bounds.h }],
  )

  const groups = buildTechPreviewRenderGroups(geometry, props.layers ?? [])
  for (const group of groups) {
    drawRectGroup(
      ctx,
      transform,
      group.color,
      group.fillAlpha,
      group.strokeAlpha,
      group.drawRects,
    )
  }
}

watch(
  () => [props.mode, props.cell?.id, props.via?.id, props.layers?.length ?? 0],
  async () => {
    await nextTick()
    draw()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})

watch(host, (hostEl, _, onCleanup) => {
  resizeObserver?.disconnect()
  resizeObserver = null
  if (!hostEl) return

  resizeObserver = new ResizeObserver(() => draw())
  resizeObserver.observe(hostEl)
  draw()

  onCleanup(() => {
    resizeObserver?.disconnect()
    resizeObserver = null
  })
}, { immediate: true })
</script>

<template>
  <div ref="host" class="tech-preview-canvas">
    <canvas ref="canvasRef" class="tech-preview-canvas__surface" />
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

.tech-preview-canvas__surface {
  position: absolute;
  inset: 0;
  display: block;
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
  pointer-events: none;
}

.preview-empty i {
  font-size: 26px;
  opacity: 0.8;
}
</style>
