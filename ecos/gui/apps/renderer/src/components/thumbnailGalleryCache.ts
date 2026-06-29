export function clearStepTabCache(
  tabInfoCache: Record<string, Record<string, unknown>>,
  tabErrorCache: Record<string, string | null>,
  step: string | undefined,
  checklistItemsCache?: Record<string, unknown[]>,
): void {
  if (!step) return

  for (const key of Object.keys(tabInfoCache).filter(k => k.startsWith(`${step}_`))) {
    delete tabInfoCache[key]
  }

  for (const key of Object.keys(tabErrorCache).filter(k => k.startsWith(`${step}_`))) {
    delete tabErrorCache[key]
  }

  if (checklistItemsCache) {
    for (const key of Object.keys(checklistItemsCache).filter(k => k.startsWith(`${step}_`))) {
      delete checklistItemsCache[key]
    }
  }
}
