import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useMessageStore } from '@/stores/messageStore'
import { getAgentSessionUi, removeAgentSessionUi } from '@/components/agentSessionUi'
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
  activeTab,
} = vi.hoisted(() => ({
  currentProject: { value: { path: '/runs/gcd' } as { path: string } | null },
  backendRuntimeEvents: { value: [] as unknown[] },
  startFlowRunArtifactCapture: vi.fn(),
  progressStart: vi.fn(),
  progressStop: vi.fn(),
  agentSessionId: { value: 'tab-workspace' as string | null },
  activeTab: { value: null as { workspacePath?: string } | null },
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
    get activeTab() {
      return activeTab.value
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
    removeAgentSessionUi('tab-workspace')
    activeTab.value = null
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

  it('waits for the provider session to settle before restoring existing artifacts', async () => {
    const ui = getAgentSessionUi('tab-workspace')
    ui.isConnecting = true
    const { useWorkspaceAgentFlowCapture } = await import('./workspaceAgentFlowCapture')
    useWorkspaceAgentFlowCapture()
    await nextTick()

    expect(progressStart).not.toHaveBeenCalled()
    expect(startFlowRunArtifactCapture).not.toHaveBeenCalled()

    ui.isConnecting = false
    await nextTick()

    expect(progressStart).toHaveBeenCalledWith('/runs/gcd')
    expect(startFlowRunArtifactCapture).toHaveBeenCalledWith({
      inspectExisting: true,
      ownerSessionId: 'tab-workspace',
      stopOnTerminal: false,
    })
  })

  it('holds capture while the active tab belongs to another workspace', async () => {
    activeTab.value = { workspacePath: '/runs/other' }
    const { useWorkspaceAgentFlowCapture } = await import('./workspaceAgentFlowCapture')
    useWorkspaceAgentFlowCapture()
    await nextTick()

    expect(progressStart).not.toHaveBeenCalled()
    expect(startFlowRunArtifactCapture).not.toHaveBeenCalled()

    activeTab.value = { workspacePath: '/runs/gcd/' }
    markFlowExecutionActiveForWorkspace('/runs/gcd')
    await nextTick()

    expect(progressStart).toHaveBeenCalledWith('/runs/gcd')
    expect(startFlowRunArtifactCapture).toHaveBeenCalledWith({
      inspectExisting: true,
      ownerSessionId: 'tab-workspace',
      stopOnTerminal: false,
    })
  })

  it('flushes artifacts only for the matching workspace and chat owner', async () => {
    const { useWorkspaceAgentFlowCapture, waitForWorkspaceAgentFlowArtifacts } =
      await import('./workspaceAgentFlowCapture')
    useWorkspaceAgentFlowCapture()
    await nextTick()
    const capture = startFlowRunArtifactCapture.mock.results[0]!.value

    await waitForWorkspaceAgentFlowArtifacts('/runs/other', 'tab-workspace')
    await waitForWorkspaceAgentFlowArtifacts('/runs/gcd', 'other-tab')
    expect(capture.inspect).not.toHaveBeenCalled()

    await waitForWorkspaceAgentFlowArtifacts('/runs/gcd/', 'tab-workspace')
    expect(capture.inspect).toHaveBeenCalledOnce()
  })
})
