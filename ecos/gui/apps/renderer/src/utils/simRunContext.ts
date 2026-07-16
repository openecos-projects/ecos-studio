export type SimSuite = 'cpu_tests' | 'rtthread' | 'coremark'

export interface SimRunContext {
  suite: SimSuite
  mode: 'all' | 'selected'
  cases: string[]
}

export function simContextsEqual(left: SimRunContext, right: SimRunContext): boolean {
  return (
    left.suite === right.suite &&
    left.mode === right.mode &&
    normalizedCaseKey(left.cases) === normalizedCaseKey(right.cases)
  )
}

export function normalizeSimCaseNameForComparison(value: string): string {
  const filename = value.trim().replace(/\\/g, '/').split('/').pop() ?? ''
  if (filename.endsWith('.soc.bin')) {
    return filename.slice(0, -'.soc.bin'.length)
  }
  if (filename.endsWith('.soc')) {
    return filename.slice(0, -'.soc'.length)
  }
  return filename
}

function normalizedCaseKey(items: string[]): string {
  return [
    ...new Set(
      items.map((item) => normalizeSimCaseNameForComparison(item)).filter(Boolean),
    ),
  ]
    .sort()
    .join('\n')
}
