import type { StepCompareCandidate } from './projectStepAnalysis'

/**
 * Which columns the cross-workspace comparison renders, and in what order.
 *
 * There is no ceiling on how many workspaces may be compared. A ceiling turns reading
 * into budgeting: a column can only be added by first taking another away, and the
 * workspaces above the ceiling leave the table without it saying which ones or why. The
 * table scrolls instead, and a reader narrows it with a predicate, a search, and a rank,
 * all three of which still mean something at fifty workspaces.
 */

/** Which workspaces of the project the comparison shows at all. */
export type StepCompareColumnFilterId = 'all' | 'reported' | 'differing' | 'findings'

export type StepCompareSortDirection = 'leading' | 'trailing'

export interface StepCompareSort {
  metricName: string
  /**
   * The direction the metric itself reports. Null for the metrics that report none,
   * where leading can only mean the larger value rather than the better one.
   */
  higherIsBetter: boolean | null
  direction: StepCompareSortDirection
}

export interface StepComparisonScopeInput {
  candidates: readonly StepCompareCandidate[]
  baselineWorkspaceId?: string | null
  selectedWorkspaceId?: string | null
  filter?: StepCompareColumnFilterId
  query?: string
  sort?: StepCompareSort | null
}

export interface StepComparisonScope {
  /**
   * Columns to render, in order. The baseline leads so a reader who has scrolled out to
   * the far columns still has the value every delta beside it is measured against.
   */
  workspaceIds: string[]
  /**
   * Rendered whatever the filter and the search say. Dropping the baseline would leave
   * the deltas counted against a column that is not on screen, and dropping the current
   * workspace would let this table disagree with the findings view behind the same tab.
   */
  pinnedWorkspaceIds: string[]
  /** Workspaces the project has that this comparison leaves out, so the view can say so. */
  hiddenWorkspaceCount: number
  /** Counts for the filter controls, narrowed by the active search. */
  filterCounts: Record<StepCompareColumnFilterId, number>
}

const FILTER_PREDICATES: Record<
  StepCompareColumnFilterId,
  (candidate: StepCompareCandidate) => boolean
> = {
  all: () => true,
  reported: (candidate) => candidate.reported,
  differing: (candidate) => candidate.differs,
  findings: (candidate) => candidate.findingCount > 0,
}

/** Reading order for the filter controls: widest population first, then each narrowing. */
export const STEP_COMPARE_COLUMN_FILTERS: readonly {
  id: StepCompareColumnFilterId
  label: string
  title: string
}[] = [
  { id: 'all', label: 'All', title: 'Every workspace in the project' },
  {
    id: 'reported',
    label: 'Reported',
    title: 'Only workspaces that reported a metric for this step',
  },
  {
    id: 'differing',
    label: 'Differing',
    title: 'Only workspaces where a metric differs from the baseline',
  },
  {
    id: 'findings',
    label: 'Findings',
    title: 'Only workspaces with a finding on this step',
  },
]

function matchesQuery(candidate: StepCompareCandidate, query: string): boolean {
  if (!query) return true
  return `${candidate.workspaceId} ${candidate.workspaceName}`
    .toLocaleLowerCase()
    .includes(query)
}

/**
 * Default order keeps the project's own workspace order, except that a workspace with
 * nothing to compare sinks to the end instead of sitting between two that do have values.
 * A sort replaces that ordering with a rank on the metric the reader picked.
 */
function orderCandidates(
  candidates: readonly StepCompareCandidate[],
  sort: StepCompareSort | null,
): StepCompareCandidate[] {
  if (!sort) {
    return [
      ...candidates.filter((candidate) => candidate.reported),
      ...candidates.filter((candidate) => !candidate.reported),
    ]
  }
  const ascending = (sort.higherIsBetter === false) === (sort.direction === 'leading')
  return [...candidates].sort((left, right) => {
    const leftValue = left.metricValues.get(sort.metricName)
    const rightValue = right.metricValues.get(sort.metricName)
    // A workspace that never reported the ranked metric cannot hold a rank in it.
    if (leftValue === undefined || rightValue === undefined) {
      if (leftValue === rightValue) return 0
      return leftValue === undefined ? 1 : -1
    }
    if (leftValue === rightValue) return 0
    const below = leftValue < rightValue
    return below === ascending ? -1 : 1
  })
}

export function buildStepComparisonScope(
  input: StepComparisonScopeInput,
): StepComparisonScope {
  const candidates: StepCompareCandidate[] = []
  const available = new Set<string>()
  for (const candidate of input.candidates) {
    if (available.has(candidate.workspaceId)) continue
    available.add(candidate.workspaceId)
    candidates.push(candidate)
  }

  const pinnedWorkspaceIds = [
    input.baselineWorkspaceId,
    input.selectedWorkspaceId,
  ].filter(
    (id, index, all): id is string =>
      typeof id === 'string' && available.has(id) && all.indexOf(id) === index,
  )
  const pinned = new Set(pinnedWorkspaceIds)

  const query = (input.query ?? '').trim().toLocaleLowerCase()
  const filter = input.filter ?? 'all'
  const searched = candidates.filter((candidate) => matchesQuery(candidate, query))
  const filterCounts = {} as Record<StepCompareColumnFilterId, number>
  for (const option of STEP_COMPARE_COLUMN_FILTERS) {
    filterCounts[option.id] = searched.filter(FILTER_PREDICATES[option.id]).length
  }

  const matched = orderCandidates(candidates, input.sort ?? null).filter(
    (candidate) =>
      !pinned.has(candidate.workspaceId) &&
      FILTER_PREDICATES[filter](candidate) &&
      matchesQuery(candidate, query),
  )
  const workspaceIds = [
    ...pinnedWorkspaceIds,
    ...matched.map((candidate) => candidate.workspaceId),
  ]

  return {
    workspaceIds,
    pinnedWorkspaceIds,
    hiddenWorkspaceCount: Math.max(0, candidates.length - workspaceIds.length),
    filterCounts,
  }
}
