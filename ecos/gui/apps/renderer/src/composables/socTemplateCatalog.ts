import { waitForDesktopApi } from '@/platform/desktop'
import { readRemoteJsonFile } from '@/services/remoteContentClient'
import { buildSocPreviewRects } from './socTemplatePreviewRenderer'
import {
  normalizeSocTemplateDetail,
  toSocTemplateSummary,
  type SocTemplateDetail,
  type SocTemplateSummary,
  type SocTemplateThumbnailLayout,
} from './socTemplateMapper'

const SOC_TEMPLATE_SOURCE = 'socTemplateCatalog' as const
const SOC_TEMPLATE_MANIFEST_PATH = 'manifest.json'
const SELECTED_CORE_SETTING_PREFIX = 'ecos.socTemplate.selectedCore.'
const SOC_TEMPLATE_CATALOG_LOAD_FAILED_MESSAGE = 'SoC template catalog load failed. Check the network connection or retry.'
const IMPORTED_SOC_STORAGE_KEY = 'ecos.imported_soc_templates_v1'
const REMOVED_SOC_STORAGE_KEY = 'ecos.removed_soc_templates_v1'

type RemoteSocTemplateIndexEntry = {
  id: string
  path: string
  sourceLabel: string
  detail: SocTemplateDetail
}

type SocTemplateManifest = {
  templates?: SocTemplateManifestTemplate[]
}

type SocTemplateManifestTemplate = {
  variants?: SocTemplateManifestVariant[]
}

type SocTemplateManifestVariant = {
  id?: unknown
  display_name?: unknown
  metadata?: unknown
}

type ImportedSocRecord = {
  id: string
  sourceLabel: string
  rawJson: string
  importedAt: string
}

let cachedIndex: RemoteSocTemplateIndexEntry[] | null = null
let cachedIndexPromise: Promise<RemoteSocTemplateIndexEntry[]> | null = null

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

function loadJsonArray<T>(
  key: string,
  isValid: (value: unknown) => value is T,
): T[] {
  const storage = getLocalStorage()
  if (!storage) return []

  try {
    const raw = storage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValid)
  } catch {
    return []
  }
}

function persistJsonValue(key: string, value: unknown): void {
  const storage = getLocalStorage()
  if (!storage) return

  try {
    storage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore quota */
  }
}

function isImportedSocRecord(value: unknown): value is ImportedSocRecord {
  return typeof value === 'object'
    && value !== null
    && typeof (value as ImportedSocRecord).id === 'string'
    && typeof (value as ImportedSocRecord).sourceLabel === 'string'
    && typeof (value as ImportedSocRecord).rawJson === 'string'
}

function loadImportedRecords(): ImportedSocRecord[] {
  return loadJsonArray(IMPORTED_SOC_STORAGE_KEY, isImportedSocRecord)
}

function persistImportedRecords(records: ImportedSocRecord[]): void {
  persistJsonValue(IMPORTED_SOC_STORAGE_KEY, records)
}

function loadRemovedTemplateIds(): Set<string> {
  return new Set(loadJsonArray(REMOVED_SOC_STORAGE_KEY, (value): value is string => typeof value === 'string'))
}

function persistRemovedTemplateIds(ids: Set<string>): void {
  persistJsonValue(REMOVED_SOC_STORAGE_KEY, Array.from(ids))
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

function selectedCoreSettingKey(sourceLabel: string): string {
  return `${SELECTED_CORE_SETTING_PREFIX}${sourceLabel}`
}

function applySelectedCoreOverride(
  detail: SocTemplateDetail,
  selectedCoreId: number | null,
): SocTemplateDetail {
  if (selectedCoreId == null) return detail

  return {
    ...detail,
    cores: detail.cores.map(core => ({
      ...core,
      selected: core.id === selectedCoreId ? 1 : 0,
    })),
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.length > 0) return error
  return String(error)
}

function createCatalogLoadError(error: unknown): Error {
  return new Error(`${SOC_TEMPLATE_CATALOG_LOAD_FAILED_MESSAGE} ${getErrorMessage(error)}`)
}

async function loadRemoteSocTemplateIndexRaw(): Promise<RemoteSocTemplateIndexEntry[]> {
  const manifest = await readRemoteJsonFile<SocTemplateManifest>({
    source: SOC_TEMPLATE_SOURCE,
    path: SOC_TEMPLATE_MANIFEST_PATH,
  })

  const variants = (manifest.templates ?? [])
    .flatMap(template => template.variants ?? [])
    .filter((variant): variant is SocTemplateManifestVariant & { id: string; metadata: string } =>
      typeof variant.id === 'string'
      && variant.id.length > 0
      && typeof variant.metadata === 'string'
      && variant.metadata.length > 0,
    )

  const entries = await Promise.all(variants.map(async (variant) => {
    const metadataPath = variant.metadata
    const sourceLabel = `remote:${SOC_TEMPLATE_SOURCE}/${metadataPath}`
    const raw = await readRemoteJsonFile<Record<string, unknown>>({
      source: SOC_TEMPLATE_SOURCE,
      path: metadataPath,
    })
    const detail = normalizeSocTemplateDetail(raw, sourceLabel)
    const displayName = typeof variant.display_name === 'string' && variant.display_name.length > 0
      ? variant.display_name
      : detail.name

    return {
      id: variant.id,
      path: metadataPath,
      sourceLabel,
      detail: {
        ...detail,
        id: variant.id,
        name: displayName,
      },
    }
  }))

  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      throw new Error(`Duplicate SoC template id from remote catalog: ${entry.id}`)
    }
    seen.add(entry.id)
  }

  return entries
}

async function loadRemoteSocTemplateIndex(): Promise<RemoteSocTemplateIndexEntry[]> {
  if (cachedIndex) return cachedIndex
  cachedIndexPromise ??= loadRemoteSocTemplateIndexRaw()
    .then((entries) => {
      cachedIndex = entries
      return entries
    })
    .catch((error) => {
      throw createCatalogLoadError(error)
    })
    .finally(() => {
      cachedIndexPromise = null
    })

  return await cachedIndexPromise
}

export function clearSocTemplateCatalogCache(): void {
  cachedIndex = null
  cachedIndexPromise = null
}

export async function importSocTemplateFromJsonText(jsonText: string, sourceLabel: string): Promise<SocTemplateSummary> {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new Error('File is not valid JSON.')
  }

  const detail = normalizeSocTemplateDetail(parsed as Record<string, unknown>, sourceLabel)
  const remoteEntries = await loadRemoteSocTemplateIndex().catch(() => [] as RemoteSocTemplateIndexEntry[])
  const importedRecords = loadImportedRecords()
  const removedIds = loadRemovedTemplateIds()

  if (remoteEntries.some(entry => entry.id === detail.id) || importedRecords.some(record => record.id === detail.id)) {
    throw new Error(`A template named "${detail.id}" is already available. Remove it first or use a different design_name.`)
  }

  importedRecords.push({
    id: detail.id,
    sourceLabel,
    rawJson: jsonText,
    importedAt: new Date().toISOString(),
  })
  removedIds.delete(detail.id)
  persistImportedRecords(importedRecords)
  persistRemovedTemplateIds(removedIds)

  return catalogSummaryFromDetail(detail)
}

export function removeImportedSocTemplate(templateId: string): void {
  const importedRecords = loadImportedRecords().filter(record => record.id !== templateId)
  const removedIds = loadRemovedTemplateIds()
  removedIds.add(templateId)
  persistImportedRecords(importedRecords)
  persistRemovedTemplateIds(removedIds)
}

export async function reloadSocTemplateCatalog(): Promise<SocTemplateSummary[]> {
  clearSocTemplateCatalogCache()
  return await loadSocTemplateCatalog()
}

export async function loadSocTemplateCatalog(): Promise<SocTemplateSummary[]> {
  const removedIds = loadRemovedTemplateIds()
  const remoteEntries = await loadRemoteSocTemplateIndex()
  const remoteItems = remoteEntries
    .filter(entry => !removedIds.has(entry.id))
    .map(entry => catalogSummaryFromDetail(entry.detail))
  const importedItems = loadImportedRecords()
    .filter(record => !removedIds.has(record.id))
    .map(importedSummaryFromRecord)

  return [...remoteItems, ...importedItems]
}

export async function loadSocTemplateDetail(templateId: string): Promise<SocTemplateDetail> {
  const removedIds = loadRemovedTemplateIds()
  if (removedIds.has(templateId)) {
    throw new Error(`Unknown SoC template: ${templateId}`)
  }

  const importedRecord = loadImportedRecords().find(record => record.id === templateId)
  if (importedRecord) {
    const detail = normalizeSocTemplateDetail(
      JSON.parse(importedRecord.rawJson) as Record<string, unknown>,
      importedRecord.sourceLabel,
    )
    return {
      ...detail,
      id: importedRecord.id,
    }
  }

  const entries = await loadRemoteSocTemplateIndex()
  const entry = entries.find((row) => row.id === templateId)
  if (!entry) {
    throw new Error(`Unknown SoC template: ${templateId}`)
  }

  const api = await waitForDesktopApi()
  const selectedCoreId = await api.settings.get<number>(selectedCoreSettingKey(entry.sourceLabel))
  return applySelectedCoreOverride(entry.detail, selectedCoreId)
}

export async function selectSocTemplateCore(
  templateId: string,
  coreId: number,
): Promise<SocTemplateDetail> {
  const entries = await loadRemoteSocTemplateIndex()
  const entry = entries.find((row) => row.id === templateId)
  if (!entry) {
    throw new Error(`Unknown SoC template: ${templateId}`)
  }
  if (!entry.detail.cores.some(core => core.id === coreId)) {
    throw new Error(`Unknown SoC core: ${coreId}`)
  }

  const api = await waitForDesktopApi()
  await api.settings.set(selectedCoreSettingKey(entry.sourceLabel), coreId)
  return applySelectedCoreOverride(entry.detail, coreId)
}
