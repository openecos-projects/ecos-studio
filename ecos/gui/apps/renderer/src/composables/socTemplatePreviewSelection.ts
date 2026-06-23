import type { SocTemplateCore, SocTemplateDetail } from './socTemplateMapper'

export function getDefaultSocCoreId(template: SocTemplateDetail): number | null {
  const selectedCore = template.cores.find(
    core => core.selected === 1 && Number.isFinite(core.id) && core.id >= 0,
  )

  return selectedCore?.id ?? template.cores.find(core => Number.isFinite(core.id) && core.id >= 0)?.id ?? null
}

export function getSelectedSocCore(
  template: SocTemplateDetail,
  selectedCoreId: number | null,
): SocTemplateCore | null {
  if (selectedCoreId == null) return null

  return template.cores.find(core => core.id === selectedCoreId) ?? null
}
