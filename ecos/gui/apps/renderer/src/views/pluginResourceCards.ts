import {
  canImportLocalResource,
  removalActionForRow,
  rowActionForStatus,
} from './pluginToolsRows'
import type { ResourceRow } from './pluginToolsRows'

export type PluginCardActionId =
  | 'install'
  | 'update'
  | 'replace'
  | 'retry'
  | 'cancel'
  | 'validate'
  | 'import_local'
  | 'uninstall'
  | 'remove_reference'

export interface PluginCardAction {
  id: PluginCardActionId
  label: string
  icon: string
  tone: 'primary' | 'info' | 'danger' | 'danger-outlined'
  iconOnly: boolean
  disabled: boolean
}

/**
 * Ordered action list for one resource card. Mirrors the previous table-row
 * button chain: local import first, then the single primary-chain action
 * (install/update/replace/cancel/retry, or validate when idle), then removal.
 */
export function cardActionsForRow(
  row: ResourceRow,
  options: { importing: boolean },
): PluginCardAction[] {
  const actions: PluginCardAction[] = []

  if (canImportLocalResource(row)) {
    actions.push({
      id: 'import_local',
      label: 'Import Local',
      icon: options.importing ? 'ri-loader-4-line spin' : 'ri-folder-add-line',
      tone: 'info',
      iconOnly: true,
      disabled: options.importing,
    })
  }

  const primary = rowActionForStatus(row.resource)
  if (primary === 'install' && row.statusKind !== 'error') {
    actions.push({
      id: 'install',
      label: 'Install',
      icon: 'ri-download-line',
      tone: 'primary',
      iconOnly: false,
      disabled: false,
    })
  } else if (primary === 'update' && row.statusKind !== 'error') {
    actions.push({
      id: 'update',
      label: 'Update',
      icon: 'ri-refresh-line',
      tone: 'info',
      iconOnly: false,
      disabled: false,
    })
  } else if (primary === 'replace') {
    actions.push({
      id: 'replace',
      label: 'Replace',
      icon: 'ri-loop-left-line',
      tone: 'info',
      iconOnly: false,
      disabled: false,
    })
  } else if (primary === 'cancel') {
    actions.push({
      id: 'cancel',
      label: 'Cancel',
      icon: 'ri-close-line',
      tone: 'danger',
      iconOnly: false,
      disabled: false,
    })
  } else if (row.statusKind === 'error') {
    actions.push({
      id: 'retry',
      label: 'Retry',
      icon: 'ri-restart-line',
      tone: 'danger',
      iconOnly: false,
      disabled: false,
    })
  } else if (row.statusKind !== 'installing' && row.actions.includes('validate')) {
    actions.push({
      id: 'validate',
      label: 'Validate',
      icon: 'ri-shield-check-line',
      tone: 'info',
      iconOnly: true,
      disabled: false,
    })
  }

  const removal = removalActionForRow(row)
  if (removal === 'remove_reference') {
    actions.push({
      id: 'remove_reference',
      label: 'Remove',
      icon: 'ri-link-unlink',
      tone: 'danger-outlined',
      iconOnly: true,
      disabled: false,
    })
  } else if (removal === 'uninstall') {
    actions.push({
      id: 'uninstall',
      label: 'Uninstall',
      icon: 'ri-delete-bin-line',
      tone: 'danger-outlined',
      iconOnly: true,
      disabled: false,
    })
  }

  return actions
}

/** Compact meta line under the card title: version · size · platform. */
export function cardMetaText(row: ResourceRow): string {
  return [row.version, row.sizeLabel, row.platform]
    .filter((part) => part && part !== '-')
    .join(' · ')
}

/**
 * Registry-declared homepage, surfaced only for web URLs. Electron main
 * re-validates the scheme before opening; this is the defensive renderer half
 * so non-web homepages never render a dead button.
 */
export function homepageUrlFor(row: ResourceRow): string | null {
  const homepage = row.resource.homepage
  if (!homepage) return null
  try {
    const parsed = new URL(homepage)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? homepage : null
  } catch {
    return null
  }
}
