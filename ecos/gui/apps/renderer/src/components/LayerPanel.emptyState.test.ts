import { describe, expect, it } from 'vitest'
import source from './LayerPanel.vue?raw'

describe('LayerPanel empty state', () => {
  it('leaves the layer panel body empty when no process layers are available', () => {
    expect(source).not.toContain('尚未加载工艺层')
    expect(source).not.toContain('请生成版图瓦片后')
    expect(source).toContain('v-if="layers.length > 0"')
  })
})
