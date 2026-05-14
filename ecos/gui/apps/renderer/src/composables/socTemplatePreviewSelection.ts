import type { SocTemplateCore, SocTemplateDetail } from './socTemplateMapper'

export function getDefaultSocCoreId(template: SocTemplateDetail): number | null {
  return template.cores.find(core => Number.isFinite(core.id) && core.id >= 0)?.id ?? null
}

export function getSelectedSocCore(
  template: SocTemplateDetail,
  selectedCoreId: number | null,
): SocTemplateCore | null {
  if (selectedCoreId == null) return null

  return template.cores.find(core => core.id === selectedCoreId) ?? null
}
