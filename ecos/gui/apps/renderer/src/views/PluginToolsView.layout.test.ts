import { describe, expect, it } from 'vitest'
import pluginToolsViewSource from './PluginToolsView.vue?raw'

describe('PluginToolsView resource table layout', () => {
  it('keeps the resource table from showing a horizontal scrollbar', () => {
    expect(pluginToolsViewSource).toMatch(
      /\.resource-table-scroll\s*\{[\s\S]*overflow-x:\s*hidden;[\s\S]*overflow-y:\s*auto;/,
    )
    expect(pluginToolsViewSource).not.toContain('.resource-table {\n  min-width: 680px;')
  })
})
