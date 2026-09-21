import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useMessageStore } from '@/stores/messageStore'
import {
  markFlowExecutionActiveForWorkspace,
  resetFlowExecutionState,
} from './flowExecutionState'

const {
  currentProject,
  backendRuntimeEvents,
  startFlowRunArtifactCapture,
  progressStart,
  progressStop,
  agentSessionId,
} = vi.hoisted(() => ({
  currentProject: { value: { path: '/runs/gcd' } as { path: string } | null },
  backendRuntimeEvents: { value: [] as unknown[] },
  startFlowRunArtifactCapture: vi.fn(),
  progressStart: vi.fn(),
  progressStop: vi.fn(),
  agentSessionId: { value: 'tab-workspace' as string | null },
}))

vi.mock('@/composables/useWorkspace', () => ({
  useWorkspace: () => ({
    backendRuntimeEvents,
    currentProject,
  }),
}))

vi.mock('@/composables/useFlowRunArtifacts', () => ({
  useFlowRunArtifacts: () => ({ startFlowRunArtifactCapture }),
}))

vi.mock('@/composables/useAgentFlowProgress', () => ({
  useAgentFlowProgress: () => ({
    start: progressStart,
    stop: progressStop,
  }),
}))

vi.mock('@/stores/agentShellStore', () => ({
  useAgentShellStore: () => ({
    get sessionId() {
      return agentSessionId.value
    },
  }),
}))

describe('workspaceAgentFlowCapture', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetFlowExecutionState()
    currentProject.value = { path: '/runs/gcd' }
    agentSessionId.value = 'tab-workspace'
    startFlowRunArtifactCapture.mockReset()
    progressStart.mockReset()
    progressStop.mockReset()
    startFlowRunArtifactCapture.mockReturnValue({
      inspect: vi.fn(),
      settle: vi.fn(),
      stop: vi.fn(),
    })
  })

  it('captures into the visible Agent tab when a GUI flow starts', async () => {
    const { useWorkspaceAgentFlowCapture } = await import('./workspaceAgentFlowCapture')
    useWorkspaceAgentFlowCapture()
    await nextTick()

    expect(progressStart).toHaveBeenCalledWith('/runs/gcd')
    expect(useMessageStore().activeSessionId).toBe('tab-workspace')
    expect(startFlowRunArtifactCapture).toHaveBeenCalledWith({
      inspectExisting: true,
      ownerSessionId: 'tab-workspace',
      stopOnTerminal: false,
    })
    expect(startFlowRunArtifactCapture).toHaveBeenCalledTimes(1)

    markFlowExecutionActiveForWorkspace('/runs/gcd')
    await nextTick()

    expect(startFlowRunArtifactCapture).toHaveBeenCalledTimes(1)
  })

  it('backfills completed steps when attaching to an already running flow', async () => {
    markFlowExecutionActiveForWorkspace('/runs/gcd')
    const { useWorkspaceAgentFlowCapture } = await import('./workspaceAgentFlowCapture')
    useWorkspaceAgentFlowCapture()
    await nextTick()

    expect(startFlowRunArtifactCapture).toHaveBeenCalledWith({
      inspectExisting: true,
      ownerSessionId: 'tab-workspace',
      stopOnTerminal: false,
    })
    expect(startFlowRunArtifactCapture).toHaveBeenCalledTimes(1)
  })
})
