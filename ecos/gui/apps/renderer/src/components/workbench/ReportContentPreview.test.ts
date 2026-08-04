import { describe, expect, it } from 'vitest'
import source from './ReportContentPreview.vue?raw'

describe('ReportContentPreview', () => {
  it('uses the same structured report modes as the Step Analysis report', () => {
    expect(source).toContain("if (extension === 'json') return 'json'")
    expect(source).toContain("if (extension === 'csv') return 'csv'")
    expect(source).toContain(
      "if (extension === 'html' || extension === 'htm') return 'html'",
    )
    expect(source).toContain('simpleJson')
    expect(source).toContain('csvHeaders')
  })

  it('keeps report data selectable and sanitizes embedded HTML', () => {
    expect(source).toContain('user-select: text')
    expect(source).toContain('sanitizeHtml')
    expect(source).toContain('v-html="safeHtml"')
  })
})
