import { describe, expect, it } from 'vitest'

import type { ResourceItem } from '@/api/plugin'
import { resourceToRow } from './pluginToolsRows'
import { cardActionsForRow, cardMetaText } from './pluginResourceCards'

function resource(overrides: Partial<ResourceItem>): ResourceItem {
  return {
    id: 'tool:yosys',
    type: 'tool',
    name: 'yosys',
    display_name: 'Yosys',
    description: 'Open synthesis suite',
    category: 'synthesis',
    status: 'available',
    installed_version: null,
    available_versions: ['20260827'],
    active_version: null,
    active: false,
    path: null,
    managed_root: null,
    platform: 'linux-x86_64',
    size: null,
    source: 'registry',
    homepage: '',
    actions: ['install'],
    health: {},
    error: null,
    ...overrides,
  }
}

function actionIds(row: ReturnType<typeof resourceToRow>, importing = false) {
  return cardActionsForRow(row, { importing }).map((action) => action.id)
}

describe('pluginResourceCards', () => {
  it('offers import + install for an available registry tool', () => {
    const row = resourceToRow(resource({}), undefined)
    expect(actionIds(row)).toEqual(['import_local', 'install'])
  })

  it('offers import + uninstall for an installed managed tool', () => {
    const row = resourceToRow(
      resource({
        status: 'installed',
        installed_version: '20260827',
        actions: ['uninstall'],
      }),
      undefined,
    )
    expect(actionIds(row)).toEqual(['import_local', 'uninstall'])
  })

  it('offers update without uninstall while an update is pending (row-chain parity)', () => {
    const row = resourceToRow(
      resource({
        status: 'update_available',
        installed_version: '20250101',
        actions: ['update', 'uninstall'],
      }),
      undefined,
    )
    expect(actionIds(row)).toEqual(['import_local', 'update'])
  })

  it('offers only cancel while installing, and disables local import', () => {
    const row = resourceToRow(resource({ status: 'installing', actions: ['cancel'] }), {
      resourceId: 'tool:yosys',
      resourceName: 'yosys',
      tool: 'yosys',
      phase: 'downloading',
      progress: 0.4,
      message: 'Downloading',
    })
    expect(actionIds(row)).toEqual(['cancel'])
  })

  it('offers retry instead of install when the row is in error state', () => {
    const row = resourceToRow(
      resource({ status: 'error', error: 'Download failed', actions: ['install'] }),
      undefined,
    )
    expect(actionIds(row)).toEqual(['import_local', 'retry'])
  })

  it('offers replace + remove reference for a replaceable local tool', () => {
    const row = resourceToRow(
      resource({
        status: 'installed',
        installed_version: '1.0',
        source: 'local',
        health: { managed: false },
        actions: ['install', 'remove_reference'],
      }),
      undefined,
    )
    expect(actionIds(row)).toEqual(['import_local', 'replace', 'remove_reference'])
  })

  it('offers validate for installed PDKs that support it', () => {
    const row = resourceToRow(
      resource({
        id: 'pdk:ics55',
        type: 'pdk',
        name: 'ics55',
        category: 'pdk',
        status: 'installed',
        installed_version: '1.10.102',
        path: '/pdks/ics55',
        actions: ['validate', 'uninstall'],
      }),
      undefined,
    )
    expect(actionIds(row)).toEqual(['import_local', 'validate', 'uninstall'])
  })

  it('marks the import action disabled with a spinner while importing', () => {
    const row = resourceToRow(resource({}), undefined)
    const [importAction] = cardActionsForRow(row, { importing: true })
    expect(importAction).toMatchObject({
      id: 'import_local',
      disabled: true,
      icon: 'ri-loader-4-line spin',
    })
  })

  it('builds the meta line from version, size, and platform', () => {
    const row = resourceToRow(resource({ size: 64 * 1024 * 1024 }), undefined)
    expect(cardMetaText(row)).toBe('v20260827 · 64.00 MB · linux-x86_64')

    const bare = resourceToRow(
      resource({ available_versions: [], platform: null }),
      undefined,
    )
    expect(cardMetaText(bare)).toBe('')
  })
})
