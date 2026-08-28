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

  it('shows frontend readiness only as non-interactive frontend category content', () => {
    const readinessStrip = pluginToolsViewSource.slice(
      pluginToolsViewSource.indexOf('<section\n            v-if="categoryFilter'),
      pluginToolsViewSource.indexOf('<div\n            v-if="managerErrorText"'),
    )

    expect(pluginToolsViewSource).toMatch(
      /<section\s+v-if="categoryFilter === 'frontend'"\s+class="frontend-flow-strip"/,
    )
    expect(readinessStrip).toContain('role="list"')
    expect(readinessStrip).toContain('role="listitem"')
    expect(readinessStrip).not.toContain('<button')
    expect(readinessStrip).not.toContain('@click')
    expect(pluginToolsViewSource).toMatch(
      /\.frontend-flow-step\s*\{[\s\S]*cursor:\s*default;/,
    )
  })

  it('does not present disabled resource controls as clickable on hover', () => {
    expect(pluginToolsViewSource).not.toContain('cursor: not-allowed;')
    expect(pluginToolsViewSource).toMatch(
      /\.manager-table-meta button:disabled\s*\{[\s\S]*cursor:\s*default;/,
    )
    expect(pluginToolsViewSource).toMatch(
      /\.row-action-btn:disabled\s*\{[\s\S]*cursor:\s*default;/,
    )
    expect(pluginToolsViewSource).toMatch(
      /\.download-button:disabled\s*\{[\s\S]*cursor:\s*default;/,
    )
    expect(pluginToolsViewSource).toContain(
      '.row-action-btn[data-title]:not(:disabled):hover::after',
    )
    expect(pluginToolsViewSource).toContain('.row-action-btn.info:not(:disabled):hover')
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

  it('aligns row metadata to the primary resource name line', () => {
    expect(pluginToolsViewSource).toContain('class="resource-status-cell"')
    expect(pluginToolsViewSource).not.toContain('row.statusIcon')
    expect(pluginToolsViewSource).not.toContain('.status-pill i')
    expect(pluginToolsViewSource).toContain('--resource-table-columns:')
    expect(pluginToolsViewSource).toMatch(
      /\.resource-table-head,\s*\.resource-row\s*\{[\s\S]*grid-template-columns:\s*var\(--resource-table-columns\);/,
    )
    expect(pluginToolsViewSource).not.toContain('minmax(70px, auto)')
    expect(pluginToolsViewSource).toMatch(
      /\.resource-row\s*\{[\s\S]*align-items:\s*start;/,
    )
    expect(pluginToolsViewSource).toMatch(
      /\.resource-row\s*>\s*\.resource-muted,\s*\.resource-status-cell,\s*\.row-actions\s*\{[\s\S]*align-self:\s*start;/,
    )
    expect(pluginToolsViewSource).toMatch(
      /\.resource-copy strong\s*\{[\s\S]*line-height:\s*var\(--resource-row-primary-line\);/,
    )
    expect(pluginToolsViewSource).toMatch(
      /\.resource-muted\s*\{[\s\S]*min-height:\s*var\(--resource-row-primary-line\);/,
    )
    expect(pluginToolsViewSource).toMatch(
      /\.row-actions\s*\{[\s\S]*justify-content:\s*flex-start;/,
    )
    expect(pluginToolsViewSource).toMatch(
      /\.status-pill\.installing\s*\{[\s\S]*font-size:\s*10px;[\s\S]*padding:\s*0 7px;/,
    )
    expect(pluginToolsViewSource).toMatch(
      /@media \(max-width: 767px\)\s*\{[\s\S]*--resource-table-columns:\s*28px minmax\(88px,\s*1fr\) minmax\(96px,\s*auto\) minmax\(68px,\s*auto\);/,
    )
  })

  it('renders mini progress with a transform driven by the row progress percent', () => {
    expect(pluginToolsViewSource).toContain(
      ':style="{ \'--progress\': row.progressPercent / 100 }"',
    )
    expect(pluginToolsViewSource).toMatch(
      /\.mini-progress span\s*\{[\s\S]*transform:\s*scaleX\(var\(--progress,\s*0\)\);/,
    )
  })

  it('uses a neutral scrim without rendering a fabricated page behind the dialog', () => {
    expect(pluginToolsViewSource).toContain('class="manager-scrim"')
    expect(pluginToolsViewSource).not.toContain('blurred-home')
    expect(pluginToolsViewSource).not.toContain('blurred-card')
    expect(pluginToolsViewSource).not.toContain('blurred-lines')
    expect(pluginToolsViewSource).not.toContain('backdrop-filter: blur(')
  })

  it('renders cancel only for the explicit cancel row action', () => {
    expect(pluginToolsViewSource).toMatch(
      /<button\s+v-else-if="rowActionForStatus\(row\.resource\) === 'cancel'"\s+type="button"\s+class="row-action-btn icon-only danger"\s+data-title="Cancel"/,
    )
    expect(pluginToolsViewSource).not.toContain('data-title="Installing"')
  })

  it('keeps long resource error details out of table rows', () => {
    expect(pluginToolsViewSource).toContain(':title="row.descriptionTitle || undefined"')
    expect(pluginToolsViewSource).toContain(':title="row.statusTitle || undefined"')
    expect(pluginToolsViewSource).not.toContain('row-error-msg')
    expect(pluginToolsViewSource).not.toContain('rowError(row)')
  })

  it('uses compact text for global resource errors', () => {
    expect(pluginToolsViewSource).toContain('managerErrorText')
    expect(pluginToolsViewSource).toContain(':title="pluginStore.error ?? undefined"')
    expect(pluginToolsViewSource).not.toContain('{{ pluginStore.error }}')
  })

  it('does not render the deprecated global PDK import action', () => {
    expect(pluginToolsViewSource).not.toContain('handleImportPdk')
    expect(pluginToolsViewSource).not.toContain('importingPdk')
    expect(pluginToolsViewSource).not.toContain('Import PDK')
  })

  it('renders local tool replace controls and copy separately from updates', () => {
    expect(pluginToolsViewSource).toContain(
      "rowActionForStatus(row.resource) === 'replace'",
    )
    expect(pluginToolsViewSource).toContain('data-title="Replace"')
    expect(pluginToolsViewSource).toContain('removalActionForRow(row)')
    expect(pluginToolsViewSource).toContain('handleRowRemove(row)')
    expect(pluginToolsViewSource).toContain('selectedResourceMetaText(row)')
    expect(pluginToolsViewSource).toMatch(
      /Updates apply to managed installs\.\s+Replace switches a local tool to the\s+registry-managed version without deleting the original local directory\./,
    )
    expect(pluginToolsViewSource).not.toContain(
      'Updates will replace the existing installed versions.',
    )
  })

  it('renders the row local import button before the primary row action', () => {
    const importButtonIndex = pluginToolsViewSource.indexOf('data-title="Import Local"')
    const installButtonIndex = pluginToolsViewSource.indexOf('data-title="Install"')

    expect(pluginToolsViewSource).toContain('canImportLocalResource(row)')
    expect(pluginToolsViewSource).toContain('handleLocalImport(row)')
    expect(pluginToolsViewSource).toMatch(
      /importingResourceIds\.has\(row\.id\)[\s\S]*\?[\s\S]*'ri-loader-4-line spin'[\s\S]*:[\s\S]*'ri-folder-add-line'/,
    )
    expect(importButtonIndex).toBeGreaterThan(-1)
    expect(installButtonIndex).toBeGreaterThan(-1)
    expect(importButtonIndex).toBeLessThan(installButtonIndex)
  })

  it('marks a row import busy before choosing the import flow', () => {
    const busyFlagIndex = pluginToolsViewSource.indexOf(
      'importingResourceIds.value = next',
    )
    const pdkImportIndex = pluginToolsViewSource.indexOf("if (row.type === 'pdk')")

    expect(pluginToolsViewSource).toContain('const { importPdk } = usePdkManager()')
    expect(pluginToolsViewSource).toContain('if (await importPdk())')
    expect(busyFlagIndex).toBeGreaterThan(-1)
    expect(pdkImportIndex).toBeGreaterThan(-1)
    expect(busyFlagIndex).toBeLessThan(pdkImportIndex)
  })
})
