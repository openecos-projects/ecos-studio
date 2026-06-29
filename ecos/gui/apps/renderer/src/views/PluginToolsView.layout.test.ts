import { describe, expect, it } from 'vitest'
import pluginToolsViewSource from './PluginToolsView.vue?raw'

describe('PluginToolsView resource table layout', () => {
  it('bounds the dialog inside the available app viewport', () => {
    expect(pluginToolsViewSource).toMatch(
      /\.manager-dialog\s*\{[\s\S]*height:\s*min\(760px,\s*calc\(100% - var\(--dialog-block-gutter\)\)\);[\s\S]*min-height:\s*min\(560px,\s*calc\(100% - var\(--dialog-block-gutter\)\)\);[\s\S]*overflow:\s*hidden;/,
    )
    expect(pluginToolsViewSource).not.toContain('min-height: 620px;')
    expect(pluginToolsViewSource).not.toContain('overflow: visible;')
  })

  it('keeps the compact resource manager layout scrollable instead of clipped', () => {
    expect(pluginToolsViewSource).toMatch(
      /@media \(max-width: 1240px\)\s*\{[\s\S]*\.manager-grid\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;[\s\S]*overflow-y:\s*auto;/,
    )
    expect(pluginToolsViewSource).toMatch(
      /@media \(max-width: 1240px\)\s*\{[\s\S]*\.manager-table-panel\s*\{[\s\S]*flex:\s*0 0 clamp\(280px,\s*42vh,\s*420px\);/,
    )
    expect(pluginToolsViewSource).toMatch(
      /@media \(max-width: 1240px\)\s*\{[\s\S]*\.selected-panel\s*\{[\s\S]*min-height:\s*220px;/,
    )
  })

  it('keeps compact category navigation as short buttons instead of stretched cards', () => {
    expect(pluginToolsViewSource).toMatch(
      /@media \(max-width: 1240px\)\s*\{[\s\S]*\.resource-nav\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/,
    )
    expect(pluginToolsViewSource).toMatch(
      /@media \(max-width: 1240px\)\s*\{[\s\S]*\.resource-nav-item\s*\{[\s\S]*width:\s*auto;[\s\S]*min-height:\s*40px;/,
    )
    expect(pluginToolsViewSource).toMatch(
      /@media \(max-width: 1240px\)\s*\{[\s\S]*\.manager-help\s*\{[\s\S]*grid-template-columns:\s*24px minmax\(0,\s*1fr\) auto;/,
    )
    expect(pluginToolsViewSource).toMatch(
      /@media \(max-width: 767px\)\s*\{[\s\S]*\.resource-nav\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/,
    )
  })

  it('lets the selected resources list shrink so footer actions remain visible', () => {
    expect(pluginToolsViewSource).toMatch(
      /\.selected-list\s*\{[\s\S]*flex:\s*1 1 0;[\s\S]*min-height:\s*0;/,
    )
    expect(pluginToolsViewSource).toMatch(
      /\.selected-actions\s*\{[\s\S]*flex:\s*0 0 auto;/,
    )
  })

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
