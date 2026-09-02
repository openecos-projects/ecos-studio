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

export interface FrontendStepQorAnalysis {
  status: FrontendQorStatus
  analysisStatus: string
  available: boolean
  comparisonFingerprint: string
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

  return {
    status,
    analysisStatus: artifactAvailable
      ? stringValue(summaryRecord?.analysis_status) || 'unavailable'
      : artifactPresent
        ? 'incomplete'
        : 'unavailable',
    available: artifactAvailable,
    comparisonFingerprint: artifactAvailable
      ? stringAt(summaryRecord, ['context', 'comparison', 'fingerprint'])
      : '',
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
  if (!gate.operator || gate.actual === null || gate.expected === null) return gate.state
  return `${gate.actual} ${gate.operator} ${gate.expected}`
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

function stringAt(source: JsonRecord | null, path: readonly string[]): string {
  let value: unknown = source
  for (const key of path) {
    const record = recordValue(value)
    if (!record) return ''
    value = record[key]
  }
  return stringValue(value)
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
