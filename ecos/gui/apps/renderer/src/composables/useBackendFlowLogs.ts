import { computed, ref, shallowRef, watch } from 'vue'
import { getWorkspaceResourceIndexApi } from '@/api/workspaceResources'
import {
  readOptionalProjectTextFileChunk,
  readOptionalProjectTextFileTail,
} from '@/utils/projectFiles'
import { resolveProjectPathAccess } from '@/utils/projectFs'
import { useBackgroundOperationStore } from '@/stores/backgroundOperationStore'
import { isFlowExecutionActiveForWorkspace } from './useFlowRunner'
import { useWorkspace } from './useWorkspace'

export interface FlowLogSegment {
  stepName: string
  tool: string
  state: string
  runtime?: string
  peakMemoryMb?: number | null
  failed: boolean
  missing: boolean
  live?: boolean
  startedAtMs?: number
  truncated?: boolean
  totalSize?: number
  lastReadOffsetBytes?: number
  logPath?: string
  logMtimeMs?: number
  logSizeBytes?: number
  ledgerStartedAtMs?: number
  contentComplete?: boolean
  contentLoading?: boolean
}

const flowLogSegmentsState = ref<FlowLogSegment[]>([])
const flowLogContentState = shallowRef<Record<string, string>>({})
const flowLogStepNameState = ref('')
const flowLogErrorState = ref<string | null>(null)
const flowLogLoadingState = ref(false)
const fullContentLoads = new Map<string, Promise<boolean>>()
const MAX_LIVE_LOG_CHARS = 128 * 1024
const MAX_FILE_LOG_CHARS = 512 * 1024
const LIVE_LOG_CHUNK_BYTES = 64 * 1024
let activeWorkspacePath = ''
let activeWorkspaceSessionId = ''
let loadGeneration = 0

function segmentKey(segment: Pick<FlowLogSegment, 'stepName' | 'tool'>): string {
  return `${segment.stepName}\u001f${segment.tool}`
}

function formatLogSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return '0 B'
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

interface LogTail {
  content: string
  truncated: boolean
  sizeBytes: number
}

function presentableLogTail(tail: LogTail): string {
  if (!tail.truncated) return tail.content
  // The tail window can start mid-line; drop the partial first line.
  const firstNewline = tail.content.indexOf('\n')
  const body = firstNewline >= 0 ? tail.content.slice(firstNewline + 1) : tail.content
  const banner = `… Log truncated — showing the last ${formatLogSize(body.length)} of a ${formatLogSize(tail.sizeBytes)} file. Open the log on disk for the full output. …`
  return `${banner}\n\n${body}`
}

function setContent(key: string, content: string): void {
  flowLogContentState.value = { ...flowLogContentState.value, [key]: content }
}

function appendContent(key: string, chunk: string): void {
  if (!chunk) return
  const content = `${flowLogContentState.value[key] ?? ''}${chunk}`
  setContent(
    key,
    content.length > MAX_LIVE_LOG_CHARS
      ? content.slice(content.length - MAX_LIVE_LOG_CHARS)
      : content,
  )
}

function deleteContent(key: string): void {
  if (!(key in flowLogContentState.value)) return
  const next = { ...flowLogContentState.value }
  delete next[key]
  flowLogContentState.value = next
}

function resetFlowLogState(): void {
  loadGeneration += 1
  flowLogSegmentsState.value = []
  flowLogContentState.value = {}
  flowLogStepNameState.value = ''
  flowLogErrorState.value = null
  flowLogLoadingState.value = false
  fullContentLoads.clear()
}

export function resetSharedFlowLogWorkspaceState(): void {
  activeWorkspacePath = ''
  activeWorkspaceSessionId = ''
  resetFlowLogState()
}

function currentStepName(segments: readonly FlowLogSegment[]): string {
  return (
    segments.find((segment) => segment.live)?.stepName ??
    [...segments].reverse().find((segment) => !segment.missing)?.stepName ??
    ''
  )
}

function isFailedState(state: string): boolean {
  return ['incomplete', 'invalid', 'failed', 'error'].includes(state.trim().toLowerCase())
}

function ledgerStartTime(info: Record<string, unknown>): number | undefined {
  for (const marker of [info.execution, info.runtime_operation]) {
    if (marker && typeof marker === 'object' && 'started_at' in marker) {
      const seconds = marker.started_at
      if (typeof seconds === 'number' && Number.isFinite(seconds)) return seconds * 1000
    }
  }
}

export function useBackendFlowLogs() {
  const { currentProject, resourceVersions, workspaceSession } = useWorkspace()
  const backgroundOperations = useBackgroundOperationStore()
  const currentWorkspaceFlowExecutionActive = computed(() =>
    isFlowExecutionActiveForWorkspace(currentProject.value?.path),
  )

  async function refreshFlowLogs(): Promise<void> {
    const generation = ++loadGeneration
    const startingEmpty = flowLogSegmentsState.value.length === 0
    if (!currentProject.value?.path) {
      if (startingEmpty) flowLogSegmentsState.value = []
      return
    }
    if (startingEmpty) flowLogLoadingState.value = true
    flowLogErrorState.value = null
    try {
      const index = await getWorkspaceResourceIndexApi()
      if (generation !== loadGeneration) return
      const existing = new Map(
        flowLogSegmentsState.value.map((segment) => [segmentKey(segment), segment]),
      )
      const next = index.flow.steps.flatMap((step) => {
        const state = step.state.trim().toLowerCase()
        if (state === 'unstart') return []
        const log = step.resources.log.file
        const logPath = log?.path
        const live = state === 'ongoing'
        const key = segmentKey({ stepName: step.name, tool: step.tool })
        const prior = existing.get(key)
        const startedAtMs = ledgerStartTime(step.info)
        const sameAttempt =
          prior &&
          prior.logPath === logPath &&
          prior.live === live &&
          prior.ledgerStartedAtMs === startedAtMs &&
          (live ||
            (prior.logMtimeMs === log?.mtimeMs &&
              prior.logSizeBytes === log?.sizeBytes &&
              prior.state === step.state &&
              prior.runtime === step.runtime))
        if (!sameAttempt) {
          deleteContent(key)
          fullContentLoads.delete(key)
        }
        return [
          {
            ...(sameAttempt ? prior : undefined),
            failed: isFailedState(step.state),
            live,
            missing: !logPath,
            peakMemoryMb: step.peakMemoryMb,
            runtime: step.runtime,
            startedAtMs: live
              ? (startedAtMs ??
                (sameAttempt ? prior?.startedAtMs : undefined) ??
                Date.now())
              : undefined,
            state: step.state,
            stepName: step.name,
            tool: step.tool,
            logPath,
            logMtimeMs: log?.mtimeMs,
            logSizeBytes: log?.sizeBytes,
            ledgerStartedAtMs: startedAtMs,
          },
        ]
      })
      const nextKeys = new Set(next.map(segmentKey))
      for (const key of existing.keys()) {
        if (nextKeys.has(key)) continue
        deleteContent(key)
        fullContentLoads.delete(key)
      }
      flowLogSegmentsState.value = next
      flowLogStepNameState.value = currentStepName(next)
    } catch (error) {
      if (generation !== loadGeneration) return
      flowLogErrorState.value = error instanceof Error ? error.message : String(error)
    } finally {
      if (generation === loadGeneration) flowLogLoadingState.value = false
    }
  }

  async function ensureFlowLogSegmentContentLoaded(
    requested: FlowLogSegment,
  ): Promise<boolean> {
    const key = segmentKey(requested)
    const currentIndex = () =>
      flowLogSegmentsState.value.findIndex((segment) => segmentKey(segment) === key)
    let segment = flowLogSegmentsState.value[currentIndex()]
    if (!segment?.logPath) {
      await refreshFlowLogs()
      segment = flowLogSegmentsState.value[currentIndex()]
    }
    if (!segment?.logPath) return false
    if (!segment.live && segment.contentComplete && key in flowLogContentState.value)
      return true
    const inFlight = fullContentLoads.get(key)
    if (inFlight) return await inFlight

    const { logPath, live, lastReadOffsetBytes } = segment
    const isCurrent = () => fullContentLoads.get(key) === load
    const mark = (partial: Partial<FlowLogSegment>): void => {
      const index = currentIndex()
      const current = flowLogSegmentsState.value[index]
      if (current && isCurrent())
        flowLogSegmentsState.value[index] = { ...current, ...partial }
    }

    const load: Promise<boolean> = (async () => {
      try {
        const allowedPath = await resolveProjectPathAccess(logPath)
        if (!allowedPath || !isCurrent()) return false
        if (!live) {
          mark({ contentLoading: true })
          const tail = await readOptionalProjectTextFileTail(
            allowedPath,
            MAX_FILE_LOG_CHARS,
          )
          if (!isCurrent()) return false
          if (!tail) {
            mark({ missing: true })
            return false
          }
          setContent(key, presentableLogTail(tail))
          mark({
            contentComplete: true,
            lastReadOffsetBytes: tail.sizeBytes,
            missing: false,
            totalSize: tail.sizeBytes,
            truncated: tail.truncated,
          })
          return true
        }

        const offset = lastReadOffsetBytes ?? 0
        let chunk = await readOptionalProjectTextFileChunk(
          allowedPath,
          offset,
          LIVE_LOG_CHUNK_BYTES,
        )
        if (!isCurrent()) return false
        if (chunk && chunk.sizeBytes < offset) {
          deleteContent(key)
          chunk = await readOptionalProjectTextFileChunk(
            allowedPath,
            0,
            LIVE_LOG_CHUNK_BYTES,
          )
          if (!isCurrent()) return false
        }
        if (!chunk) {
          mark({ missing: true })
          return false
        }
        appendContent(key, chunk.content)
        mark({
          contentComplete: false,
          lastReadOffsetBytes: chunk.nextOffsetBytes,
          missing: false,
          totalSize: chunk.sizeBytes,
          truncated: false,
        })
        flowLogErrorState.value = null
        return true
      } catch (error) {
        if (isCurrent()) {
          flowLogErrorState.value = error instanceof Error ? error.message : String(error)
        }
        return false
      }
    })().finally(() => {
      if (!isCurrent()) return
      mark({ contentLoading: false })
      fullContentLoads.delete(key)
    })
    fullContentLoads.set(key, load)
    return await load
  }

  watch(
    () => [currentProject.value?.path, workspaceSession.value.sessionId] as const,
    ([path, sessionId]) => {
      const normalized = path ?? ''
      if (normalized !== activeWorkspacePath || sessionId !== activeWorkspaceSessionId) {
        activeWorkspacePath = normalized
        activeWorkspaceSessionId = sessionId
        resetFlowLogState()
      }
      if (path) void refreshFlowLogs()
    },
    { immediate: true },
  )
  watch(
    () => [
      resourceVersions.value.logs,
      backgroundOperations.operations.find(
        (operation) => operation.workspaceHandle === workspaceSession.value.workspaceId,
      )?.flow,
    ],
    () => {
      if (currentProject.value?.path) void refreshFlowLogs()
    },
  )

  return {
    currentWorkspaceFlowExecutionActive,
    ensureFlowLogSegmentContentLoaded,
    flowLogContentByKey: flowLogContentState,
    flowLogError: flowLogErrorState,
    flowLogLoading: flowLogLoadingState,
    flowLogSegments: flowLogSegmentsState,
    flowLogStepName: flowLogStepNameState,
    refreshFlowLogs,
  }
}
