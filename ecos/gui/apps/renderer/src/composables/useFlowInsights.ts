import type {
  BackendWorkspaceArtifactContent,
  WorkspaceArtifactDescriptor,
  WorkspaceTimingSummaryDetail,
} from '@ecos-studio/shared'
import { computed, onScopeDispose, ref, watch } from 'vue'
import {
  buildDrcRelatedMetrics,
  type StaCriticalPath,
} from '@/components/flow-insights/flowInsightsData'
import { useBackendWorkspaceSession } from '@/stores/backendWorkspaceSession'
import { getDesktopApi } from '@/platform/desktop'
import {
  buildSnapshotFlowInsights,
  mergeStaTimingSummaries,
} from './snapshotFlowInsights'

export type { FlowInsightsData } from './snapshotFlowInsights'

export function useFlowInsights() {
  const session = useBackendWorkspaceSession()
  const data = computed(() => buildSnapshotFlowInsights(session.projection.data))
  const congestionTileUrls = ref(new Map<string, string>())
  const timingSummaries = ref<WorkspaceTimingSummaryDetail[]>([])
  const timingPathsByCorner = ref<Array<{ corner: string; paths: StaCriticalPath[] }>>([])
  const timingRunInfo = ref<Array<{ id: string; label: string; value: string }>>([])
  const timingSelectedCorner = ref<string | null>(null)
  const timingDetailLoading = ref<string[]>([])
  const timingDetailErrors = ref<Record<string, string>>({})
  let loadVersion = 0
  let timingVersion = 0
  let timingContextId = ''
  let timingRevision: number | null = null
  let timingSummaryKey = ''
  let timingSummaryLoad: Promise<void> | null = null
  const timingPathLoads = new Map<string, Promise<void>>()
  const timingPathArtifacts = new Map<string, WorkspaceArtifactDescriptor>()

  function clearCongestionUrls(): void {
    for (const url of congestionTileUrls.value.values()) {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url)
    }
    congestionTileUrls.value = new Map()
  }

  function clearTiming(): void {
    timingVersion += 1
    timingContextId = ''
    timingRevision = null
    timingSummaryKey = ''
    timingSummaryLoad = null
    timingPathLoads.clear()
    timingPathArtifacts.clear()
    timingSummaries.value = []
    timingPathsByCorner.value = []
    timingRunInfo.value = []
    timingSelectedCorner.value = null
    timingDetailLoading.value = []
    timingDetailErrors.value = {}
  }

  function setTimingLoading(corner: string, active: boolean): void {
    const values = new Set(timingDetailLoading.value)
    if (active) values.add(corner)
    else values.delete(corner)
    timingDetailLoading.value = [...values]
  }

  function setTimingError(corner: string, code: string | null): void {
    const errors = { ...timingDetailErrors.value }
    if (code) errors[corner] = code
    else delete errors[corner]
    timingDetailErrors.value = errors
  }

  function committedRevision(): number | null {
    const revision = session.projection.data?.revision
    return revision?.status === 'ready' || revision?.status === 'partial'
      ? revision.data.workspaceRevision
      : null
  }

  async function readTimingArtifact(
    artifact: WorkspaceArtifactDescriptor,
    contextId: string,
    revision: number,
    version: number,
  ): Promise<BackendWorkspaceArtifactContent | null> {
    const result = await getDesktopApi().backendWorkspace.getArtifact({
      artifactId: artifact.artifactId,
      workspaceContextId: contextId,
      workspaceRevision: revision,
    })
    if (
      version !== timingVersion ||
      result.workspaceContextId !== contextId ||
      result.workspaceRevision !== revision ||
      result.artifact.status !== 'ready' ||
      result.artifact.data.artifactId !== artifact.artifactId
    ) {
      return null
    }
    return result.artifact.data
  }

  async function loadTimingCorner(corner: string | null): Promise<void> {
    timingSelectedCorner.value = corner
    if (!corner) return
    const artifact = timingPathArtifacts.get(corner)
    const contextId = timingContextId
    const revision = timingRevision
    if (!artifact || !contextId || revision === null) {
      setTimingError(corner, 'TIMING_ARTIFACT_UNAVAILABLE')
      return
    }
    if (timingPathsByCorner.value.some((item) => item.corner === corner)) return
    const key = `${contextId}\u0000${revision}\u0000${corner}`
    const pending = timingPathLoads.get(key)
    if (pending) return await pending
    const version = timingVersion
    const request = (async () => {
      setTimingLoading(corner, true)
      setTimingError(corner, null)
      try {
        const artifactData = await readTimingArtifact(
          artifact,
          contextId,
          artifact.sourceRevision ?? revision,
          version,
        )
        const detail = artifactData?.timingPaths
        if (!detail || detail.corner !== corner) {
          setTimingError(corner, 'TIMING_ARTIFACT_INVALID')
          return
        }
        const paths = detail.paths.map((path) => ({
          id: `${corner}:${path.pathId}`,
          corner,
          analysisType: path.analysisType,
          slackNs: path.slackNs,
          stageCount: path.stages.length,
          stages: path.stages,
        }))
        timingPathsByCorner.value = [
          ...timingPathsByCorner.value.filter((item) => item.corner !== corner),
          { corner, paths },
        ]
        timingRunInfo.value = [
          ...timingRunInfo.value.filter((item) => item.id !== `path-limit-${corner}`),
          {
            id: `path-limit-${corner}`,
            label: `${corner} path limit`,
            value: String(detail.pathLimit),
          },
        ]
      } catch {
        setTimingError(corner, 'TIMING_ARTIFACT_READ_FAILED')
      } finally {
        if (version === timingVersion) setTimingLoading(corner, false)
      }
    })()
    timingPathLoads.set(key, request)
    try {
      await request
    } finally {
      if (timingPathLoads.get(key) === request) timingPathLoads.delete(key)
    }
  }

  async function loadTiming(): Promise<void> {
    const contextId = session.workspaceContextId
    const revision = committedRevision()
    const artifacts = data.value?.timingArtifacts ?? []
    if (!contextId || revision === null) return
    const summaryArtifacts = artifacts.filter(
      (artifact) => artifact.kind === 'timing_summary' && artifact.timingCorner,
    )
    const pathArtifacts = artifacts.filter(
      (artifact) => artifact.kind === 'timing_paths' && artifact.timingCorner,
    )
    const key = `${contextId}\u0000${revision}`
    timingContextId = contextId
    timingRevision = revision

    if (timingSummaryKey !== key) {
      timingPathLoads.clear()
      timingPathArtifacts.clear()
      for (const artifact of pathArtifacts)
        timingPathArtifacts.set(artifact.timingCorner!, artifact)
      timingSummaries.value = []
      timingPathsByCorner.value = []
      timingRunInfo.value = []
      timingSelectedCorner.value = null
      timingDetailLoading.value = []
      timingDetailErrors.value = {}
      timingSummaryKey = key
      const version = timingVersion
      timingSummaryLoad = (async () => {
        const summaries = await Promise.all(
          summaryArtifacts.slice(0, 32).map(async (artifact) => {
            try {
              const artifactData = await readTimingArtifact(
                artifact,
                contextId,
                artifact.sourceRevision ?? revision,
                version,
              )
              return artifactData?.timingSummary ?? null
            } catch {
              return null
            }
          }),
        )
        if (version === timingVersion) {
          timingSummaries.value = summaries.filter(
            (summary): summary is WorkspaceTimingSummaryDetail => summary !== null,
          )
        }
      })()
      try {
        await timingSummaryLoad
      } finally {
        if (timingSummaryKey === key) timingSummaryLoad = null
      }
    } else if (timingSummaryLoad) {
      await timingSummaryLoad
    }

    const overview = mergeStaTimingSummaries(
      data.value?.sta ?? null,
      timingSummaries.value,
    )
    await loadTimingCorner(
      timingSelectedCorner.value ?? overview?.worstSetup?.corner ?? null,
    )
  }

  async function loadCongestion(): Promise<void> {
    const contextId = session.workspaceContextId
    const revision = session.projection.data?.revision
    if (
      !contextId ||
      !revision ||
      (revision.status !== 'ready' && revision.status !== 'partial')
    ) {
      return
    }
    const workspaceRevision = revision.data.workspaceRevision
    const version = ++loadVersion
    const next = new Map(congestionTileUrls.value)
    const createdUrls: string[] = []
    await Promise.all(
      (data.value?.congestionTiles ?? []).map(async (tile) => {
        if (next.has(tile.pngPath)) return
        const artifactRevision = tile.sourceRevision ?? workspaceRevision
        const result = await getDesktopApi().backendWorkspace.getArtifact({
          artifactId: tile.pngPath,
          workspaceContextId: contextId,
          workspaceRevision: artifactRevision,
        })
        if (
          version !== loadVersion ||
          result.workspaceContextId !== contextId ||
          result.workspaceRevision !== artifactRevision ||
          result.artifact.status !== 'ready' ||
          !result.artifact.data.bytes ||
          result.artifact.data.artifactId !== tile.pngPath
        ) {
          return
        }
        const url = URL.createObjectURL(
          new Blob([result.artifact.data.bytes.slice()], {
            type: result.artifact.data.mimeType,
          }),
        )
        createdUrls.push(url)
        next.set(tile.pngPath, url)
      }),
    )
    if (version === loadVersion) {
      congestionTileUrls.value = next
    } else {
      for (const url of createdUrls) URL.revokeObjectURL(url)
    }
  }

  watch(
    () => data.value?.signature ?? '',
    () => {
      loadVersion += 1
      clearCongestionUrls()
      clearTiming()
    },
  )
  onScopeDispose(() => {
    loadVersion += 1
    clearCongestionUrls()
    clearTiming()
  })

  const sta = computed(() =>
    mergeStaTimingSummaries(data.value?.sta ?? null, timingSummaries.value),
  )
  return {
    data,
    stepResources: computed(() => data.value?.stepResources ?? null),
    dbTrends: computed(() => data.value?.dbTrends ?? null),
    instanceComposition: computed(() => data.value?.instanceComposition ?? null),
    congestionTiles: computed(() => data.value?.congestionTiles ?? []),
    congestionTileUrls,
    loadCongestion,
    drc: computed(() => data.value?.drc ?? null),
    drcRelated: computed(() => data.value?.drcRelated ?? buildDrcRelatedMetrics()),
    sta,
    staCriticalPaths: computed(() => data.value?.staCriticalPaths ?? null),
    timingPathsByCorner,
    timingRunInfo,
    timingSelectedCorner,
    timingDetailLoading,
    timingDetailErrors,
    loadTiming,
    loadTimingCorner,
    loading: computed(
      () =>
        session.projection.status === 'loading' ||
        session.projection.status === 'refreshing',
    ),
    error: computed(() =>
      session.projection.status === 'error' || session.projection.status === 'stale'
        ? (session.projection.issue.detail ?? session.projection.issue.code)
        : null,
    ),
    refresh: () => session.refresh(),
  }
}
