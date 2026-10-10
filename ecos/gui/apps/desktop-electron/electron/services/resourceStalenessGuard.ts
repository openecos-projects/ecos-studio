import { resolve, sep } from 'node:path'
import {
  RESOURCE_UPDATE_AVAILABLE,
  type ResourceInfo,
  type ResourceStalenessItem,
  type ResourceUpdateKind,
} from '@ecos-studio/shared'
import { electronLogger } from './logger'
import { assetShaDrift, type ResourceManagerService } from './resourceManagerService'
import type { PdkInventoryService } from './pdkInventoryService'

type StalenessResourceManager = Pick<
  ResourceManagerService,
  'listResources' | 'readCachedLatestPdkRelease'
>

type StalenessPdkInventory = Pick<
  PdkInventoryService,
  'listBindings' | 'listInstallations'
>

export interface RunStalenessAssessmentOptions {
  resourceManagerService: StalenessResourceManager
  pdkInventoryService: StalenessPdkInventory
  workspaceDirectory: string | null
}

function shortRef(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 8) : null
}

/**
 * Structured run-input record ("record versions at run start"): one log line
 * with every active tool's version and the short commit/sha from its update
 * check, when known. Logger only — no persisted format.
 */
function logRunResourceInputs(resources: ResourceInfo[]): void {
  const inputs = resources
    .filter((resource) => resource.type === 'tool' && resource.active)
    .map((tool) => {
      const updateCheck = tool.health?.update_check as
        | { commit?: unknown; sha256?: unknown }
        | undefined
      const ref = shortRef(updateCheck?.commit ?? updateCheck?.sha256)
      const version = tool.active_version ?? tool.installed_version ?? 'unknown'
      return `${tool.name}@${version}${ref ? ` (${ref})` : ''}`
    })
  electronLogger.info('[resources] run inputs: %s', inputs.join(', ') || 'none')
}

function collectStaleRunResources(resources: ResourceInfo[]): ResourceStalenessItem[] {
  const items: ResourceStalenessItem[] = []
  for (const resource of resources) {
    if (resource.status !== 'update_available') continue
    // Active tools land on PATH for every run; bound MPCs are run inputs.
    const isRunInput =
      (resource.type === 'tool' && resource.active) || resource.type === 'mpc'
    if (!isRunInput) continue
    items.push({
      id: resource.id,
      display_name: resource.display_name,
      installed_version: resource.installed_version,
      latest_version: resource.available_versions[0] ?? null,
      update_kind: resource.update_kind ?? null,
    })
  }
  return items
}

/**
 * Best-effort PDK staleness: find the binding whose project root contains the
 * run's workspace directory (longest normalized prefix wins), then compare the
 * bound installation against the cached registry release. Returns null when no
 * binding matches, the installation is unknown or imported (user-managed
 * external trees have no registry update source), or the PDK is fresh.
 */
async function assessBoundPdk(
  options: RunStalenessAssessmentOptions,
): Promise<ResourceStalenessItem | null> {
  if (!options.workspaceDirectory) return null
  const bindings = await options.pdkInventoryService.listBindings()
  const workspaceRoot = resolve(options.workspaceDirectory)
  const binding = bindings
    .filter((candidate) => {
      const projectRoot = resolve(candidate.projectRoot)
      return workspaceRoot === projectRoot || workspaceRoot.startsWith(projectRoot + sep)
    })
    .sort((a, b) => resolve(b.projectRoot).length - resolve(a.projectRoot).length)[0]
  if (!binding) return null

  const installations = await options.pdkInventoryService.listInstallations()
  const installation = installations.find(
    (candidate) => candidate.id === binding.installationId,
  )
  if (!installation) return null
  // Imported PDKs are user-managed external trees; comparing them against the
  // registry release would false-positive on every run. Mirrors the Resource
  // Manager listing, which only checks updates for managed PDKs.
  if (installation.ownership === 'imported' || !installation.version) return null

  const release = await options.resourceManagerService.readCachedLatestPdkRelease(
    installation.familyId,
  )
  if (!release) return null

  let updateKind: ResourceUpdateKind | null = null
  if (installation.version !== release.version) {
    updateKind = 'version'
  } else if (assetShaDrift(installation.registrySha256, release.sha256)) {
    updateKind = 'rebuild'
  }
  if (!updateKind) return null

  return {
    id: installation.id,
    display_name: installation.displayName,
    installed_version: installation.version,
    latest_version: release.version,
    update_kind: updateKind,
  }
}

/**
 * Pure cached-data staleness assessment for a flow run: zero network access
 * and never throws — failures are warn-logged and whatever could be assessed
 * is returned.
 */
export async function assessRunStaleness(
  options: RunStalenessAssessmentOptions,
): Promise<ResourceStalenessItem[]> {
  const items: ResourceStalenessItem[] = []
  try {
    const list = await options.resourceManagerService.listResources()
    logRunResourceInputs(list.resources)
    items.push(...collectStaleRunResources(list.resources))
  } catch (error) {
    electronLogger.warn('[resources] run staleness assessment failed to list', error)
  }
  try {
    const pdkItem = await assessBoundPdk(options)
    if (pdkItem) items.push(pdkItem)
  } catch (error) {
    electronLogger.warn('[resources] run staleness PDK assessment failed', error)
  }
  return items
}

/**
 * Gate a flow run on the assessment. Throws the coded
 * RESOURCE_UPDATE_AVAILABLE error (with the items in `details`) unless the
 * caller explicitly allows stale resources; the bypass is warn-logged.
 */
export function assertRunResourcesFresh(
  items: ResourceStalenessItem[],
  allowStaleResources: boolean | undefined,
  runLabel: string,
): void {
  if (items.length === 0) return
  const names = items.map((item) => item.display_name).join(', ')
  if (allowStaleResources) {
    electronLogger.warn(
      '[resources] %s proceeds with stale resources: %s',
      runLabel,
      names,
    )
    return
  }
  throw Object.assign(
    new Error(
      `Resource updates are available for: ${names}. Update them in Resource Manager or re-run with allowStaleResources.`,
    ),
    { code: RESOURCE_UPDATE_AVAILABLE, details: { resources: items } },
  )
}
