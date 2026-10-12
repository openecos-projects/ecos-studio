import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import type {
  BackendWorkspaceArtifactContent,
  WorkspaceArtifactDescriptor,
  WorkspaceTimingSummaryDetail,
} from '@ecos-studio/shared'
import { getDesktopApi } from '@/platform/desktop'
import { useBackendWorkspaceSession } from '@/stores/backendWorkspaceSession'
import {
  buildStaOverviewModel,
  type StaCriticalPath,
} from '@/components/flow-insights/flowInsightsData'

function summarySource(detail: WorkspaceTimingSummaryDetail): Record<string, unknown> {
  const checks = (value: WorkspaceTimingSummaryDetail) => ({
    setup: {
      wns: value.setup.wns,
      tns: value.setup.tns,
      nvp: value.setup.violationCount,
      frequency_mhz: value.setup.frequencyMhz,
    },
    hold: {
      wns: value.hold.wns,
      tns: value.hold.tns,
      nvp: value.hold.violationCount,
    },
  })
  return {
    summary: checks(detail),
    path_groups: (detail.pathGroups ?? []).map((group) => ({
      name: group.name,
      ...checks({ ...detail, setup: group.setup, hold: group.hold }),
    })),
  }
}

export function useStaCornerDetails(
  artifacts: Readonly<Ref<WorkspaceArtifactDescriptor[]>>,
) {
  const session = useBackendWorkspaceSession()
  const summaries = ref(new Map<string, WorkspaceTimingSummaryDetail>())
  const summaryErrors = ref<Record<string, string>>({})
  const summaryLoading = ref(false)
  const pathsByCorner = ref<Array<{ corner: string; paths: StaCriticalPath[] }>>([])
  const pathLimits = ref<Record<string, number>>({})
  const pathErrors = ref<Record<string, string>>({})
  const pathLoading = ref<string[]>([])
  const selectedCorner = ref<string | null>(null)
  const pendingPaths = new Map<string, Promise<void>>()
  let requestVersion = 0

  const revision = computed(() => {
    const section = session.projection.data?.revision
    return section?.status === 'ready' || section?.status === 'partial'
      ? section.data.workspaceRevision
      : null
  })
  const corners = computed(() => [
    ...new Set(
      artifacts.value.flatMap((artifact) =>
        artifact.timingCorner ? [artifact.timingCorner] : [],
      ),
    ),
  ])
  const overview = computed(() =>
    corners.value.length
      ? buildStaOverviewModel(
          corners.value.map((corner) => ({
            corner,
            summary: summaries.value.has(corner)
              ? summarySource(summaries.value.get(corner)!)
              : null,
          })),
        )
      : null,
  )

  function errorCode(error: unknown): string {
    return error instanceof Error ? error.message : 'TIMING_ARTIFACT_READ_FAILED'
  }

  async function readArtifact(
    artifact: WorkspaceArtifactDescriptor,
  ): Promise<BackendWorkspaceArtifactContent> {
    const contextId = session.workspaceContextId
    const workspaceRevision = artifact.sourceRevision ?? revision.value
    if (
      !contextId ||
      workspaceRevision === null ||
      artifact.availability !== 'available'
    ) {
      throw new Error('TIMING_ARTIFACT_UNAVAILABLE')
    }
    const result = await getDesktopApi().backendWorkspace.getArtifact({
      artifactId: artifact.artifactId,
      workspaceContextId: contextId,
      workspaceRevision,
    })
    if (
      result.workspaceContextId !== contextId ||
      result.workspaceRevision !== workspaceRevision
    ) {
      throw new Error('ARTIFACT_REVISION_MISMATCH')
    }
    if (result.artifact.status !== 'ready') {
      throw new Error(result.artifact.issues[0]?.code ?? 'TIMING_ARTIFACT_UNAVAILABLE')
    }
    if (result.artifact.data.artifactId !== artifact.artifactId) {
      throw new Error('TIMING_ARTIFACT_INVALID')
    }
    return result.artifact.data
  }

  async function loadCorner(corner: string): Promise<void> {
    if (pathsByCorner.value.some((entry) => entry.corner === corner)) return
    const pending = pendingPaths.get(corner)
    if (pending) return pending
    const version = requestVersion
    const request = (async () => {
      pathLoading.value = [...pathLoading.value, corner]
      const errors = { ...pathErrors.value }
      delete errors[corner]
      pathErrors.value = errors
      try {
        const artifact = artifacts.value.find(
          (entry) => entry.kind === 'timing_paths' && entry.timingCorner === corner,
        )
        if (!artifact) throw new Error('TIMING_ARTIFACT_UNAVAILABLE')
        const content = await readArtifact(artifact)
        if (version !== requestVersion) return
        const detail = content.timingPaths
        if (!detail || detail.corner !== corner)
          throw new Error('TIMING_ARTIFACT_INVALID')
        pathsByCorner.value = [
          ...pathsByCorner.value,
          {
            corner,
            paths: detail.paths.map((path) => ({
              id: `${corner}:${path.pathId}`,
              corner,
              analysisType: path.analysisType,
              slackNs: path.slackNs,
              startPoint: path.startPoint,
              endPoint: path.endPoint,
              pathGroup: path.pathGroup,
              stageCount: path.stages.length,
              stages: path.stages,
            })),
          },
        ]
        pathLimits.value = { ...pathLimits.value, [corner]: detail.pathLimit }
      } catch (error) {
        if (version === requestVersion)
          pathErrors.value = { ...pathErrors.value, [corner]: errorCode(error) }
      } finally {
        if (version === requestVersion)
          pathLoading.value = pathLoading.value.filter((value) => value !== corner)
      }
    })()
    pendingPaths.set(corner, request)
    try {
      await request
    } finally {
      if (pendingPaths.get(corner) === request) pendingPaths.delete(corner)
    }
  }

  function selectCorner(corner: string | null): void {
    selectedCorner.value = corner
    if (corner) void loadCorner(corner)
  }

  async function refresh(): Promise<void> {
    const version = ++requestVersion
    summaries.value = new Map()
    summaryErrors.value = {}
    pathsByCorner.value = []
    pathLimits.value = {}
    pathErrors.value = {}
    pathLoading.value = []
    pendingPaths.clear()
    summaryLoading.value = corners.value.length > 0
    await Promise.all(
      corners.value.map(async (corner) => {
        try {
          const artifact = artifacts.value.find(
            (entry) => entry.kind === 'timing_summary' && entry.timingCorner === corner,
          )
          if (!artifact) throw new Error('TIMING_ARTIFACT_UNAVAILABLE')
          const content = await readArtifact(artifact)
          if (version !== requestVersion) return
          const detail = content.timingSummary
          if (!detail || detail.corner !== corner)
            throw new Error('TIMING_ARTIFACT_INVALID')
          summaries.value = new Map(summaries.value).set(corner, detail)
        } catch (error) {
          if (version === requestVersion)
            summaryErrors.value = { ...summaryErrors.value, [corner]: errorCode(error) }
        }
      }),
    )
    if (version !== requestVersion) return
    summaryLoading.value = false
    const next =
      selectedCorner.value && corners.value.includes(selectedCorner.value)
        ? selectedCorner.value
        : (overview.value?.worstSetup?.corner ?? corners.value[0] ?? null)
    selectCorner(next)
  }

  watch(
    () =>
      JSON.stringify([
        session.generation,
        session.workspaceContextId,
        revision.value,
        artifacts.value,
      ]),
    () => {
      void refresh()
    },
    { immediate: true },
  )
  onScopeDispose(() => {
    requestVersion += 1
  })

  return {
    overview,
    summaryLoading,
    summaryErrors,
    pathsByCorner,
    pathLimits,
    pathErrors,
    pathLoading,
    selectedCorner,
    selectCorner,
    refresh,
  }
}
