import { computed, onUnmounted, ref, shallowRef, watch } from 'vue'
import type { DesignRuntimeEvent } from '@ecos-studio/shared'
import { getWorkspaceResourceIndexApi } from '@/api/workspaceResources'
import {
  backendRuntimeEventKind,
  backendRuntimeEventPayload,
  backendRuntimeEventState,
  backendRuntimeEventStep,
} from '@/api/backendRuntimeEvents'
import { readOptionalProjectTextFileChunk } from '@/utils/projectFiles'
import { resolveProjectPathAccess } from '@/utils/projectFs'
import { isFlowExecutionActiveForWorkspace } from './useFlowRunner'
import { useWorkspace } from './useWorkspace'
import { isObsoleteBackendFlowStep } from './backendFlowProjection'

export interface FlowLogSegment {
  stepName: string
  tool: string
  state: string
  runtime?: string
  peakMemoryMb?: number | null
  failed: boolean
  missing: boolean
  live?: boolean
  truncated?: boolean
  totalSize?: number
  lastReadOffsetBytes?: number
  logPath?: string
  contentComplete?: boolean
  contentLoading?: boolean
}

const flowLogSegmentsState = ref<FlowLogSegment[]>([])
const flowLogContentState = shallowRef<Record<string, string>>({})
const flowLogStepNameState = ref('')
const flowLogErrorState = ref<string | null>(null)
const flowLogRerunAffectedStepsState = ref<string[]>([])
const flowLogLoadingState = ref(false)
const flowLogCursorByKey = new Map<string, number>()
const fullContentLoads = new Map<string, Promise<boolean>>()
const MAX_RUNTIME_LOG_CHARS = 128 * 1024
const LOG_CHUNK_BYTES = 256 * 1024
let activeWorkspacePath = ''
let activeWorkspaceSessionId = ''
let loadGeneration = 0

function segmentKey(segment: Pick<FlowLogSegment, 'stepName' | 'tool'>): string {
  return `${segment.stepName}\u001f${segment.tool}`
}

function normalizedPath(path: unknown): string {
  if (typeof path !== 'string') return ''
  return path.trim().replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
}

function setContent(key: string, content: string): void {
  flowLogContentState.value = { ...flowLogContentState.value, [key]: content }
}

function appendContent(key: string, chunk: string): void {
  if (!chunk) return
  const content = `${flowLogContentState.value[key] ?? ''}${chunk}`
  setContent(
    key,
    content.length > MAX_RUNTIME_LOG_CHARS
      ? content.slice(content.length - MAX_RUNTIME_LOG_CHARS)
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
  flowLogRerunAffectedStepsState.value = []
  flowLogLoadingState.value = false
  flowLogCursorByKey.clear()
  fullContentLoads.clear()
}

export function resetSharedHomeDataProjectState(): void {
  activeWorkspacePath = ''
  activeWorkspaceSessionId = ''
  resetFlowLogState()
}

export function prepareFlowLogSegmentsForRerun(stepNames: readonly string[]): void {
  const affected = new Set(
    stepNames.map((step) => step.trim().toLowerCase()).filter(Boolean),
  )
  if (affected.size === 0) return
  flowLogSegmentsState.value = flowLogSegmentsState.value.filter((segment) => {
    if (!affected.has(segment.stepName.trim().toLowerCase())) return true
    const key = segmentKey(segment)
    deleteContent(key)
    flowLogCursorByKey.delete(key)
    fullContentLoads.delete(key)
    return false
  })
  if (affected.has(flowLogStepNameState.value.trim().toLowerCase())) {
    flowLogStepNameState.value = ''
  }
}

function sameSegment(segment: FlowLogSegment, stepName: string, tool: string): boolean {
  return (
    segment.stepName.trim().toLowerCase() === stepName.trim().toLowerCase() &&
    (!tool ||
      !segment.tool ||
      segment.tool.trim().toLowerCase() === tool.trim().toLowerCase())
  )
}

function upsertRuntimeSegment(input: {
  stepName: string
  tool: string
  state: string
  live: boolean
  failed?: boolean
}): FlowLogSegment {
  const index = flowLogSegmentsState.value.findIndex((segment) =>
    sameSegment(segment, input.stepName, input.tool),
  )
  const previous = index >= 0 ? flowLogSegmentsState.value[index] : undefined
  const next: FlowLogSegment = {
    ...(previous ?? {
      failed: false,
      missing: false,
      stepName: input.stepName,
      tool: input.tool,
    }),
    failed: input.failed ?? false,
    live: input.live,
    missing: false,
    state: input.state,
    stepName: input.stepName,
    tool: input.tool || previous?.tool || '',
  }
  const segments = flowLogSegmentsState.value.map((segment, candidateIndex) =>
    candidateIndex === index
      ? next
      : input.live && segment.live
        ? { ...segment, live: false }
        : segment,
  )
  if (index < 0) segments.push(next)
  flowLogSegmentsState.value = segments
  return next
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

function rerunPreparedForWorkspace(
  event: DesignRuntimeEvent,
  workspacePath: string,
): string[] | null {
  if (backendRuntimeEventKind(event) !== 'operation.rerun_prepared') return null
  const payload = backendRuntimeEventPayload(event)
  const eventWorkspace = normalizedPath(event.workspaceDirectory)
  if (eventWorkspace && eventWorkspace !== normalizedPath(workspacePath)) return null
  return Array.isArray(payload.affectedSteps)
    ? payload.affectedSteps.filter((step): step is string => typeof step === 'string')
    : []
}

function eventMatchesWorkspace(
  event: DesignRuntimeEvent,
  workspaceHandle: string,
  workspacePath: string,
): boolean {
  if ('workspaceHandle' in event && event.workspaceHandle) {
    return event.workspaceHandle === workspaceHandle
  }
  const eventWorkspace = normalizedPath(event.workspaceDirectory)
  return Boolean(eventWorkspace && eventWorkspace === normalizedPath(workspacePath))
}

export function useBackendFlowLogs() {
  const { backendRuntimeEvents, currentProject, workspaceSession } = useWorkspace()
  const handledEventIds = new Set<string>()
  const handledEventObjects = new WeakSet<object>()

  const currentWorkspaceFlowExecutionActive = computed(() =>
    isFlowExecutionActiveForWorkspace(currentProject.value?.path),
  )

  function shouldProcess(event: DesignRuntimeEvent): boolean {
    const eventId = event.type === 'runtime.protocol' ? event.event.eventId : undefined
    if (typeof eventId === 'string' && eventId) {
      if (handledEventIds.has(eventId)) return false
      handledEventIds.add(eventId)
      if (handledEventIds.size > 512) {
        handledEventIds.delete(handledEventIds.values().next().value!)
      }
      return true
    }
    if (handledEventObjects.has(event)) return false
    handledEventObjects.add(event)
    return true
  }

  function processRuntimeEvent(event: DesignRuntimeEvent): void {
    const workspacePath = currentProject.value?.path
    if (
      !workspacePath ||
      !eventMatchesWorkspace(event, workspaceSession.value.workspaceId, workspacePath) ||
      !shouldProcess(event)
    )
      return
    const affected = rerunPreparedForWorkspace(event, workspacePath)
    if (affected) {
      flowLogRerunAffectedStepsState.value = affected
      prepareFlowLogSegmentsForRerun(affected)
      return
    }
    const record = backendRuntimeEventPayload(event)
    const protocolType = backendRuntimeEventKind(event)
    const stepName = backendRuntimeEventStep(event) ?? ''
    const tool = typeof record.tool === 'string' ? record.tool : ''
    if (!stepName || isObsoleteBackendFlowStep(stepName)) return

    if (protocolType === 'step.started') {
      const segment = upsertRuntimeSegment({
        live: true,
        state: backendRuntimeEventState(event) ?? 'Ongoing',
        stepName,
        tool,
      })
      const key = segmentKey(segment)
      deleteContent(key)
      flowLogCursorByKey.delete(key)
      fullContentLoads.delete(key)
      flowLogStepNameState.value = stepName
      flowLogErrorState.value = null
      return
    }

    if (protocolType === 'step.log' && typeof record.chunk === 'string') {
      const segment = upsertRuntimeSegment({
        live: true,
        state: backendRuntimeEventState(event) ?? 'Ongoing',
        stepName,
        tool,
      })
      const key = segmentKey(segment)
      const cursor =
        typeof record.cursor === 'number' && Number.isFinite(record.cursor)
          ? record.cursor
          : null
      if (cursor === null || cursor > (flowLogCursorByKey.get(key) ?? -1)) {
        appendContent(key, record.chunk)
        if (cursor !== null) flowLogCursorByKey.set(key, cursor)
      }
      flowLogStepNameState.value = stepName
      flowLogErrorState.value = null
      return
    }

    if (protocolType === 'step.completed') {
      const state = backendRuntimeEventState(event) ?? 'Success'
      const segment = upsertRuntimeSegment({
        failed: isFailedState(state),
        live: false,
        state,
        stepName,
        tool,
      })
      const finalLog = typeof record.finalLog === 'string' ? record.finalLog : ''
      const key = segmentKey(segment)
      if (finalLog) setContent(key, finalLog)
      flowLogCursorByKey.delete(key)
      const index = flowLogSegmentsState.value.indexOf(segment)
      if (index >= 0) {
        flowLogSegmentsState.value[index] = {
          ...segment,
          contentComplete: false,
          contentLoading: false,
          totalSize: new TextEncoder().encode(finalLog).byteLength,
          truncated: finalLog.length >= 64 * 1024,
        }
      }
      flowLogStepNameState.value = stepName
      flowLogErrorState.value = null
    }
  }

  function consumeRuntimeEvents(events: readonly DesignRuntimeEvent[]): void {
    for (const event of events) processRuntimeEvent(event)
  }

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
        if (isObsoleteBackendFlowStep(step.name)) return []
        if (['unstart'].includes(step.state.trim().toLowerCase())) return []
        const logPath = step.resources.log.file?.path
        const base: FlowLogSegment = {
          failed: isFailedState(step.state),
          missing: !logPath,
          peakMemoryMb:
            step.peakMemoryMb ??
            (typeof step.info['peak memory (mb)'] === 'number'
              ? step.info['peak memory (mb)']
              : null),
          runtime: step.runtime,
          state: step.state,
          stepName: step.name,
          tool: step.tool,
          ...(logPath ? { logPath } : {}),
        }
        const prior = existing.get(segmentKey(base))
        return [prior ? { ...base, ...prior, logPath } : base]
      })
      const nextKeys = new Set(next.map(segmentKey))
      for (const segment of existing.values()) {
        if (!nextKeys.has(segmentKey(segment))) next.push(segment)
      }
      const alive = new Set(next.map(segmentKey))
      for (const key of Object.keys(flowLogContentState.value)) {
        if (!alive.has(key)) deleteContent(key)
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
    if (requested.live) return false
    let segment = flowLogSegmentsState.value.find((candidate) =>
      sameSegment(candidate, requested.stepName, requested.tool),
    )
    if (!segment?.logPath) {
      await refreshFlowLogs()
      segment = flowLogSegmentsState.value.find((candidate) =>
        sameSegment(candidate, requested.stepName, requested.tool),
      )
    }
    if (!segment?.logPath) return false
    const key = segmentKey(segment)
    if (segment.contentComplete && key in flowLogContentState.value) return true
    const inFlight = fullContentLoads.get(key)
    if (inFlight) return await inFlight

    const load = (async () => {
      const logPath = await resolveProjectPathAccess(segment!.logPath!)
      if (!logPath) return false
      const mark = (partial: Partial<FlowLogSegment>): void => {
        const index = flowLogSegmentsState.value.findIndex((candidate) =>
          sameSegment(candidate, requested.stepName, requested.tool),
        )
        if (index >= 0) {
          flowLogSegmentsState.value[index] = {
            ...flowLogSegmentsState.value[index]!,
            ...partial,
          }
        }
      }
      mark({ contentLoading: true })
      const chunks: string[] = []
      let offset = 0
      try {
        while (true) {
          const chunk = await readOptionalProjectTextFileChunk(
            logPath,
            offset,
            LOG_CHUNK_BYTES,
          )
          if (!chunk) {
            mark({ contentLoading: false, missing: true })
            return false
          }
          if (chunk.nextOffsetBytes < offset) {
            throw new Error('Log chunk reader returned a backwards byte offset.')
          }
          if (!chunk.eof && chunk.nextOffsetBytes === offset) {
            throw new Error('Log chunk reader made no byte-offset progress.')
          }
          chunks.push(chunk.content)
          offset = chunk.nextOffsetBytes
          if (!chunk.eof) continue
          setContent(key, chunks.join(''))
          mark({
            contentComplete: true,
            contentLoading: false,
            lastReadOffsetBytes: offset,
            missing: false,
            totalSize: chunk.sizeBytes,
            truncated: false,
          })
          return true
        }
      } catch (error) {
        flowLogErrorState.value = error instanceof Error ? error.message : String(error)
        mark({ contentLoading: false })
        return false
      }
    })().finally(() => fullContentLoads.delete(key))
    fullContentLoads.set(key, load)
    return await load
  }

  watch(
    () => [currentProject.value?.path, workspaceSession.value.sessionId] as const,
    ([path, sessionId]) => {
      const normalized = normalizedPath(path)
      if (normalized !== activeWorkspacePath || sessionId !== activeWorkspaceSessionId) {
        activeWorkspacePath = normalized
        activeWorkspaceSessionId = sessionId
        resetFlowLogState()
      }
      if (path) void refreshFlowLogs()
    },
    { immediate: true },
  )
  watch(backendRuntimeEvents, (events) => consumeRuntimeEvents(events), {
    deep: true,
    flush: 'sync',
    immediate: true,
  })

  onUnmounted(() => {
    handledEventIds.clear()
  })

  return {
    currentWorkspaceFlowExecutionActive,
    ensureFlowLogSegmentContentLoaded,
    ensureFlowLogsLoaded: refreshFlowLogs,
    expandFlowLogSegment: ensureFlowLogSegmentContentLoaded,
    flowLogContentByKey: flowLogContentState,
    flowLogError: flowLogErrorState,
    flowLogLoading: flowLogLoadingState,
    flowLogRerunAffectedSteps: flowLogRerunAffectedStepsState,
    flowLogSegments: flowLogSegmentsState,
    flowLogStepName: flowLogStepNameState,
    refreshFlowLogs,
  }
}
