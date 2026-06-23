import { describe, expect, it } from 'vitest'
import source from './WorkspaceView.vue?raw'

describe('WorkspaceView side panels', () => {
  it('hides the layer/property inspector for view JSON layouts without layer or selection data', () => {
    expect(source).toContain('hasLayoutInspectorContent')
    expect(source).toContain('layoutState.tileLayers.value.length > 0')
    expect(source).toContain('layoutState.tileSelection.value != null')
    expect(source).toContain("layoutState.renderMode.value === 'layout'")
    expect(source).toContain('v-if="hasLayoutInspectorContent"')
    expect(source).not.toContain("computed(() => layoutState.renderMode.value === 'layout')")
  })

  it('keeps the DRC inspector visible even when layer/property content is empty', () => {
    expect(source).toContain('hasDrcInspectorContent')
    expect(source).toContain('const hasDrcInspectorContent = computed(() => isDrcStep.value)')
    expect(source).toContain('hasLayoutInspectorContent.value || hasDrcInspectorContent.value')
    expect(source).toContain(':size="hasLayoutInspectorContent ? 32 : 100"')
  })
})
