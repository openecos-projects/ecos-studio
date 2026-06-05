import { describe, expect, it } from 'vitest'
import pluginToolsViewSource from './PluginToolsView.vue?raw'

describe('PluginToolsView resource table layout', () => {
  it('keeps the resource table from showing a horizontal scrollbar', () => {
    expect(pluginToolsViewSource).toMatch(
      /\.resource-table-scroll\s*\{[\s\S]*overflow-x:\s*hidden;[\s\S]*overflow-y:\s*auto;/,
    )
    expect(pluginToolsViewSource).not.toContain('.resource-table {\n  min-width: 680px;')
  })

  it('renders mini progress with a transform driven by the row progress percent', () => {
    expect(pluginToolsViewSource).toContain(
      ":style=\"{ '--progress': row.progressPercent / 100 }\"",
    )
    expect(pluginToolsViewSource).toMatch(
      /\.mini-progress span\s*\{[\s\S]*transform:\s*scaleX\(var\(--progress,\s*0\)\);/,
    )
  })

  it('uses only a lightweight background blur and avoids backdrop blur', () => {
    expect(pluginToolsViewSource).toMatch(
      /\.blurred-home\s*\{[\s\S]*filter:\s*blur\(1\.5px\)\s+brightness\(0\.82\);/,
    )
    expect(pluginToolsViewSource).toMatch(
      /\.blurred-home\s*\{[\s\S]*transform:\s*translateZ\(0\)\s+scale\(1\.006\);/,
    )
    expect(pluginToolsViewSource).not.toContain('backdrop-filter: blur(')
  })

  it('renders cancel only for the explicit cancel row action', () => {
    expect(pluginToolsViewSource).toMatch(
      /<button\s+v-else-if="rowActionForStatus\(row\.resource\) === 'cancel'"\s+type="button"\s+class="row-action-btn icon-only danger"\s+data-title="Cancel"/,
    )
    expect(pluginToolsViewSource).not.toContain('data-title="Installing"')
  })
})
