import type { ProjectManifestFrontendFlowStep } from '@ecos-studio/shared'

export type FrontendAnalysisStage = ProjectManifestFrontendFlowStep
export type FrontendAnalysisTone = 'neutral' | 'good' | 'warn' | 'bad'
export type FrontendAnalysisStepStatus =
  | 'success'
  | 'reused'
  | 'skipped'
  | 'unstart'
  | 'running'
  | 'failed'

export interface FrontendAnalysisMetric {
  id: string
  label: string
  display: string
  value: number | null
  tone: FrontendAnalysisTone
}

export interface FrontendAnalysisFinding {
  id: string
  workspaceId: string
  stage: FrontendAnalysisStage
  severity: 'error' | 'warning' | 'info'
  title: string
  detail: string
  source?: string
  line?: number
}

export interface FrontendStepAnalysis {
  stage: FrontendAnalysisStage
  label: string
  status: FrontendAnalysisStepStatus
  runtime: string
  runtimeSeconds: number | null
  metrics: FrontendAnalysisMetric[]
  findings: FrontendAnalysisFinding[]
  available: boolean
}

export interface FrontendWorkspaceAnalysis {
  workspaceId: string
  workspaceName: string
  workspacePath: string
  status: string
  steps: FrontendStepAnalysis[]
  completedSteps: number
  totalSteps: number
  progressPercent: number
  errors: number
  warnings: number
  actionableWarnings: number
  totalCases: number
  passedCases: number
  failedCases: number
  passRate: number | null
  cycles: number | null
  difftestPassed: number
  findings: FrontendAnalysisFinding[]
}

export interface FrontendProjectAnalysis {
  workspaces: FrontendWorkspaceAnalysis[]
  findings: FrontendAnalysisFinding[]
  workspaceCount: number
  completeWorkspaceCount: number
  failedWorkspaceCount: number
  runningWorkspaceCount: number
  completedSteps: number
  totalSteps: number
  progressPercent: number
  totalCases: number
  passedCases: number
  failedCases: number
  passRate: number | null
}

export interface FrontendWorkspaceAnalysisSource {
  workspaceId: string
  workspaceName: string
  workspacePath: string
  status: string
  startStage?: FrontendAnalysisStage
  endStage?: FrontendAnalysisStage
  steps: ReadonlyArray<{
    stage: FrontendAnalysisStage
    status: FrontendAnalysisStepStatus
  }>
  detailTexts?: Partial<Record<FrontendAnalysisStage, string | null>>
}

const FRONTEND_STAGE_LABELS: Record<FrontendAnalysisStage, string> = {
  prepare: 'Prepare',
  review: 'RTL Review',
  elab: 'Elaboration',
  lint: 'Lint',
  sim: 'Simulation',
}

const COMPLETED_STATUSES = new Set<FrontendAnalysisStepStatus>(['success', 'reused'])
const PREPARE_CONTRACT_SUCCESS_STATUSES = new Set(['ok', 'pass', 'success'])
const PREPARE_CONTRACT_WARNING_STATUSES = new Set(['warning', 'stub', 'disabled'])

export function buildFrontendProjectAnalysis(
  sources: readonly FrontendWorkspaceAnalysisSource[],
): FrontendProjectAnalysis {
  const workspaces = sources.map(buildFrontendWorkspaceAnalysis)
  const completedSteps = sum(workspaces.map((workspace) => workspace.completedSteps))
  const totalSteps = sum(workspaces.map((workspace) => workspace.totalSteps))
  const totalCases = sum(workspaces.map((workspace) => workspace.totalCases))
  const passedCases = sum(workspaces.map((workspace) => workspace.passedCases))
  const failedCases = sum(workspaces.map((workspace) => workspace.failedCases))

  return {
    workspaces,
    findings: workspaces.flatMap((workspace) => workspace.findings),
    workspaceCount: workspaces.length,
    completeWorkspaceCount: workspaces.filter(
      (workspace) =>
        workspace.totalSteps > 0 && workspace.completedSteps === workspace.totalSteps,
    ).length,
    failedWorkspaceCount: workspaces.filter((workspace) => workspace.status === 'failed')
      .length,
    runningWorkspaceCount: workspaces.filter(
      (workspace) => workspace.status === 'running',
    ).length,
    completedSteps,
    totalSteps,
    progressPercent: percentage(completedSteps, totalSteps),
    totalCases,
    passedCases,
    failedCases,
    passRate: totalCases > 0 ? passedCases / totalCases : null,
  }
}

function buildFrontendWorkspaceAnalysis(
  source: FrontendWorkspaceAnalysisSource,
): FrontendWorkspaceAnalysis {
  const steps = source.steps
    .filter(({ stage, status }) =>
      isConfiguredAnalysisStage(stage, status, source.startStage, source.endStage),
    )
    .map(({ stage, status }) =>
      buildFrontendStepAnalysis(
        source.workspaceId,
        stage,
        status,
        source.detailTexts?.[stage] ?? null,
      ),
    )
  const completedSteps = steps.filter((step) =>
    COMPLETED_STATUSES.has(step.status),
  ).length
  const review = parseRecord(source.detailTexts?.review)
  const elab = parseRecord(source.detailTexts?.elab)
  const lint = parseRecord(source.detailTexts?.lint)
  const sim = parseRecord(source.detailTexts?.sim)
  const errors =
    numberAt(review, ['summary', 'rtl_review', 'errors']) +
    numberAt(elab, ['summary', 'elab', 'errors']) +
    numberAt(lint, ['summary', 'lint', 'cpu_errors'])
  const warnings =
    numberAt(review, ['summary', 'rtl_review', 'warnings']) +
    numberAt(elab, ['summary', 'elab', 'warnings']) +
    numberAt(lint, ['summary', 'lint', 'warnings'])
  const actionableWarnings =
    numberAt(review, ['summary', 'rtl_review', 'actionable_warnings']) +
    numberAt(lint, ['summary', 'lint', 'cpu_warnings'])
  const totalCases = numberAt(sim, ['summary', 'total_cases'])
  const passedCases = numberAt(sim, ['summary', 'passed_cases'])
  const failedCases = numberAt(sim, ['summary', 'failed_cases'])
  const cases = arrayValue(sim?.cases)
  const cycles = nullableSum(
    cases.map((item) => numberValue(recordValue(recordValue(item)?.metrics)?.cycles)),
  )
  const difftestPassed = cases.filter(
    (item) =>
      stringValue(
        recordValue(recordValue(recordValue(item)?.metrics)?.difftest)?.status,
      ).toLowerCase() === 'passed',
  ).length

  return {
    workspaceId: source.workspaceId,
    workspaceName: source.workspaceName,
    workspacePath: source.workspacePath,
    status: source.status,
    steps,
    completedSteps,
    totalSteps: steps.length,
    progressPercent: percentage(completedSteps, steps.length),
    errors,
    warnings,
    actionableWarnings,
    totalCases,
    passedCases,
    failedCases,
    passRate: totalCases > 0 ? passedCases / totalCases : null,
    cycles,
    difftestPassed,
    findings: steps.flatMap((step) => step.findings),
  }
}

function buildFrontendStepAnalysis(
  workspaceId: string,
  stage: FrontendAnalysisStage,
  status: FrontendAnalysisStepStatus,
  text: string | null,
): FrontendStepAnalysis {
  const detail = parseRecord(text)
  const runtime =
    stringAt(detail, ['runtime']) || stringAt(detail, ['summary', 'runtime'])
  return {
    stage,
    label: FRONTEND_STAGE_LABELS[stage],
    status,
    runtime: runtime || '-',
    runtimeSeconds: parseRuntimeSeconds(runtime),
    metrics: stageMetrics(stage, detail),
    findings: stageFindings(workspaceId, stage, detail),
    available: detail !== null,
  }
}

function stageMetrics(
  stage: FrontendAnalysisStage,
  detail: JsonRecord | null,
): FrontendAnalysisMetric[] {
  if (stage === 'prepare') {
    return [
      metric(
        'rtl_files',
        'RTL files',
        numberAt(detail, ['summary', 'inputs', 'total_rtl_files']),
      ),
      metric('defines', 'Defines', numberAt(detail, ['summary', 'inputs', 'defines'])),
      metric(
        'incdirs',
        'Include dirs',
        numberAt(detail, ['summary', 'inputs', 'incdirs']),
      ),
    ]
  }
  if (stage === 'review') {
    return [
      metric(
        'errors',
        'Errors',
        numberAt(detail, ['summary', 'rtl_review', 'errors']),
        true,
      ),
      metric(
        'warnings',
        'Warnings',
        numberAt(detail, ['summary', 'rtl_review', 'warnings']),
        true,
      ),
      metric(
        'modules',
        'Modules',
        numberAt(detail, ['summary', 'rtl_review', 'modules']),
      ),
      metric(
        'source_files',
        'Source files',
        numberAt(detail, ['summary', 'rtl_review', 'source_files']),
      ),
    ]
  }
  if (stage === 'elab') {
    return [
      metric('errors', 'Errors', numberAt(detail, ['summary', 'elab', 'errors']), true),
      metric(
        'warnings',
        'Warnings',
        numberAt(detail, ['summary', 'elab', 'warnings']),
        true,
      ),
      metric('modules', 'Modules', numberAt(detail, ['summary', 'elab', 'modules'])),
      metric(
        'unresolved',
        'Unresolved',
        numberAt(detail, ['summary', 'elab', 'unresolved_modules']),
        true,
      ),
    ]
  }
  if (stage === 'lint') {
    return [
      metric(
        'cpu_errors',
        'CPU errors',
        numberAt(detail, ['summary', 'lint', 'cpu_errors']),
        true,
      ),
      metric(
        'cpu_warnings',
        'CPU warnings',
        numberAt(detail, ['summary', 'lint', 'cpu_warnings']),
        true,
      ),
      metric(
        'total_warnings',
        'All warnings',
        numberAt(detail, ['summary', 'lint', 'warnings']),
      ),
      metric('rules', 'Rules', numberAt(detail, ['summary', 'lint', 'rules'])),
    ]
  }
  const totalCases = numberAt(detail, ['summary', 'total_cases'])
  const passedCases = numberAt(detail, ['summary', 'passed_cases'])
  const failedCases = numberAt(detail, ['summary', 'failed_cases'])
  return [
    metric('passed_cases', 'Passed', passedCases),
    metric('failed_cases', 'Failed', failedCases, true),
    metric('total_cases', 'Total cases', totalCases),
    {
      id: 'pass_rate',
      label: 'Pass rate',
      display: totalCases > 0 ? `${percentage(passedCases, totalCases)}%` : 'N/A',
      value: totalCases > 0 ? passedCases / totalCases : null,
      tone: totalCases === 0 ? 'neutral' : failedCases === 0 ? 'good' : 'bad',
    },
  ]
}

function stageFindings(
  workspaceId: string,
  stage: FrontendAnalysisStage,
  detail: JsonRecord | null,
): FrontendAnalysisFinding[] {
  if (!detail) return []
  if (stage === 'prepare') {
    return arrayAt(detail, ['summary', 'contracts']).flatMap((contract, index) => {
      const item = recordValue(contract)
      if (!item) return []
      const status = stringValue(item.status).toLowerCase()
      if (PREPARE_CONTRACT_SUCCESS_STATUSES.has(status)) return []
      const label = stringValue(item.label) || stringValue(item.id) || 'Input'
      const isWarning = PREPARE_CONTRACT_WARNING_STATUSES.has(status)
      return [
        finding(workspaceId, stage, index, {
          severity: isWarning ? 'warning' : 'error',
          title: `${label} ${isWarning ? 'needs attention' : 'contract failed'}`,
          detail:
            stringValue(item.detail) ||
            stringValue(item.reason) ||
            'The prepared input contract did not pass.',
        }),
      ]
    })
  }
  if (stage === 'review') {
    return arrayAt(detail, ['review', 'issues']).flatMap((issue, index) => {
      const item = recordValue(issue)
      if (!item || item.waived === true) return []
      const ownership = stringValue(item.ownership).toLowerCase()
      if (ownership && ownership !== 'cpu') return []
      return [
        finding(workspaceId, stage, index, {
          severity: severityValue(item.severity),
          title: stringValue(item.title) || stringValue(item.category) || 'RTL finding',
          detail: stringValue(item.detail) || stringValue(item.recommendation),
          source: stringValue(item.source),
          line: numberValue(item.line) ?? undefined,
        }),
      ]
    })
  }
  if (stage === 'elab') {
    return arrayAt(detail, ['elab', 'diagnostics']).flatMap((diagnostic, index) => {
      const item = recordValue(diagnostic)
      if (!item) return []
      return [
        finding(workspaceId, stage, index, {
          severity: severityValue(item.severity),
          title: stringValue(item.code) || 'Elaboration diagnostic',
          detail: stringValue(item.message) || stringValue(item.raw),
          source: stringValue(item.source),
          line: numberValue(item.line) ?? undefined,
        }),
      ]
    })
  }
  if (stage === 'lint') {
    return arrayAt(detail, ['lint', 'diagnostics']).flatMap((diagnostic, index) => {
      const item = recordValue(diagnostic)
      if (!item || (item.actionable !== true && stringValue(item.ownership) !== 'cpu')) {
        return []
      }
      return [
        finding(workspaceId, stage, index, {
          severity: severityValue(item.severity),
          title: stringValue(item.code) || 'Lint diagnostic',
          detail: stringValue(item.message) || stringValue(item.raw),
          source: stringValue(item.source),
          line: numberValue(item.line) ?? undefined,
        }),
      ]
    })
  }
  return arrayValue(detail.cases).flatMap((testCase, index) => {
    const item = recordValue(testCase)
    if (!item || item.ok === true) return []
    return [
      finding(workspaceId, stage, index, {
        severity: 'error',
        title: `${stringValue(item.name) || 'Simulation case'} failed`,
        detail: `Simulation exited with code ${numberValue(item.returncode) ?? 'unknown'}.`,
      }),
    ]
  })
}

function isConfiguredAnalysisStage(
  stage: FrontendAnalysisStage,
  status: FrontendAnalysisStepStatus,
  startStage?: FrontendAnalysisStage,
  endStage?: FrontendAnalysisStage,
): boolean {
  if (!startStage || !endStage || status === 'reused') return true
  const stageIndex = FRONTEND_STAGE_ORDER.indexOf(stage)
  const startIndex = FRONTEND_STAGE_ORDER.indexOf(startStage)
  const endIndex = FRONTEND_STAGE_ORDER.indexOf(endStage)
  return stageIndex >= startIndex && stageIndex <= endIndex
}

function finding(
  workspaceId: string,
  stage: FrontendAnalysisStage,
  index: number,
  input: Omit<FrontendAnalysisFinding, 'id' | 'workspaceId' | 'stage'>,
): FrontendAnalysisFinding {
  return {
    id: `${workspaceId}-${stage}-${index}`,
    workspaceId,
    stage,
    ...input,
    ...(input.source ? { source: input.source } : {}),
    ...(input.line !== null && input.line !== undefined ? { line: input.line } : {}),
  }
}

function metric(
  id: string,
  label: string,
  value: number,
  zeroIsGood = false,
): FrontendAnalysisMetric {
  return {
    id,
    label,
    display: String(value),
    value,
    tone: zeroIsGood ? (value === 0 ? 'good' : 'warn') : 'neutral',
  }
}

type JsonRecord = Record<string, unknown>

const FRONTEND_STAGE_ORDER = [
  'prepare',
  'review',
  'elab',
  'lint',
  'sim',
] as const satisfies readonly FrontendAnalysisStage[]

function parseRecord(text: string | null | undefined): JsonRecord | null {
  if (!text) return null
  try {
    return recordValue(JSON.parse(text))
  } catch {
    return null
  }
}

function recordValue(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function valueAt(source: JsonRecord | null, path: readonly string[]): unknown {
  let value: unknown = source
  for (const key of path) {
    const record = recordValue(value)
    if (!record) return undefined
    value = record[key]
  }
  return value
}

function arrayAt(source: JsonRecord | null, path: readonly string[]): unknown[] {
  return arrayValue(valueAt(source, path))
}

function stringAt(source: JsonRecord | null, path: readonly string[]): string {
  return stringValue(valueAt(source, path))
}

function numberAt(source: JsonRecord | null, path: readonly string[]): number {
  return numberValue(valueAt(source, path)) ?? 0
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function severityValue(value: unknown): FrontendAnalysisFinding['severity'] {
  const severity = stringValue(value).toLowerCase()
  if (severity === 'error' || severity === 'fatal') return 'error'
  if (severity === 'warning' || severity === 'warn') return 'warning'
  return 'info'
}

function parseRuntimeSeconds(value: string): number | null {
  const parts = value.split(':').map(Number)
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null
  return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
}

function percentage(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function nullableSum(values: readonly (number | null)[]): number | null {
  const available = values.filter((value): value is number => value !== null)
  return available.length > 0 ? sum(available) : null
}
