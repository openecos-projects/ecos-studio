import { isEdaToolRow } from './pluginToolsRows'
import type { ResourceRow } from './pluginToolsRows'

export type CategoryFilter = 'all' | 'frontend' | 'tools' | 'pdks' | 'mpc' | 'installed'
export type StatusFilter = 'all' | 'available' | 'installed' | 'updates'

export interface SidebarItem {
  id: CategoryFilter
  label: string
  icon: string
  count: number
}

export interface StatusTabItem {
  id: StatusFilter
  label: string
  icon: string
  badge: number
}

export interface FrontendFlowStepItem {
  label: string
  installed: number
  total: number
  status: 'ready' | 'missing'
}

export interface FrontendReadinessSummary {
  installedCount: number
  totalCount: number
  availableCount: number
  items: FrontendFlowStepItem[]
}

export function isInstalledLikeRow(row: ResourceRow): boolean {
  return row.statusKind === 'installed' || row.statusKind === 'update'
}

export function filterResourceRows(
  rows: ResourceRow[],
  filters: { category: CategoryFilter; status: StatusFilter; query: string },
): ResourceRow[] {
  const q = filters.query.trim().toLowerCase()

  return rows.filter((row) => {
    if (filters.category === 'frontend' && !row.isFrontendTool) return false
    if (filters.category === 'tools' && !isEdaToolRow(row)) return false
    if (filters.category === 'pdks' && row.type !== 'pdk') return false
    if (filters.category === 'mpc' && row.type !== 'mpc') return false
    if (filters.category === 'installed' && !isInstalledLikeRow(row)) return false

    if (filters.status === 'available' && row.statusKind !== 'available') return false
    if (filters.status === 'installed' && !isInstalledLikeRow(row)) return false
    if (filters.status === 'updates' && row.statusKind !== 'update') return false

    if (!q) return true
    return `${row.name} ${row.description} ${row.version} ${row.requires.join(' ')}`
      .toLowerCase()
      .includes(q)
  })
}

export function buildSidebarItems(rows: ResourceRow[]): SidebarItem[] {
  return [
    { id: 'all', label: 'All Resources', icon: 'ri-apps-2-line', count: rows.length },
    {
      id: 'frontend',
      label: 'Frontend Flow',
      icon: 'ri-flow-chart',
      count: rows.filter((row) => row.isFrontendTool).length,
    },
    {
      id: 'tools',
      label: 'EDA Tools',
      icon: 'ri-tools-line',
      count: rows.filter(isEdaToolRow).length,
    },
    {
      id: 'pdks',
      label: 'PDKs',
      icon: 'ri-cpu-line',
      count: rows.filter((row) => row.type === 'pdk').length,
    },
    {
      id: 'mpc',
      label: 'MPC',
      icon: 'ri-layout-grid-line',
      count: rows.filter((row) => row.type === 'mpc').length,
    },
    {
      id: 'installed',
      label: 'Installed',
      icon: 'ri-checkbox-circle-line',
      count: rows.filter(isInstalledLikeRow).length,
    },
  ]
}

export function buildStatusTabs(rows: ResourceRow[]): StatusTabItem[] {
  return [
    { id: 'all', label: 'All', icon: 'ri-apps-line', badge: 0 },
    {
      id: 'available',
      label: 'Available',
      icon: 'ri-download-line',
      badge: rows.filter((row) => row.statusKind === 'available').length,
    },
    {
      id: 'installed',
      label: 'Installed',
      icon: 'ri-check-line',
      badge: rows.filter(isInstalledLikeRow).length,
    },
    {
      id: 'updates',
      label: 'Updates',
      icon: 'ri-arrow-up-circle-line',
      badge: rows.filter((row) => row.statusKind === 'update').length,
    },
  ]
}

const FRONTEND_FLOW_STAGES: { label: string; tags: string[] }[] = [
  { label: 'Review', tags: ['Yosys'] },
  { label: 'Elab', tags: ['Elab'] },
  { label: 'Lint', tags: ['Lint'] },
  { label: 'Sim', tags: ['Sim'] },
  { label: 'Wave', tags: ['Wave'] },
]

export function frontendReadiness(rows: ResourceRow[]): FrontendReadinessSummary {
  const frontendRows = rows.filter((row) => row.isFrontendTool)
  const items = FRONTEND_FLOW_STAGES.map((stage) => {
    const stageRows = frontendRows.filter((row) =>
      stage.tags.some((tag) => row.flowTags.includes(tag)),
    )
    const installed = stageRows.filter(isInstalledLikeRow).length
    return {
      label: stage.label,
      installed,
      total: stageRows.length,
      status:
        stageRows.length > 0 && installed === stageRows.length
          ? ('ready' as const)
          : ('missing' as const),
    }
  })
  return {
    installedCount: frontendRows.filter(isInstalledLikeRow).length,
    totalCount: frontendRows.length,
    availableCount: frontendRows.filter((row) => row.statusKind === 'available').length,
    items,
  }
}
