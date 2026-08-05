import type { InstallProgress, ResourceAction, ResourceItem } from '@/api/plugin'

export type ResourceType = 'tool' | 'pdk' | 'mpc'
export type StatusKind = 'available' | 'installed' | 'update' | 'installing' | 'error'
export type RowAction =
  | 'install'
  | 'update'
  | 'replace'
  | 'cancel'
  | 'uninstall'
  | 'remove_reference'
  | 'none'
export type PrimaryRowAction = 'install' | 'update' | 'replace'
export type RemovalRowAction = 'uninstall' | 'remove_reference'

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
  descriptionTitle: string
  version: string
  sizeLabel: string
  sizeMb: number
  platform: string
  statusText: string
  statusTitle: string
  statusKind: StatusKind
  icon: string
  accent: string
  flowTags: string[]
  isFrontendTool: boolean
  requires: string[]
  missingRequires: string[]
  dependencyLabel: string
  progressPercent: number | null
  actions: ResourceAction[]
  resource: ResourceItem
}

const toolMeta: Record<string, { icon: string; accent: string }> = {
  openroad: { icon: 'O', accent: '#79c142' },
  yosys: { icon: 'Y', accent: '#63666d' },
  slang: { icon: 'SV', accent: '#7c5fb4' },
  surfer: { icon: 'W', accent: '#2f8f83' },
  'ecc-fe-soc': { icon: 'SOC', accent: '#4f7f75' },
  'ecc-fe-cpu': { icon: 'CPU', accent: '#4f7f75' },
  'ecc-fe': { icon: 'FE', accent: '#4f7f75' },
  'riscv-toolchain': { icon: 'RV', accent: '#b35f3a' },
  riscv: { icon: 'RV', accent: '#b35f3a' },
  klayout: { icon: 'K', accent: '#d99427' },
  magic: { icon: 'M', accent: '#6b7078' },
  netgen: { icon: 'N', accent: '#607d8b' },
  verilator: { icon: 'V', accent: '#4b87c5' },
  iverilog: { icon: 'I', accent: '#4f7f75' },
}

const mpcMeta = { icon: 'MPC', accent: '#3f7cac' }

export function formatResourceSize(size: number | null): {
  sizeLabel: string
  sizeMb: number
} {
  if (!size || size <= 0) return { sizeLabel: '-', sizeMb: 0 }

  const sizeMb = size / (1024 * 1024)
  return { sizeLabel: formatResourceSizeMb(sizeMb), sizeMb }
}

export function formatResourceSizeMb(sizeMb: number): string {
  if (!Number.isFinite(sizeMb) || sizeMb <= 0) return '0.00 MB'
  if (sizeMb >= 1024) return `${(sizeMb / 1024).toFixed(2)} GB`
  return `${sizeMb.toFixed(2)} MB`
}

function versionLabel(resource: ResourceItem): string {
  const version =
    resource.active_version ||
    resource.installed_version ||
    (resource.source === 'local' ? undefined : resource.available_versions[0])
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
  if (resource.type === 'mpc') {
    return mpcMeta.icon
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
  if (resource.type === 'mpc') {
    return mpcMeta.accent
  }

  const haystack = `${resource.name} ${resource.display_name}`.toLowerCase()
  const match = Object.entries(toolMeta).find(([key]) => haystack.includes(key))
  if (match) {
    return match[1].accent
  }
  return '#68707d'
}

export function frontendFlowTagsFor(resource: ResourceItem): string[] {
  if (resource.type !== 'tool') return []
  const haystack =
    `${resource.name} ${resource.display_name} ${resource.description}`.toLowerCase()
  const tags: string[] = []

  if (haystack.includes('yosys') || haystack.includes('oss cad')) {
    tags.push('Review', 'Yosys')
  }
  if (haystack.includes('slang')) tags.push('Elab')
  if (haystack.includes('verilator') || haystack.includes('oss cad')) {
    tags.push('Lint', 'Sim')
  }
  if (haystack.includes('riscv')) tags.push('CPU Tests', 'CoreMark')
  if (haystack.includes('surfer')) tags.push('Wave')
  if (haystack.includes('ecc-fe') || haystack.includes('frontend flow runtime')) {
    tags.push('Frontend CLI')
  }
  if (haystack.includes('soc harness')) tags.push('SoC Harness')
  if (haystack.includes('example')) tags.push('Examples')
  if (haystack.includes('cpu adapter')) tags.push('CPU Adapter')

  return [...new Set(tags)]
}

function progressPercentFor(progress: InstallProgress | undefined): number | null {
  if (!progress) return null
  return Math.max(0, Math.min(100, Math.round((progress.progress || 0) * 100)))
}

export function compactResourceMessage(
  message: string | null | undefined,
  fallback: string = 'Resource operation failed',
): string {
  const text = message?.trim()
  if (!text) return fallback

  const lower = text.toLowerCase()
  const hasUrl = /https?:\/\//i.test(text)
  const isShortDisplayText =
    text.length <= 80 &&
    !hasUrl &&
    !text.includes('\n') &&
    !lower.includes('fetch failed') &&
    !lower.includes('und_err')

  if (isShortDisplayText) return text
  if (lower.includes('timeout') || lower.includes('und_err_connect_timeout'))
    return 'Connection timeout'
  if (lower.includes('failed to download') || lower.includes('fetch failed') || hasUrl)
    return 'Download failed'
  if (lower.includes('checksum') || lower.includes('hash') || lower.includes('integrity'))
    return 'Verification failed'
  if (lower.includes('post-install') || lower.includes('post_install'))
    return 'Post-install failed'
  if (lower.includes('not found') || lower.includes('missing'))
    return 'Resource not found'
  return fallback
}

function installedStatusText(resource: ResourceItem): string {
  if (isLocalTool(resource)) {
    return 'Local'
  }
  if (resource.type === 'pdk' && resource.active) {
    return 'Active'
  }
  return 'Installed'
}

function isLocalTool(resource: ResourceItem): boolean {
  return (
    resource.type === 'tool' &&
    resource.status === 'installed' &&
    resource.source === 'local' &&
    resource.health.managed === false
  )
}

function isReplaceableLocalTool(resource: ResourceItem): boolean {
  return isLocalTool(resource) && resource.actions.includes('install')
}

function errorStatusText(resource: ResourceItem): string {
  if (resource.status === 'missing') return 'Missing'
  if (resource.status === 'invalid') return 'Invalid'
  return 'Error'
}

function rowDescription(resource: ResourceItem): { text: string; title: string } {
  const text = resource.description || resource.path || ''
  if (resource.error) {
    return {
      text: compactResourceMessage(resource.error),
      title: resource.error,
    }
  }
  return { text, title: text }
}

function progressStatusText(progress: InstallProgress | undefined): string {
  switch (progress?.phase) {
    case 'downloading':
      return 'Downloading'
    case 'verifying':
      return 'Verifying'
    case 'extracting':
      return 'Extracting'
    case 'post_install':
      return 'Post-install'
    case 'uninstalling':
      return 'Removing'
    case 'done':
      return 'Installed'
    case 'cancelled':
      return 'Cancelled'
    case 'error':
      return 'Error'
    default:
      return 'Installing'
  }
}

function mapStatus(
  resource: ResourceItem,
  progress: InstallProgress | undefined,
): { kind: StatusKind; text: string } {
  if (
    progress ||
    resource.status === 'installing' ||
    resource.status === 'uninstalling' ||
    resource.status === 'removing'
  ) {
    return {
      kind: 'installing',
      text: progressStatusText(progress),
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
  if (isReplaceableLocalTool(resource)) {
    return 'replace'
  }
  if (
    (resource.status === 'available' || resource.status === 'error') &&
    actions.has('install')
  ) {
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
  if (action === 'install' || action === 'update' || action === 'replace') {
    return action
  }
  return null
}

export function removalActionForRow(row: ResourceRow): RemovalRowAction | null {
  const action = rowActionForStatus(row.resource)
  if (action === 'uninstall' || action === 'remove_reference') {
    return action
  }
  if (action === 'replace' && row.resource.actions.includes('remove_reference')) {
    return 'remove_reference'
  }
  return null
}

export function canImportLocalResource(row: ResourceRow): boolean {
  return (row.type === 'tool' || row.type === 'pdk') && row.statusKind !== 'installing'
}

function isCompilerToolchainRow(row: ResourceRow): boolean {
  if (row.type !== 'tool') return false
  const category = row.resource.category.toLowerCase()
  const haystack =
    `${row.resource.name} ${row.resource.display_name} ${row.resource.description}`.toLowerCase()
  return (
    category.includes('toolchain') ||
    category.includes('compiler') ||
    haystack.includes('gnu toolchain') ||
    haystack.includes('risc-v gnu') ||
    haystack.includes('riscv-toolchain') ||
    haystack.includes('bare-metal gcc') ||
    haystack.includes('ecc-fe') ||
    haystack.includes('frontend flow runtime')
  )
}

export function isEdaToolRow(row: ResourceRow): boolean {
  return row.type === 'tool' && !isCompilerToolchainRow(row)
}

export function createPrimaryActionTask(
  row: ResourceRow,
  executor: ResourceActionExecutor,
): Promise<void> | null {
  const action = primaryActionForRow(row)
  if (action === 'update') {
    return executor.updateResource(row.id)
  }
  if (action === 'install' || action === 'replace') {
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
  const rowsById = new Map(rows.map((row) => [row.id, row]))
  const selectedIds = new Set(rows.map((row) => row.id))
  const rowsCoveredBySelectedParents = new Set<string>()
  for (const row of rows) {
    for (const dependencyId of dependencyClosure(rowsById, row)) {
      if (selectedIds.has(dependencyId)) {
        rowsCoveredBySelectedParents.add(dependencyId)
      }
    }
  }
  const tasks = rows
    .filter((row) => !rowsCoveredBySelectedParents.has(row.id))
    .map((row) => createPrimaryActionTask(row, executor))
    .filter((task): task is Promise<void> => task !== null)

  for (let i = 0; i < tasks.length; i += concurrency) {
    await Promise.all(tasks.slice(i, i + concurrency))
  }
}

function dependencyClosure(
  rowsById: Map<string, ResourceRow>,
  row: ResourceRow,
): Set<string> {
  const dependencies = new Set<string>()
  const visit = (candidate: ResourceRow): void => {
    for (const dependencyId of candidate.missingRequires) {
      if (dependencies.has(dependencyId)) continue
      dependencies.add(dependencyId)
      const dependency = rowsById.get(dependencyId)
      if (dependency) visit(dependency)
    }
  }
  visit(row)
  return dependencies
}

function targetVersionForRow(row: ResourceRow): string | null {
  const resource = row.resource
  if (
    resource.status === 'update_available' ||
    resource.status === 'available' ||
    primaryActionForRow(row) === 'replace'
  ) {
    return resource.available_versions[0] ?? null
  }
  return (
    resource.installed_version ??
    resource.active_version ??
    resource.available_versions[0] ??
    null
  )
}

export function selectedResourceMetaText(row: ResourceRow): string {
  if (primaryActionForRow(row) === 'replace') {
    const version = row.resource.available_versions[0]
    return version
      ? `Replace with managed v${String(version).replace(/^v/i, '')}`
      : 'Replace with managed version'
  }
  if (row.statusKind === 'update') {
    return 'Update'
  }
  if (row.statusKind === 'installing') {
    return row.statusText
  }
  return row.version
}

function joinInstallPath(root: string, segments: string[]): string {
  return [
    root.replace(/\/+$/, ''),
    ...segments.map((segment) => segment.replace(/^\/+|\/+$/g, '')),
  ].join('/')
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

function resourceDisplayNameFromId(resourceId: string): string {
  return resourceId.replace(/^(tool|pdk):/, '')
}

function dependencyLabel(resource: ResourceItem): string {
  const requirements = resource.requires ?? []
  if (requirements.length === 0) return ''
  const missing = resource.missing_requires ?? []
  if (missing.length > 0) {
    return `Installs ${missing.length} required: ${missing
      .map(resourceDisplayNameFromId)
      .join(', ')}`
  }
  return `Requires: ${requirements.map(resourceDisplayNameFromId).join(', ')}`
}

export function resourceToRow(
  resource: ResourceItem,
  progress: InstallProgress | undefined,
): ResourceRow {
  const progressPercent = progressPercentFor(progress)
  const size = formatResourceSize(resource.size)
  const status = mapStatus(resource, progress)
  const description = rowDescription(resource)
  const flowTags = frontendFlowTagsFor(resource)

  return {
    id: resource.id,
    type: resource.type,
    name: resource.display_name || resource.name,
    resourceName: resource.name,
    description: description.text,
    descriptionTitle: description.title,
    version: versionLabel(resource),
    sizeLabel: size.sizeLabel,
    sizeMb: size.sizeMb,
    platform: resource.platform || (resource.source === 'local' ? 'Local' : ''),
    statusText: status.text,
    statusTitle: status.kind === 'error' ? resource.error || '' : '',
    statusKind: status.kind,
    icon: iconFor(resource),
    accent: accentFor(resource),
    flowTags,
    isFrontendTool: flowTags.length > 0,
    requires: resource.requires ?? [],
    missingRequires: resource.missing_requires ?? [],
    dependencyLabel: dependencyLabel(resource),
    progressPercent,
    actions: resource.actions,
    resource,
  }
}
