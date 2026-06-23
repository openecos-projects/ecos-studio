import { describe, expect, it } from 'vitest'
import source from './DrawingToolbar.vue?raw'

describe('DrawingToolbar preview mode toggle', () => {
  it('does not gate the image/layout switch behind tile generation', () => {
    expect(source).toContain('v-if="showPreviewModeToggle || showTileGenerate"')
    expect(source).toMatch(/<button\s+v-if="showPreviewModeToggle"[\s\S]*@click="onUnifiedTileClick"/)
  })

  it('uses copy that reflects the current image/layout switch behavior', () => {
    expect(source).toContain("if (props.renderMode === 'layout') return '切换到步骤预览图'")
    expect(source).toContain("if (props.canSwitchToLayoutMode) return '切换到矢量版图'")
  })
})
