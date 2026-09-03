import { computed, onScopeDispose, ref, watch } from 'vue'
import { buildDrcRelatedMetrics } from '@/components/flow-insights/flowInsightsData'
import { useBackendWorkspaceSession } from '@/stores/backendWorkspaceSession'
import { getDesktopApi } from '@/platform/desktop'
import { buildSnapshotFlowInsights } from './snapshotFlowInsights'

export type { FlowInsightsData } from './snapshotFlowInsights'

export function useFlowInsights() {
  const session = useBackendWorkspaceSession()
  const data = computed(() => buildSnapshotFlowInsights(session.projection.data))
  const congestionTileUrls = ref(new Map<string, string>())
  let loadVersion = 0

  function clearCongestionUrls(): void {
    for (const url of congestionTileUrls.value.values()) {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url)
    }
    congestionTileUrls.value = new Map()
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
        const result = await getDesktopApi().backendWorkspace.getArtifact({
          artifactId: tile.pngPath,
          workspaceContextId: contextId,
          workspaceRevision,
        })
        if (
          version !== loadVersion ||
          result.workspaceContextId !== contextId ||
          result.workspaceRevision !== workspaceRevision ||
          result.artifact.status !== 'ready'
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
    },
  )
  onScopeDispose(() => {
    loadVersion += 1
    clearCongestionUrls()
  })

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
    sta: computed(() => data.value?.sta ?? null),
    staCriticalPaths: computed(() => data.value?.staCriticalPaths ?? null),
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
