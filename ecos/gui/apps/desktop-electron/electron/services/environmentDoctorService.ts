import type {
  EnvironmentDoctorComponent,
  EnvironmentDoctorComponentStatus,
  EnvironmentDoctorResult,
  EnvironmentDoctorStatus,
  EnvironmentDoctorSummary,
} from '@ecos-studio/shared'

const SUMMARY_DOCTOR = 'environment'
const DEFAULT_TIMEOUT_MS = 60_000
const MAX_STDOUT_BYTES = 1024 * 1024
const MAX_STDERR_BYTES = 256 * 1024

export interface EnvironmentDoctorCommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

export type EnvironmentDoctorRunner = (
  args: readonly string[],
) => Promise<EnvironmentDoctorCommandResult>

export interface EnvironmentDoctorServiceOptions {
  runner: EnvironmentDoctorRunner
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : fallback
}

function summaryStatus(value: unknown): EnvironmentDoctorStatus {
  return value === 'ok' || value === 'attention' || value === 'failed' ? value : 'unknown'
}

function componentStatus(value: unknown): EnvironmentDoctorComponentStatus {
  return value === 'pass' || value === 'fail' || value === 'skip' ? value : 'unknown'
}

function readComponent(value: unknown): EnvironmentDoctorComponent | null {
  if (!isRecord(value)) return null
  const component = optionalString(value.component)
  if (!component) return null

  return {
    component,
    status: componentStatus(value.status),
    required: value.required !== false,
    detail: optionalString(value.detail),
    remediation: optionalString(value.remediation),
    installedAt: optionalString(value.installed_at),
  }
}

function readSummary(value: Record<string, unknown>): EnvironmentDoctorSummary | null {
  if (value.doctor !== SUMMARY_DOCTOR) return null

  return {
    status: summaryStatus(value.status),
    checked: nonNegativeInteger(value.checked, 0),
    failed: nonNegativeInteger(value.failed, 0),
    attention: nonNegativeInteger(value.attention, 0),
    detail: optionalString(value.detail),
    installedAt: optionalString(value.installed_at),
  }
}

export function parseEnvironmentDoctorOutput(
  stdout: string,
  projectPath: string | null,
): EnvironmentDoctorResult {
  let payload: unknown
  try {
    payload = JSON.parse(stdout)
  } catch {
    throw new Error('ECC doctor returned invalid JSON.')
  }
  if (!Array.isArray(payload)) {
    throw new Error('ECC doctor returned an unexpected response.')
  }

  let summary: EnvironmentDoctorSummary | null = null
  const components: EnvironmentDoctorComponent[] = []
  for (const record of payload) {
    if (!isRecord(record)) continue
    if (!summary) {
      summary = readSummary(record)
      if (summary) continue
    }
    const component = readComponent(record)
    if (component) components.push(component)
  }
  if (!summary) {
    throw new Error('ECC doctor returned no environment summary.')
  }

  return { summary, components, projectPath }
}

/**
 * Runs the environment doctor through the same ECC executable and runtime
 * environment as the GUI. A required-tool failure exits non-zero but still
 * carries valid JSON records, so parsing takes precedence over exit status.
 */
export class EnvironmentDoctorService {
  private readonly runner: EnvironmentDoctorRunner

  constructor(options: EnvironmentDoctorServiceOptions) {
    this.runner = options.runner
  }

  async run(projectPath?: string | null): Promise<EnvironmentDoctorResult> {
    const args = ['doctor', '--json']
    const normalizedProjectPath = projectPath?.trim() || null
    if (normalizedProjectPath) args.push('--project', normalizedProjectPath)

    const result = await this.runner(args)
    try {
      return parseEnvironmentDoctorOutput(result.stdout, normalizedProjectPath)
    } catch (error) {
      const detail = result.stderr.trim() || result.stdout.trim()
      if (detail) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)} ${detail}`,
        )
      }
      throw error
    }
  }
}

export function environmentDoctorLimits(): {
  timeoutMs: number
  maxStdoutBytes: number
  maxStderrBytes: number
} {
  return {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxStdoutBytes: MAX_STDOUT_BYTES,
    maxStderrBytes: MAX_STDERR_BYTES,
  }
}
