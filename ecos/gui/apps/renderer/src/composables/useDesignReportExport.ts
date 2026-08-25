import { computed, onUnmounted, reactive, ref, watch, type Ref } from 'vue'
import {
  appMenuActionIds,
  canonicalizeStageName,
  extractDesignReportData,
  generateDesignReport,
  joinLocalPath,
  parsePowerRpt,
  parseQorSummaryRpt,
  projectManagementWorkspaceStepAnalysisSpecs,
  type DesignReportData,
  type DesignReportExportOptions,
  type DesignReportFormat,
  type WorkspaceResourceIndex,
} from '@ecos-studio/shared'
import { getDesktopApi, getOptionalDesktopApi } from '@/platform/desktop'
import {
  getWorkspaceResourceIndexApi,
  readWorkspaceFlowResourceApi,
  readWorkspaceHomeResourceApi,
  readWorkspaceParametersResourceApi,
} from '@/api/workspaceResources'
import { resolveProjectPathAccess } from '@/utils/projectFs'
import { readOptionalProjectTextFile, writeProjectTextFile } from '@/utils/projectFiles'
import { parseDrcStatisCsv } from '@/components/flow-insights/flowInsightsData'

interface WorkspaceProject {
  path?: string
  name?: string
  pdk?: string
  topModule?: string
  designTool?: string
  frequencyTarget?: number
}

interface ToastOptions {
  severity?: 'success' | 'info' | 'warn' | 'error' | 'secondary' | 'contrast'
  summary: string
  detail?: string
  life?: number
}

interface UseDesignReportExportDependencies {
  currentProject: Readonly<Ref<WorkspaceProject | null | undefined>>
  showToast(options: ToastOptions): void
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function projectPathForWorkspace(workspacePath: string): string {
  const normalized = workspacePath.replace(/[\\/]+$/g, '')
  const separatorIndex = Math.max(
    normalized.lastIndexOf('/'),
    normalized.lastIndexOf('\\'),
  )
  if (separatorIndex <= 0) return normalized
  return normalized.slice(0, separatorIndex)
}

function formatFileExtension(format: DesignReportFormat): string {
  switch (format) {
    case 'latex':
      return 'tex'
    case 'markdown':
      return 'md'
    case 'csv':
      return 'csv'
    case 'text':
      return 'txt'
  }
}

async function readJsonFrom(
  path: string | undefined,
): Promise<Record<string, unknown> | null> {
  if (!path) return null
  const authorized = await resolveProjectPathAccess(path)
  const pathToRead = authorized || path
  try {
    const text = await readOptionalProjectTextFile(pathToRead)
    if (!text) return null
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
}

async function readOptionalTextFrom(path: string | undefined): Promise<string | null> {
  if (!path) return null
  const authorized = await resolveProjectPathAccess(path)
  const pathToRead = authorized || path
  try {
    return await readOptionalProjectTextFile(pathToRead)
  } catch {
    return null
  }
}

const COMMON_CORNER_CANDIDATES = [
  'MAX_125/Cworst',
  'MAX_125/RCworst',
  'MIN_m40/Cbest',
  'MIN_m40/Cworst',
  'MIN_m40/RCbest',
  'MIN_m40/RCworst',
  'ML_125/Cbest',
  'ML_125/Cworst',
  'ML_125/RCbest',
  'ML_125/RCworst',
  'TYP_25/TYPICAL',
  'WCL_m40/Cworst',
  'WCL_m40/RCworst',
  'nom_tt_025C_1v80',
  'slow_ss_125C_1v60',
  'fast_ff_m40C_1v95',
  'post_synthesis',
  'default',
]

export function useDesignReportExport({
  currentProject,
  showToast,
}: UseDesignReportExportDependencies) {
  const dialogVisible = ref(false)
  const loading = ref(false)
  const error = ref('')
  const selectedFormat = ref<DesignReportFormat>('latex')
  const reportData = ref<DesignReportData | null>(null)
  const designReportExportEnabled = ref(false)

  const exportOptions = reactive<DesignReportExportOptions>({
    includeMultiCorner: true,
    includeStageBreakdown: true,
    includeVerificationBreakdown: true,
    includeProvenance: false,
    latexStandalone: false,
    latexUseBooktabs: true,
    latexUseSiunitx: true,
  })

  let unmounted = false
  let loadGeneration = 0

  const generatedContent = computed(() => {
    if (!reportData.value) return ''
    return generateDesignReport(reportData.value, selectedFormat.value, exportOptions)
  })

  async function setMenuEnabled(enabled: boolean): Promise<void> {
    designReportExportEnabled.value = enabled
    try {
      const api = getOptionalDesktopApi()
      if (api) {
        await api.menu.setActionEnabled(appMenuActionIds.exportDesignSummary, enabled)
      }
    } catch (err) {
      console.warn('[design-report-export] Failed to set menu action state:', err)
    }
  }

  async function syncMenuEligibility(): Promise<void> {
    const hasWorkspace = Boolean(currentProject.value?.path)
    await setMenuEnabled(hasWorkspace)
  }

  watch(
    () => currentProject.value?.path,
    () => {
      void syncMenuEligibility()
      if (dialogVisible.value && !currentProject.value?.path) {
        closeDesignReportExport()
      }
    },
    { immediate: true },
  )

  onUnmounted(() => {
    unmounted = true
    closeDesignReportExport()
    void setMenuEnabled(false)
  })

  async function loadWorkspaceReportData(): Promise<void> {
    const workspacePath = currentProject.value?.path
    if (!workspacePath) {
      error.value = 'No active workspace open.'
      return
    }

    const generation = ++loadGeneration
    loading.value = true
    error.value = ''

    try {
      const api = getDesktopApi()

      // 1. Get version info from desktop app
      let versionInfo = null
      try {
        versionInfo = await api.app.getVersions()
      } catch {
        /* ignore */
      }

      // 2. Query workspace resource index
      let resourceIndex: WorkspaceResourceIndex | null = null
      try {
        resourceIndex = await getWorkspaceResourceIndexApi()
      } catch {
        /* ignore if index API fails */
      }

      // 3. Read flow.json and parameters.json and home.json
      let flow: Record<string, unknown> | null = null
      let parameters: Record<string, unknown> | null = null
      let homeData: Record<string, unknown> | null = null

      try {
        flow = await readWorkspaceFlowResourceApi()
      } catch {
        /* ignore */
      }
      if (!flow && resourceIndex?.home.flowJson?.exists) {
        flow = await readJsonFrom(resourceIndex.home.flowJson.path)
      }
      if (!flow) {
        flow = await readJsonFrom('home/flow.json')
      }

      try {
        parameters = await readWorkspaceParametersResourceApi()
      } catch {
        /* ignore */
      }
      if (!parameters && resourceIndex?.parameters) {
        parameters = resourceIndex.parameters
      }
      if (!parameters && resourceIndex?.home.parametersJson?.exists) {
        parameters = await readJsonFrom(resourceIndex.home.parametersJson.path)
      }
      if (!parameters) {
        parameters = await readJsonFrom('home/parameters.json')
      }

      try {
        homeData = await readWorkspaceHomeResourceApi()
      } catch {
        /* ignore */
      }
      if (!homeData && resourceIndex?.homeData) {
        homeData = resourceIndex.homeData
      }

      let pdkJson: Record<string, unknown> | null = null
      try {
        pdkJson =
          (await readJsonFrom('home/pdk.json')) ||
          (await readJsonFrom('config/pdk.json')) ||
          (await readJsonFrom('pdk.json'))
      } catch {
        /* ignore */
      }
      if (pdkJson) {
        homeData = { ...homeData, ...pdkJson }
      }

      const topModule =
        resourceIndex?.topModule ||
        resourceIndex?.design ||
        currentProject.value?.topModule ||
        currentProject.value?.name ||
        'gcd'

      // 4. Collect step metrics from workspace resource index & raw step directories
      const stepMetrics: Record<string, unknown> = {}
      const stepSummaries: Record<string, unknown> = {}
      const stepHotspots: Record<string, unknown> = {}

      const stepList =
        resourceIndex &&
        Array.isArray(resourceIndex.flow?.steps) &&
        resourceIndex.flow.steps.length > 0
          ? resourceIndex.flow.steps
          : Array.isArray(flow?.steps)
            ? flow!.steps
            : []

      await Promise.all(
        stepList.map(async (rawStep: unknown) => {
          if (!rawStep || typeof rawStep !== 'object') return
          const stepObj = rawStep as Record<string, unknown>
          const stepName = typeof stepObj.name === 'string' ? stepObj.name : ''
          const stepDir =
            typeof stepObj.directory === 'string'
              ? stepObj.directory.replace(/\/+$/, '')
              : stepName
          if (!stepName) return

          const canonical = canonicalizeStageName(stepName)
          const resources =
            typeof stepObj.resources === 'object' && stepObj.resources !== null
              ? (stepObj.resources as Record<
                  string,
                  Record<string, { exists: boolean; path: string }>
                >)
              : null

          // 4.1 Check analysis metrics
          if (resources?.analysis?.metrics?.exists) {
            const m = await readJsonFrom(resources.analysis.metrics.path)
            if (m) {
              stepMetrics[stepName] = {
                ...(stepMetrics[stepName] as Record<string, unknown>),
                ...m,
              }
              stepMetrics[canonical] = {
                ...(stepMetrics[canonical] as Record<string, unknown>),
                ...m,
              }
            }
          } else {
            const m = await readJsonFrom(`${stepDir}/analysis/qor_metrics.json`)
            if (m) {
              stepMetrics[stepName] = {
                ...(stepMetrics[stepName] as Record<string, unknown>),
                ...m,
              }
              stepMetrics[canonical] = {
                ...(stepMetrics[canonical] as Record<string, unknown>),
                ...m,
              }
            }
          }

          // 4.2 Check analysis summary
          if (resources?.analysis?.summary?.exists) {
            const s = await readJsonFrom(resources.analysis.summary.path)
            if (s) {
              stepSummaries[stepName] = {
                ...(stepSummaries[stepName] as Record<string, unknown>),
                ...s,
              }
              stepSummaries[canonical] = {
                ...(stepSummaries[canonical] as Record<string, unknown>),
                ...s,
              }
            }
          } else {
            const s = await readJsonFrom(`${stepDir}/analysis/qor_summary.json`)
            if (s) {
              stepSummaries[stepName] = {
                ...(stepSummaries[stepName] as Record<string, unknown>),
                ...s,
              }
              stepSummaries[canonical] = {
                ...(stepSummaries[canonical] as Record<string, unknown>),
                ...s,
              }
            }
          }

          // 4.3 Check feature db (step.db.json)
          if (resources?.feature?.db?.exists) {
            const db = await readJsonFrom(resources.feature.db.path)
            if (db) {
              stepMetrics[stepName] = {
                ...(stepMetrics[stepName] as Record<string, unknown>),
                ...db,
              }
              stepMetrics[canonical] = {
                ...(stepMetrics[canonical] as Record<string, unknown>),
                ...db,
              }
            }
          } else {
            const dbCandidates = [
              `${stepDir}/feature/${stepName}.db.json`,
              `${stepDir}/feature/db.json`,
              `${stepDir}/db.json`,
              `${stepDir}/feature/${canonical}.db.json`,
            ]
            for (const cand of dbCandidates) {
              const db = await readJsonFrom(cand)
              if (db) {
                stepMetrics[stepName] = {
                  ...(stepMetrics[stepName] as Record<string, unknown>),
                  ...db,
                }
                stepMetrics[canonical] = {
                  ...(stepMetrics[canonical] as Record<string, unknown>),
                  ...db,
                }
                break
              }
            }
          }

          // 4.4 Check feature stat (Synthesis_stat.json)
          const statFile = resources?.feature?.stat ?? resources?.feature?.generic_stat
          if (statFile?.exists) {
            const stat = await readJsonFrom(statFile.path)
            if (stat) {
              stepMetrics[stepName] = {
                ...(stepMetrics[stepName] as Record<string, unknown>),
                ...stat,
              }
              stepMetrics[canonical] = {
                ...(stepMetrics[canonical] as Record<string, unknown>),
                ...stat,
              }
            }
          } else {
            const stat =
              (await readJsonFrom(`${stepDir}/feature/Synthesis_stat.json`)) ||
              (await readJsonFrom(`${stepDir}/report/Synthesis_stat.json`))
            if (stat) {
              stepMetrics[stepName] = {
                ...(stepMetrics[stepName] as Record<string, unknown>),
                ...stat,
              }
              stepMetrics[canonical] = {
                ...(stepMetrics[canonical] as Record<string, unknown>),
                ...stat,
              }
            }
          }

          // 4.5 Check feature step (e.g. sta.step.json, cts.step.json)
          let stepJson: Record<string, unknown> | null = null
          if (resources?.feature?.step?.exists) {
            stepJson = await readJsonFrom(resources.feature.step.path)
          } else {
            stepJson =
              (await readJsonFrom(`${stepDir}/feature/${stepName}.step.json`)) ||
              (await readJsonFrom(
                `${stepDir}/feature/${canonical.toLowerCase()}.step.json`,
              )) ||
              (await readJsonFrom(`${stepDir}/feature/step.json`))
          }
          if (stepJson) {
            stepMetrics[stepName] = {
              ...(stepMetrics[stepName] as Record<string, unknown>),
              ...stepJson,
            }
            stepMetrics[canonical] = {
              ...(stepMetrics[canonical] as Record<string, unknown>),
              ...stepJson,
            }
          }

          // 4.6 Check DRC statis CSV
          if (resources?.analysis?.statis_csv?.exists) {
            const drcCsv = await readOptionalTextFrom(resources.analysis.statis_csv.path)
            if (drcCsv) {
              const parsedDrc = parseDrcStatisCsv(drcCsv)
              if (parsedDrc) {
                const drcExisting = (stepMetrics['DRC'] as Record<string, unknown>) || {}
                stepMetrics['DRC'] = {
                  ...drcExisting,
                  drc_violations: parsedDrc.totalCount,
                  drc_count: parsedDrc.totalCount,
                }
              }
            }
          } else if (canonical === 'DRC') {
            const drcCsv = await readOptionalTextFrom(
              `${stepDir}/analysis/drc_statis.csv`,
            )
            if (drcCsv) {
              const parsedDrc = parseDrcStatisCsv(drcCsv)
              if (parsedDrc) {
                const drcExisting = (stepMetrics['DRC'] as Record<string, unknown>) || {}
                stepMetrics['DRC'] = {
                  ...drcExisting,
                  drc_violations: parsedDrc.totalCount,
                  drc_count: parsedDrc.totalCount,
                }
              }
            }
          }

          // 4.7 Scan for power.rpt and qor_summary.rpt at step level
          const directPowerRpt =
            (await readOptionalTextFrom(
              `${stepDir}/data/sta/power_reporter/power.rpt`,
            )) ||
            (await readOptionalTextFrom(`${stepDir}/report/post_synthesis/power.rpt`))
          if (directPowerRpt) {
            const parsed = parsePowerRpt(directPowerRpt)
            stepMetrics[stepName] = {
              ...(stepMetrics[stepName] as Record<string, unknown>),
              ...parsed,
            }
            stepMetrics[canonical] = {
              ...(stepMetrics[canonical] as Record<string, unknown>),
              ...parsed,
            }
          }

          const directQorRpt =
            (await readOptionalTextFrom(
              `${stepDir}/data/sta/timing_reporter/qor_summary.rpt`,
            )) ||
            (await readOptionalTextFrom(
              `${stepDir}/report/post_synthesis/qor_summary.rpt`,
            ))
          if (directQorRpt) {
            const parsed = parseQorSummaryRpt(directQorRpt)
            stepMetrics[stepName] = {
              ...(stepMetrics[stepName] as Record<string, unknown>),
              ...parsed,
            }
            stepMetrics[canonical] = {
              ...(stepMetrics[canonical] as Record<string, unknown>),
              ...parsed,
            }
          }

          // 4.8 Scan for Multi-Corner reports (under feature/<corner>/ and report/<corner>/)
          const cornersMap: Record<string, Record<string, unknown>> = {}

          await Promise.all(
            COMMON_CORNER_CANDIDATES.map(async (corner) => {
              const qorJson = await readJsonFrom(
                `${stepDir}/feature/${corner}/qor_summary.json`,
              )
              const powerJson = await readJsonFrom(
                `${stepDir}/feature/${corner}/power_summary.json`,
              )
              const pathsJson = await readJsonFrom(
                `${stepDir}/feature/${corner}/timing_paths.json`,
              )
              const powerRptText = await readOptionalTextFrom(
                `${stepDir}/report/${corner}/power.rpt`,
              )
              const qorRptText = await readOptionalTextFrom(
                `${stepDir}/report/${corner}/qor_summary.rpt`,
              )

              let cornerData: Record<string, unknown> = {}
              let hasCornerData = false

              if (qorJson) {
                cornerData = { ...cornerData, ...qorJson }
                hasCornerData = true
              }
              if (powerJson) {
                cornerData = { ...cornerData, ...powerJson }
                hasCornerData = true
              }
              if (pathsJson) {
                cornerData = { ...cornerData, ...pathsJson }
                hasCornerData = true
              }
              if (powerRptText) {
                const parsedPower = parsePowerRpt(powerRptText)
                cornerData = { ...cornerData, ...parsedPower }
                hasCornerData = true
              }
              if (qorRptText) {
                const parsedQor = parseQorSummaryRpt(qorRptText)
                cornerData = { ...cornerData, ...parsedQor }
                hasCornerData = true
              }

              if (hasCornerData) {
                cornersMap[corner] = cornerData
              }
            }),
          )

          if (Object.keys(cornersMap).length > 0) {
            const targetKey = canonical === 'Synth' ? 'Synth' : 'STA'
            const existing = (stepMetrics[targetKey] as Record<string, unknown>) || {}
            stepMetrics[targetKey] = {
              ...existing,
              corners: {
                ...(existing.corners as Record<string, unknown>),
                ...cornersMap,
              },
            }
          }
        }),
      )

      // 5. Fallback standard predefined analysis specs
      await Promise.all(
        projectManagementWorkspaceStepAnalysisSpecs.map(async (spec) => {
          if (!stepMetrics[spec.step]) {
            const m = await readJsonFrom(spec.metricsPath)
            if (m) stepMetrics[spec.step] = m
          }
          if (!stepSummaries[spec.step]) {
            const s = await readJsonFrom(spec.summaryPath)
            if (s) stepSummaries[spec.step] = s
          }
          if (!stepHotspots[spec.step]) {
            const h = await readJsonFrom(spec.hotspotsPath)
            if (h) stepHotspots[spec.step] = h
          }
        }),
      )

      // 6. STA timing issues
      let staTimingIssues: Record<string, unknown> | null = null
      staTimingIssues = await readJsonFrom('sta_ecc/analysis/sta_timing_issues.json')

      if (unmounted || generation !== loadGeneration) return

      const extracted = extractDesignReportData({
        workspacePath,
        workspaceName: currentProject.value?.name,
        designName: resourceIndex?.design || currentProject.value?.topModule,
        topModule,
        pdk: resourceIndex?.pdk || currentProject.value?.pdk,
        frequencyTarget: currentProject.value?.frequencyTarget,
        parameters,
        flow,
        homeData,
        stepMetrics,
        stepSummaries,
        stepHotspots,
        staTimingIssues,
        versionInfo,
      })

      reportData.value = extracted
      loading.value = false
    } catch (err) {
      if (unmounted || generation !== loadGeneration) return
      error.value = errorDetail(err) || 'Failed to extract design metrics.'
      loading.value = false
    }
  }

  function openDesignReportExport(initialFormat?: DesignReportFormat): void {
    if (!currentProject.value?.path) {
      showToast({
        severity: 'warn',
        summary: 'No Workspace Open',
        detail: 'Open or run a workspace before exporting signoff reports.',
      })
      return
    }

    if (initialFormat) {
      selectedFormat.value = initialFormat
    }
    dialogVisible.value = true
    void loadWorkspaceReportData()
  }

  function closeDesignReportExport(): void {
    dialogVisible.value = false
    loading.value = false
    error.value = ''
  }

  async function copyToClipboard(): Promise<boolean> {
    const text = generatedContent.value
    if (!text) return false

    try {
      await navigator.clipboard.writeText(text)
      showToast({
        severity: 'success',
        summary: 'Copied to Clipboard',
        detail: `Exported ${selectedFormat.value.toUpperCase()} report copied to clipboard.`,
        life: 3000,
      })
      return true
    } catch (err) {
      showToast({
        severity: 'error',
        summary: 'Clipboard Error',
        detail: errorDetail(err) || 'Failed to copy to clipboard.',
      })
      return false
    }
  }

  async function saveCurrentReport(): Promise<boolean> {
    const text = generatedContent.value
    if (!text || !currentProject.value?.path) return false

    const design = reportData.value?.design.designName || 'design'
    const ext = formatFileExtension(selectedFormat.value)
    const defaultFilename = `${design}_design_summary.${ext}`
    const defaultPath = joinLocalPath(
      projectPathForWorkspace(currentProject.value.path),
      defaultFilename,
    )

    try {
      const api = getDesktopApi()
      const destination = await api.dialog.saveFile({
        title: `Save ${selectedFormat.value.toUpperCase()} Design Summary`,
        defaultPath,
        filters: [
          {
            name: `${selectedFormat.value.toUpperCase()} Files`,
            extensions: [ext],
          },
          { name: 'All Files', extensions: ['*'] },
        ],
      })

      if (!destination) return false

      await writeProjectTextFile(destination, text)
      showToast({
        severity: 'success',
        summary: 'Report Saved',
        detail: `Report written to ${destination}`,
        life: 4000,
      })
      return true
    } catch (err) {
      showToast({
        severity: 'error',
        summary: 'Save Failed',
        detail: errorDetail(err) || 'Could not save report file.',
      })
      return false
    }
  }

  async function exportAllFormats(): Promise<boolean> {
    if (!reportData.value || !currentProject.value?.path) return false

    const formats: DesignReportFormat[] = ['latex', 'markdown', 'csv', 'text']
    const design = reportData.value.design.designName || 'design'
    const parentDir = projectPathForWorkspace(currentProject.value.path)

    try {
      await Promise.all(
        formats.map(async (fmt) => {
          const ext = formatFileExtension(fmt)
          const content = generateDesignReport(reportData.value!, fmt, exportOptions)
          const targetPath = joinLocalPath(parentDir, `${design}_design_summary.${ext}`)
          await writeProjectTextFile(targetPath, content)
        }),
      )

      showToast({
        severity: 'success',
        summary: 'All Formats Exported',
        detail: `Successfully generated .tex, .md, .csv, and .txt files in ${parentDir}`,
        life: 5000,
      })
      return true
    } catch (err) {
      showToast({
        severity: 'error',
        summary: 'Batch Export Failed',
        detail: errorDetail(err) || 'Failed to export all format artifacts.',
      })
      return false
    }
  }

  return {
    dialogVisible,
    loading,
    error,
    selectedFormat,
    reportData,
    generatedContent,
    exportOptions,
    designReportExportEnabled,
    openDesignReportExport,
    closeDesignReportExport,
    copyToClipboard,
    saveCurrentReport,
    exportAllFormats,
    loadWorkspaceReportData,
    refreshReportData: loadWorkspaceReportData,
  }
}
