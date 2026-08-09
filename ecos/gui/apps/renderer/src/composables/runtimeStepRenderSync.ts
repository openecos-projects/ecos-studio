import { nextTick } from 'vue'
import type { WorkspaceResourceIndex } from '@ecos-studio/shared'
import { getWorkspaceResourceIndexApi } from '@/api/workspaceResources'

export interface RuntimeStepRenderCommit {
  eventId: string
  operationId: string
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

/**
 * Components that own step-derived data register their bounded refresh here.
 * The workspace event coordinator awaits these tasks before it releases the
 * ECC gate, so no next step races a slow NFS-backed view refresh.
 */
export function registerRuntimeStepRenderTask(task: RuntimeStepRenderTask): () => void {
  renderTasks.add(task)
  return () => renderTasks.delete(task)
}

export async function finishRuntimeStepRender(
  commit: RuntimeStepRenderCommit,
): Promise<void> {
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
