export interface PreviewListOptions<Item> {
  limit: number
  showAll: boolean
  selectedId: string | null
  getId: (item: Item) => string
}

/**
 * Caps a navigation list without making the current selection disappear from view.
 * Search and an explicit "show all" command pass `showAll: true`.
 */
export function previewList<Item>(
  items: readonly Item[],
  options: PreviewListOptions<Item>,
): Item[] {
  const allItems = [...items]
  if (options.showAll || options.limit < 1 || allItems.length <= options.limit) {
    return allItems
  }

  const visibleItems = allItems.slice(0, options.limit)
  const selected = options.selectedId
    ? allItems.find((item) => options.getId(item) === options.selectedId)
    : undefined

  return selected &&
    !visibleItems.some((item) => options.getId(item) === options.selectedId)
    ? [...visibleItems, selected]
    : visibleItems
}
