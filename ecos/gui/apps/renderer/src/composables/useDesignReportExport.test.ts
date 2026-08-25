import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { appMenuActionIds } from '@ecos-studio/shared'
import { useDesignReportExport } from './useDesignReportExport'

const mockSetActionEnabled = vi.fn()
const mockGetIndex = vi.fn()
const mockReadFlow = vi.fn()
const mockReadParameters = vi.fn()
const mockReadHome = vi.fn()
const mockReadOptionalProjectTextFile = vi.fn()
const mockRequestProjectPathAccess = vi.fn()
const mockSaveFile = vi.fn()
const mockWriteProjectTextFile = vi.fn()
const mockGetVersions = vi.fn()

vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({
    app: {
      getVersions: mockGetVersions,
    },
    menu: { setActionEnabled: mockSetActionEnabled },
    workspaceResources: {
      getIndex: mockGetIndex,
      readFlow: mockReadFlow,
      readParameters: mockReadParameters,
      readHome: mockReadHome,
    },
    workspace: {
      readOptionalProjectTextFile: mockReadOptionalProjectTextFile,
      writeProjectTextFile: mockWriteProjectTextFile,
      requestProjectPathAccess: mockRequestProjectPathAccess,
    },
    dialog: {
      saveFile: mockSaveFile,
    },
  }),
  getOptionalDesktopApi: () => ({
    app: {
      getVersions: mockGetVersions,
    },
    menu: { setActionEnabled: mockSetActionEnabled },
    workspaceResources: {
      getIndex: mockGetIndex,
      readFlow: mockReadFlow,
      readParameters: mockReadParameters,
      readHome: mockReadHome,
    },
    workspace: {
      readOptionalProjectTextFile: mockReadOptionalProjectTextFile,
      writeProjectTextFile: mockWriteProjectTextFile,
      requestProjectPathAccess: mockRequestProjectPathAccess,
    },
    dialog: {
      saveFile: mockSaveFile,
    },
  }),
}))

describe('useDesignReportExport', () => {
  const currentProject = ref<{ path?: string; name?: string } | null>(null)
  const showToast = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    currentProject.value = null
    mockGetVersions.mockResolvedValue({
      gui: '0.1.0-alpha.8',
      ecc: '1.4.2',
      eccTools: 'ecc-fe',
    })
    mockGetIndex.mockResolvedValue({
      design: 'gcd',
      topModule: 'gcd',
      pdk: 'ic55',
      home: {
        flowJson: { exists: true, path: 'home/flow.json' },
        parametersJson: { exists: true, path: 'home/parameters.json' },
      },
      flow: {
        steps: [
          {
            name: 'Synthesis_yosys',
            tool: 'Yosys',
            state: 'Success',
            runtime: '0:0:30',
            directory: '/projects/gcd/ws_001/Synthesis_yosys',
            resources: {
              analysis: {
                metrics: {
                  exists: true,
                  path: '/projects/gcd/ws_001/Synthesis_yosys/analysis/qor_metrics.json',
                },
              },
              feature: {
                stat: {
                  exists: true,
                  path: '/projects/gcd/ws_001/Synthesis_yosys/feature/Synthesis_stat.json',
                },
              },
            },
          },
        ],
      },
    })
    mockReadFlow.mockResolvedValue({
      design: 'gcd',
      pdk: 'ic55',
      steps: [
        {
          name: 'Synthesis_yosys',
          tool: 'Yosys',
          state: 'Success',
          runtime: '0:0:30',
          'peak memory (mb)': 120,
        },
      ],
    })
    mockReadParameters.mockResolvedValue({
      Design: 'gcd',
      PDK: 'ic55',
      CLOCK_PERIOD: 10.0,
    })
    mockRequestProjectPathAccess.mockImplementation(async (p: string) => p)
    mockReadOptionalProjectTextFile.mockImplementation(async (p: string) => {
      if (p.includes('qor_metrics.json')) {
        return JSON.stringify({
          schema_version: 3,
          metrics: [
            { id: 'instance_count', value: 572 },
            { id: 'die_area', value: 100000 },
          ],
        })
      }
      return null
    })
  })

  it('enables menu action when workspace is open and disables when closed', async () => {
    const composable = useDesignReportExport({
      currentProject,
      showToast,
    })

    expect(composable.designReportExportEnabled.value).toBe(false)
    expect(mockSetActionEnabled).toHaveBeenCalledWith(
      appMenuActionIds.exportDesignSummary,
      false,
    )

    currentProject.value = { path: '/projects/gcd/ws_001', name: 'gcd_run' }
    await Promise.resolve()

    expect(composable.designReportExportEnabled.value).toBe(true)
    expect(mockSetActionEnabled).toHaveBeenCalledWith(
      appMenuActionIds.exportDesignSummary,
      true,
    )
  })

  it('loads workspace data and generates report content on openDesignReportExport', async () => {
    currentProject.value = { path: '/projects/gcd/ws_001', name: 'gcd_run' }
    const composable = useDesignReportExport({
      currentProject,
      showToast,
    })

    composable.openDesignReportExport('latex')
    expect(composable.dialogVisible.value).toBe(true)
    expect(composable.selectedFormat.value).toBe('latex')

    await vi.waitFor(() => expect(composable.loading.value).toBe(false))

    expect(composable.reportData.value).toBeDefined()
    expect(composable.reportData.value?.design.designName).toBe('gcd')
    expect(composable.generatedContent.value).toContain('\\begin{table}')
    expect(composable.generatedContent.value).toContain('gcd')

    composable.selectedFormat.value = 'markdown'
    expect(composable.generatedContent.value).toContain('# Design Summary Report: gcd')

    composable.selectedFormat.value = 'csv'
    expect(composable.generatedContent.value).toContain('Category,Metric,Value')

    composable.selectedFormat.value = 'text'
    expect(composable.generatedContent.value).toContain('ECOS STUDIO — DESIGN SUMMARY')
  })

  it('copies content to clipboard and shows success toast', async () => {
    currentProject.value = { path: '/projects/gcd/ws_001', name: 'gcd_run' }
    const composable = useDesignReportExport({
      currentProject,
      showToast,
    })

    composable.openDesignReportExport('latex')
    await vi.waitFor(() => expect(composable.loading.value).toBe(false))

    const clipboardWrite = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: { writeText: clipboardWrite },
    })

    const copied = await composable.copyToClipboard()
    expect(copied).toBe(true)
    expect(clipboardWrite).toHaveBeenCalledWith(composable.generatedContent.value)
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'success',
        summary: 'Copied to Clipboard',
      }),
    )
  })

  it('saves the current report file using dialog.saveFile and writeProjectTextFile', async () => {
    currentProject.value = { path: '/projects/gcd/ws_001', name: 'gcd_run' }
    const composable = useDesignReportExport({
      currentProject,
      showToast,
    })

    composable.openDesignReportExport('latex')
    await vi.waitFor(() => expect(composable.loading.value).toBe(false))

    mockSaveFile.mockResolvedValueOnce('/projects/gcd/exports/gcd_summary.tex')
    mockWriteProjectTextFile.mockResolvedValueOnce(undefined)

    const saved = await composable.saveCurrentReport()
    expect(saved).toBe(true)
    expect(mockSaveFile).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining('TEX'),
      }),
    )
    expect(mockWriteProjectTextFile).toHaveBeenCalledWith(
      '/projects/gcd/exports/gcd_summary.tex',
      composable.generatedContent.value,
    )
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'success',
        summary: 'Report Saved',
      }),
    )
  })

  it('exports all 4 formats (.tex, .md, .csv, .txt) on exportAllFormats', async () => {
    currentProject.value = { path: '/projects/gcd/ws_001', name: 'gcd_run' }
    const composable = useDesignReportExport({
      currentProject,
      showToast,
    })

    composable.openDesignReportExport()
    await vi.waitFor(() => expect(composable.loading.value).toBe(false))

    mockWriteProjectTextFile.mockResolvedValue(undefined)

    const result = await composable.exportAllFormats()
    expect(result).toBe(true)
    expect(mockWriteProjectTextFile).toHaveBeenCalledTimes(4)
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'success',
        summary: 'All Formats Exported',
      }),
    )
  })

  it('warns when trying to open export without an active workspace', () => {
    const composable = useDesignReportExport({
      currentProject,
      showToast,
    })

    composable.openDesignReportExport()
    expect(composable.dialogVisible.value).toBe(false)
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'warn',
        summary: 'No Workspace Open',
      }),
    )
  })
})
