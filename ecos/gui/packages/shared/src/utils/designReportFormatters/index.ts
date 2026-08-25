import type {
  DesignReportData,
  DesignReportExportOptions,
  DesignReportFormat,
} from '../../contracts/designReport.ts'
import { formatCsvReport } from './csvFormatter.ts'
import { formatLatexReport } from './latexFormatter.ts'
import { formatMarkdownReport } from './markdownFormatter.ts'
import { formatTextReport } from './textFormatter.ts'
import { formatTypstReport } from './typstFormatter.ts'

export { formatCsvReport } from './csvFormatter.ts'
export { formatLatexReport } from './latexFormatter.ts'
export { formatMarkdownReport } from './markdownFormatter.ts'
export { formatTextReport } from './textFormatter.ts'
export { formatTypstReport } from './typstFormatter.ts'

export function generateDesignReport(
  data: DesignReportData,
  format: DesignReportFormat,
  options: DesignReportExportOptions = {},
): string {
  switch (format) {
    case 'latex':
      return formatLatexReport(data, options)
    case 'markdown':
      return formatMarkdownReport(data, options)
    case 'csv':
      return formatCsvReport(data, options)
    case 'text':
      return formatTextReport(data, options)
    case 'typst':
      return formatTypstReport(data, options)
    default:
      return formatMarkdownReport(data, options)
  }
}
