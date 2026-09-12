import { onScopeDispose, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { parseProjectManifest } from '@ecos-studio/shared'
import {
  buildProjectQorTrendForManifest,
  resolveProjectQorBaselineWorkspace,
  type ProjectQorBaselineSource,
} from '@/utils/projectManagement'
import {
  buildProjectQorWorkspaceComparison,
  type ProjectQorWorkspaceComparison,
} from '@/utils/projectQorTrend'
import { resolveProjectRouteContextForWorkspace } from '@/utils/projectManifestRegistration'
import { readProjectQorWorkspaceData } from '@/views/project-management/projectWorkspaceAnalysisData'
import { getDesktopApi } from '@/platform/desktop'
import { onWorkspaceRerunPrepared } from './homeRunArtifacts'
import { useWorkspace } from './useWorkspace'
import { registerRuntimeStepRenderTask } from './runtimeStepRenderSync'
import type {
  ProjectWorkspaceAnalysisInput,
  ProjectWorkspaceFlowStateMap,
} from '@/utils/projectManagement'

export type HomeQorComparisonStatus =
  | 'loading'
  | 'available'
  | 'baseline'
  | 'no-project'
  | 'no-baseline'
  | 'unavailable'

export interface HomeQorComparisonState {
  status: HomeQorComparisonStatus
  projectName: string | null
  baselineWorkspaceName: string | null
  baselineSource: ProjectQorBaselineSource | null
  comparison: ProjectQorWorkspaceComparison | null
}

const EMPTY_STATE: HomeQorComparisonState = {
  status: 'no-project',
  projectName: null,
  baselineWorkspaceName: null,
  baselineSource: null,
  comparison: null,
}

const homeQorComparisonCache = new Map<string, HomeQorComparisonState>()
const homeQorWorkspaceCache = new Map<
  string,
  {
    analysis: ProjectWorkspaceAnalysisInput
    flow: ProjectWorkspaceFlowStateMap
  }
>()
const QOR_READ_TIMEOUT_MS = 12_000

function homeQorComparisonCacheKey(workspacePath: string, projectRoot: string): string {
  return `${workspacePath.trim()}\u0000${projectRoot.trim()}`
}

/** Clears route-scoped QoR comparison snapshots when the workspace is closed. */
export function clearHomeQorComparisonCache(): void {
  homeQorComparisonCache.clear()
  homeQorWorkspaceCache.clear()
}

function clearHomeQorComparisonCacheForWorkspace(workspacePath: string): void {
  const normalizedWorkspacePath = normalizePath(workspacePath)
  for (const cacheKey of homeQorComparisonCache.keys()) {
    const [cachedWorkspacePath] = cacheKey.split('\u0000')
    if (normalizePath(cachedWorkspacePath ?? '') === normalizedWorkspacePath) {
      homeQorComparisonCache.delete(cacheKey)
    }
  }
}

/**
 * Loads Home's QoR data from the parent project named by the Project view route. The
 * desktop bridge grants that parent as an additional read root without changing the
 * active workspace root consumed by Home and Step resource APIs.
 */
export function useHomeQorComparison() {
  const route = useRoute()
  const { currentProject, resourceVersions } = useWorkspace()
  const initialWorkspacePath = currentProject.value?.path
  const initialProjectRoot = routeString(route.query.projectRoot)
  const initialCacheKey =
    initialWorkspacePath && initialProjectRoot
      ? homeQorComparisonCacheKey(initialWorkspacePath, initialProjectRoot)
      : null
  const state = ref<HomeQorComparisonState>(
    initialCacheKey
      ? (homeQorComparisonCache.get(initialCacheKey) ?? EMPTY_STATE)
      : EMPTY_STATE,
  )
  let requestToken = 0
  let disposed = false
  let refreshPromise: Promise<void> | null = null
  let refreshRequests = 0

  const unregisterWorkspaceRerunPrepared = onWorkspaceRerunPrepared((event) => {
    const workspacePath = currentProject.value?.path
    if (!workspacePath || !samePath(event.projectPath, workspacePath)) return
    requestToken += 1
    clearHomeQorComparisonCacheForWorkspace(workspacePath)
    state.value = {
      status: 'loading',
      projectName: null,
      baselineWorkspaceName: null,
      baselineSource: null,
      comparison: null,
    }
  })

  function refresh(): Promise<void> {
    refreshRequests += 1
    if (!refreshPromise) {
      refreshPromise = drainRefreshRequests()
    }
    return refreshPromise
  }

  async function drainRefreshRequests(): Promise<void> {
    let completedRequests = 0
    try {
      while (!disposed && completedRequests < refreshRequests) {
        completedRequests = refreshRequests
        await refreshOnce()
      }
    } finally {
      refreshPromise = null
    }
  }

  async function refreshOnce(): Promise<void> {
    const token = ++requestToken
    const workspacePath = currentProject.value?.path
    if (!workspacePath) {
      state.value = EMPTY_STATE
      return
    }

    let projectRoot: string | null
    try {
      projectRoot =
        routeString(route.query.projectRoot) ??
        (
          await withQorReadDeadline(
            resolveProjectRouteContextForWorkspace(workspacePath),
            'project context',
          )
        )?.projectRoot ??
        null
    } catch (error) {
      if (disposed || token !== requestToken) return
      console.warn('Failed to resolve project context for Home QoR:', error)
      if (!state.value.comparison) {
        state.value = {
          status: 'unavailable',
          projectName: null,
          baselineWorkspaceName: null,
          baselineSource: null,
          comparison: null,
        }
      }
      return
    }
    if (disposed || token !== requestToken || !projectRoot) {
      if (!disposed && token === requestToken) state.value = EMPTY_STATE
      return
    }

    const cacheKey = homeQorComparisonCacheKey(workspacePath, projectRoot)
    const cachedState = homeQorComparisonCache.get(cacheKey)
    if (cachedState) {
      state.value = cachedState
    } else {
      state.value = {
        status: 'loading',
        projectName: null,
        baselineWorkspaceName: null,
        baselineSource: null,
        comparison: null,
      }
    }

    function updateState(nextState: HomeQorComparisonState): void {
      if (disposed || token !== requestToken) return
      state.value = nextState
      homeQorComparisonCache.set(cacheKey, nextState)
    }

    try {
      const projectManagement = getDesktopApi().projectManagement
      if (!projectManagement) throw new Error('Project QoR reads are unavailable.')
      const manifestText = await withQorReadDeadline(
        projectManagement.readManifest(projectRoot),
        'project manifest',
      )
      if (!manifestText) {
        updateState(EMPTY_STATE)
        return
      }

      let manifest = parseProjectManifest(manifestText)
      const currentWorkspace = manifest.workspaces.find((workspace) =>
        samePath(workspace.workspace_path, workspacePath),
      )
      if (!currentWorkspace) {
        updateState(EMPTY_STATE)
        return
      }

      const baseline = resolveProjectQorBaselineWorkspace(
        manifest,
        currentWorkspace.workspace_id,
      )
      if (!baseline) {
        updateState({
          status: 'unavailable',
          projectName: manifest.name || null,
          baselineWorkspaceName: null,
          baselineSource: null,
          comparison: null,
        })
        return
      }
      const currentWorkspaceId = currentWorkspace.workspace_id
      const workspaceCacheKey = (workspaceId: string) =>
        `${projectRoot}\u0000${workspaceId}`
      const loadWorkspaceIds = [currentWorkspaceId]
      if (
        baseline.workspaceId !== currentWorkspaceId &&
        !homeQorWorkspaceCache.has(workspaceCacheKey(baseline.workspaceId))
      ) {
        loadWorkspaceIds.push(baseline.workspaceId)
      }
      const loaded = await withQorReadDeadline(
        readProjectQorWorkspaceData(projectRoot, manifest, loadWorkspaceIds),
        'Dashboard QoR inputs',
      )
      if (disposed || token !== requestToken) return

      const unavailableWorkspaceIds = new Set(loaded.unavailableWorkspaceIds ?? [])
      const hasUncachedUnavailableWorkspace = loadWorkspaceIds.some(
        (workspaceId) =>
          unavailableWorkspaceIds.has(workspaceId) &&
          !homeQorWorkspaceCache.has(workspaceCacheKey(workspaceId)),
      )
      for (const workspaceId of loadWorkspaceIds) {
        if (unavailableWorkspaceIds.has(workspaceId)) continue
        homeQorWorkspaceCache.set(workspaceCacheKey(workspaceId), {
          analysis: loaded.analysisInputs[workspaceId] ?? {},
          flow: loaded.flowStates[workspaceId] ?? {},
        })
      }
      const flowStates = Object.fromEntries(
        [currentWorkspaceId, baseline.workspaceId].map((workspaceId) => [
          workspaceId,
          homeQorWorkspaceCache.get(workspaceCacheKey(workspaceId))?.flow ?? {},
        ]),
      )
      const analysisInputs = Object.fromEntries(
        [currentWorkspaceId, baseline.workspaceId].map((workspaceId) => [
          workspaceId,
          homeQorWorkspaceCache.get(workspaceCacheKey(workspaceId))?.analysis ?? {},
        ]),
      )

      const trend = buildProjectQorTrendForManifest(
        manifest,
        flowStates,
        analysisInputs,
        {
          baselineWorkspaceId: baseline.workspaceId,
        },
      )
      const comparison = buildProjectQorWorkspaceComparison(
        trend,
        currentWorkspace.workspace_id,
      )
      const status: HomeQorComparisonStatus = hasUncachedUnavailableWorkspace
        ? 'unavailable'
        : comparison.isBaselineWorkspace
          ? 'baseline'
          : comparison.available
            ? 'available'
            : 'unavailable'

      updateState({
        status,
        projectName: manifest.name || null,
        baselineWorkspaceName: comparison.baselineWorkspaceName,
        baselineSource: baseline.source,
        comparison,
      })
    } catch (error) {
      if (disposed || token !== requestToken) return
      console.warn('Failed to load project QoR comparison for Home:', error)
      if (cachedState) {
        state.value = cachedState
        return
      }
      updateState({
        status: 'unavailable',
        projectName: null,
        baselineWorkspaceName: null,
        baselineSource: null,
        comparison: null,
      })
    }
  }

  watch(
    () => [
      currentProject.value?.path ?? '',
      routeString(route.query.projectRoot) ?? '',
      resourceVersions.value.home,
      resourceVersions.value.step,
      resourceVersions.value.all,
    ],
    () => {
      void refresh()
    },
    { immediate: true },
  )

  const unregisterStepRenderTask = registerRuntimeStepRenderTask(async () => {
    await refresh()
  })

  onScopeDispose(() => {
    disposed = true
    requestToken += 1
    unregisterWorkspaceRerunPrepared()
    unregisterStepRenderTask()
  })

  return { state, refresh }
}

function routeString(value: unknown): string | null {
  const routeValue = Array.isArray(value) ? value[0] : value
  return typeof routeValue === 'string' && routeValue.trim() ? routeValue : null
}

function samePath(left: string, right: string): boolean {
  return normalizePath(left) === normalizePath(right)
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/g, '')
}

/**
 * QoR is an optional Dashboard surface. A slow NFS read must not keep the
 * step-render gate open and stall the ECC operation waiting for its GUI ACK.
 */
function withQorReadDeadline<T>(request: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error(`Timed out after ${QOR_READ_TIMEOUT_MS}ms while reading ${label}.`),
      )
    }, QOR_READ_TIMEOUT_MS)
    request.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}
