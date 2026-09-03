import { dirname } from 'node:path'
import { performance } from 'node:perf_hooks'
import type {
  BackendWorkspaceArtifactContent,
  ReadSection,
  WorkspaceTimingPathsDetail,
  WorkspaceTimingSummaryDetail,
} from '@ecos-studio/shared'
import { electronLogger } from './logger'
import type {
  ProjectEngineeringSnapshotReadResult,
  VerifiedProjectArtifactReadResult,
} from './projectManagementReadService'

type ValidSnapshot = Extract<ProjectEngineeringSnapshotReadResult, { ok: true }>

export type WorkspaceArtifactReader = (request: {
  projectRoot: string
  workspacePath: string
  artifact: { reference: string; sha256: string; sizeBytes: number }
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
      path.stages.length > 512
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
      'timing_paths',
      'timing_summary',
      'report_text',
    ].includes(artifact.kind) ||
    artifact.sizeBytes === undefined ||
    !artifact.sha256 ||
    !reader
  ) {
    return unavailable('ARTIFACT_REFERENCE_MISSING')
  }
  const startedAt = performance.now()
  const read = await reader({
    artifact: {
      reference: artifact.reference,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes,
    },
    projectRoot: dirname(workspaceRoot),
    workspacePath: workspaceRoot,
  })
  electronLogger.debug('[backend-workspace] artifact query metrics', {
    artifactBytes: read.ok ? read.bytes.byteLength : 0,
    artifactReadCount: 1,
    totalMs: Number((performance.now() - startedAt).toFixed(2)),
  })
  if (!read.ok) {
    const code =
      read.code === 'FINDINGS_ARTIFACT_TOO_LARGE'
        ? 'ARTIFACT_TOO_LARGE'
        : read.code === 'FINDINGS_READ_FAILED'
          ? 'ARTIFACT_READ_FAILED'
          : read.code
    return unavailable(code)
  }
  const parsedTimingPaths =
    artifact.kind === 'timing_paths' ? timingPaths(read.bytes) : undefined
  const parsedTimingSummary =
    artifact.kind === 'timing_summary'
      ? timingSummary(read.bytes, artifact.reference)
      : undefined
  if (
    (artifact.kind === 'timing_paths' && !parsedTimingPaths) ||
    (artifact.kind === 'timing_summary' && !parsedTimingSummary)
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
      bytes: read.bytes,
      kind: artifact.kind,
      mimeType: artifact.name.toLowerCase().endsWith('.png')
        ? 'image/png'
        : artifact.kind === 'report_text'
          ? 'text/plain'
          : 'application/json',
      name: artifact.name,
      ...(text === undefined ? {} : { text }),
      ...(parsedTimingPaths ? { timingPaths: parsedTimingPaths } : {}),
      ...(parsedTimingSummary ? { timingSummary: parsedTimingSummary } : {}),
    },
    issues: [],
  }
}
