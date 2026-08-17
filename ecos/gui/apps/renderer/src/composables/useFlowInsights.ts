import { onScopeDispose, ref, computed, watch } from 'vue'
import type { WorkspaceResourceIndex } from '@ecos-studio/shared'
import { getWorkspaceResourceIndexApi } from '@/api/workspaceResources'
import {
  buildCongestionTiles,
  buildDbTrendModel,
  buildFlowInsightSteps,
  buildInstanceCompositionModel,
  attachStaFirstPaths,
  buildStaCriticalPathsModel,
  buildStaOverviewModel,
  buildStepResourcesModel,
  canonicalStepKey,
  buildDrcRelatedMetrics,
  parseCongestionCsv,
  parseDrcStatisCsv,
  parseFirstStaPathPreview,
  parseStaCornerSummaries,
  peakMemoryFromFlowStep,
  type CongestionMapTileModel,
  type DbTrendModel,
  type DrcRelatedMetrics,
  type InstanceCompositionModel,
  type StaCriticalPathsModel,
  type StaOverviewModel,
  type StepResourcesModel,
} from '@/components/flow-insights/flowInsightsData'
import { useDesktopRuntime } from './useDesktopRuntime'
import { useWorkspace } from './useWorkspace'
import { readOptionalProjectTextFile, readProjectBlobUrl } from '@/utils/projectFiles'
import { resolveProjectPathAccess } from '@/utils/projectFs'
import {
  normalizeWorkspaceProjectPath,
  onWorkspaceRerunPrepared,
} from './homeRunArtifacts'

export interface FlowInsightsData {
  signature: string
  stepResources: StepResourcesModel | null
  dbTrends: DbTrendModel | null
  instanceComposition: {
    num: InstanceCompositionModel
    area: InstanceCompositionModel
  } | null
  congestionTiles: CongestionMapTileModel[]
  congestionTileUrls: Map<string, string>
  drc: ReturnType<typeof parseDrcStatisCsv>
  drcRelated: DrcRelatedMetrics
  sta: StaOverviewModel | null
  staCriticalPaths: StaCriticalPathsModel | null
}

function flowInsightsSignature(index: WorkspaceResourceIndex): string {
  return index.flow.steps
    .map((step) => {
      const files = [
        step.resources.analysis.metrics,
        step.resources.feature.db,
        step.resources.feature.step,
        step.resources.analysis.statis_csv,
      ]
      const fingerprints = files
        .map((file) =>
          file
            ? `${file.path}:${file.exists ? 1 : 0}:${file.sizeBytes ?? 0}:${file.mtimeMs ?? 0}`
            : '',
        )
        .join('|')
      return [step.name, step.state, step.runtime, fingerprints].join('#')
    })
    .join('\n')
}

async function readJsonFrom(path: string): Promise<Record<string, unknown> | null> {
  const authorized = await resolveProjectPathAccess(path)
  if (!authorized) return null
  const text = await readOptionalProjectTextFile(authorized)
  if (!text) return null
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
}

async function readOptionalTextFrom(path: string): Promise<string | null> {
  const authorized = await resolveProjectPathAccess(path)
  return authorized ? readOptionalProjectTextFile(authorized) : null
}

const CONGESTION_MAP_SPECS: Array<{
  directory: string
  pattern: string
  directions: string[]
}> = [
  {
    directory: 'egr_congestion_map',
    pattern: '{step}_egr_{direction}_overflow',
    directions: ['horizontal', 'vertical', 'union'],
  },
  {
    directory: 'RUDY_map',
    pattern: '{step}_rudy_{direction}',
    directions: ['horizontal', 'vertical', 'union'],
  },
  {
    directory: 'RUDY_map',
    pattern: '{step}_lut_rudy_{direction}',
    directions: ['horizontal', 'vertical', 'union'],
  },
  {
    directory: 'density_map',
    pattern: '{step}_allcell_density',
    directions: [''],
  },
]

function numberOfMetric(source: Record<string, unknown>, id: string): number | null {
  const metrics = Array.isArray(source.metrics) ? source.metrics : []
  for (const candidate of metrics) {
    const item = candidate as Record<string, unknown>
    if (
      item?.id === id &&
      typeof item.value === 'number' &&
      Number.isFinite(item.value)
    ) {
      return item.value
    }
  }
  return null
}

async function buildFlowInsightsData(
  index: WorkspaceResourceIndex,
  previous: FlowInsightsData | undefined,
): Promise<FlowInsightsData> {
  const previousStatsByPath = new Map(
    (previous?.congestionTiles ?? []).map((tile) => [tile.pngPath, tile.stats ?? null]),
  )
  const imageUrls = new Map(previous?.congestionTileUrls ?? [])

  const flowJson = index.home.flowJson.exists
    ? await readJsonFrom(index.home.flowJson.path)
    : null
  const flowPeakByName = new Map<string, number>()
  const flowSteps = Array.isArray(flowJson?.steps) ? flowJson.steps : []
  for (const candidate of flowSteps) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const step = candidate as Record<string, unknown>
    const name = typeof step.name === 'string' ? step.name : ''
    const peak = peakMemoryFromFlowStep(step)
    if (name && peak !== null) flowPeakByName.set(name, peak)
  }

  const stepInputs = index.flow.steps.map((step) => ({
    name: step.name,
    tool: step.tool,
    state: step.state,
    runtime: step.runtime,
    directory: step.directory,
    info: step.info,
    peakMemoryMb: flowPeakByName.get(step.name) ?? peakMemoryFromFlowStep(step),
  }))
  const insightSteps = buildFlowInsightSteps(stepInputs)

  const dbJsonByStep = new Map<string, Record<string, unknown> | null>()
  let synthesisStatJson: Record<string, unknown> | null = null
  let drcCsv: string | null = null
  let staStepJson: Record<string, unknown> | null = null
  let staStepDirectory = ''
  let drcCount: number | null = null
  let routeDrViolations: number | null = null
  let routeLaOverflow: number | null = null

  const insightStepByName = new Map(insightSteps.map((step) => [step.name, step]))
  await Promise.all(
    index.flow.steps.map(async (step) => {
      const key = canonicalStepKey(step.name)
      const insightStep = insightStepByName.get(step.name) ?? null

      // runtime/memory 统一口径：qor_metrics.json 优先，flow.json runtime 兜底
      const metricsFile = step.resources.analysis.metrics
      if (metricsFile?.exists) {
        const metrics = await readJsonFrom(metricsFile.path)
        if (metrics && insightStep) {
          const peakMemory = numberOfMetric(metrics, 'peak_memory_mb')
          if (peakMemory !== null) insightStep.peakMemoryMb = peakMemory
          const runtimeSeconds = numberOfMetric(metrics, 'runtime_seconds')
          if (runtimeSeconds !== null) insightStep.runtimeSeconds = runtimeSeconds
          if (key === 'Route') {
            routeDrViolations = numberOfMetric(metrics, 'route_dr_total_violation_count')
            routeLaOverflow = numberOfMetric(metrics, 'route_la_total_overflow')
          }
          if (key === 'DRC') {
            drcCount = numberOfMetric(metrics, 'drc_count')
          }
        }
      }

      if (key === 'Synth') {
        const statFile =
          step.resources.feature.stat ?? step.resources.feature.generic_stat
        if (statFile?.exists) synthesisStatJson = await readJsonFrom(statFile.path)
        return
      }

      const dbFile = step.resources.feature.db
      if (dbFile?.exists) dbJsonByStep.set(step.name, await readJsonFrom(dbFile.path))

      if (key === 'DRC') {
        const statisCsv = step.resources.analysis.statis_csv
        if (statisCsv?.exists) drcCsv = await readOptionalTextFrom(statisCsv.path)
      }

      if (key === 'STA') {
        const stepJsonFile = step.resources.feature.step
        if (stepJsonFile?.exists) {
          staStepJson = await readJsonFrom(stepJsonFile.path)
          staStepDirectory = step.directory.replace(/\/+$/, '')
        }
      }
    }),
  )

  // 模块③：拥塞/密度图 tile（place/CTS）
  const congestionCandidateSteps = insightSteps.filter((step) =>
    ['Place', 'CTS'].includes(step.key),
  )
  const candidatePaths = new Set<string>()
  for (const step of congestionCandidateSteps) {
    for (const spec of CONGESTION_MAP_SPECS) {
      for (const direction of spec.directions) {
        const stem = spec.pattern
          .replace('{step}', step.name)
          .replace('{direction}', direction)
        candidatePaths.add(`${step.directory}/feature/${spec.directory}/${stem}.png`)
      }
    }
  }

  await Promise.all(
    [...candidatePaths].map(async (pngPath) => {
      if (imageUrls.has(pngPath)) return
      try {
        const url = await readProjectBlobUrl(pngPath, { mimeType: 'image/png' })
        imageUrls.set(pngPath, url)
      } catch {
        /* 不存在时静默跳过 */
      }
    }),
  )

  const existingFiles = new Set(imageUrls.keys())
  const congestionTiles = buildCongestionTiles(insightSteps, existingFiles)
  for (const [path, url] of imageUrls) {
    const stillUsed = congestionTiles.some((tile) => tile.pngPath === path)
    if (!stillUsed) {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url)
      imageUrls.delete(path)
    }
  }

  await Promise.all(
    congestionTiles.map(async (tile) => {
      const cached = previousStatsByPath.get(tile.pngPath)
      if (cached) {
        tile.stats = cached
        return
      }
      tile.stats = await readOptionalTextFrom(tile.csvPath).then((text) =>
        text ? parseCongestionCsv(text) : null,
      )
    }),
  )

  // 模块⑤：STA corner 一览（sta.step.json signoff_metrics.corners → feature/<corner>/qor_summary.json）
  let sta: StaOverviewModel | null = null
  let staCriticalPaths: StaCriticalPathsModel | null = null
  if (staStepJson) {
    const corners = parseStaCornerSummaries(staStepJson)
    if (corners.length > 0) {
      const cornerSummaries = await Promise.all(
        corners.map(async ({ corner, summaryPath }) => {
          const resolved = summaryPath.startsWith('/')
            ? summaryPath
            : `${staStepDirectory}/${summaryPath}`
          return { corner, summary: await readJsonFrom(resolved) }
        }),
      )
      sta = buildStaOverviewModel(cornerSummaries)
      const worstCorners = new Set(
        [sta.worstSetup?.corner, sta.worstHold?.corner].filter(
          (corner): corner is string => Boolean(corner),
        ),
      )
      const pathSources = await Promise.all(
        corners.map(async ({ corner, pathsPath }) => {
          const resolved = pathsPath.startsWith('/')
            ? pathsPath
            : `${staStepDirectory}/${pathsPath}`
          return { corner, source: await readJsonFrom(resolved) }
        }),
      )
      sta = attachStaFirstPaths(
        sta,
        pathSources.map(({ corner, source }) => parseFirstStaPathPreview(source, corner)),
      )
      staCriticalPaths = buildStaCriticalPathsModel(
        pathSources.filter(({ corner }) => worstCorners.has(corner)),
      )
    }
  }

  return {
    signature: flowInsightsSignature(index),
    stepResources: buildStepResourcesModel(insightSteps),
    dbTrends: buildDbTrendModel(insightSteps, dbJsonByStep, synthesisStatJson),
    instanceComposition: {
      num: buildInstanceCompositionModel(insightSteps, dbJsonByStep, 'num'),
      area: buildInstanceCompositionModel(insightSteps, dbJsonByStep, 'area'),
    },
    congestionTiles,
    congestionTileUrls: imageUrls,
    drc: parseDrcStatisCsv(drcCsv),
    drcRelated: buildDrcRelatedMetrics({
      drcCount,
      routeDrViolations,
      routeLaOverflow,
      drcStepName: insightSteps.find((step) => step.key === 'DRC')?.name ?? null,
      routeStepName: insightSteps.find((step) => step.key === 'Route')?.name ?? null,
    }),
    sta,
    staCriticalPaths,
  }
}

const flowInsightsCache = new Map<string, FlowInsightsData>()

function releaseFlowInsightsImages(data: FlowInsightsData): void {
  for (const url of data.congestionTileUrls.values()) {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url)
  }
}

export function clearFlowInsightsCache(): void {
  for (const data of flowInsightsCache.values()) releaseFlowInsightsImages(data)
  flowInsightsCache.clear()
}

function clearFlowInsightsCacheForWorkspace(projectPath: string): void {
  const normalized = normalizeWorkspaceProjectPath(projectPath)
  for (const [cachedPath, data] of flowInsightsCache.entries()) {
    if (normalizeWorkspaceProjectPath(cachedPath) !== normalized) continue
    flowInsightsCache.delete(cachedPath)
    releaseFlowInsightsImages(data)
  }
}

export function useFlowInsights() {
  const { isDesktopRuntimeAvailable } = useDesktopRuntime()
  const { currentProject, resourceVersions } = useWorkspace()
  const data = ref<FlowInsightsData | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let requestVersion = 0

  const stepResources = computed(() => data.value?.stepResources ?? null)
  const dbTrends = computed(() => data.value?.dbTrends ?? null)
  const instanceComposition = computed(() => data.value?.instanceComposition ?? null)
  const congestionTiles = computed(() => data.value?.congestionTiles ?? [])
  const congestionTileUrls = computed(
    () => data.value?.congestionTileUrls ?? new Map<string, string>(),
  )
  const drc = computed(() => data.value?.drc ?? null)
  const drcRelated = computed(() => data.value?.drcRelated ?? buildDrcRelatedMetrics({}))
  const sta = computed(() => data.value?.sta ?? null)
  const staCriticalPaths = computed(() => data.value?.staCriticalPaths ?? null)

  const unregisterRerunPrepared = onWorkspaceRerunPrepared((event) => {
    const projectPath = currentProject.value?.path
    if (
      !projectPath ||
      normalizeWorkspaceProjectPath(projectPath) !==
        normalizeWorkspaceProjectPath(event.projectPath)
    ) {
      return
    }
    requestVersion += 1
    clearFlowInsightsCacheForWorkspace(projectPath)
    data.value = null
    error.value = null
    loading.value = false
  })

  async function refresh(resourceIndex?: WorkspaceResourceIndex): Promise<void> {
    const projectPath = currentProject.value?.path
    const version = ++requestVersion
    if (!projectPath || !isDesktopRuntimeAvailable) {
      data.value = null
      error.value = null
      loading.value = false
      return
    }

    const cached = flowInsightsCache.get(projectPath)
    if (cached) data.value = cached

    loading.value = true
    error.value = null
    try {
      const index = resourceIndex ?? (await getWorkspaceResourceIndexApi())
      if (version !== requestVersion || currentProject.value?.path !== projectPath) return
      const signature = flowInsightsSignature(index)
      if (cached?.signature === signature) return

      const next = await buildFlowInsightsData(index, cached)
      if (version !== requestVersion || currentProject.value?.path !== projectPath) {
        releaseFlowInsightsImages(next)
        return
      }
      flowInsightsCache.set(projectPath, next)
      if (cached && cached.congestionTileUrls !== next.congestionTileUrls) {
        const retained = new Set(next.congestionTileUrls.values())
        for (const url of cached.congestionTileUrls.values()) {
          if (!retained.has(url) && url.startsWith('blob:')) URL.revokeObjectURL(url)
        }
      }
      data.value = next
    } catch (cause) {
      if (version !== requestVersion || currentProject.value?.path !== projectPath) return
      error.value = cause instanceof Error ? cause.message : String(cause)
      if (!cached) data.value = null
    } finally {
      if (version === requestVersion) loading.value = false
    }
  }

  onScopeDispose(() => {
    unregisterRerunPrepared()
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

  return {
    data,
    stepResources,
    dbTrends,
    instanceComposition,
    congestionTiles,
    congestionTileUrls,
    drc,
    drcRelated,
    sta,
    staCriticalPaths,
    loading,
    error,
    refresh,
  }
}
