import { onScopeDispose, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  buildProjectQorTrendForManifest,
  parseProjectManifest,
  resolveProjectQorBaselineWorkspace,
  serializeProjectManifest,
  setQorBaselineInManifest,
  type ProjectQorBaselineSource,
} from '@/utils/projectManagement'
import {
  buildProjectQorWorkspaceComparison,
  type ProjectQorWorkspaceComparison,
} from '@/utils/projectQorTrend'
import { readOptionalProjectTextFile, writeProjectTextFile } from '@/utils/projectFiles'
import {
  readProjectWorkspaceAnalysisInputs,
  readProjectWorkspaceFlowStates,
} from '@/views/project-management/projectWorkspaceAnalysisData'
import { getDesktopApi } from '@/platform/desktop'
import { useWorkspace } from './useWorkspace'

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

/**
 * Loads Home's QoR data from the parent project named by the Project view route. The
 * desktop bridge grants that parent as an additional read root without changing the
 * active workspace root consumed by Home and Step resource APIs.
 */
export function useHomeQorComparison() {
  const route = useRoute()
  const { currentProject, resourceVersions } = useWorkspace()
  const state = ref<HomeQorComparisonState>(EMPTY_STATE)
  let requestToken = 0

  async function refresh(): Promise<void> {
    const token = ++requestToken
    const workspacePath = currentProject.value?.path
    const projectRoot = routeString(route.query.projectRoot)
    if (!workspacePath || !projectRoot) {
      state.value = EMPTY_STATE
      return
    }

    state.value = {
      status: 'loading',
      projectName: null,
      baselineWorkspaceName: null,
      baselineSource: null,
      comparison: null,
    }

    try {
      const registeredRoot =
        await getDesktopApi().workspace.registerProjectReadRoot(projectRoot)
      const manifestText = await readOptionalProjectTextFile('project.json', {
        projectPath: registeredRoot,
      })
      if (!manifestText) {
        if (token === requestToken) state.value = EMPTY_STATE
        return
      }

      let manifest = parseProjectManifest(manifestText)
      const currentWorkspace = manifest.workspaces.find((workspace) =>
        samePath(workspace.workspace_path, workspacePath),
      )
      if (!currentWorkspace) {
        if (token === requestToken) state.value = EMPTY_STATE
        return
      }

      const baseline = resolveProjectQorBaselineWorkspace(
        manifest,
        currentWorkspace.workspace_id,
      )
      if (!baseline) {
        if (token === requestToken) {
          state.value = {
            status: 'unavailable',
            projectName: manifest.name || null,
            baselineWorkspaceName: null,
            baselineSource: null,
            comparison: null,
          }
        }
        return
      }
      if (baseline.source === 'default') {
        manifest = setQorBaselineInManifest(
          manifest,
          baseline.workspaceId,
          'Default project QoR baseline',
        )
        await writeProjectTextFile('project.json', serializeProjectManifest(manifest), {
          projectPath: registeredRoot,
        })
      }

      const [flowStates, analysisInputs] = await Promise.all([
        readProjectWorkspaceFlowStates(manifest),
        readProjectWorkspaceAnalysisInputs(manifest),
      ])
      if (token !== requestToken) return

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
      const status: HomeQorComparisonStatus = comparison.isBaselineWorkspace
        ? 'baseline'
        : comparison.available
          ? 'available'
          : 'unavailable'

      state.value = {
        status,
        projectName: manifest.name || null,
        baselineWorkspaceName: comparison.baselineWorkspaceName,
        baselineSource: baseline.source,
        comparison,
      }
    } catch (error) {
      if (token !== requestToken) return
      console.warn('Failed to load project QoR comparison for Home:', error)
      state.value = {
        status: 'unavailable',
        projectName: null,
        baselineWorkspaceName: null,
        baselineSource: null,
        comparison: null,
      }
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

  onScopeDispose(() => {
    requestToken += 1
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
