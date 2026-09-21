import { nextTick } from 'vue'
import type { WorkspaceResourceIndex } from '@ecos-studio/shared'
import { getWorkspaceResourceIndexApi } from '@/api/workspaceResources'

export interface RuntimeStepRenderCommit {
  eventId: string
  operationId: string
  workspaceHandle?: string
  step: string
  stepCommitId: string
  workspaceRevision?: number
}

export interface RuntimeStepRenderContext extends RuntimeStepRenderCommit {
  resourceIndex(): Promise<WorkspaceResourceIndex>
}

export type RuntimeStepRenderTask = (
  commit: RuntimeStepRenderContext,
) => Promise<void> | void

const renderTasks = new Set<RuntimeStepRenderTask>()
type RenderQueue = {
  pending: RuntimeStepRenderCommit | null
  running: boolean
  waiters: Array<() => void>
}

const renderQueues = new Map<string, RenderQueue>()

function isNewerCommit(
  next: RuntimeStepRenderCommit,
  current: RuntimeStepRenderCommit | null,
): boolean {
  if (!current) return true
  if (next.workspaceRevision === undefined || current.workspaceRevision === undefined)
    return true
  return next.workspaceRevision > current.workspaceRevision
}

/**
 * Components that own step-derived data register their bounded refresh here.
 * Runtime events trigger these tasks without delaying ECC execution.
 */
export function registerRuntimeStepRenderTask(task: RuntimeStepRenderTask): () => void {
  renderTasks.add(task)
  return () => renderTasks.delete(task)
}

export async function finishRuntimeStepRender(
  commit: RuntimeStepRenderCommit,
): Promise<void> {
  const queueKey = commit.workspaceHandle || commit.operationId || 'workspace'
  const queue = renderQueues.get(queueKey) ?? {
    pending: null,
    running: false,
    waiters: [],
  }
  if (isNewerCommit(commit, queue.pending)) queue.pending = commit
  const completion = new Promise<void>((resolve) => queue.waiters.push(resolve))
  renderQueues.set(queueKey, queue)
  if (!queue.running) void drainRenderQueue(queueKey, queue)
  await completion
}

async function drainRenderQueue(queueKey: string, queue: RenderQueue): Promise<void> {
  queue.running = true
  try {
    while (queue.pending) {
      const commit = queue.pending
      queue.pending = null
      try {
        await runRuntimeStepRender(commit)
      } catch (error) {
        console.warn(
          'Step render scheduling failed; preserving the last rendered data:',
          error,
        )
      }
    }
  } finally {
    queue.running = false
    const waiters = queue.waiters.splice(0)
    for (const resolve of waiters) resolve()
    if (queue.pending) {
      void drainRenderQueue(queueKey, queue)
    } else {
      renderQueues.delete(queueKey)
    }
  }
}

async function runRuntimeStepRender(commit: RuntimeStepRenderCommit): Promise<void> {
  let resourceIndexTask: Promise<WorkspaceResourceIndex> | null = null
  const context: RuntimeStepRenderContext = {
    ...commit,
    resourceIndex: () => {
      resourceIndexTask ??= getWorkspaceResourceIndexApi()
      return resourceIndexTask
    },
  }
  const results = await Promise.allSettled(
    [...renderTasks].map(async (task) => await task(context)),
  )
  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn(
        'Step render task failed; preserving the last rendered data:',
        result.reason,
      )
    }
  }
  await nextTick()
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve())
      return
    }
    setTimeout(resolve, 0)
  })
}
