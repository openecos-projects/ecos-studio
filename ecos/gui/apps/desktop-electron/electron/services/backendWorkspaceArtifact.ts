import { dirname } from 'node:path'
import { performance } from 'node:perf_hooks'
import type {
  BackendWorkspaceArtifactContent,
  ReadSection,
  WorkspaceChecklistEvidence,
  WorkspaceStaTimingIssuesDetail,
  WorkspaceTimingPathsDetail,
  WorkspaceTimingSummaryDetail,
} from '@ecos-studio/shared'
import { electronLogger } from './logger'
import type {
  ProjectEngineeringSnapshotReadResult,
  VerifiedProjectArtifactReadResult,
} from './projectManagementReadService'

type ValidSnapshot = NonNullable<ProjectEngineeringSnapshotReadResult['staleSnapshot']>

export type WorkspaceArtifactReader = (request: {
  projectRoot: string
  workspacePath: string
  artifact: { reference: string }
}) => Promise<VerifiedProjectArtifactReadResult>

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringValue(value: Record<string, unknown>, key: string): string {
  return typeof value[key] === 'string' ? value[key] : ''
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function artifactJson(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    return record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  } catch {
    return null
  }
}

function timingCorner(reference: string): string {
  const parts = reference.replace(/\\/g, '/').split('/')
  const feature = parts.indexOf('feature')
  return feature >= 0 ? parts.slice(feature + 1, -1).join('/') : ''
}

function timingPaths(bytes: Uint8Array): WorkspaceTimingPathsDetail | null {
  const source = artifactJson(bytes)
  const corner = source ? stringValue(source, 'corner') : ''
  const pathLimit = finiteNumber(source?.path_limit)
  if (
    !source ||
    source.schema_version !== 1 ||
    !corner ||
    pathLimit === null ||
    !Number.isSafeInteger(pathLimit) ||
    pathLimit < 0 ||
    !Array.isArray(source.paths) ||
    source.paths.length > 256
  ) {
    return null
  }
  const paths: WorkspaceTimingPathsDetail['paths'] = []
  for (const value of source.paths) {
    const path = record(value)
    const pathId = path ? stringValue(path, 'path_id') : ''
    const analysisType = path ? stringValue(path, 'analysis_type') : ''
    const pathGroup = path ? stringValue(path, 'path_group') : ''
    const startPoint = path ? stringValue(path, 'start_point') : ''
    const endPoint = path ? stringValue(path, 'end_point') : ''
    const slackNs = finiteNumber(path?.slack_ns)
    if (
      !pathId ||
      (analysisType !== 'setup' && analysisType !== 'hold') ||
      !pathGroup ||
      !startPoint ||
      !endPoint ||
      slackNs === null ||
      !Array.isArray(path?.stages) ||
      path.stages.length > 2048
    ) {
      return null
    }
    const stages = path.stages.flatMap((value) => {
      const stage = record(value)
      if (!stage || typeof stage.pin !== 'string' || typeof stage.cell !== 'string') {
        return []
      }
      return [
        {
          pin: stringValue(stage, 'pin'),
          cell: stringValue(stage, 'cell'),
          arrivalNs: finiteNumber(stage.arrival_ns),
          delayNs: finiteNumber(stage.incremental_delay_ns ?? stage.delay_ns),
        },
      ]
    })
    if (stages.length !== path.stages.length) return null
    paths.push({
      pathId,
      analysisType,
      pathGroup,
      startPoint,
      endPoint,
      slackNs,
      stages,
    })
  }
  return { corner, pathLimit, paths }
}

function timingSummary(
  bytes: Uint8Array,
  reference: string,
): WorkspaceTimingSummaryDetail | null {
  const source = artifactJson(bytes)
  const summary = record(source?.summary)
  const setup = record(summary?.setup)
  const hold = record(summary?.hold)
  const corner = source ? stringValue(source, 'corner') || timingCorner(reference) : ''
  if (
    !source ||
    (source.schema_version !== undefined && source.schema_version !== 1) ||
    !summary ||
    !setup ||
    !hold ||
    !corner
  ) {
    return null
  }
  const setupWns = finiteNumber(setup.wns)
  const holdWns = finiteNumber(hold.wns)
  return {
    corner,
    meetsTiming:
      setupWns === null || holdWns === null ? null : setupWns >= 0 && holdWns >= 0,
    setup: {
      wns: setupWns,
      tns: finiteNumber(setup.tns),
      violationCount: finiteNumber(setup.nvp),
      frequencyMhz: finiteNumber(setup.frequency_mhz),
    },
    hold: {
      wns: holdWns,
      tns: finiteNumber(hold.tns),
      violationCount: finiteNumber(hold.nvp),
    },
  }
}

const TIMING_ISSUES_LIMIT = 4096
const TIMING_ISSUE_STAGE_LIMIT = 2048

// Full STA timing issues (with dominant stage lists) from the committed
// sta_timing_issues.json analysis file; the bounded snapshot projection only
// carries scalar top-N fields.
function timingIssues(bytes: Uint8Array): WorkspaceStaTimingIssuesDetail | null {
  const source = artifactJson(bytes)
  if (
    !source ||
    source.schema_version !== 1 ||
    !Array.isArray(source.issues) ||
    source.issues.length > TIMING_ISSUES_LIMIT ||
    !Array.isArray(source.missing_corners) ||
    !source.missing_corners.every((corner) => typeof corner === 'string')
  ) {
    return null
  }
  const issues: WorkspaceStaTimingIssuesDetail['issues'] = []
  for (const value of source.issues) {
    const issue = record(value)
    const issueId = issue ? stringValue(issue, 'issue_id') : ''
    const corner = issue ? stringValue(issue, 'corner') : ''
    const analysisType = issue ? stringValue(issue, 'analysis_type') : ''
    const slackNs = finiteNumber(issue?.slack_ns)
    if (
      !issue ||
      !issueId ||
      !corner ||
      (analysisType !== 'setup' && analysisType !== 'hold') ||
      slackNs === null ||
      !Array.isArray(issue.dominant_stages) ||
      issue.dominant_stages.length > TIMING_ISSUE_STAGE_LIMIT
    ) {
      return null
    }
    const stages = issue.dominant_stages.flatMap((value) => {
      const stage = record(value)
      if (!stage || typeof stage.pin !== 'string' || typeof stage.cell !== 'string') {
        return []
      }
      return [
        {
          pin: stringValue(stage, 'pin'),
          cell: stringValue(stage, 'cell'),
          arrivalNs: finiteNumber(stage.arrival_ns),
          delayNs: finiteNumber(stage.incremental_delay_ns ?? stage.delay_ns),
        },
      ]
    })
    if (stages.length !== issue.dominant_stages.length) return null
    issues.push({
      issueId,
      corner,
      analysisType,
      slackNs,
      startPoint: stringValue(issue, 'start_point'),
      endPoint: stringValue(issue, 'end_point'),
      pathGroup: stringValue(issue, 'path_group'),
      stages,
    })
  }
  return {
    issues,
    missingCorners: source.missing_corners.filter((corner) => corner),
  }
}

function readFailureCode(code: string): string {
  return code === 'FINDINGS_ARTIFACT_TOO_LARGE'
    ? 'ARTIFACT_TOO_LARGE'
    : code === 'FINDINGS_READ_FAILED'
      ? 'ARTIFACT_READ_FAILED'
      : code
}

export async function readWorkspaceArtifact(
  snapshot: ValidSnapshot,
  workspaceRoot: string,
  artifactId: string,
  reader: WorkspaceArtifactReader | undefined,
): Promise<ReadSection<BackendWorkspaceArtifactContent>> {
  const unavailable = (code: string): ReadSection<BackendWorkspaceArtifactContent> => ({
    status: 'unavailable',
    issues: [{ code }],
  })
  const artifacts = snapshot.sections.artifacts
  if (artifacts.status !== 'ready') return unavailable('ENGINEERING_ARTIFACT_INVALID')
  const artifact = artifacts.data.find((candidate) => candidate.artifactId === artifactId)
  if (
    !artifact ||
    artifact.availability !== 'available' ||
    ![
      'layout_image',
      'congestion_image',
      'sta_timing_issues',
      'timing_paths',
      'timing_summary',
      'report_text',
    ].includes(artifact.kind) ||
    !reader
  ) {
    return unavailable('ARTIFACT_REFERENCE_MISSING')
  }
  const startedAt = performance.now()
  const read = await reader({
    artifact: { reference: artifact.reference },
    projectRoot: dirname(workspaceRoot),
    workspacePath: workspaceRoot,
  })
  electronLogger.debug('[backend-workspace] artifact query metrics', {
    artifactBytes: read.ok ? read.bytes.byteLength : 0,
    artifactReadCount: 1,
    totalMs: Number((performance.now() - startedAt).toFixed(2)),
  })
  if (!read.ok) {
    return unavailable(readFailureCode(read.code))
  }
  const parsedTimingPaths =
    artifact.kind === 'timing_paths' ? timingPaths(read.bytes) : undefined
  const parsedTimingSummary =
    artifact.kind === 'timing_summary'
      ? timingSummary(read.bytes, artifact.reference)
      : undefined
  const parsedTimingIssues =
    artifact.kind === 'sta_timing_issues' ? timingIssues(read.bytes) : undefined
  if (
    (artifact.kind === 'timing_paths' && !parsedTimingPaths) ||
    (artifact.kind === 'timing_summary' && !parsedTimingSummary) ||
    (artifact.kind === 'sta_timing_issues' && !parsedTimingIssues)
  ) {
    return unavailable('ARTIFACT_INVALID_JSON')
  }
  let text: string | undefined
  if (artifact.kind === 'report_text') {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(read.bytes)
    } catch {
      return unavailable('ARTIFACT_TEXT_INVALID')
    }
  }
  return {
    status: 'ready',
    data: {
      artifactId: artifact.artifactId,
      kind: artifact.kind,
      mimeType: artifact.name.toLowerCase().endsWith('.png')
        ? 'image/png'
        : artifact.kind === 'report_text'
          ? 'text/plain'
          : 'application/json',
      name: artifact.name,
      ...(['layout_image', 'congestion_image'].includes(artifact.kind)
        ? { bytes: read.bytes }
        : {}),
      ...(text === undefined ? {} : { text }),
      ...(parsedTimingIssues ? { timingIssues: parsedTimingIssues } : {}),
      ...(parsedTimingPaths ? { timingPaths: parsedTimingPaths } : {}),
      ...(parsedTimingSummary ? { timingSummary: parsedTimingSummary } : {}),
    },
    issues: [],
  }
}

// Checklist evidence detail: the bounded projection carries display fields
// only, so the original checklist.json record loads on demand through the
// artifact index (workspace-level kind `checklist`). Resolution is
// index-driven — an unindexed or missing file reports ARTIFACT_REFERENCE_MISSING
// rather than guessing a path.
export async function readWorkspaceChecklistEvidence(
  snapshot: ValidSnapshot,
  workspaceRoot: string,
  findingId: string,
  reader: WorkspaceArtifactReader | undefined,
): Promise<ReadSection<WorkspaceChecklistEvidence>> {
  const unavailable = (code: string): ReadSection<WorkspaceChecklistEvidence> => ({
    status: 'unavailable',
    issues: [{ code }],
  })
  const artifacts = snapshot.sections.artifacts
  if (artifacts.status !== 'ready') return unavailable('ENGINEERING_ARTIFACT_INVALID')
  const artifact = artifacts.data.find(
    (candidate) =>
      candidate.kind === 'checklist' && candidate.availability === 'available',
  )
  if (!artifact || !reader) return unavailable('ARTIFACT_REFERENCE_MISSING')
  const startedAt = performance.now()
  const read = await reader({
    artifact: { reference: artifact.reference },
    projectRoot: dirname(workspaceRoot),
    workspacePath: workspaceRoot,
  })
  electronLogger.debug('[backend-workspace] checklist evidence query metrics', {
    artifactBytes: read.ok ? read.bytes.byteLength : 0,
    artifactReadCount: 1,
    totalMs: Number((performance.now() - startedAt).toFixed(2)),
  })
  if (!read.ok) {
    return unavailable(readFailureCode(read.code))
  }
  const source = artifactJson(read.bytes)
  if (
    !source ||
    source.schema_version !== 3 ||
    source.kind !== 'signoff_checklist' ||
    !Array.isArray(source.checklist)
  ) {
    return unavailable('ARTIFACT_INVALID_JSON')
  }
  const item = source.checklist.find(
    (entry) => record(entry) && record(entry)!.id === findingId,
  )
  if (!item) return unavailable('CHECKLIST_FINDING_NOT_FOUND')
  return {
    status: 'ready',
    data: { findingId, item: item as Record<string, unknown> },
    issues: [],
  }
}
