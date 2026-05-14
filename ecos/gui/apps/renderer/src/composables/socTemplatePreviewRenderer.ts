import type { SocTemplateDetail, SocTemplateRect } from './socTemplateMapper'

export type SocPreviewRect = {
  coreId: number
  label: string
  leftPct: number
  topPct: number
  widthPct: number
  heightPct: number
  align: string
  orient: string
}

export type SocIoPreviewRect = {
  pinIndex: number
  name: string
  shortLabel: string
  leftPct: number
  topPct: number
  widthPct: number
  heightPct: number
  placement: 'die' | 'ring'
}

function toProjectedPercent(value: number, size: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(size) || size <= 0) {
    return 0
  }

  return (value / size) * 100
}

export function getSocDisplayCoreLabel(coreId: number, name: string): string {
  if (Number.isFinite(coreId) && coreId >= 0) {
    return `core${coreId}`
  }

  return name.split('/').pop() || name
}

export function buildSocPreviewRects(template: SocTemplateDetail): SocPreviewRect[] {
  return template.cores.map(core => ({
    coreId: core.id,
    label: getSocDisplayCoreLabel(core.id, core.name),
    leftPct: toProjectedPercent(core.boundingBox.llx - template.coreArea.llx, template.coreArea.width),
    topPct: toProjectedPercent(template.coreArea.ury - core.boundingBox.ury, template.coreArea.height),
    widthPct: toProjectedPercent(core.boundingBox.width, template.coreArea.width),
    heightPct: toProjectedPercent(core.boundingBox.height, template.coreArea.height),
    align: core.align,
    orient: core.orient,
  }))
}

function hasValidIoBox(bb: SocTemplateRect): boolean {
  return bb.width > 0 && bb.height > 0
}

function shortenIoLabel(name: string): string {
  const t = name.trim()
  if (t.length <= 9) return t
  return `${t.slice(0, 8)}…`
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

/**
 * Ring fallback: elongated rectangles along die edge (horizontal pads on top/bottom, vertical on left/right).
 */
function fallbackPerimeterSlot(
  index: number,
  total: number,
): Pick<SocIoPreviewRect, 'leftPct' | 'topPct' | 'widthPct' | 'heightPct'> {
  const inset = 1.05
  /** Pad thickness toward die interior (% of die side). */
  const thick = 1.25
  /** Pad span along the edge (% of die side). */
  const along = Math.min(4.2, Math.max(1.5, 92 / Math.max(8, total)))

  const innerW = 100 - 2 * inset
  const innerH = 100 - 2 * inset
  const perim = 2 * innerW + 2 * innerH

  if (total <= 0 || perim <= 0) {
    return { leftPct: inset, topPct: inset, widthPct: along, heightPct: thick }
  }

  const dist = ((index + 0.5) / total) * perim

  let s = 0

  // Top — wide rectangle
  if (dist < s + innerW) {
    const t = dist - s
    const cx = inset + t
    return {
      leftPct: clamp(cx - along / 2, inset, inset + innerW - along),
      topPct: inset,
      widthPct: along,
      heightPct: thick,
    }
  }
  s += innerW

  // Right — tall rectangle
  if (dist < s + innerH) {
    const t = dist - s
    const cy = inset + t
    return {
      leftPct: 100 - inset - thick,
      topPct: clamp(cy - along / 2, inset, inset + innerH - along),
      widthPct: thick,
      heightPct: along,
    }
  }
  s += innerH

  // Bottom — wide rectangle (right to left)
  if (dist < s + innerW) {
    const t = dist - s
    const cx = inset + innerW - t
    return {
      leftPct: clamp(cx - along / 2, inset, inset + innerW - along),
      topPct: 100 - inset - thick,
      widthPct: along,
      heightPct: thick,
    }
  }
  s += innerW

  // Left — tall rectangle (bottom to top)
  const t = dist - s
  const cy = inset + innerH - t
  return {
    leftPct: inset,
    topPct: clamp(cy - along / 2, inset, inset + innerH - along),
    widthPct: thick,
    heightPct: along,
  }
}

/**
 * IO pads projected onto the die. Pins with valid bbox use layout coords; others get ring fallback on die edge.
 */
export function buildSocIoPinRects(template: SocTemplateDetail): SocIoPreviewRect[] {
  const die = template.die
  const dw = die.width
  const dh = die.height
  if (!dw || !dh) return []

  const invalidPinIndices: number[] = []
  const placed: SocIoPreviewRect[] = []

  template.ioPins.forEach((pin, pinIndex) => {
    const bb = pin.boundingBox
    if (hasValidIoBox(bb)) {
      placed.push({
        pinIndex,
        name: pin.name,
        shortLabel: shortenIoLabel(pin.name),
        leftPct: toProjectedPercent(bb.llx - die.llx, dw),
        topPct: toProjectedPercent(die.ury - bb.ury, dh),
        widthPct: toProjectedPercent(bb.width, dw),
        heightPct: toProjectedPercent(bb.height, dh),
        placement: 'die',
      })
    } else {
      invalidPinIndices.push(pinIndex)
    }
  })

  const ring: SocIoPreviewRect[] = invalidPinIndices.map((pinIndex, ringIndex) => {
    const pin = template.ioPins[pinIndex]!
    const box = fallbackPerimeterSlot(ringIndex, invalidPinIndices.length)
    return {
      pinIndex,
      name: pin.name,
      shortLabel: shortenIoLabel(pin.name),
      ...box,
      placement: 'ring',
    }
  })

  return [...placed, ...ring]
}

function normalizeDbu(dbu: number): number {
  return Number.isFinite(dbu) && dbu > 0 ? dbu : 1
}

function formatMicronValue(value: number): string {
  if (!Number.isFinite(value)) return '0'

  const fixed = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(3)
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed
}

export function formatSocBoundingBox(box: SocTemplateRect, dbu = 1): string {
  const d = normalizeDbu(dbu)
  return [box.llx, box.lly, box.urx, box.ury].map(value => formatMicronValue(value / d)).join(', ')
}

export function formatSocArea(area: number | undefined, dbu = 1): string {
  const d = normalizeDbu(dbu)
  return formatMicronValue((area ?? 0) / (d * d))
}
