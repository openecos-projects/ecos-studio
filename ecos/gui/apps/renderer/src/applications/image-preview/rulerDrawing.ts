import type { EditorTheme } from '@/applications/editor/core/Theme'
import { RULER_THICKNESS } from '@/applications/editor/core/rulerConfig'
import type { ViewportTransform } from './types'
import { colorNumberToCss } from './themeUtils'

const NICE_MULTIPLIERS = [1, 2, 5]

function calculateTickInterval(scale: number): number {
  const targetScreenInterval = 80
  const worldInterval = targetScreenInterval / scale
  const mag = 10 ** Math.floor(Math.log10(worldInterval))
  for (const m of NICE_MULTIPLIERS) {
    if (m * mag >= worldInterval) return m * mag
  }
  return 10 * mag
}

function formatNumber(value: number): string {
  const abs = Math.abs(value)
  if (abs < 0.01) return '0'
  if (abs >= 1_000_000) {
    const v = value / 1_000_000
    return (Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)) + 'M'
  }
  if (abs >= 10_000) {
    const v = value / 1_000
    return (Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)) + 'K'
  }
  return value.toFixed(0)
}

function drawHorizontalRuler(
  ctx: CanvasRenderingContext2D,
  screenWidth: number,
  screenHeight: number,
  transform: ViewportTransform,
  tickInterval: number,
  thickness: number,
  theme: EditorTheme,
  fontSize: number,
): void {
  const backgroundColor = colorNumberToCss(theme.rulerBackground)
  const tickColor = colorNumberToCss(theme.rulerTickColor)
  const subTickCount = 10
  const subInterval = tickInterval / subTickCount
  const rulerTop = screenHeight - thickness

  ctx.fillStyle = backgroundColor
  ctx.fillRect(thickness, rulerTop, screenWidth - thickness, thickness)

  const worldStartX = -transform.x / transform.scale
  const worldEndX = (screenWidth - transform.x) / transform.scale
  const startTick = Math.floor(worldStartX / tickInterval) * tickInterval

  ctx.strokeStyle = tickColor
  ctx.lineWidth = 1
  ctx.fillStyle = theme.rulerTextColor
  ctx.font = `${fontSize}px JetBrains Mono, Monaco, Consolas, monospace`
  ctx.textBaseline = 'top'

  const labelGap = 12
  const charWidth = fontSize * 0.65
  let lastLabelEndX = -Infinity

  for (let worldX = startTick; worldX <= worldEndX; worldX += subInterval) {
    const screenX = worldX * transform.scale + transform.x
    if (screenX < thickness) continue

    const isMajor = Math.abs(worldX % tickInterval) < 0.01
    const tickHeight = isMajor ? thickness * 0.6 : thickness * 0.3

    ctx.beginPath()
    ctx.moveTo(screenX, rulerTop + thickness - tickHeight)
    ctx.lineTo(screenX, rulerTop + thickness)
    ctx.stroke()

    if (isMajor && screenX >= lastLabelEndX + labelGap) {
      const text = formatNumber(worldX)
      ctx.fillText(text, screenX + 2, rulerTop + 2)
      lastLabelEndX = screenX + 2 + text.length * charWidth
    }
  }
}

function drawVerticalRuler(
  ctx: CanvasRenderingContext2D,
  screenHeight: number,
  worldHeight: number,
  transform: ViewportTransform,
  tickInterval: number,
  thickness: number,
  theme: EditorTheme,
  fontSize: number,
): void {
  const backgroundColor = colorNumberToCss(theme.rulerBackground)
  const tickColor = colorNumberToCss(theme.rulerTickColor)
  const subTickCount = 10
  const subInterval = tickInterval / subTickCount

  ctx.fillStyle = backgroundColor
  ctx.fillRect(0, 0, thickness, screenHeight - thickness)

  ctx.fillStyle = backgroundColor
  ctx.fillRect(0, screenHeight - thickness, thickness, thickness)

  const worldStartY = -transform.y / transform.scale
  const worldEndY = (screenHeight - transform.y) / transform.scale
  const displayMin = worldHeight - worldEndY
  const displayMax = worldHeight - worldStartY
  const startTick = Math.floor(displayMin / subInterval) * subInterval

  ctx.strokeStyle = tickColor
  ctx.lineWidth = 1
  ctx.fillStyle = theme.rulerTextColor
  ctx.font = `${fontSize}px JetBrains Mono, Monaco, Consolas, monospace`

  const minLabelScreenInterval = 40
  let lastLabelScreenY = -Infinity

  for (let displayY = startTick; displayY <= displayMax + 1e-6; displayY += subInterval) {
    const worldY = worldHeight - displayY
    const screenY = worldY * transform.scale + transform.y
    if (screenY >= screenHeight - thickness) continue

    const isMajor =
      Math.abs(displayY / tickInterval - Math.round(displayY / tickInterval)) < 1e-5
    const tickWidth = isMajor ? thickness * 0.6 : thickness * 0.3

    ctx.beginPath()
    ctx.moveTo(thickness - tickWidth, screenY)
    ctx.lineTo(thickness, screenY)
    ctx.stroke()

    if (isMajor && Math.abs(screenY - lastLabelScreenY) >= minLabelScreenInterval) {
      const text = formatNumber(displayY)
      ctx.save()
      ctx.translate(thickness - 4, screenY - 2)
      ctx.rotate(-Math.PI / 2)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'bottom'
      ctx.fillText(text, 0, 0)
      ctx.restore()
      lastLabelScreenY = screenY
    }
  }
}

export function drawRulers(
  ctx: CanvasRenderingContext2D,
  screenWidth: number,
  screenHeight: number,
  worldHeight: number,
  transform: ViewportTransform,
  theme: EditorTheme,
  fontSize = 9,
): void {
  const thickness = RULER_THICKNESS
  const tickInterval = calculateTickInterval(transform.scale)

  drawHorizontalRuler(ctx, screenWidth, screenHeight, transform, tickInterval, thickness, theme, fontSize)
  drawVerticalRuler(
    ctx,
    screenHeight,
    worldHeight,
    transform,
    tickInterval,
    thickness,
    theme,
    fontSize,
  )
}
