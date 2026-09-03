import { computed, onScopeDispose, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type {
  WorkspaceResourceFile,
  WorkspaceResourceIndex,
  WorkspaceStepResource,
} from '@ecos-studio/shared'
import { InfoEnum } from '@/api/type'
import {
  getWorkspaceResourceIndexApi,
  resolveWorkspaceStepInfoApi,
} from '@/api/workspaceResources'
import { readOptionalProjectTextFile, readProjectBlobUrl } from '@/utils/projectFiles'
import { resolveProjectPathAccess } from '@/utils/projectFs'
import {
  buildCongestionTiles,
  buildFlowInsightSteps,
  congestionCandidatePngPaths,
  parseCongestionCsv,
  type CongestionMapTileModel,
} from '@/components/flow-insights/flowInsightsData'
import { useDesktopRuntime } from '@/composables/useDesktopRuntime'
import { onWorkspaceRerunPrepared } from '@/composables/homeRunArtifacts'
import { registerRuntimeStepRenderTask } from '@/composables/runtimeStepRenderSync'
import { useWorkspace } from '@/composables/useWorkspace'
import {
  checklistSummary,
  dbDistributions,
  dbHighlights,
  designStatisSummary,
  drcInsights,
  floorplanInsights,
  hardenOutputInsights,
  lecInsights,
  lvsInsights,
  mapHighlights,
  POST_SYNTHESIS_TIMING_CORNER,
  qorSummary,
  record,
  rcxInsights,
  runSummary,
  staCornerSummaryPaths,
  staInsights,
  stepFeatureInsights,
  stepTimingAnalysis,
  synthesisInsights,
  stepDistribution,
  stepKeyMetrics,
  type StepDashboardBar,
  type StepDashboardChecklist,
  type StepDashboardDrcInsights,
  type StepDashboardDistribution,
  type StepDashboardFloorplanInsights,
  type StepDesignStatis,
  type StepDashboardHardenInsights,
  type StepDashboardLecInsights,
  type StepDashboardLvsInsights,
  type StepDashboardMetric,
  type StepDashboardQor,
  type StepDashboardRcxInsights,
  type StepDashboardStaInsights,
  type StepDashboardSynthesisInsights,
  type StepDashboardTimingAnalysis,
} from '@/components/step-dashboard/stepDashboardData'

export interface StepDashboardReport {
  directory: string
  id: string
  label: string
  path: string
  relativePath: string
  sizeBytes: number | null
  modifiedAt: number | null
}

export interface StepDashboardData {
  step: string
  tool: string
  run: ReturnType<typeof runSummary>
  keyMetrics: StepDashboardMetric[]
  stepChartTitle: string
  stepChartUnit: string
  stepBars: StepDashboardBar[]
  checklist: StepDashboardChecklist
  qor: StepDashboardQor
  dataHighlights: StepDashboardMetric[]
  dataCharts: StepDashboardDistribution[]
  drcInsights: StepDashboardDrcInsights | null
  floorplanInsights: StepDashboardFloorplanInsights | null
  hardenInsights: StepDashboardHardenInsights | null
  lecInsights: StepDashboardLecInsights | null
  lvsInsights: StepDashboardLvsInsights | null
  rcxInsights: StepDashboardRcxInsights | null
  staInsights: StepDashboardStaInsights | null
  stepInsights: StepDashboardFloorplanInsights | null
  synthesisInsights: StepDashboardSynthesisInsights | null
  timingAnalysis: StepDashboardTimingAnalysis | null
  layoutUrl: string | null
  mapUrl: string | null
  /** Congestion/density map tiles from this step's own feature maps (place/CTS). */
  congestionTiles: CongestionMapTileModel[]
  congestionTileUrls: Map<string, string>
  /** Metric table of Design Layout / Design Statis from this step's db.json feature. */
  designStatis: StepDesignStatis | null
  hasGeometry: boolean
  reports: StepDashboardReport[]
}

function resourceFile(value: unknown): value is WorkspaceResourceFile {
  return (
    value !== null &&
    typeof value === 'object' &&
    'path' in value &&
    typeof value.path === 'string' &&
    'exists' in value &&
    typeof value.exists === 'boolean'
  )
}

function normalizedPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

function reportFiles(
  report: WorkspaceStepResource['resources']['report'],
  reportDirectory: string,
): StepDashboardReport[] {
  const root = normalizedPath(reportDirectory)
  const seenPaths = new Set<string>()
  const files = Object.values(report)
    .flatMap((value) => {
      if (resourceFile(value)) return [value]
      return Object.values(value).filter(resourceFile)
    })
    .filter((file) => {
      const path = normalizedPath(file.path)
      return file.exists && path.startsWith(`${root}/`) && !seenPaths.has(path)
        ? Boolean(seenPaths.add(path))
        : false
    })

  return files
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => {
      const relativePath = normalizedPath(file.path).slice(root.length + 1)
      const parts = relativePath.split('/').filter(Boolean)
      return {
        directory: parts.slice(0, -1).join(' / '),
        id: file.path,
        label: parts[parts.length - 1] || fileLabel(file.path),
        path: file.path,
        relativePath,
        sizeBytes: file.sizeBytes ?? null,
        modifiedAt: file.mtimeMs ?? null,
      }
    })
}

function fileLabel(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || path
}

function stringInfo(value: Record<string, unknown>, key: string): string {
  const candidate = value[key]
  return typeof candidate === 'string' ? candidate : ''
}

function mapImagePath(value: Record<string, unknown>): string {
  for (const item of Object.values(value)) {
    const source = record(item)
    if (typeof source?.path === 'string') return source.path
  }
  return ''
}

function siblingAnalysisPath(metricsPath: string, filename: string): string {
  return metricsPath.endsWith('/qor_metrics.json')
    ? `${metricsPath.slice(0, -'qor_metrics.json'.length)}${filename}`
    : ''
}

const stepDashboardCache = new Map<string, StepDashboardData>()
const floorplanStyleInsightSteps = new Set([
  'place',
  'cts',
  'legalization',
  'timing optimization',
  'route',
  'filler',
])

function usesFloorplanStyleInsights(step: string): boolean {
  return floorplanStyleInsightSteps.has(step.trim().toLowerCase())
}

function stepDashboardCacheKey(projectPath: string, step: string): string {
  return `${projectPath.trim()}\u0000${step.trim().toLowerCase()}`
}

function revokeBlobUrl(url: string | null): void {
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
}

function releaseDashboardImages(
  data: StepDashboardData,
  replacement?: StepDashboardData,
): void {
  const retainedUrls = new Set([replacement?.layoutUrl, replacement?.mapUrl])
  for (const url of [data.layoutUrl, data.mapUrl]) {
    if (!retainedUrls.has(url)) revokeBlobUrl(url)
  }
  if (replacement) {
    for (const url of replacement.congestionTileUrls.values()) retainedUrls.add(url)
  }
  for (const url of data.congestionTileUrls.values()) {
    if (!retainedUrls.has(url)) revokeBlobUrl(url)
  }
}

function replaceCachedStepDashboardData(key: string, next: StepDashboardData): void {
  const previous = stepDashboardCache.get(key)
  stepDashboardCache.set(key, next)
  if (previous) releaseDashboardImages(previous, next)
}

/** Releases cached dashboard images when the workspace itself is closed. */
export function clearStepDashboardDataCache(): void {
  for (const cachedData of stepDashboardCache.values()) {
    releaseDashboardImages(cachedData)
  }
  stepDashboardCache.clear()
}

/** Removes only artifacts ECC invalidated for the active workspace rerun. */
export function clearStepDashboardDataForRerun(
  projectPath: string,
  affectedSteps: readonly string[],
): void {
  const workspaceKey = normalizedPath(projectPath)
  const affectedStepNames = new Set(
    affectedSteps.map((step) => step.trim().toLowerCase()).filter(Boolean),
  )
  for (const [cacheKey, cachedData] of stepDashboardCache.entries()) {
    const [cachedWorkspace] = cacheKey.split('\u0000')
    if (normalizedPath(cachedWorkspace ?? '') !== workspaceKey) continue
    if (
      affectedStepNames.size > 0 &&
      !affectedStepNames.has(cachedData.step.trim().toLowerCase())
    ) {
      continue
    }
    stepDashboardCache.delete(cacheKey)
    releaseDashboardImages(cachedData)
  }
}

export function useStepDashboardData() {
  const route = useRoute()
  const { isDesktopRuntimeAvailable } = useDesktopRuntime()
  const { currentProject, resourceVersions } = useWorkspace()
  const data = ref<StepDashboardData | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let requestVersion = 0

  const unregisterWorkspaceRerunPrepared = onWorkspaceRerunPrepared((event) => {
    const projectPath = currentProject.value?.path
    if (
      !projectPath ||
      normalizedPath(event.projectPath) !== normalizedPath(projectPath)
    ) {
      return
    }
    clearStepDashboardDataForRerun(projectPath, event.affectedSteps)
    const affectedStepNames = new Set(
      event.affectedSteps.map((step) => step.trim().toLowerCase()).filter(Boolean),
    )
    if (
      affectedStepNames.size === 0 ||
      affectedStepNames.has(currentStep.value.trim().toLowerCase())
    ) {
      requestVersion += 1
      data.value = null
      error.value = null
      loading.value = false
    }
  })

  const currentStep = computed(() => {
    const param = route.params.step
    if (typeof param === 'string' && param) return param
    const segments = route.path.split('/').filter(Boolean)
    return segments[segments.length - 1] ?? ''
  })

  async function readJson(path: string): Promise<unknown | null> {
    const text = await readText(path)
    if (!text) return null
    try {
      return JSON.parse(text) as unknown
    } catch {
      return null
    }
  }

  async function readText(path: string): Promise<string | null> {
    if (!path) return null
    const authorizedPath = await resolveProjectPathAccess(path)
    if (!authorizedPath) return null
    return readOptionalProjectTextFile(authorizedPath)
  }

  async function readImage(path: string): Promise<string | null> {
    if (!path) return null
    const authorizedPath = await resolveProjectPathAccess(path)
    if (!authorizedPath) return null
    return readProjectBlobUrl(authorizedPath, { mimeType: 'image/png' })
  }

  async function readOptionalImage(path: string): Promise<string | null> {
    try {
      return await readImage(path)
    } catch {
      return null
    }
  }

  async function refresh(resourceIndex?: WorkspaceResourceIndex): Promise<void> {
    const step = currentStep.value
    const projectPath = currentProject.value?.path
    const version = ++requestVersion
    const cacheKey = step && projectPath ? stepDashboardCacheKey(projectPath, step) : null
    const cachedData = cacheKey ? stepDashboardCache.get(cacheKey) : null
    if (cachedData) data.value = cachedData
    else data.value = null
    error.value = null

    if (!step || !projectPath || !isDesktopRuntimeAvailable) return
    loading.value = true
    try {
      const [index, layoutResponse, analysisResponse, mapResponse] = await Promise.all([
        resourceIndex ?? getWorkspaceResourceIndexApi(),
        resolveWorkspaceStepInfoApi({ step, id: InfoEnum.layout }),
        resolveWorkspaceStepInfoApi({ step, id: InfoEnum.analysis }),
        resolveWorkspaceStepInfoApi({ step, id: InfoEnum.maps }),
      ])
      if (version !== requestVersion) return

      const resourceStep = index.flow.steps.find(
        (candidate) => candidate.name.trim().toLowerCase() === step.trim().toLowerCase(),
      )
      if (!resourceStep) {
        error.value = `Workspace step not found: ${step}`
        return
      }

      const metricsPath = stringInfo(analysisResponse.info, 'metrics')
      const isSynthesis = resourceStep.name.trim().toLowerCase() === 'synthesis'
      const isFloorplan = resourceStep.name.trim().toLowerCase() === 'floorplan'
      const isHarden = resourceStep.name.trim().toLowerCase() === 'harden'
      const isPlace = resourceStep.name.trim().toLowerCase() === 'place'
      const isRcx = resourceStep.name.trim().toLowerCase() === 'rcx'
      const isDrc = resourceStep.name.trim().toLowerCase() === 'drc'
      const isLvs = resourceStep.name.trim().toLowerCase() === 'lvs'
      const isSta = resourceStep.name.trim().toLowerCase() === 'sta'
      const isLec = ['lec', 'postroutelec'].includes(
        resourceStep.name.trim().toLowerCase(),
      )
      const lecBackendStatus = isLec
        ? stringInfo(analysisResponse.info, 'lec status')
        : ''
      const isFloorplanStyleStep = usesFloorplanStyleInsights(resourceStep.name)
      const stepPath =
        stringInfo(analysisResponse.info, 'step feature') ||
        resourceStep.resources.feature.step?.path ||
        `${resourceStep.directory}/feature/${resourceStep.name}.step.json`
      const dbPath = stringInfo(analysisResponse.info, 'data summary')
      const synthesisStatPath = isSynthesis
        ? resourceStep.resources.feature.stat?.path || dbPath
        : ''
      const synthesisTimingSummaryPath = isSynthesis
        ? `${resourceStep.directory}/feature/post_synthesis/qor_summary.json`
        : ''
      const synthesisTimingPathsPath = isSynthesis
        ? `${resourceStep.directory}/feature/post_synthesis/timing_paths.json`
        : ''
      const checklistPath = `${resourceStep.directory}/checklist.json`
      const drcStatisticsPath = isDrc
        ? `${resourceStep.directory}/analysis/drc_statis.csv`
        : ''
      const lecResultFile = resourceStep.resources.output.result
      const lecResultPath =
        isLec && resourceFile(lecResultFile) && lecResultFile.exists
          ? lecResultFile.path
          : ''
      const featureMapPath = resourceStep.resources.feature.map?.exists
        ? resourceStep.resources.feature.map.path
        : isPlace
          ? `${resourceStep.directory}/feature/${resourceStep.name}.map.json`
          : ''
      const isCongestionStep =
        resourceStep.name.trim().toLowerCase() === 'place' ||
        resourceStep.name.trim().toLowerCase() === 'cts'
      const congestionCandidateStep = isCongestionStep
        ? buildFlowInsightSteps([resourceStep])[0]
        : null
      const layoutPath = resourceStep.resources.output.image?.exists
        ? stringInfo(layoutResponse.info, 'image')
        : ''
      const availableMapPath = mapImagePath(mapResponse.info)

      const [
        stepJson,
        dbJson,
        checklistJson,
        mapJson,
        metricsJson,
        qorSummaryJson,
        hotspotsJson,
        synthesisStatJson,
        synthesisTimingSummaryJson,
        synthesisTimingPathsJson,
        drcStatisticsText,
        lecResultJson,
      ] = await Promise.all([
        readJson(stepPath),
        readJson(dbPath),
        readJson(checklistPath),
        readJson(featureMapPath),
        readJson(metricsPath),
        readJson(siblingAnalysisPath(metricsPath, 'qor_summary.json')),
        readJson(siblingAnalysisPath(metricsPath, 'qor_hotspots.json')),
        synthesisStatPath && synthesisStatPath !== dbPath
          ? readJson(synthesisStatPath)
          : Promise.resolve(null),
        readJson(synthesisTimingSummaryPath),
        readJson(synthesisTimingPathsPath),
        readText(drcStatisticsPath),
        readJson(lecResultPath),
      ])
      if (version !== requestVersion) return

      const staCornerRefs = isSta
        ? staCornerSummaryPaths(stepJson, resourceStep.directory)
        : []
      const [staTimingSummaries, staTimingPathsSources] = await Promise.all([
        Promise.all(staCornerRefs.map(({ path }) => readJson(path))),
        Promise.all(
          staCornerRefs.map(({ timingPathsPath }) => readJson(timingPathsPath)),
        ),
      ])
      if (version !== requestVersion) return

      const [layoutUrl, mapUrl] = await Promise.all([
        readImage(layoutPath),
        readImage(availableMapPath),
      ])
      if (version !== requestVersion) {
        revokeBlobUrl(layoutUrl)
        revokeBlobUrl(mapUrl)
        return
      }

      // Congestion/density map tiles for this step's own feature maps (place/CTS)
      let congestionTiles: CongestionMapTileModel[] = []
      let congestionTileUrls = new Map<string, string>()
      if (congestionCandidateStep) {
        const probed = await Promise.all(
          congestionCandidatePngPaths(congestionCandidateStep).map(
            async (pngPath) => [pngPath, await readOptionalImage(pngPath)] as const,
          ),
        )
        for (const [pngPath, url] of probed) {
          if (url) congestionTileUrls.set(pngPath, url)
        }
        if (version !== requestVersion) {
          for (const url of congestionTileUrls.values()) revokeBlobUrl(url)
          return
        }
        congestionTiles = buildCongestionTiles(
          [congestionCandidateStep],
          new Set(congestionTileUrls.keys()),
        )
        await Promise.all(
          congestionTiles.map(async (tile) => {
            const text = await readText(tile.csvPath)
            tile.stats = text ? parseCongestionCsv(text) : null
          }),
        )
        if (version !== requestVersion) {
          for (const url of congestionTileUrls.values()) revokeBlobUrl(url)
          return
        }
      }

      const keyMetrics = stepKeyMetrics(resourceStep.name, stepJson)
      const stepChart = stepDistribution(resourceStep.name, stepJson)
      const mapMetricValues = mapHighlights(mapJson)
      const nextData: StepDashboardData = {
        step: resourceStep.name,
        tool: resourceStep.tool,
        run: runSummary(stepJson),
        keyMetrics,
        stepChartTitle: stepChart?.title ?? '',
        stepChartUnit: stepChart?.unit ?? '',
        stepBars: stepChart?.bars ?? [],
        checklist: checklistSummary(checklistJson),
        qor: qorSummary(qorSummaryJson, metricsJson, hotspotsJson),
        dataHighlights: mapMetricValues.length ? mapMetricValues : dbHighlights(dbJson),
        dataCharts: dbDistributions(dbJson),
        drcInsights: isDrc ? drcInsights(drcStatisticsText) : null,
        floorplanInsights: isFloorplan ? floorplanInsights(dbJson) : null,
        hardenInsights: isHarden
          ? hardenOutputInsights(resourceStep.resources.output)
          : null,
        lecInsights: isLec ? lecInsights(lecResultJson, lecBackendStatus) : null,
        lvsInsights: isLvs ? lvsInsights(stepJson) : null,
        rcxInsights: isRcx ? rcxInsights(stepJson) : null,
        staInsights: isSta ? staInsights(stepJson) : null,
        stepInsights: isFloorplanStyleStep
          ? stepFeatureInsights(resourceStep.name, stepJson, dbJson, mapJson)
          : null,
        synthesisInsights: isSynthesis
          ? synthesisInsights(synthesisStatJson ?? dbJson)
          : null,
        timingAnalysis: isSta
          ? stepTimingAnalysis(
              staCornerRefs.map(({ id }, index) => ({
                corner: id,
                summary: staTimingSummaries[index],
              })),
              staCornerRefs.map(({ id }, index) => ({
                corner: id,
                source: staTimingPathsSources[index],
              })),
            )
          : isSynthesis
            ? stepTimingAnalysis(
                synthesisTimingSummaryJson
                  ? [
                      {
                        corner: POST_SYNTHESIS_TIMING_CORNER,
                        summary: synthesisTimingSummaryJson,
                      },
                    ]
                  : [],
                synthesisTimingPathsJson
                  ? [
                      {
                        corner: POST_SYNTHESIS_TIMING_CORNER,
                        source: synthesisTimingPathsJson,
                      },
                    ]
                  : [],
              )
            : null,
        layoutUrl,
        mapUrl,
        congestionTiles,
        congestionTileUrls,
        designStatis: designStatisSummary(dbJson),
        hasGeometry: Boolean(resourceStep.resources.output.geometryManifest?.exists),
        reports: reportFiles(
          resourceStep.resources.report,
          `${resourceStep.directory}/report`,
        ),
      }
      if (!cacheKey) {
        revokeBlobUrl(layoutUrl)
        revokeBlobUrl(mapUrl)
        for (const url of congestionTileUrls.values()) revokeBlobUrl(url)
        return
      }
      replaceCachedStepDashboardData(cacheKey, nextData)
      data.value = nextData
    } catch (cause) {
      if (version !== requestVersion) return
      console.error('Failed to load step dashboard data:', cause)
      error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      if (version === requestVersion) loading.value = false
    }
  }

  watch(
    () => [
      currentStep.value,
      currentProject.value?.path ?? '',
      resourceVersions.value.step,
      resourceVersions.value.all,
    ],
    () => void refresh(),
    { immediate: true },
  )

  const unregisterStepRenderTask = registerRuntimeStepRenderTask(async (commit) => {
    if (commit.step.trim().toLowerCase() !== currentStep.value.trim().toLowerCase()) {
      return
    }
    await refresh(await commit.resourceIndex())
  })

  onScopeDispose(() => {
    requestVersion += 1
    unregisterWorkspaceRerunPrepared()
    unregisterStepRenderTask()
  })

  return { currentStep, data, error, loading, refresh }
}
