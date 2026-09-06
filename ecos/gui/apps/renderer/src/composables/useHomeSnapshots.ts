import type { WorkspaceArtifactDescriptor } from '@ecos-studio/shared'
import { onScopeDispose, ref, watch } from 'vue'
import { onWorkspaceRerunPrepared } from './homeRunArtifacts'
import { useWorkspace } from './useWorkspace'
import { getDesktopApi } from '@/platform/desktop'
import { useBackendWorkspaceSession } from '@/stores/backendWorkspaceSession'

export interface HomeLayoutThumbnail {
  id: string
  kind: 'layout'
  label: string
  step: string
  url: string | null
  hasGeometry: boolean
  availability: WorkspaceArtifactDescriptor['availability']
  reason: string | null
}

const layoutUrls = new Map<string, string>()
const layoutSteps = new Set([
  'floorplan',
  'place',
  'cts',
  'legalization',
  'timing optimization',
  'route',
  'drc',
  'lvs',
  'filler',
  'rcx',
  'sta',
  'harden',
])

function revoke(url: string): void {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url)
}

export function clearHomeSnapshotCache(): void {
  for (const url of layoutUrls.values()) revoke(url)
  layoutUrls.clear()
}

function availableArtifacts(
  artifacts: WorkspaceArtifactDescriptor[],
  kind: string,
): WorkspaceArtifactDescriptor[] {
  return artifacts.filter(
    (artifact) => artifact.kind === kind && artifact.availability === 'available',
  )
}

export function useHomeSnapshots() {
  const { currentProject } = useWorkspace()
  const session = useBackendWorkspaceSession()
  const layoutThumbnails = ref<HomeLayoutThumbnail[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  let requestVersion = 0

  async function refresh(): Promise<void> {
    const contextId = session.workspaceContextId
    const overview = session.projection.data
    const revisionSection = overview?.revision
    const artifactSection = overview?.artifacts
    const flowSection = overview?.flow
    const revision =
      revisionSection?.status === 'ready' || revisionSection?.status === 'partial'
        ? revisionSection.data.workspaceRevision
        : null
    const version = ++requestVersion
    if (
      !currentProject.value ||
      !contextId ||
      revision === null ||
      !artifactSection ||
      (artifactSection.status !== 'ready' && artifactSection.status !== 'partial') ||
      !flowSection ||
      (flowSection.status !== 'ready' && flowSection.status !== 'partial')
    ) {
      clearHomeSnapshotCache()
      layoutThumbnails.value = []
      loading.value = false
      return
    }

    const artifacts = artifactSection.data.items
    const successfulSteps = new Set(
      flowSection.data.steps
        .filter((step) => step.state === 'succeeded' || step.state === 'skipped')
        .map((step) => step.stepId.trim().toLowerCase()),
    )
    const images = artifacts
      .filter(
        (artifact) =>
          artifact.kind === 'layout_image' &&
          artifact.availability !== 'missing' &&
          artifact.stepId &&
          layoutSteps.has(artifact.stepId.trim().toLowerCase()) &&
          (artifact.sourceRevision !== undefined ||
            successfulSteps.has(artifact.stepId.trim().toLowerCase())),
      )
      .slice(0, 16)
    const geometrySteps = new Set(
      availableArtifacts(artifacts, 'layout_geometry').map((artifact) =>
        artifact.stepId?.trim().toLowerCase(),
      ),
    )
    loading.value = true
    error.value = null
    try {
      const thumbnails = await Promise.all(
        images.map(async (artifact) => {
          const step = artifact.stepId!
          const thumbnail = (
            url: string | null,
            availability: WorkspaceArtifactDescriptor['availability'] = artifact.availability,
            reason: string | null = null,
          ): HomeLayoutThumbnail => ({
            id: artifact.artifactId,
            kind: 'layout',
            label: `${step} Layout`,
            step,
            url,
            hasGeometry: geometrySteps.has(step.trim().toLowerCase()),
            availability,
            reason,
          })
          if (artifact.availability !== 'available') return thumbnail(null)
          const artifactRevision = artifact.sourceRevision ?? revision
          const cacheId = `${contextId}:${artifactRevision}:${artifact.artifactId}`
          let url = layoutUrls.get(cacheId)
          if (!url) {
            const result = await getDesktopApi().backendWorkspace.getArtifact({
              artifactId: artifact.artifactId,
              workspaceContextId: contextId,
              workspaceRevision: artifactRevision,
            })
            if (
              version !== requestVersion ||
              result.workspaceContextId !== contextId ||
              result.workspaceRevision !== artifactRevision
            ) {
              return null
            }
            if (result.artifact.status !== 'ready') {
              return thumbnail(
                null,
                'stale',
                result.artifact.issues[0]?.code ?? 'ARTIFACT_READ_FAILED',
              )
            }
            const content = result.artifact.data
            url = URL.createObjectURL(
              new Blob([content.bytes.slice()], { type: content.mimeType }),
            )
            if (version !== requestVersion) {
              revoke(url)
              return null
            }
            layoutUrls.set(cacheId, url)
          }
          return thumbnail(url)
        }),
      )
      if (version !== requestVersion) return
      const next = thumbnails.filter(
        (thumbnail): thumbnail is HomeLayoutThumbnail => thumbnail !== null,
      )
      const retained = new Set(
        next.flatMap((thumbnail) => (thumbnail.url ? [thumbnail.url] : [])),
      )
      for (const [key, url] of layoutUrls) {
        if (!retained.has(url)) {
          revoke(url)
          layoutUrls.delete(key)
        }
      }
      layoutThumbnails.value = next
    } catch (cause) {
      if (version !== requestVersion) return
      error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      if (version === requestVersion) loading.value = false
    }
  }

  const unregisterRerun = onWorkspaceRerunPrepared(() => {
    requestVersion += 1
    clearHomeSnapshotCache()
    layoutThumbnails.value = []
  })

  watch(
    () => [
      currentProject.value?.path ?? '',
      session.workspaceContextId,
      session.generation,
      session.projection.data?.revision?.status === 'ready'
        ? session.projection.data.revision.data.workspaceRevision
        : null,
    ],
    () => void refresh(),
    { immediate: true },
  )

  onScopeDispose(() => {
    requestVersion += 1
    unregisterRerun()
  })

  return { error, layoutThumbnails, loading, refresh }
}
