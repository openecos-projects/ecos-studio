import { describe, expect, it } from 'vitest'
import appSource from './App.vue?raw'

describe('App design report export wiring', () => {
  it('wires useDesignReportExport composable and menu action in App.vue', () => {
    expect(appSource).toContain('useDesignReportExport')
    expect(appSource).toContain('DesignReportExportDialog')
    expect(appSource).toContain('openDesignReportExport')
    expect(appSource).toContain('exportDesignSummary: openDesignReportExport')
    expect(appSource).toContain(
      ':design-report-export-enabled="designReportExportEnabled"',
    )
  })

  it('mounts DesignReportExportDialog with full handlers and bindings', () => {
    expect(appSource).toContain('<DesignReportExportDialog')
    expect(appSource).toContain(':content="generatedDesignReportContent"')
    expect(appSource).toContain(':error="designReportError"')
    expect(appSource).toContain(':loading="designReportLoading"')
    expect(appSource).toContain(':options="designReportExportOptions"')
    expect(appSource).toContain(':report-data="designReportData"')
    expect(appSource).toContain(':selected-format="selectedDesignReportFormat"')
    expect(appSource).toContain(':visible="showDesignReportDialog"')
    expect(appSource).toContain('@close="closeDesignReportExport"')
    expect(appSource).toContain('@copy="copyDesignReport"')
    expect(appSource).toContain('@refresh="refreshDesignReportData"')
    expect(appSource).toContain('@save-all="exportAllDesignReportFormats"')
    expect(appSource).toContain('@save-current="saveDesignReport"')
  })

  it('mounts SignoffPackageReviewDialog with export and refresh handlers', () => {
    expect(appSource).toContain('<SignoffPackageReviewDialog')
    expect(appSource).toContain('@export="confirmSignoffPackageExport"')
    expect(appSource).toContain('@refresh="refreshSignoffPackageReview"')
  })
})
