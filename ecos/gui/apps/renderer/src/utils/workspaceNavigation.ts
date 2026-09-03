import { ref } from 'vue'
import type { LocationQuery, LocationQueryRaw, RouteLocationRaw } from 'vue-router'
import type { WorkspaceConfig } from '@/types'

export interface WorkspaceManagementReturnRoute {
  path: string
  query?: LocationQueryRaw
  params?: Record<string, string | string[]>
}

export type WorkspaceWizardInitialConfig = Partial<WorkspaceConfig> & {
  managedWorkspaceRoot?: string
  deriveDirectoryFromDesign?: boolean
  lockWorkspaceDirectory?: boolean
  standaloneWorkspace?: boolean
  suggestedWorkspaceName?: string
}

export interface WorkspaceWizardRequest {
  initialConfig?: WorkspaceWizardInitialConfig
}

export interface WorkspaceCreationRequest {
  targetPath: string
  token: number
}

const managementReturnRoute = ref<WorkspaceManagementReturnRoute | null>(null)
const pendingWorkspaceWizard = ref<WorkspaceWizardRequest | null>(null)
const workspaceCreation = ref<WorkspaceCreationRequest | null>(null)
let workspaceCreationSequence = 0

function cloneQuery(query: LocationQuery): LocationQueryRaw {
  return Object.fromEntries(
    Object.entries(query).map(([key, value]) => [
      key,
      Array.isArray(value) ? [...value] : value,
    ]),
  )
}

export function rememberWorkspaceManagementReturnRoute(route: {
  path: string
  query?: LocationQuery
  params?: Record<string, string | string[]>
}): void {
  if (!route.path.startsWith('/workspace/') || route.path === '/workspace/projects') {
    return
  }
  managementReturnRoute.value = {
    path: route.path,
    query: route.query ? cloneQuery(route.query) : undefined,
    params: route.params ? { ...route.params } : undefined,
  }
}

export function consumeWorkspaceManagementReturnRoute(): RouteLocationRaw | null {
  const route = managementReturnRoute.value
  managementReturnRoute.value = null
  return route
}

export function clearWorkspaceManagementReturnRoute(): void {
  managementReturnRoute.value = null
}

export function requestWorkspaceWizard(
  initialConfig?: WorkspaceWizardInitialConfig,
): void {
  pendingWorkspaceWizard.value = { initialConfig }
}

export function consumeWorkspaceWizardRequest(): WorkspaceWizardRequest | null {
  const request = pendingWorkspaceWizard.value
  pendingWorkspaceWizard.value = null
  return request
}

export function useWorkspaceWizardRequest() {
  return pendingWorkspaceWizard
}

export function beginWorkspaceCreation(targetPath: string): number | null {
  if (workspaceCreation.value) return null
  const token = ++workspaceCreationSequence
  workspaceCreation.value = { targetPath, token }
  return token
}

export function finishWorkspaceCreation(token: number): void {
  if (workspaceCreation.value?.token === token) workspaceCreation.value = null
}

export function useWorkspaceCreation() {
  return workspaceCreation
}
