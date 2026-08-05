import { describe, expect, it } from 'vitest'
import { previewList } from './projectListPreview'

interface ListItem {
  id: string
}

const items: ListItem[] = Array.from({ length: 24 }, (_, index) => ({
  id: `item_${index + 1}`,
}))

describe('previewList', () => {
  it('caps a long list when it has no selected item outside the preview', () => {
    expect(
      previewList(items, {
        limit: 20,
        showAll: false,
        selectedId: 'item_3',
        getId: (item) => item.id,
      }),
    ).toEqual(items.slice(0, 20))
  })

  it('keeps a selected item visible when it falls outside the preview', () => {
    expect(
      previewList(items, {
        limit: 20,
        showAll: false,
        selectedId: 'item_24',
        getId: (item) => item.id,
      }),
    ).toEqual([...items.slice(0, 20), items[23]])
  })

  it('returns every item for search or an explicit show-all command', () => {
    expect(
      previewList(items, {
        limit: 20,
        showAll: true,
        selectedId: null,
        getId: (item) => item.id,
      }),
    ).toEqual(items)
  })
})
