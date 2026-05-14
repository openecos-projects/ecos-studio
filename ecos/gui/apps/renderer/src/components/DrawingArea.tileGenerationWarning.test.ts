import { describe, expect, it } from 'vitest'
import source from './DrawingArea.vue?raw'
import toolbarSource from './DrawingToolbar.vue?raw'

describe('DrawingArea tile generation warning', () => {
  it('keeps the generation entry free of browser confirm dialogs', () => {
    expect(source).not.toContain('window.confirm')
    expect(source).not.toContain('confirmLayoutTileGeneration')
  })

  it('uses an inline toolbar popover before emitting tile generation', () => {
    expect(source).toContain(':tile-cache-ready="currentLayoutTileCacheReady"')
    expect(toolbarSource).toContain('const showTileGenerateConfirm = ref(false)')
    expect(toolbarSource).toContain('function requestTileGeneration(): void')
    expect(toolbarSource).toContain('function confirmTileGeneration(): void')
    expect(toolbarSource).toContain('tileCacheReady')
    expect(toolbarSource).toContain('Generate layout tiles?')
    expect(toolbarSource).toContain('.ecos/tile-cache')
    expect(toolbarSource).toMatch(
      /function requestTileGeneration\(\): void \{[\s\S]*?if \(props\.tileCacheReady\) \{[\s\S]*?emit\('generateTiles'\)[\s\S]*?return[\s\S]*?\}[\s\S]*?showTileGenerateConfirm\.value = true[\s\S]*?\}/,
    )
    expect(toolbarSource).toMatch(
      /function confirmTileGeneration\(\): void \{[\s\S]*?emit\('generateTiles'\)[\s\S]*?\}/,
    )
  })

  it('closes the inline generation popover when the route context changes', () => {
    expect(source).toContain(':tile-generate-confirm-reset-key="route.path"')
    expect(toolbarSource).toContain('tileGenerateConfirmResetKey?: string')
    expect(toolbarSource).toMatch(
      /watch\(\s*\(\) => props\.tileGenerateConfirmResetKey[\s\S]*?showTileGenerateConfirm\.value = false[\s\S]*?\)/,
    )
  })

  it('ignores stale async cache status responses after the route context changes', () => {
    expect(source).toMatch(
      /async function refreshCurrentLayoutTileCacheStatus\(\): Promise<void> \{[\s\S]*?const projectPath = currentProject\.value\?\.path[\s\S]*?const rel = layoutJsonRelativePath\.value[\s\S]*?const stepKey = currentStepKey\.value[\s\S]*?currentLayoutTileCacheReady\.value = false[\s\S]*?const status = await getLayoutTileGenerationStatus\(\{[\s\S]*?projectPath,[\s\S]*?layoutJsonRelative: rel,[\s\S]*?stepKey,[\s\S]*?\}\)[\s\S]*?if \([\s\S]*?currentProject\.value\?\.path !== projectPath[\s\S]*?layoutJsonRelativePath\.value !== rel[\s\S]*?currentStepKey\.value !== stepKey[\s\S]*?\) \{[\s\S]*?return[\s\S]*?\}[\s\S]*?currentLayoutTileCacheReady\.value = status\.fromCache/,
    )
  })
})
