import { describe, expect, it } from 'vitest'
import source from './DrawingToolbar.vue?raw'

describe('DrawingToolbar embedded layout tools', () => {
  it('does not expose image/layout switching or tile generation tools', () => {
    expect(source).not.toContain('showPreviewModeToggle')
    expect(source).not.toContain('showTileGenerate')
    expect(source).not.toContain('tileGenBusy')
    expect(source).not.toContain('tileCacheReady')
    expect(source).not.toContain('generateTiles')
    expect(source).not.toContain('previewModeChange')
    expect(source).not.toContain('onUnifiedTileClick')
    expect(source).not.toContain('requestTileGeneration')
    expect(source).not.toContain('Generate layout tiles?')
  })

  it('does not expose embedded layout selection tool shortcuts', () => {
    expect(source).not.toContain('layoutTileShortcutsHint')
    expect(source).not.toContain('SelectPlugin')
    expect(source).not.toContain("id: 'select'")
    expect(source).not.toContain('setActiveTool')
    expect(source).not.toContain('toolChange')
  })
})
