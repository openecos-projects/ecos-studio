export type SocTemplateRect = {
  llx: number
  lly: number
  urx: number
  ury: number
  width: number
  height: number
  area?: number
}

export type SocTemplateCore = {
  id: number
  name: string
  info: string
  align: string
  orient: string
  selected: number
  boundingBox: SocTemplateRect
}

export type SocTemplateIoPin = {
  name: string
  info: string
  boundingBox: SocTemplateRect
}

export type SocTemplateThumbnailCoreRect = {
  leftPct: number
  topPct: number
  widthPct: number
  heightPct: number
}

/** Mini floorplan for gallery cards: core-area inset on die + core bboxes (same projection as detail preview). */
export type SocTemplateThumbnailLayout = {
  coreSlotLeftPct: number
  coreSlotTopPct: number
  coreSlotWidthPct: number
  coreSlotHeightPct: number
  cores: SocTemplateThumbnailCoreRect[]
}

export type SocTemplateSummary = {
  id: string
  name: string
  info: string
  ioPinsCount: number
  coreCount: number
  sourceLabel: string
  /** Present when the catalog had full template geometry (bundled / imported). */
  thumbnail?: SocTemplateThumbnailLayout
}

export type SocTemplateDetail = SocTemplateSummary & {
  dbu: number
  die: SocTemplateRect
  coreArea: SocTemplateRect
  cores: SocTemplateCore[]
  ioPins: SocTemplateIoPin[]
}

const FALLBACK_INFO = 'No info provided'
const FALLBACK_TEMPLATE_ID = 'unknown-template'
const FALLBACK_CORE_NAME = 'unknown-core'
const FALLBACK_TEXT = 'unknown'
const FALLBACK_DBU = 1000

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null
}

function toRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {}
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }

  return fallback
}

function toText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function normalizeInfo(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : FALLBACK_INFO
}

function normalizeSelected(value: unknown): number {
  return toNumber(value) === 1 ? 1 : 0
}

function normalizeRect(value: unknown): SocTemplateRect {
  const rect = toRecord(value)

  return {
    llx: toNumber(rect.llx),
    lly: toNumber(rect.lly),
    urx: toNumber(rect.urx),
    ury: toNumber(rect.ury),
    width: toNumber(rect.width),
    height: toNumber(rect.height),
    area: toNumber(rect.area),
  }
}

export function normalizeSocTemplateDetail(raw: any, sourceLabel: string): SocTemplateDetail {
  const rawRecord = toRecord(raw)
  const rawCores = toRecord(rawRecord.cores)
  const coreList = Array.isArray(rawCores.list) ? rawCores.list : []
  const hasSelectedCoreId = 'selected_core_id' in rawCores
  const selectedCoreId = hasSelectedCoreId
    ? toNumber(rawCores.selected_core_id, -1)
    : toNumber(rawCores.selected, -1)

  const cores = coreList.map((core): SocTemplateCore => {
    const coreRecord = toRecord(core)
    const id = toNumber(coreRecord.core_id, -1)

    return {
      id,
      name: toText(coreRecord.name, FALLBACK_CORE_NAME),
      info: normalizeInfo(coreRecord.info),
      align: toText(coreRecord.io_align, FALLBACK_TEXT),
      orient: toText(coreRecord.orient, FALLBACK_TEXT),
      selected: selectedCoreId === id ? 1 : hasSelectedCoreId ? 0 : normalizeSelected(coreRecord.selected),
      boundingBox: normalizeRect(coreRecord.bounding_box),
    }
  })

  const rawIoPins = toRecord(rawRecord.io_pins)
  const ioPinList = Array.isArray(rawIoPins.list) ? rawIoPins.list : []
  const ioPins = ioPinList.map((pin): SocTemplateIoPin => {
    const pinRecord = toRecord(pin)
    return {
      name: toText(pinRecord.name, 'io'),
      info: normalizeInfo(pinRecord.info),
      boundingBox: normalizeRect(pinRecord.bounding_box),
    }
  })

  const designName = toText(rawRecord.design_name, FALLBACK_TEMPLATE_ID)

  return {
    id: designName,
    name: designName,
    info: normalizeInfo(rawRecord.info),
    ioPinsCount: toNumber(toRecord(rawRecord.io_pins).number),
    coreCount: toNumber(rawCores.number, cores.length),
    sourceLabel,
    dbu: toNumber(rawRecord.dbu, FALLBACK_DBU),
    die: normalizeRect(rawRecord.die),
    coreArea: normalizeRect(rawRecord.core),
    cores,
    ioPins,
  }
}

export function toSocTemplateSummary(detail: SocTemplateDetail): SocTemplateSummary {
  return {
    id: detail.id,
    name: detail.name,
    info: detail.info,
    ioPinsCount: detail.ioPinsCount,
    coreCount: detail.coreCount,
    sourceLabel: detail.sourceLabel,
  }
}
