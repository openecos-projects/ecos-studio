import { onScopeDispose, ref, watch } from 'vue'
import type { WorkspaceResourceIndex, WorkspaceStepResource } from '@ecos-studio/shared'
import { getWorkspaceResourceIndexApi } from '@/api/workspaceResources'
import type { DashboardPieSlice } from '@/components/home/dashboardData'
import {
  drcInsights,
  floorplanInsights,
  type StepDashboardFloorplanSnapshot,
} from '@/components/step-dashboard/stepDashboardData'
import { isSuccessfulFlowStep } from './flowRunArtifacts'
import { useDesktopRuntime } from './useDesktopRuntime'
import { useWorkspace } from './useWorkspace'
import { readOptionalProjectTextFile, readProjectBlobUrl } from '@/utils/projectFiles'
import { resolveProjectPathAccess } from '@/utils/projectFs'
import {
  normalizeWorkspaceProjectPath,
  onWorkspaceRerunPrepared,
} from './homeRunArtifacts'
import { registerRuntimeStepRenderTask } from './runtimeStepRenderSync'

export interface HomeLayoutThumbnail {
  id: string
  kind: 'layout'
  label: string
  step: string
  path: string
  url: string
  hasGeometry: boolean
}

export interface HomeSnapshotImage {
  id: string
  kind: 'image'
  label: string
  path: string
  url: string
}

export interface HomeSnapshotDistribution {
  id: string
  kind: 'distribution'
  label: string
  sourceStep: string
  total: number
  unit: StepDashboardFloorplanSnapshot['unit']
  slices: DashboardPieSlice[]
}

export type HomeInsightSnapshot = HomeSnapshotImage | HomeSnapshotDistribution

interface HomeSnapshotData {
  insightSnapshots: HomeInsightSnapshot[]
  layoutThumbnails: HomeLayoutThumbnail[]
  signature: string
}

const physicalSnapshotSteps = new Set([
  'floorplan',
  'place',
  'cts',
  'legalization',
  'timing optimization',
  'route',
  'filler',
])

const homeSnapshotCache = new Map<string, HomeSnapshotData>()

function snapshotStepKey(step: WorkspaceStepResource): string {
  return step.name.trim().toLowerCase()
}

function snapshotFileFingerprint(
  step: WorkspaceStepResource,
  key: 'layout' | 'db' | 'geometry',
): string {
  const file =
    key === 'layout'
      ? step.resources.output.image
      : key === 'geometry'
        ? step.resources.output.geometryManifest
        : step.resources.feature.db
  return file
    ? `${file.path}:${file.exists}:${file.sizeBytes ?? 0}:${file.mtimeMs ?? 0}`
    : ''
}

function homeSnapshotSignature(index: WorkspaceResourceIndex): string {
  return index.flow.steps
    .map((step) => {
      const drcCsv = step.resources.analysis.statis_csv
      return [
        snapshotStepKey(step),
        step.state.trim().toLowerCase(),
        snapshotFileFingerprint(step, 'layout'),
        snapshotFileFingerprint(step, 'geometry'),
        snapshotFileFingerprint(step, 'db'),
        drcCsv
          ? `${drcCsv.path}:${drcCsv.exists}:${drcCsv.sizeBytes ?? 0}:${drcCsv.mtimeMs ?? 0}`
          : '',
      ].join('|')
    })
    .join('\u001f')
}

function floorplanToHardenSteps(steps: WorkspaceStepResource[]): WorkspaceStepResource[] {
  const floorplanIndex = steps.findIndex((step) => snapshotStepKey(step) === 'floorplan')
  if (floorplanIndex < 0) return []
  const hardenIndex = steps.findIndex((step) => snapshotStepKey(step) === 'harden')
  return steps.slice(
    floorplanIndex,
    hardenIndex >= floorplanIndex ? hardenIndex + 1 : undefined,
  )
}

function latestSuccessfulPhysicalStep(
  steps: WorkspaceStepResource[],
): WorkspaceStepResource | null {
  return (
    [...steps]
      .reverse()
      .find(
        (step) =>
          physicalSnapshotSteps.has(snapshotStepKey(step)) && isSuccessfulFlowStep(step),
      ) ?? null
  )
}

function findSnapshot(
  snapshots: StepDashboardFloorplanSnapshot[],
  id: string,
): StepDashboardFloorplanSnapshot | null {
  return snapshots.find((snapshot) => snapshot.id === id) ?? null
}

function distributionSnapshot(
  snapshot: StepDashboardFloorplanSnapshot,
  sourceStep: string,
): HomeSnapshotDistribution {
  return {
    id: `${sourceStep.toLowerCase()}-${snapshot.id}`,
    kind: 'distribution',
    label: snapshot.label,
    sourceStep,
    total: snapshot.total,
    unit: snapshot.unit,
    slices: snapshot.slices,
  }
}

function imageUrlByPath(data: HomeSnapshotData | undefined): Map<string, string> {
  return new Map(
    [...(data?.layoutThumbnails ?? []), ...(data?.insightSnapshots ?? [])].flatMap(
      (item) =>
        item.kind !== 'distribution' && item.url ? [[item.path, item.url] as const] : [],
    ),
  )
}

function revokeImage(url: string): void {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url)
}

function releaseReplacedImages(
  previous: HomeSnapshotData | undefined,
  next: HomeSnapshotData,
): void {
  const retainedUrls = new Set(
    [...next.layoutThumbnails, ...next.insightSnapshots].flatMap((item) =>
      item.kind === 'distribution' ? [] : [item.url],
    ),
  )
  for (const item of [
    ...(previous?.layoutThumbnails ?? []),
    ...(previous?.insightSnapshots ?? []),
  ]) {
    if (item.kind !== 'distribution' && !retainedUrls.has(item.url)) revokeImage(item.url)
  }
}

function releaseSnapshotImages(data: HomeSnapshotData): void {
  for (const item of [...data.layoutThumbnails, ...data.insightSnapshots]) {
    if (item.kind !== 'distribution') revokeImage(item.url)
  }
}

async function readText(path: string): Promise<string | null> {
  if (!path) return null
  const authorizedPath = await resolveProjectPathAccess(path)
  return authorizedPath ? readOptionalProjectTextFile(authorizedPath) : null
}

async function readJson(path: string): Promise<unknown | null> {
  const text = await readText(path)
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

async function readImage(path: string): Promise<string | null> {
  if (!path) return null
  try {
    const authorizedPath = await resolveProjectPathAccess(path)
    return authorizedPath
      ? await readProjectBlobUrl(authorizedPath, { mimeType: 'image/png' })
      : null
  } catch {
    return null
  }
}

async function buildHomeSnapshotData(
  index: WorkspaceResourceIndex,
  cachedData: HomeSnapshotData | undefined,
): Promise<HomeSnapshotData> {
  const reusableUrls = imageUrlByPath(cachedData)
  const getImage = async (path: string): Promise<string | null> =>
    reusableUrls.get(path) ?? readImage(path)
  const insightSnapshots: HomeInsightSnapshot[] = []
  const steps = floorplanToHardenSteps(index.flow.steps)
  const layouts = await Promise.all(
    steps.filter(isSuccessfulFlowStep).map(async (step) => {
      const image = step.resources.output.image
      if (!image?.exists) return null
      const url = await getImage(image.path)
      return url
        ? ({
            id: `layout-${snapshotStepKey(step)}`,
            kind: 'layout' as const,
            label: `${step.name} Layout`,
            step: step.name,
            path: image.path,
            url,
            hasGeometry: Boolean(step.resources.output.geometryManifest?.exists),
          } satisfies HomeLayoutThumbnail)
        : null
    }),
  )
  const layoutThumbnails = layouts.filter(
    (item): item is HomeLayoutThumbnail => item !== null,
  )

  const physicalStep = latestSuccessfulPhysicalStep(index.flow.steps)
  if (physicalStep) {
    const dbPath = physicalStep.resources.feature.db
    const dbJson = dbPath?.exists ? await readJson(dbPath.path) : null
    const snapshots = floorplanInsights(dbJson)?.snapshots ?? []
    const instDistPath = `${physicalStep.directory}/feature/${physicalStep.name}.db.inst_dist.png`
    const instDistUrl = await getImage(instDistPath)
    if (instDistUrl) {
      insightSnapshots.push({
        id: 'physical-instance-distribution',
        kind: 'image',
        label: `${physicalStep.name} Instance Distribution`,
        path: instDistPath,
        url: instDistUrl,
      })
    }
    for (const id of ['pin-distribution-net_num', 'layer-via_num', 'layer-wire_len']) {
      const snapshot = findSnapshot(snapshots, id)
      if (snapshot)
        insightSnapshots.push(distributionSnapshot(snapshot, physicalStep.name))
    }
  }

  const placeStep = index.flow.steps.find(
    (step) => snapshotStepKey(step) === 'place' && isSuccessfulFlowStep(step),
  )
  if (placeStep) {
    const densityMapPath = `${placeStep.directory}/feature/density_map/place_allcell_density.png`
    const densityMapUrl = await getImage(densityMapPath)
    if (densityMapUrl) {
      insightSnapshots.push({
        id: 'place-all-cell-density',
        kind: 'image',
        label: 'Place All Cell Density',
        path: densityMapPath,
        url: densityMapUrl,
      })
    }
  }

  const drcStep = index.flow.steps.find(
    (step) => snapshotStepKey(step) === 'drc' && isSuccessfulFlowStep(step),
  )
  const drcCsv = drcStep?.resources.analysis.statis_csv
  if (drcStep && drcCsv?.exists) {
    const snapshots = drcInsights(await readText(drcCsv.path))?.snapshots ?? []
    for (const snapshot of snapshots) {
      insightSnapshots.push(distributionSnapshot(snapshot, drcStep.name))
    }
  }

  return { insightSnapshots, layoutThumbnails, signature: homeSnapshotSignature(index) }
}

/** Releases Home Snapshot image Blob URLs after the workspace is closed. */
export function clearHomeSnapshotCache(): void {
  for (const data of homeSnapshotCache.values()) {
    releaseSnapshotImages(data)
  }
  homeSnapshotCache.clear()
}

function clearHomeSnapshotCacheForWorkspace(projectPath: string): void {
  const normalizedProjectPath = normalizeWorkspaceProjectPath(projectPath)
  for (const [cachedProjectPath, cachedData] of homeSnapshotCache.entries()) {
    if (normalizeWorkspaceProjectPath(cachedProjectPath) !== normalizedProjectPath) {
      continue
    }
    homeSnapshotCache.delete(cachedProjectPath)
    releaseSnapshotImages(cachedData)
  }
}

export function useHomeSnapshots() {
  const { isDesktopRuntimeAvailable } = useDesktopRuntime()
  const { currentProject, resourceVersions } = useWorkspace()
  const insightSnapshots = ref<HomeInsightSnapshot[]>([])
  const layoutThumbnails = ref<HomeLayoutThumbnail[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  let requestVersion = 0

  const unregisterWorkspaceRerunPrepared = onWorkspaceRerunPrepared((event) => {
    const projectPath = currentProject.value?.path
    if (
      !projectPath ||
      normalizeWorkspaceProjectPath(projectPath) !==
        normalizeWorkspaceProjectPath(event.projectPath)
    ) {
      return
    }
    requestVersion += 1
    clearHomeSnapshotCacheForWorkspace(projectPath)
    insightSnapshots.value = []
    layoutThumbnails.value = []
    error.value = null
    loading.value = false
  })

  async function refresh(resourceIndex?: WorkspaceResourceIndex): Promise<void> {
    const projectPath = currentProject.value?.path
    const version = ++requestVersion
    if (!projectPath || !isDesktopRuntimeAvailable) {
      insightSnapshots.value = []
      layoutThumbnails.value = []
      error.value = null
      loading.value = false
      return
    }

    const cachedData = homeSnapshotCache.get(projectPath)
    if (cachedData) {
      insightSnapshots.value = cachedData.insightSnapshots
      layoutThumbnails.value = cachedData.layoutThumbnails
    }
    loading.value = true
    error.value = null
    try {
      const index = resourceIndex ?? (await getWorkspaceResourceIndexApi())
      if (version !== requestVersion || currentProject.value?.path !== projectPath) return
      const signature = homeSnapshotSignature(index)
      if (cachedData?.signature === signature) return

      const nextData = await buildHomeSnapshotData(index, cachedData)
      if (version !== requestVersion || currentProject.value?.path !== projectPath) {
        releaseReplacedImages(
          nextData,
          cachedData ?? { insightSnapshots: [], layoutThumbnails: [], signature: '' },
        )
        return
      }
      homeSnapshotCache.set(projectPath, nextData)
      releaseReplacedImages(cachedData, nextData)
      insightSnapshots.value = nextData.insightSnapshots
      layoutThumbnails.value = nextData.layoutThumbnails
    } catch (cause) {
      if (version !== requestVersion || currentProject.value?.path !== projectPath) return
      error.value = cause instanceof Error ? cause.message : String(cause)
      if (!cachedData) {
        insightSnapshots.value = []
        layoutThumbnails.value = []
      }
    } finally {
      if (version === requestVersion) loading.value = false
    }
  }

  const unregisterStepRenderTask = registerRuntimeStepRenderTask(async (commit) => {
    await refresh(await commit.resourceIndex())
  })
  onScopeDispose(() => {
    unregisterStepRenderTask()
    unregisterWorkspaceRerunPrepared()
  })

  watch(
    () => [
      currentProject.value?.path ?? '',
      resourceVersions.value.flow,
      resourceVersions.value.step,
      resourceVersions.value.maps,
      resourceVersions.value.all,
    ],
    () => {
      void refresh()
    },
    { immediate: true },
  )

  return { error, insightSnapshots, layoutThumbnails, loading, refresh }
}
