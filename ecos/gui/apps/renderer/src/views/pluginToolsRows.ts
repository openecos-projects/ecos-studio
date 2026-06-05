import type { InstallProgress, ResourceAction, ResourceItem } from '@/api/plugin'

export type ResourceType = 'tool' | 'pdk'
export type StatusKind = 'available' | 'installed' | 'update' | 'installing' | 'error'
export type RowAction = 'install' | 'update' | 'cancel' | 'uninstall' | 'remove_reference' | 'none'
export type PrimaryRowAction = 'install' | 'update'

export interface ResourceActionExecutor {
  installResource(resourceId: string): Promise<void>
  updateResource(resourceId: string): Promise<void>
}

export interface ResourceRow {
  id: string
  type: ResourceType
  name: string
  resourceName: string
  description: string
  version: string
  sizeLabel: string
  sizeMb: number
  platform: string
  statusText: string
  statusKind: StatusKind
  icon: string
  accent: string
  progressPercent: number | null
  actions: ResourceAction[]
  resource: ResourceItem
}

const toolMeta: Record<string, { icon: string; accent: string }> = {
  openroad: { icon: 'O', accent: '#79c142' },
  yosys: { icon: 'Y', accent: '#63666d' },
  klayout: { icon: 'K', accent: '#d99427' },
  magic: { icon: 'M', accent: '#6b7078' },
  netgen: { icon: 'N', accent: '#607d8b' },
  verilator: { icon: 'V', accent: '#4b87c5' },
  iverilog: { icon: 'I', accent: '#4f7f75' },
}

export function formatResourceSize(size: number | null): { sizeLabel: string; sizeMb: number } {
  if (!size || size <= 0) return { sizeLabel: '0 MB', sizeMb: 0 }

  const sizeMb = Math.round(size / (1024 * 1024))
  if (sizeMb >= 1024) {
    return { sizeLabel: `${(sizeMb / 1024).toFixed(2)} GB`, sizeMb }
  }
  return { sizeLabel: `${sizeMb} MB`, sizeMb }
}

function versionLabel(resource: ResourceItem): string {
  const version = resource.active_version || resource.installed_version || resource.available_versions[0]
  if (!version) {
    return resource.source === 'local' ? 'Local' : '-'
  }
  return `v${String(version).replace(/^v/i, '')}`
}

function iconFor(resource: ResourceItem): string {
  const label = resource.display_name || resource.name || '?'
  if (resource.type === 'pdk') {
    return (resource.name || label).slice(0, 5)
  }

  const haystack = `${resource.name} ${resource.display_name}`.toLowerCase()
  const match = Object.entries(toolMeta).find(([key]) => haystack.includes(key))
  if (match) {
    return match[1].icon
  }
  return label.slice(0, 1).toUpperCase()
}

function accentFor(resource: ResourceItem): string {
  if (resource.type === 'pdk') {
    return resource.active ? '#4f7f75' : '#6b7078'
  }

  const haystack = `${resource.name} ${resource.display_name}`.toLowerCase()
  const match = Object.entries(toolMeta).find(([key]) => haystack.includes(key))
  if (match) {
    return match[1].accent
  }
  return '#68707d'
}

function progressPercentFor(progress: InstallProgress | undefined): number | null {
  if (!progress) return null
  return Math.max(0, Math.min(100, Math.round((progress.progress || 0) * 100)))
}

function installedStatusText(resource: ResourceItem): string {
  if (resource.type === 'pdk' && resource.active) {
    return 'Active'
  }
  return 'Installed'
}

function errorStatusText(resource: ResourceItem): string {
  if (resource.status === 'missing') return 'Missing'
  if (resource.status === 'invalid') return 'Invalid'
  return 'Error'
}

function progressStatusText(progress: InstallProgress | undefined, percent: number | null): string {
  if (progress?.phase === 'uninstalling') {
    return 'Removing'
  }
  if (percent !== null && progress?.phase === 'downloading') {
    return `Downloading ${percent}%`
  }
  if (percent !== null && progress?.phase === 'extracting') {
    return `Extracting ${percent}%`
  }
  if (progress?.phase === 'post_install') {
    return progress.message || 'Initializing'
  }
  if (progress?.message) {
    return progress.message
  }
  if (percent !== null) {
    return `Installing ${percent}%`
  }
  return 'Installing'
}

function mapStatus(
  resource: ResourceItem,
  progress: InstallProgress | undefined,
): { kind: StatusKind; text: string } {
  const percent = progressPercentFor(progress)
  if (progress || resource.status === 'installing' || resource.status === 'uninstalling' || resource.status === 'removing') {
    return {
      kind: 'installing',
      text: progressStatusText(progress, percent),
    }
  }

  switch (resource.status) {
    case 'installed':
      return { kind: 'installed', text: installedStatusText(resource) }
    case 'update_available':
      return { kind: 'update', text: 'Update' }
    case 'error':
    case 'missing':
    case 'invalid':
      return { kind: 'error', text: errorStatusText(resource) }
    default:
      return { kind: 'available', text: 'Available' }
  }
}

export function rowActionForStatus(resource: ResourceItem): RowAction {
  const actions = new Set<ResourceAction>(resource.actions)

  if (resource.status === 'installing') {
    return 'cancel'
  }
  if (resource.status === 'uninstalling' || resource.status === 'removing') {
    return 'none'
  }
  if (
    (resource.status === 'update_available' || resource.status === 'error') &&
    actions.has('update')
  ) {
    return 'update'
  }
  if ((resource.status === 'available' || resource.status === 'error') && actions.has('install')) {
    return 'install'
  }
  if (actions.has('uninstall')) {
    return 'uninstall'
  }
  if (actions.has('remove_reference')) {
    return 'remove_reference'
  }

  return 'none'
}

export function primaryActionForRow(row: ResourceRow): PrimaryRowAction | null {
  const action = rowActionForStatus(row.resource)
  if (action === 'install' || action === 'update') {
    return action
  }
  return null
}

export function createPrimaryActionTask(
  row: ResourceRow,
  executor: ResourceActionExecutor,
): Promise<void> | null {
  const action = primaryActionForRow(row)
  if (action === 'update') {
    return executor.updateResource(row.id)
  }
  if (action === 'install') {
    return executor.installResource(row.id)
  }
  return null
}

export async function runPrimaryAction(
  row: ResourceRow,
  executor: ResourceActionExecutor,
): Promise<void> {
  const task = createPrimaryActionTask(row, executor)
  if (!task) {
    return
  }
  await task
}

export async function runBatchDownload(
  rows: ResourceRow[],
  executor: ResourceActionExecutor,
  concurrency: number = 2,
): Promise<void> {
  const tasks = rows
    .map((row) => createPrimaryActionTask(row, executor))
    .filter((task): task is Promise<void> => task !== null)

  for (let i = 0; i < tasks.length; i += concurrency) {
    await Promise.all(tasks.slice(i, i + concurrency))
  }
}

function targetVersionForRow(row: ResourceRow): string | null {
  const resource = row.resource
  if (resource.status === 'update_available' || resource.status === 'available') {
    return resource.available_versions[0] ?? null
  }
  return resource.installed_version ?? resource.active_version ?? resource.available_versions[0] ?? null
}

function joinInstallPath(root: string, segments: string[]): string {
  return [root.replace(/\/+$/, ''), ...segments.map((segment) => segment.replace(/^\/+|\/+$/g, ''))].join('/')
}

export function resolveRowInstallPath(row: ResourceRow): string {
  const managedRoot = row.resource.managed_root
  const version = targetVersionForRow(row)
  if (!managedRoot || !version) {
    return row.resource.path ?? ''
  }
  return joinInstallPath(managedRoot, [row.resourceName, version])
}

export function managedInstallLocation(rows: ResourceRow[]): string {
  const installableRows = rows.filter((row) => primaryActionForRow(row) !== null)
  if (installableRows.length === 0) {
    return ''
  }

  const resolvedPaths = installableRows
    .map(resolveRowInstallPath)
    .filter((path) => path.length > 0)

  if (resolvedPaths.length === 0) {
    return ''
  }

  if (resolvedPaths.length === 1) {
    return resolvedPaths[0]
  }

  return resolvedPaths.join(', ')
}

export function currentInstallLocation(rows: ResourceRow[]): string {
  const paths = rows.map(resolveRowInstallPath).filter((path) => path.length > 0)

  if (paths.length === 0) {
    return ''
  }

  if (paths.length === 1) {
    return paths[0]
  }

  return paths.join(', ')
}

export function resourceToRow(
  resource: ResourceItem,
  progress: InstallProgress | undefined,
): ResourceRow {
  const progressPercent = progressPercentFor(progress)
  const size = formatResourceSize(resource.size)
  const status = mapStatus(resource, progress)

  return {
    id: resource.id,
    type: resource.type,
    name: resource.display_name || resource.name,
    resourceName: resource.name,
    description: resource.description || resource.path || resource.error || '',
    version: versionLabel(resource),
    sizeLabel: size.sizeLabel,
    sizeMb: size.sizeMb,
    platform: resource.platform || (resource.source === 'local' ? 'Local' : ''),
    statusText: status.text,
    statusKind: status.kind,
    icon: iconFor(resource),
    accent: accentFor(resource),
    progressPercent,
    actions: resource.actions,
    resource,
  }
}
