export type FrontendQorStatus = 'pass' | 'blocked' | 'incomplete' | 'unavailable'

export interface FrontendQorMetric {
  id: string
  label: string
  value: number
  display: string
  unit: string
  category: string
  direction: string
  gate: boolean
  trend: boolean
}

export interface FrontendQorGate {
  id: string
  label: string
  state: 'pass' | 'failed' | 'incomplete' | 'unavailable'
  actual: number | string | null
  operator: string
  expected: number | string | null
}

export interface FrontendQorHotspot {
  id: string
  label: string
  severity: 'critical' | 'warning' | 'info'
  description: string
  source: string
}

export interface FrontendQorScoreComponent {
  id: string
  label: string
  earned: number
  possible: number
  summary: string
}

export interface FrontendQorScore {
  label: string
  value: number
  maximum: number
  scoringVersion: number
  components: FrontendQorScoreComponent[]
}

export interface FrontendStepQorAnalysis {
  status: FrontendQorStatus
  analysisStatus: string
  available: boolean
  comparisonFingerprint: string
  inputFingerprint: string
  score: FrontendQorScore | null
  metrics: FrontendQorMetric[]
  gates: FrontendQorGate[]
  hotspots: FrontendQorHotspot[]
}

export interface FrontendStepQorArtifacts {
  metrics?: unknown
  summary?: unknown
  hotspots?: unknown
}

type JsonRecord = Record<string, unknown>
const CURRENT_QOR_STEP_STATES = new Set([
  'success',
  'reused',
  'failed',
  'incomplete',
  'imcomplete',
])
const COUNT_GATE_EVIDENCE: Record<
  string,
  { singular: string; plural: string; requirement: string }
> = {
  frontend_contracts: {
    singular: 'input contract failure',
    plural: 'input contract failures',
    requirement: 'none allowed',
  },
  no_actionable_errors: {
    singular: 'actionable RTL error',
    plural: 'actionable RTL errors',
    requirement: 'none allowed',
  },
  no_elaboration_errors: {
    singular: 'elaboration error',
    plural: 'elaboration errors',
    requirement: 'none allowed',
  },
  all_modules_resolved: {
    singular: 'unresolved module',
    plural: 'unresolved modules',
    requirement: 'none allowed',
  },
  no_cpu_lint_errors: {
    singular: 'CPU-owned lint error',
    plural: 'CPU-owned lint errors',
    requirement: 'none allowed',
  },
  all_required_cases_pass: {
    singular: 'required simulation failure',
    plural: 'required simulation failures',
    requirement: 'none allowed',
  },
  difftest_matches_reference: {
    singular: 'Difftest mismatch',
    plural: 'Difftest mismatches',
    requirement: 'none allowed',
  },
}

export interface FrontendQorStepStateOptions {
  running?: boolean
  stale?: boolean
}

export function parseFrontendStepQorTexts(
  metricsText: string | null | undefined,
  summaryText: string | null | undefined,
  hotspotsText: string | null | undefined,
): FrontendStepQorAnalysis {
  return parseFrontendStepQorArtifacts({
    metrics: parseRecord(metricsText),
    summary: parseRecord(summaryText),
    hotspots: parseRecord(hotspotsText),
  })
}

export function parseFrontendStepQorArtifacts(
  artifacts: FrontendStepQorArtifacts | null | undefined,
): FrontendStepQorAnalysis {
  const metricsRecord = recordValue(artifacts?.metrics)
  const summaryRecord = recordValue(artifacts?.summary)
  const hotspotsRecord = recordValue(artifacts?.hotspots)
  const metricsValid =
    metricsRecord?.schema_version === 3 && Array.isArray(metricsRecord.metrics)
  const summaryValid =
    summaryRecord?.schema_version === 4 && Array.isArray(summaryRecord.gates)
  const hotspotsValid =
    hotspotsRecord?.schema_version === 3 && Array.isArray(hotspotsRecord.hotspots)
  const artifactPresent = metricsValid || summaryValid || hotspotsValid
  const generations = [metricsRecord, summaryRecord, hotspotsRecord].map((record) =>
    stringValue(record?.generation),
  )
  const generationValid =
    generations.every(Boolean) && generations.every((value) => value === generations[0])
  const artifactAvailable =
    metricsValid && summaryValid && hotspotsValid && generationValid
  const rawStatus = stringValue(summaryRecord?.quality_status)
  const status: FrontendQorStatus =
    artifactAvailable && isFrontendQorStatus(rawStatus)
      ? rawStatus
      : artifactPresent
        ? 'incomplete'
        : 'unavailable'
  const comparison = artifactAvailable
    ? recordValue(recordValue(summaryRecord?.context)?.comparison)
    : null
  const rawInputFingerprint = recordValue(comparison?.inputs)?.input_fingerprint
  const inputFingerprint =
    typeof rawInputFingerprint === 'string' && /^[a-f0-9]{64}$/i.test(rawInputFingerprint)
      ? rawInputFingerprint
      : ''

  return {
    status,
    analysisStatus: artifactAvailable
      ? stringValue(summaryRecord?.analysis_status) || 'unavailable'
      : artifactPresent
        ? 'incomplete'
        : 'unavailable',
    available: artifactAvailable,
    comparisonFingerprint: stringValue(comparison?.fingerprint),
    inputFingerprint,
    score: artifactAvailable
      ? frontendQorScore(summaryRecord?.score, Boolean(inputFingerprint))
      : null,
    metrics: (artifactAvailable ? arrayValue(metricsRecord?.metrics) : []).flatMap(
      (value) => {
        const metric = recordValue(value)
        const rating = recordValue(metric?.rating)
        const id = stringValue(metric?.id)
        const numericValue = numberValue(metric?.value)
        if (!metric || !id || numericValue === null) return []
        const unit = stringValue(metric.unit)
        return [
          {
            id,
            label: stringValue(metric.display_name) || displayName(id),
            value: numericValue,
            display: formatQorMetric(numericValue, unit),
            unit,
            category: stringValue(metric.category) || 'quality',
            direction: stringValue(metric.direction) || 'trend_only',
            gate: rating?.gate === true,
            trend: rating?.trend === true,
          },
        ]
      },
    ),
    gates: (artifactAvailable ? arrayValue(summaryRecord?.gates) : []).flatMap(
      (value) => {
        const gate = recordValue(value)
        const firstMetric = recordValue(arrayValue(gate?.metrics)[0])
        const id = stringValue(gate?.id)
        const state = frontendGateState(gate?.state)
        if (!gate || !id || !state) return []
        return [
          {
            id,
            label: stringValue(gate.title) || displayName(id),
            state,
            actual: scalarValue(firstMetric?.actual),
            operator: stringValue(firstMetric?.operator),
            expected: scalarValue(firstMetric?.expected),
          },
        ]
      },
    ),
    hotspots: (artifactAvailable ? arrayValue(hotspotsRecord?.hotspots) : []).flatMap(
      (value, index) => {
        const hotspot = recordValue(value)
        const source = recordValue(hotspot?.source)
        const metricId = stringValue(hotspot?.metric_id)
        if (!hotspot || !metricId) return []
        return [
          {
            id: `${metricId}-${index}`,
            label: stringValue(hotspot.display_name) || displayName(metricId),
            severity: frontendHotspotSeverity(hotspot.severity),
            description: stringValue(hotspot.description),
            source: stringValue(source?.path),
          },
        ]
      },
    ),
  }
}

export function frontendQorForStepState(
  qor: FrontendStepQorAnalysis,
  state: string | null | undefined,
  options: FrontendQorStepStateOptions = {},
): FrontendStepQorAnalysis {
  const normalizedState = String(state || '')
    .trim()
    .toLowerCase()
  if (
    !options.running &&
    !options.stale &&
    CURRENT_QOR_STEP_STATES.has(normalizedState)
  ) {
    return qor
  }
  if (qor.status === 'unavailable') return qor
  return {
    status: 'incomplete',
    analysisStatus: 'incomplete',
    available: false,
    comparisonFingerprint: '',
    inputFingerprint: '',
    score: null,
    metrics: [],
    gates: [],
    hotspots: [],
  }
}

export function frontendQorStatusLabel(status: FrontendQorStatus): string {
  if (status === 'pass') return 'Pass'
  if (status === 'blocked') return 'Blocked'
  if (status === 'incomplete') return 'Incomplete'
  return 'Unavailable'
}

export function frontendQorStatusIcon(status: FrontendQorStatus): string {
  if (status === 'pass') return 'ri-shield-check-fill'
  if (status === 'blocked') return 'ri-shield-cross-fill'
  if (status === 'incomplete') return 'ri-shield-flash-line'
  return 'ri-shield-line'
}

export function frontendQorGateIcon(state: FrontendQorGate['state']): string {
  if (state === 'pass') return 'ri-checkbox-circle-fill tone-good'
  if (state === 'failed') return 'ri-close-circle-fill tone-bad'
  return 'ri-question-line tone-warn'
}

export function frontendQorGateEvidence(gate: FrontendQorGate): string {
  const actual = typeof gate.actual === 'number' ? gate.actual : null
  if (actual !== null) {
    const countRule = COUNT_GATE_EVIDENCE[gate.id]
    if (countRule) {
      const noun = actual === 1 ? countRule.singular : countRule.plural
      return `${actual} ${noun}; ${countRule.requirement}`
    }

    if (gate.id === 'simulation_cases_present') {
      return `${actual} simulation case${actual === 1 ? '' : 's'} produced; at least 1 required`
    }
  }

  if (gate.id === 'yosys_precheck') {
    if (gate.state === 'pass') return 'Yosys structural precheck completed successfully'
    if (gate.state === 'failed') return 'Yosys structural precheck did not pass'
    return `Yosys structural precheck is ${gate.state}`
  }
  if (gate.id === 'top_module_resolved') {
    if (gate.state === 'pass') return 'Top module resolved successfully'
    if (gate.state === 'failed') return 'Top module could not be resolved'
    return `Top module resolution is ${gate.state}`
  }

  if (!gate.operator || gate.actual === null || gate.expected === null) {
    return `Requirement ${gate.state}`
  }
  return `Actual: ${gate.actual}; required: ${gateOperatorPhrase(gate.operator)} ${gate.expected}`
}

function gateOperatorPhrase(operator: string): string {
  if (operator === '==') return 'exactly'
  if (operator === '!=') return 'not'
  if (operator === '>') return 'greater than'
  if (operator === '>=') return 'at least'
  if (operator === '<') return 'less than'
  if (operator === '<=') return 'at most'
  return operator
}

export function frontendQorHotspotIcon(severity: FrontendQorHotspot['severity']): string {
  if (severity === 'critical') return 'ri-close-circle-fill tone-bad'
  if (severity === 'warning') return 'ri-error-warning-fill tone-warn'
  return 'ri-information-fill'
}

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

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function scalarValue(value: unknown): number | string | null {
  return numberValue(value) ?? (stringValue(value) || null)
}

function isFrontendQorStatus(value: string): value is FrontendQorStatus {
  return (
    value === 'pass' ||
    value === 'blocked' ||
    value === 'incomplete' ||
    value === 'unavailable'
  )
}

function frontendGateState(value: unknown): FrontendQorGate['state'] | null {
  const state = stringValue(value)
  return state === 'pass' ||
    state === 'failed' ||
    state === 'incomplete' ||
    state === 'unavailable'
    ? state
    : null
}

function frontendHotspotSeverity(value: unknown): FrontendQorHotspot['severity'] {
  const severity = stringValue(value)
  return severity === 'critical' || severity === 'warning' ? severity : 'info'
}

function frontendQorScore(
  value: unknown,
  inputSnapshotTracked: boolean,
): FrontendQorScore | null {
  const score = recordValue(value)
  const label = stringValue(score?.label)
  const numericValue = numberValue(score?.value)
  const maximum = numberValue(score?.maximum)
  const scoringVersion = numberValue(score?.scoring_version)
  const rawComponents = arrayValue(score?.components)
  const components = rawComponents.flatMap((value) => {
    const component = recordValue(value)
    const id = stringValue(component?.id)
    const componentLabel = stringValue(component?.label)
    const earned = numberValue(component?.earned)
    const possible = numberValue(component?.possible)
    const summary = frontendQorScoreComponentSummary(
      id,
      stringValue(component?.summary),
      inputSnapshotTracked,
    )
    if (
      !id ||
      !componentLabel ||
      earned === null ||
      possible === null ||
      possible <= 0 ||
      earned < 0 ||
      earned > possible ||
      !summary
    ) {
      return []
    }
    return [{ id, label: componentLabel, earned, possible, summary }]
  })
  if (
    !score ||
    !label ||
    numericValue === null ||
    maximum === null ||
    maximum <= 0 ||
    numericValue < 0 ||
    numericValue > maximum ||
    scoringVersion === null ||
    !Number.isInteger(scoringVersion) ||
    scoringVersion < 1 ||
    components.length === 0 ||
    components.length !== rawComponents.length ||
    Math.abs(components.reduce((total, item) => total + item.earned, 0) - numericValue) >
      0.11 ||
    Math.abs(components.reduce((total, item) => total + item.possible, 0) - maximum) >
      0.01
  ) {
    return null
  }
  return { label, value: numericValue, maximum, scoringVersion, components }
}

function frontendQorScoreComponentSummary(
  id: string,
  summary: string,
  inputSnapshotTracked: boolean,
): string {
  if (id !== 'reproducibility') return summary

  return summary
    .replace(
      /^(?:Input fingerprint (?:recorded|missing)|Input snapshot (?:tracked|not tracked));/,
      `Input snapshot ${inputSnapshotTracked ? 'tracked' : 'not tracked'};`,
    )
    .replace(
      'normalized outputs persisted.',
      'normalized input manifest and file list persisted.',
    )
    .replace(
      'normalized outputs incomplete.',
      'normalized input manifest or file list is incomplete.',
    )
}

function formatQorMetric(value: number, unit: string): string {
  if (unit === 'ratio') return `${Math.round(value * 1000) / 10}%`
  if (unit === 'boolean') return value === 1 ? 'Pass' : 'Fail'
  const formatted = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 3,
  }).format(value)
  return unit && unit !== 'count' ? `${formatted} ${unit}` : formatted
}

function displayName(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
