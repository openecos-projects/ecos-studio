import type {
  BackendWorkspaceArtifactContent,
  BackendWorkspaceStepDetailResult,
  WorkspaceStepDetail,
} from '@ecos-studio/shared'
import { computed, onScopeDispose, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { onWorkspaceRerunPrepared } from '@/composables/homeRunArtifacts'
import { useWorkspace } from '@/composables/useWorkspace'
import { getDesktopApi } from '@/platform/desktop'
import { useBackendWorkspaceSession } from '@/stores/backendWorkspaceSession'
import {
  snapshotStepDashboardData,
  applyTimingArtifacts,
  type StepDashboardData,
} from './stepDashboardSnapshot'

export type { StepDashboardData, StepDashboardReport } from './stepDashboardSnapshot'

const stepDashboardCache = new Map<string, StepDashboardData>()

function revokeDashboardData(data: StepDashboardData): void {
  if (data.layoutUrl?.startsWith('blob:')) URL.revokeObjectURL(data.layoutUrl)
  for (const url of data.congestionTileUrls.values()) {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url)
  }
}

function cacheKey(
  projectPath: string,
  contextId: string,
  step: string,
  revision: number,
): string {
  return `${projectPath.replace(/\\/g, '/')}\u0000${contextId}\u0000${step.toLowerCase()}\u0000${revision}`
}

export function clearStepDashboardDataCache(): void {
  for (const data of stepDashboardCache.values()) revokeDashboardData(data)
  stepDashboardCache.clear()
}

export function clearStepDashboardDataForRerun(
  projectPath: string,
  affectedSteps: readonly string[],
): void {
  const workspace = projectPath.replace(/\\/g, '/')
  const affected = new Set(affectedSteps.map((step) => step.trim().toLowerCase()))
  for (const key of stepDashboardCache.keys()) {
    const [cachedWorkspace, , cachedStep] = key.split('\u0000')
    if (
      cachedWorkspace === workspace &&
      (!affected.size || affected.has(cachedStep ?? ''))
    ) {
      const cached = stepDashboardCache.get(key)
      if (cached) revokeDashboardData(cached)
      stepDashboardCache.delete(key)
    }
  }
}

function readyDetail(
  result: BackendWorkspaceStepDetailResult,
  contextId: string,
  revision: number,
): WorkspaceStepDetail | null {
  return result.workspaceContextId === contextId &&
    result.workspaceRevision === revision &&
    (result.detail.status === 'ready' || result.detail.status === 'partial')
    ? result.detail.data
    : null
}

export function useStepDashboardData() {
  const route = useRoute()
  const { currentProject } = useWorkspace()
  const session = useBackendWorkspaceSession()
  const data = ref<StepDashboardData | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let requestVersion = 0

  const currentStep = computed(() => {
    const param = route.params.step
    if (typeof param === 'string' && param) return param
    const segments = route.path.split('/').filter(Boolean)
    return segments[segments.length - 1] ?? ''
  })

  function committedRevision(): number | null {
    const section = session.projection.data?.revision
    return section?.status === 'ready' || section?.status === 'partial'
      ? section.data.workspaceRevision
      : null
  }

  async function refresh(): Promise<void> {
    const projectPath = currentProject.value?.path
    const stepId = currentStep.value
    const contextId = session.workspaceContextId
    const revision = committedRevision()
    const version = ++requestVersion
    if (!projectPath || !stepId || !contextId || revision === null) {
      data.value = null
      loading.value = false
      return
    }
    const key = cacheKey(projectPath, contextId, stepId, revision)
    const cached = stepDashboardCache.get(key)
    data.value = cached ?? null
    loading.value = true
    error.value = null
    try {
      const result = await getDesktopApi().backendWorkspace.getStepDetail({
        stepId,
        workspaceContextId: contextId,
        workspaceRevision: revision,
      })
      if (version !== requestVersion) return
      const detail = readyDetail(result, contextId, revision)
      if (!detail) {
        error.value = result.detail.issues[0]?.code ?? 'WORKSPACE_STEP_DETAIL_UNAVAILABLE'
        if (!cached) data.value = null
        return
      }
      const next = snapshotStepDashboardData(detail)
      const artifacts =
        next.staleRevision !== null && detail.staleEvidence
          ? detail.staleEvidence.artifacts
          : detail.artifacts
      const artifactRevision = next.staleRevision ?? revision
      const readArtifact = async (
        artifactId: string,
      ): Promise<BackendWorkspaceArtifactContent | null> => {
        const artifact = await getDesktopApi().backendWorkspace.getArtifact({
          artifactId,
          workspaceContextId: contextId,
          workspaceRevision: artifactRevision,
        })
        if (
          version !== requestVersion ||
          artifact.workspaceContextId !== contextId ||
          artifact.workspaceRevision !== artifactRevision ||
          artifact.artifact.status !== 'ready'
        ) {
          return null
        }
        return artifact.artifact.data
      }
      const readImage = async (artifactId: string): Promise<string | null> => {
        const artifact = await readArtifact(artifactId)
        if (!artifact) return null
        const url = URL.createObjectURL(
          new Blob([artifact.bytes.slice()], {
            type: artifact.mimeType,
          }),
        )
        if (version !== requestVersion) {
          URL.revokeObjectURL(url)
          return null
        }
        return url
      }
      const layout = artifacts.find(
        (artifact) =>
          artifact.kind === 'layout_image' && artifact.availability === 'available',
      )
      if (layout) {
        next.layoutUrl = await readImage(layout.artifactId)
        if (!next.layoutUrl && version === requestVersion) {
          next.layoutAvailability = 'stale'
        }
      }
      const congestionUrls = await Promise.all(
        next.congestionTiles.map(
          async (tile) => [tile.pngPath, await readImage(tile.pngPath)] as const,
        ),
      )
      for (const [artifactId, url] of congestionUrls) {
        if (url) next.congestionTileUrls.set(artifactId, url)
      }
      next.mapUrl = next.congestionTileUrls.values().next().value ?? null
      const timingSummaries = []
      const timingPaths = []
      for (const descriptor of artifacts
        .filter(
          (artifact) =>
            artifact.availability === 'available' &&
            (artifact.kind === 'timing_summary' || artifact.kind === 'timing_paths'),
        )
        .slice(0, 32)) {
        const artifact = await readArtifact(descriptor.artifactId)
        if (artifact?.timingSummary) timingSummaries.push(artifact.timingSummary)
        if (artifact?.timingPaths) timingPaths.push(artifact.timingPaths)
      }
      applyTimingArtifacts(next, timingSummaries, timingPaths)
      if (version !== requestVersion) {
        revokeDashboardData(next)
        return
      }
      const previous = stepDashboardCache.get(key)
      if (previous && previous !== next) revokeDashboardData(previous)
      stepDashboardCache.set(key, next)
      data.value = next
    } catch (cause) {
      if (version !== requestVersion) return
      error.value = cause instanceof Error ? cause.message : String(cause)
      if (!cached) data.value = null
    } finally {
      if (version === requestVersion) loading.value = false
    }
  }

  const unregisterRerun = onWorkspaceRerunPrepared((event) => {
    const projectPath = currentProject.value?.path
    if (
      !projectPath ||
      projectPath.replace(/\\/g, '/') !== event.projectPath.replace(/\\/g, '/')
    ) {
      return
    }
    clearStepDashboardDataForRerun(projectPath, event.affectedSteps)
    if (
      !event.affectedSteps.length ||
      event.affectedSteps.some(
        (step) => step.toLowerCase() === currentStep.value.toLowerCase(),
      )
    ) {
      requestVersion += 1
      data.value = null
    }
  })

  watch(
    () => [
      currentStep.value,
      currentProject.value?.path ?? '',
      session.workspaceContextId,
      session.generation,
      committedRevision(),
    ],
    () => void refresh(),
    { immediate: true },
  )

  onScopeDispose(() => {
    requestVersion += 1
    unregisterRerun()
  })

  return { currentStep, data, error, loading, refresh }
}
