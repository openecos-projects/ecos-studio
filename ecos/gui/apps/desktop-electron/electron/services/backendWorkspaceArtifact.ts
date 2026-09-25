import { basename, dirname } from 'node:path'
import { performance } from 'node:perf_hooks'
import type {
  BackendWorkspaceArtifactContent,
  ReadSection,
  WorkspaceChecklistEvidence,
  WorkspaceDatabaseFacts,
  WorkspaceLvsInsights,
  WorkspaceRcxInsights,
  WorkspaceStaTimingIssuesDetail,
  WorkspaceStepDetail,
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
const QOR_GATE_LIMIT = 256
const QOR_HOTSPOT_LIMIT = 512

// Per-step QoR summary (quality gates) from the committed qor_summary.json
// analysis file; the bounded snapshot has no per-step gate projection.
function qorSummary(bytes: Uint8Array): Record<string, unknown> | null {
  const source = artifactJson(bytes)
  if (
    !source ||
    source.schema_version !== 4 ||
    !Array.isArray(source.gates) ||
    source.gates.length > QOR_GATE_LIMIT ||
    !Array.isArray(source.missing_metrics)
  ) {
    return null
  }
  return source
}

// Per-step QoR hotspots from the committed qor_hotspots.json analysis file.
function qorHotspots(bytes: Uint8Array): Array<Record<string, unknown>> | null {
  const source = artifactJson(bytes)
  if (
    !source ||
    source.schema_version !== 3 ||
    !Array.isArray(source.hotspots) ||
    source.hotspots.length > QOR_HOTSPOT_LIMIT ||
    !source.hotspots.every((hotspot) => record(hotspot))
  ) {
    return null
  }
  return source.hotspots as Array<Record<string, unknown>>
}

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

const SUBFLOW_STEP_LIMIT = 256

function sameStepId(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

// Per-step subflow steps from the committed <step>/subflow.json file. The
// file's `path` field is an absolute runtime path and never crosses the
// bridge; only the bounded step list is projected.
function subflowSteps(bytes: Uint8Array): WorkspaceStepDetail['subflow']['steps'] | null {
  const source = artifactJson(bytes)
  if (
    !source ||
    !Array.isArray(source.steps) ||
    source.steps.length > SUBFLOW_STEP_LIMIT
  ) {
    return null
  }
  const steps: WorkspaceStepDetail['subflow']['steps'] = []
  for (const value of source.steps) {
    const step = record(value)
    const name = step ? stringValue(step, 'name') : ''
    const state = step ? stringValue(step, 'state') : ''
    const runtime = step?.runtime
    const rawPeakMemory = step?.['peak memory (mb)']
    const peakMemoryMb = finiteNumber(rawPeakMemory)
    if (
      !name ||
      !state ||
      (runtime !== undefined && typeof runtime !== 'string') ||
      (rawPeakMemory !== undefined && peakMemoryMb === null)
    ) {
      return null
    }
    steps.push({
      name,
      state,
      ...(typeof runtime === 'string' ? { runtime } : {}),
      ...(peakMemoryMb === null ? {} : { peakMemoryMb }),
    })
  }
  return steps
}

// Subflow progress loads through the artifact index (per-step kind `subflow`)
// so an unindexed or missing file reports `missing` rather than guessing a
// path under the step directory.
export async function readWorkspaceSubflow(
  snapshot: ValidSnapshot,
  workspaceRoot: string,
  stepId: string,
  reader: WorkspaceArtifactReader | undefined,
): Promise<WorkspaceStepDetail['subflow']> {
  const artifacts = snapshot.sections.artifacts
  if (artifacts.status !== 'ready') return { status: 'missing', steps: [] }
  const artifact = artifacts.data.find(
    (candidate) =>
      candidate.kind === 'subflow' &&
      candidate.availability === 'available' &&
      sameStepId(candidate.stepId, stepId),
  )
  if (!artifact || !reader) return { status: 'missing', steps: [] }
  const read = await reader({
    artifact: { reference: artifact.reference },
    projectRoot: dirname(workspaceRoot),
    workspacePath: workspaceRoot,
  })
  if (!read.ok) {
    const code = readFailureCode(read.code)
    return {
      status:
        code === 'ARTIFACT_TOO_LARGE'
          ? 'oversized'
          : code === 'ARTIFACT_REFERENCE_OUTSIDE_WORKSPACE'
            ? 'unsafe'
            : 'missing',
      steps: [],
    }
  }
  const steps = subflowSteps(read.bytes)
  if (!steps) return { status: 'invalid', steps: [] }
  return { status: 'available', steps }
}

async function readIndexedStepJson(
  snapshot: ValidSnapshot,
  workspaceRoot: string,
  stepId: string,
  kind: string,
  reader: WorkspaceArtifactReader | undefined,
): Promise<Record<string, unknown> | null> {
  const artifacts = snapshot.sections.artifacts
  if (artifacts.status !== 'ready') return null
  const artifact = artifacts.data.find(
    (candidate) =>
      candidate.kind === kind &&
      candidate.availability === 'available' &&
      sameStepId(candidate.stepId, stepId),
  )
  if (!artifact || !reader) return null
  const read = await reader({
    artifact: { reference: artifact.reference },
    projectRoot: dirname(workspaceRoot),
    workspacePath: workspaceRoot,
  })
  return read.ok ? artifactJson(read.bytes) : null
}

// LEC equivalence result from the committed output/<design>_<step>_result.json
// (kind `lec_result`). The recorded netlist/report paths are absolute runtime
// paths: only basenames and fingerprints cross the bridge.
export async function readWorkspaceLecResult(
  snapshot: ValidSnapshot,
  workspaceRoot: string,
  stepId: string,
  reader: WorkspaceArtifactReader | undefined,
): Promise<Record<string, unknown> | null> {
  const source = await readIndexedStepJson(
    snapshot,
    workspaceRoot,
    stepId,
    'lec_result',
    reader,
  )
  if (!source) return null
  const result: Record<string, unknown> = {}
  if (typeof source.status === 'string' && source.status) result.status = source.status
  for (const key of ['golden_verilog', 'gate_verilog'] as const) {
    const value = source[key]
    if (typeof value === 'string' && value) result[key] = basename(value)
  }
  for (const key of ['golden_sha256', 'gate_sha256'] as const) {
    const value = source[key]
    if (typeof value === 'string' && value) result[key] = value
  }
  for (const key of ['golden_size_bytes', 'gate_size_bytes'] as const) {
    const value = finiteNumber(source[key])
    if (value !== null) result[key] = value
  }
  return Object.keys(result).length > 0 ? result : null
}

const RCX_CORNER_LIMIT = 64
const RCX_ENVELOPE_LIMIT = 32

function humanizeLabel(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function insightText(value: unknown): string {
  const numeric = finiteNumber(value)
  if (numeric === null) {
    return typeof value === 'string' && value ? value : '--'
  }
  if (Number.isInteger(numeric)) return String(numeric)
  return numeric.toFixed(3).replace(/\.?0+$/, '')
}

// RCX per-corner electrical facts from the committed feature/<step>.step.json
// (kind `rcx_feature_facts`). Only the bounded `rcx` section is projected;
// the file's run/constraints sections never cross the bridge.
function rcxInsightsFromFacts(
  source: Record<string, unknown>,
): WorkspaceRcxInsights | null {
  const rcx = record(source.rcx)
  if (!rcx) return null
  const electrical = record(rcx.electrical_summary)
  const signoff = record(rcx.signoff_metrics)
  const corners = electrical?.corners
  const rcCorners = signoff?.rc_corners
  if (
    (corners !== undefined &&
      (!Array.isArray(corners) || corners.length > RCX_CORNER_LIMIT)) ||
    (rcCorners !== undefined &&
      (!Array.isArray(rcCorners) || rcCorners.length > RCX_CORNER_LIMIT))
  ) {
    return null
  }
  const electricalCorners = (Array.isArray(corners) ? corners : []).flatMap((value) => {
    const corner = record(value)
    if (!corner) return []
    return [
      {
        corner: stringValue(corner, 'corner') || '--',
        netCount: finiteNumber(corner.net_count),
        groundCapacitanceFf: finiteNumber(corner.ground_capacitance_ff),
        couplingCapacitanceFf: finiteNumber(corner.coupling_capacitance_ff),
        totalCapacitanceFf: finiteNumber(corner.total_capacitance_ff),
        totalResistanceOhm: finiteNumber(corner.total_resistance_ohm),
      },
    ]
  })
  const signoffCorners = (Array.isArray(rcCorners) ? rcCorners : []).flatMap((value) => {
    const corner = record(value)
    if (!corner) return []
    return [
      {
        corner: stringValue(corner, 'label') || stringValue(corner, 'rc_corner') || '--',
        availability: stringValue(corner, 'availability'),
        totalCapacitanceFf: finiteNumber(corner.total_capacitance_ff),
        couplingCapacitanceFf: finiteNumber(corner.coupling_capacitance_ff),
        totalResistanceOhm: finiteNumber(corner.total_resistance_ohm),
      },
    ]
  })
  const envelope = record(signoff?.parasitic_envelope)
  const envelopeEntries = Object.entries(envelope ?? {})
  if (envelopeEntries.length > RCX_ENVELOPE_LIMIT) return null
  return {
    electricalMetrics: [
      'parsed_corner_count',
      'worst_total_capacitance_ff',
      'worst_coupling_capacitance_ff',
      'worst_total_resistance_ohm',
    ].map((field) => ({
      id: `rcx-electrical-${field}`,
      label: humanizeLabel(field),
      value: insightText(electrical?.[field]),
    })),
    electricalCorners,
    signoffMetrics: envelopeEntries.flatMap(([key, item]) =>
      item === null || typeof item === 'object'
        ? []
        : [
            {
              id: `rcx-envelope-${key}`,
              label: humanizeLabel(key),
              value: insightText(item),
            },
          ],
    ),
    signoffCorners,
  }
}

export async function readWorkspaceRcxInsights(
  snapshot: ValidSnapshot,
  workspaceRoot: string,
  stepId: string,
  reader: WorkspaceArtifactReader | undefined,
): Promise<WorkspaceRcxInsights | null> {
  const source = await readIndexedStepJson(
    snapshot,
    workspaceRoot,
    stepId,
    'rcx_feature_facts',
    reader,
  )
  return source ? rcxInsightsFromFacts(source) : null
}

const QOR_DETAIL_LIST_LIMIT = 32
const QOR_INSTANCE_CLASS_LIMIT = 32
const QOR_LAYER_LIMIT = 64
const QOR_PIN_DISTRIBUTION_LIMIT = 64
const LVS_RECORD_LIMIT = 100

// Database facts committed as the `database_facts` detail record inside the
// step's analysis/qor_metrics.json (kind `qor_metrics`).
function databaseFactsFromSummary(value: unknown): WorkspaceDatabaseFacts | null {
  const summary = record(value)
  if (!summary) return null
  const layout = record(summary.layout)
  const statistics = record(summary.statistics)
  const instanceTotal = record(summary.instance_total)
  const instanceClasses = summary.instance_classes
  const pinDistribution = summary.pin_distribution
  const cutLayers = summary.cut_layers
  const routingLayers = summary.routing_layers
  if (
    (instanceClasses !== undefined &&
      (!Array.isArray(instanceClasses) ||
        instanceClasses.length > QOR_INSTANCE_CLASS_LIMIT)) ||
    (pinDistribution !== undefined &&
      (!Array.isArray(pinDistribution) ||
        pinDistribution.length > QOR_PIN_DISTRIBUTION_LIMIT)) ||
    (cutLayers !== undefined &&
      (!Array.isArray(cutLayers) || cutLayers.length > QOR_LAYER_LIMIT)) ||
    (routingLayers !== undefined &&
      (!Array.isArray(routingLayers) || routingLayers.length > QOR_LAYER_LIMIT))
  ) {
    return null
  }
  return {
    layout: {
      dieArea: finiteNumber(layout?.die_area),
      dieUsage: finiteNumber(layout?.die_usage),
      dieWidth: finiteNumber(layout?.die_width),
      dieHeight: finiteNumber(layout?.die_height),
      coreArea: finiteNumber(layout?.core_area),
      coreUsage: finiteNumber(layout?.core_usage),
      coreWidth: finiteNumber(layout?.core_width),
      coreHeight: finiteNumber(layout?.core_height),
      dbu: finiteNumber(layout?.dbu),
    },
    statistics: {
      ioPins: finiteNumber(statistics?.io_pins),
      instances: finiteNumber(statistics?.instances),
      nets: finiteNumber(statistics?.nets),
      pdn: finiteNumber(statistics?.pdn),
    },
    instanceClasses: (Array.isArray(instanceClasses) ? instanceClasses : []).flatMap(
      (item) => {
        const entry = record(item)
        if (!entry) return []
        return [
          {
            kind: stringValue(entry, 'kind'),
            count: finiteNumber(entry.count),
            area: finiteNumber(entry.area),
            pinCount: finiteNumber(entry.pin_count),
          },
        ]
      },
    ),
    instanceTotal: {
      count: finiteNumber(instanceTotal?.count),
      area: finiteNumber(instanceTotal?.area),
      pinCount: finiteNumber(instanceTotal?.pin_count),
    },
    pinDistribution: (Array.isArray(pinDistribution) ? pinDistribution : []).flatMap(
      (item) => {
        const entry = record(item)
        const pinCount = finiteNumber(entry?.pin_count)
        if (!entry || pinCount === null) return []
        return [
          {
            pinCount,
            instanceCount: finiteNumber(entry.instance_count),
            netCount: finiteNumber(entry.net_count),
          },
        ]
      },
    ),
    cutLayers: (Array.isArray(cutLayers) ? cutLayers : []).flatMap((item) => {
      const entry = record(item)
      if (!entry) return []
      return [
        { layer: stringValue(entry, 'layer'), viaCount: finiteNumber(entry.via_count) },
      ]
    }),
    routingLayers: (Array.isArray(routingLayers) ? routingLayers : []).flatMap((item) => {
      const entry = record(item)
      if (!entry) return []
      return [
        {
          layer: stringValue(entry, 'layer'),
          wireLength: finiteNumber(entry.wire_length),
        },
      ]
    }),
    wireLength: finiteNumber(summary.wire_length),
    viaCount: finiteNumber(summary.via_count),
  }
}

// LVS connectivity committed as the `lvs_connectivity_summary` detail record
// inside the step's analysis/qor_metrics.json.
function lvsInsightsFromSummary(value: unknown): WorkspaceLvsInsights | null {
  const summary = record(value)
  if (!summary) return null
  const entities = summary.entities
  const connectivity = summary.connectivity
  const violations = summary.violations
  if (
    !Array.isArray(entities) ||
    entities.length > LVS_RECORD_LIMIT ||
    !Array.isArray(connectivity) ||
    connectivity.length > LVS_RECORD_LIMIT ||
    !Array.isArray(violations) ||
    violations.length > LVS_RECORD_LIMIT
  ) {
    return null
  }
  return {
    entities: entities.flatMap((item, index) => {
      const entry = record(item)
      if (!entry) return []
      return [
        {
          id: `lvs-entity-${index}`,
          entity: stringValue(entry, 'entity'),
          netlist: finiteNumber(entry.netlist),
          def: finiteNumber(entry.def),
          difference: finiteNumber(entry.difference),
        },
      ]
    }),
    connections: connectivity.flatMap((item, index) => {
      const entry = record(item)
      if (!entry) return []
      return [
        {
          id: `lvs-connection-${index}`,
          connectivity: stringValue(entry, 'connectivity'),
          open: finiteNumber(entry.open),
          short: finiteNumber(entry.short),
          connected: finiteNumber(entry.connected),
          total: finiteNumber(entry.total),
        },
      ]
    }),
    violations: violations.flatMap((item, index) => {
      const entry = record(item)
      if (!entry) return []
      return [
        {
          id: `lvs-violation-${index}`,
          type: stringValue(entry, 'type'),
          net: stringValue(entry, 'net'),
          instance: stringValue(entry, 'instance'),
          terminals: stringValue(entry, 'terminals'),
          components: stringValue(entry, 'components'),
        },
      ]
    }),
  }
}

// Bounded dashboard facts (database statistics, LVS connectivity) committed as
// detail records inside the step's analysis/qor_metrics.json; the bounded
// snapshot carries only the metric projection.
export async function readWorkspaceStepFacts(
  snapshot: ValidSnapshot,
  workspaceRoot: string,
  stepId: string,
  reader: WorkspaceArtifactReader | undefined,
): Promise<{
  database: WorkspaceDatabaseFacts | null
  lvs: WorkspaceLvsInsights | null
}> {
  const empty = { database: null, lvs: null }
  const source = await readIndexedStepJson(
    snapshot,
    workspaceRoot,
    stepId,
    'qor_metrics',
    reader,
  )
  if (!source || !Array.isArray(source.details)) return empty
  const details = source.details
  if (details.length > QOR_DETAIL_LIST_LIMIT) return empty
  let database: WorkspaceDatabaseFacts | null = null
  let lvs: WorkspaceLvsInsights | null = null
  for (const value of details) {
    const detail = record(value)
    if (!detail) continue
    if (detail.id === 'database_facts' && !database) {
      database = databaseFactsFromSummary(detail.summary)
    }
    if (detail.id === 'lvs_connectivity_summary' && !lvs) {
      lvs = lvsInsightsFromSummary(detail.summary)
    }
  }
  return { database, lvs }
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
      'qor_summary',
      'qor_hotspots',
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
  const parsedQorSummary =
    artifact.kind === 'qor_summary' ? qorSummary(read.bytes) : undefined
  const parsedQorHotspots =
    artifact.kind === 'qor_hotspots' ? qorHotspots(read.bytes) : undefined
  if (
    (artifact.kind === 'timing_paths' && !parsedTimingPaths) ||
    (artifact.kind === 'timing_summary' && !parsedTimingSummary) ||
    (artifact.kind === 'sta_timing_issues' && !parsedTimingIssues) ||
    (artifact.kind === 'qor_summary' && !parsedQorSummary) ||
    (artifact.kind === 'qor_hotspots' && !parsedQorHotspots)
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
      ...(parsedQorHotspots ? { hotspots: parsedQorHotspots } : {}),
      ...(parsedQorSummary ? { summary: parsedQorSummary } : {}),
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
