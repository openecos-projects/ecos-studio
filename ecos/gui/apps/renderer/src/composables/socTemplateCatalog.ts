/**
 * SoC 模板目录（当前：仅浏览器 localStorage 中的用户导入 JSON）。
 *
 * TODO(soc-api): 用后端接口替换本地导入为主的流程：
 * - `loadSocTemplateCatalog` → GET 列表（摘要 + thumbnail 所需字段）
 * - `loadSocTemplateDetail` → GET 单模板完整 JSON / 或结构化 DTO
 * - 保留可选「导出/离线 JSON」或调试导入作为辅助能力
 *
 * 已移除：从 `public/ysyxSoCASIC.json` 拉取固定模板的开发用逻辑。
 */

import { buildSocPreviewRects } from './socTemplatePreviewRenderer'
import {
  normalizeSocTemplateDetail,
  toSocTemplateSummary,
  type SocTemplateDetail,
  type SocTemplateSummary,
  type SocTemplateThumbnailLayout,
} from './socTemplateMapper'

const IMPORTED_SOC_STORAGE_KEY = 'ecos.imported_soc_templates_v1'

type ImportedSocRecord = {
  id: string
  sourceLabel: string
  rawJson: string
  importedAt: string
}

function getLocalStorage(): Storage | null {
  if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) {
    return null
  }
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function loadImportedRecords(): ImportedSocRecord[] {
  const storage = getLocalStorage()
  if (!storage) return []

  try {
    const raw = storage.getItem(IMPORTED_SOC_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (row): row is ImportedSocRecord =>
        typeof row === 'object' &&
        row !== null &&
        typeof (row as ImportedSocRecord).id === 'string' &&
        typeof (row as ImportedSocRecord).rawJson === 'string' &&
        typeof (row as ImportedSocRecord).sourceLabel === 'string',
    )
  } catch {
    return []
  }
}

function persistImportedRecords(records: ImportedSocRecord[]): void {
  const storage = getLocalStorage()
  if (!storage) return

  try {
    storage.setItem(IMPORTED_SOC_STORAGE_KEY, JSON.stringify(records))
  } catch {
    /* ignore quota */
  }
}

function thumbnailLayoutFromDetail(detail: SocTemplateDetail): SocTemplateThumbnailLayout | undefined {
  const { die, coreArea: c } = detail
  const dw = die.width
  const dh = die.height
  if (!dw || !dh) return undefined

  return {
    coreSlotLeftPct: ((c.llx - die.llx) / dw) * 100,
    coreSlotTopPct: ((die.ury - c.ury) / dh) * 100,
    coreSlotWidthPct: (c.width / dw) * 100,
    coreSlotHeightPct: (c.height / dh) * 100,
    cores: buildSocPreviewRects(detail).map(r => ({
      leftPct: r.leftPct,
      topPct: r.topPct,
      widthPct: r.widthPct,
      heightPct: r.heightPct,
    })),
  }
}

function catalogSummaryFromDetail(detail: SocTemplateDetail): SocTemplateSummary {
  return {
    ...toSocTemplateSummary(detail),
    thumbnail: thumbnailLayoutFromDetail(detail),
  }
}

function importedSummaryFromRecord(rec: ImportedSocRecord): SocTemplateSummary {
  const detail = normalizeSocTemplateDetail(JSON.parse(rec.rawJson) as Record<string, unknown>, rec.sourceLabel)
  return catalogSummaryFromDetail({ ...detail, id: rec.id })
}

/**
 * Parse and persist a user-provided SoC template JSON file (soc export schema).
 */
export function importSocTemplateFromJsonText(jsonText: string, sourceLabel: string): SocTemplateSummary {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new Error('File is not valid JSON.')
  }

  const detail = normalizeSocTemplateDetail(parsed as Record<string, unknown>, sourceLabel)

  const records = loadImportedRecords()
  if (records.some((r) => r.id === detail.id)) {
    throw new Error(`A template named "${detail.id}" is already imported. Remove it first or use a different design_name.`)
  }

  records.push({
    id: detail.id,
    sourceLabel,
    rawJson: jsonText,
    importedAt: new Date().toISOString(),
  })
  persistImportedRecords(records)

  return catalogSummaryFromDetail(detail)
}

export function removeImportedSocTemplate(templateId: string): void {
  const next = loadImportedRecords().filter((r) => r.id !== templateId)
  persistImportedRecords(next)
}

export async function loadSocTemplateDetail(templateId: string): Promise<SocTemplateDetail> {
  const rec = loadImportedRecords().find((r) => r.id === templateId)
  if (!rec) {
    throw new Error(`Unknown SoC template: ${templateId}`)
  }

  const detail = normalizeSocTemplateDetail(JSON.parse(rec.rawJson) as Record<string, unknown>, rec.sourceLabel)
  return {
    ...detail,
    id: rec.id,
  }
}

/** Catalog from locally imported templates only until `soc-api` is implemented. */
export async function loadSocTemplateCatalog(): Promise<SocTemplateSummary[]> {
  return loadImportedRecords().map((rec) => importedSummaryFromRecord(rec))
}
