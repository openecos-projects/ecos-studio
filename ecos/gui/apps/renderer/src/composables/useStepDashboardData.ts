import { computed, onScopeDispose, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { WorkspaceResourceFile, WorkspaceStepResource } from '@ecos-studio/shared'
import { InfoEnum } from '@/api/type'
import {
  getWorkspaceResourceIndexApi,
  resolveWorkspaceStepInfoApi,
} from '@/api/workspaceResources'
import { readOptionalProjectTextFile, readProjectBlobUrl } from '@/utils/projectFiles'
import { resolveProjectPathAccess } from '@/utils/projectFs'
import { useDesktopRuntime } from '@/composables/useDesktopRuntime'
import { useWorkspace } from '@/composables/useWorkspace'
import {
  checklistSummary,
  dbDistributions,
  dbHighlights,
  mapHighlights,
  qorSummary,
  record,
  runSummary,
  stepDistribution,
  stepKeyMetrics,
  type StepDashboardBar,
  type StepDashboardChecklist,
  type StepDashboardDistribution,
  type StepDashboardMetric,
  type StepDashboardQor,
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
  layoutUrl: string | null
  mapUrl: string | null
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

export function useStepDashboardData() {
  const route = useRoute()
  const { isDesktopRuntimeAvailable } = useDesktopRuntime()
  const { currentProject, resourceVersions } = useWorkspace()
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

  async function readJson(path: string): Promise<unknown | null> {
    if (!path) return null
    const authorizedPath = await resolveProjectPathAccess(path)
    if (!authorizedPath) return null
    const text = await readOptionalProjectTextFile(authorizedPath)
    if (!text) return null
    try {
      return JSON.parse(text) as unknown
    } catch {
      return null
    }
  }

  async function readImage(path: string): Promise<string | null> {
    if (!path) return null
    const authorizedPath = await resolveProjectPathAccess(path)
    if (!authorizedPath) return null
    return readProjectBlobUrl(authorizedPath, { mimeType: 'image/png' })
  }

  async function refresh(): Promise<void> {
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
        getWorkspaceResourceIndexApi(),
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
      const stepPath =
        stringInfo(analysisResponse.info, 'step feature') ||
        resourceStep.resources.feature.step?.path ||
        `${resourceStep.directory}/feature/${resourceStep.name}.step.json`
      const dbPath = stringInfo(analysisResponse.info, 'data summary')
      const checklistPath = `${resourceStep.directory}/checklist.json`
      const featureMapPath = resourceStep.resources.feature.map?.exists
        ? resourceStep.resources.feature.map.path
        : ''
      const layoutPath = stringInfo(layoutResponse.info, 'image')
      const availableMapPath = mapImagePath(mapResponse.info)

      const [
        stepJson,
        dbJson,
        checklistJson,
        mapJson,
        metricsJson,
        qorSummaryJson,
        hotspotsJson,
      ] = await Promise.all([
        readJson(stepPath),
        readJson(dbPath),
        readJson(checklistPath),
        readJson(featureMapPath),
        readJson(metricsPath),
        readJson(siblingAnalysisPath(metricsPath, 'qor_summary.json')),
        readJson(siblingAnalysisPath(metricsPath, 'qor_hotspots.json')),
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
        layoutUrl,
        mapUrl,
        hasGeometry: Boolean(resourceStep.resources.output.geometryManifest?.exists),
        reports: reportFiles(
          resourceStep.resources.report,
          `${resourceStep.directory}/report`,
        ),
      }
      if (!cacheKey) {
        revokeBlobUrl(layoutUrl)
        revokeBlobUrl(mapUrl)
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

  onScopeDispose(() => {
    requestVersion += 1
  })

  return { currentStep, data, error, loading, refresh }
}
