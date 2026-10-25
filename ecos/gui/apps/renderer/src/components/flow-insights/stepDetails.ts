export const LVS_STEP_PATH = 'lvs_ecc/feature/lvs.step.json'
export const ANTENNA_STEP_PATH = 'antennaCheck_ecc/feature/antennaCheck.step.json'

const HIDDEN_FIELDS = new Set(['run', 'constraints'])
const ACRONYMS = new Set([
  'def',
  'gds',
  'io',
  'lvs',
  'pdk',
  'sdc',
  'spef',
  'sta',
  'vdd',
  'vss',
])

export interface StepDetailsColumn {
  key: string
  label: string
}

export interface StepDetailsSection {
  id: string
  title: string
  columns: StepDetailsColumn[]
  rows: string[][]
  emptyLabel: string
}

export interface StepDetailsModel {
  sections: StepDetailsSection[]
  violationCount: number | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function titleize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[._\-\s]+/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase()
      if (ACRONYMS.has(lower)) return lower.toUpperCase()
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join(' ')
}

function columnLabel(key: string): string {
  return key
    .split('.')
    .map((part) => (part === 'percentage' ? '%' : titleize(part)))
    .join(' ')
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value || '—'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '—'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function flattenRecord(
  value: Record<string, unknown>,
  prefix = '',
  result: Record<string, string> = {},
): Record<string, string> {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isRecord(child)) flattenRecord(child, path, result)
    else result[path] = displayValue(child)
  }
  return result
}

function columnsFor(records: Array<Record<string, string>>): StepDetailsColumn[] {
  const keys = new Set<string>()
  for (const record of records) {
    for (const key of Object.keys(record)) keys.add(key)
  }
  return Array.from(keys, (key) => ({ key, label: columnLabel(key) }))
}

function recordsTable(
  id: string,
  records: Array<Record<string, string>>,
  emptyLabel: string,
): StepDetailsSection {
  const columns = columnsFor(records)
  return {
    id,
    title: titleize(id),
    columns,
    rows: records.map((record) => columns.map((column) => record[column.key] ?? '—')),
    emptyLabel,
  }
}

function sectionFor(id: string, value: unknown): StepDetailsSection {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return {
        id,
        title: titleize(id),
        columns: [],
        rows: [],
        emptyLabel:
          id.toLowerCase() === 'violations'
            ? 'No violations reported.'
            : 'No records reported.',
      }
    }
    if (value.every(isRecord)) {
      return recordsTable(
        id,
        value.map((entry) => flattenRecord(entry)),
        'No records reported.',
      )
    }
    return {
      id,
      title: titleize(id),
      columns: [{ key: 'value', label: 'Value' }],
      rows: value.map((entry) => [displayValue(entry)]),
      emptyLabel: 'No records reported.',
    }
  }

  if (isRecord(value)) {
    const record = flattenRecord(value)
    return {
      id,
      title: titleize(id),
      columns: [
        { key: 'field', label: 'Field' },
        { key: 'value', label: 'Value' },
      ],
      rows: Object.entries(record).map(([key, entry]) => [columnLabel(key), entry]),
      emptyLabel: 'No data reported.',
    }
  }

  return {
    id,
    title: titleize(id),
    columns: [
      { key: 'field', label: 'Field' },
      { key: 'value', label: 'Value' },
    ],
    rows: [['Value', displayValue(value)]],
    emptyLabel: 'No data reported.',
  }
}

function violationCountFor(value: unknown): number | null {
  if (Array.isArray(value)) return value.length
  if (!isRecord(value)) return null
  for (const key of ['count', 'total', 'violation_count']) {
    const candidate = value[key]
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0) {
      return candidate
    }
  }
  return null
}

export function parseStepDetails(value: unknown): StepDetailsModel | null {
  if (!isRecord(value)) return null

  const sections = Object.entries(value)
    .filter(([key]) => !HIDDEN_FIELDS.has(key.toLowerCase()))
    .map(([key, entry]) => sectionFor(key, entry))

  let violationCount = violationCountFor(value.violations)
  if (violationCount === null) {
    for (const entry of Object.values(value)) {
      if (isRecord(entry)) {
        violationCount = violationCountFor(entry)
        if (violationCount !== null) break
      }
    }
  }

  return { sections, violationCount }
}
