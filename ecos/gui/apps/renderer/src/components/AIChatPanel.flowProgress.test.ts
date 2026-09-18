// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { defineComponent, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, expect, it, vi } from 'vitest'
import type { DesignRuntimeEvent, DesktopApi } from '@ecos-studio/shared'
import AIChatPanel from './AIChatPanel.vue'
import AgentToolCard from './AgentToolCard.vue'
import { removeAgentSessionUi } from './agentSessionUi'
import { useWorkspace } from '@/composables/useWorkspace'
import { useWorkspaceAgentFlowCapture } from '@/composables/workspaceAgentFlowCapture'
import { useAgentShellStore } from '@/stores/agentShellStore'
import { useMessageStore } from '@/stores/messageStore'
import { agentWorkspaceSetupKey } from '@/composables/agentWorkspaceSetup'
import { quickStartRunnerKey } from '@/composables/quickStartUi'

const { runAllFlow, inspectArtifacts } = vi.hoisted(() => ({
  runAllFlow: vi.fn(),
  inspectArtifacts: vi.fn(),
}))

vi.mock('@/composables/useWorkspace', async () => {
  const { ref } = await import('vue')
  const workspace = {
    currentProject: ref({ path: '/runs/gcd', name: 'gcd' }),
    workspaceSession: ref({ workspaceId: 'workspace-handle' }),
    backendRuntimeEvents: ref([]),
    openProject: vi.fn(),
    invalidateWorkspaceResources: vi.fn(),
    waitForRuntimeOperation: vi.fn(),
  }
  return { useWorkspace: () => workspace }
})
vi.mock('@/composables/useWorkspaceLifecycle', () => ({
  useWorkspaceLifecycle: () => ({}),
}))
vi.mock('@/composables/useFlowRunner', () => ({
  useFlowRunner: () => ({ runAllFlow }),
}))
vi.mock('@/composables/useFlowRunArtifacts', () => ({
  useFlowRunArtifacts: () => ({
    startFlowRunArtifactCapture: () => ({ inspect: inspectArtifacts, stop: vi.fn() }),
  }),
}))
vi.mock('@/api/workspaceResources', () => ({
  readWorkspaceFlowResourceApi: async () => ({ steps: [] }),
}))

beforeEach(() => {
  runAllFlow.mockReset()
  runAllFlow.mockImplementation(() => new Promise(() => {}))
  inspectArtifacts.mockReset()
  useWorkspace().backendRuntimeEvents.value = []
})

async function mountPostCreateFlow(options: { handoff?: boolean } = {}) {
  const pinia = createPinia()
  const shell = useAgentShellStore(pinia)
  const messages = useMessageStore(pinia)
  shell.createTab({ mode: 'home' }, { id: 'owner' })
  shell.markTabStarted('owner')
  messages.setActiveSessionId('owner')
  messages.addMessage('Confirm and start')
  if (options.handoff === false) {
    messages.addInteraction({
      interaction: {
        kind: 'choice',
        options: [{ id: 'quick-start', label: 'Quick Start' }],
        variant: 'buttons',
      },
      kind: 'choice',
      purpose: 'execution',
      requestId: 'home-options',
      schema_version: 'flow-agent.interaction_request.v1',
      status: 'pending',
      title: 'Get started',
    })
  }
  if (options.handoff !== false) {
    shell.setPendingPostCreateFlow({
      ownerSessionId: 'owner',
      setupId: 'setup-gcd',
      workspacePath: '/runs/gcd',
    })
  }
  const startSession = vi.fn(async () => ({
    sessionId: 'owner',
    ...(options.handoff === false
      ? {
          pendingInteraction: {
            interaction: {
              kind: 'choice' as const,
              options: [
                { id: 'rerun', label: 'Rerun a specified stage' },
                { id: 'continue', label: 'Continue unfinished flow' },
              ],
              variant: 'list' as const,
            },
            kind: 'choice' as const,
            purpose: 'execution' as const,
            requestId: 'workspace-options',
            schema_version: 'flow-agent.interaction_request.v1' as const,
            status: 'pending' as const,
            title: 'Choose an operation',
          },
        }
      : {}),
  }))
  window.ecosDesktop = {
    agent: {
      onEvent: () => () => {},
      getModelSettings: async () => ({ model: 'test', models: [] }),
      start: vi.fn(async () => undefined),
      startSession,
    },
    settings: {
      get: vi.fn(async () => null),
      set: vi.fn(async () => undefined),
    },
  } as unknown as DesktopApi
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
  await router.push('/')
  await router.isReady()
  const workspace = defineComponent({
    setup() {
      useWorkspaceAgentFlowCapture()
      return () => h(AIChatPanel, { shell: 'workspace' })
    },
  })
  const wrapper = mount(workspace, {
    global: {
      plugins: [pinia, router],
      provide: {
        [agentWorkspaceSetupKey]: vi.fn(),
        [quickStartRunnerKey]: vi.fn(),
      },
      stubs: {
        MessageItem: {
          props: ['message'],
          components: { AgentToolCard },
          template:
            '<AgentToolCard v-if="message.type === \'tool\'" :content="message.content" :status="message.status" />',
        },
        AgentSessionContractPanels: true,
        AgentActivityStream: true,
        AgentCodexSetupCard: true,
        AgentModelSettingsMenu: true,
      },
    },
  })
  await flushPromises()
  if (options.handoff !== false) expect(shell.pendingPostCreateFlow).toBeNull()
  return { wrapper, messages, startSession }
}

function dispose(wrapper: ReturnType<typeof mount>) {
  wrapper.unmount()
  removeAgentSessionUi('owner')
  delete window.ecosDesktop
}

it('renames a home Agent tab when the workspace shell takes ownership', async () => {
  const { wrapper, startSession } = await mountPostCreateFlow({ handoff: false })
  try {
    expect(useAgentShellStore().tabs.find((tab) => tab.id === 'owner')).toMatchObject({
      mode: 'workspace',
      title: 'gcd',
      workspacePath: '/runs/gcd',
    })
    expect(wrapper.get('[role="tab"]').text()).toContain('gcd')
    expect(wrapper.text()).toContain('Rerun a specified stage')
    expect(wrapper.text()).toContain('Continue unfinished flow')
    expect(wrapper.text()).not.toContain('Quick Start')
    expect(startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        directory: '/runs/gcd',
        mode: 'workspace',
        sessionId: 'owner',
      }),
    )
  } finally {
    dispose(wrapper)
  }
})

it('shows each post-create flow step once with workspace capture and chat mounted', async () => {
  const { wrapper, messages, startSession } = await mountPostCreateFlow()
  try {
    expect(startSession).not.toHaveBeenCalled()
    const { backendRuntimeEvents } = useWorkspace()
    for (const [index, [sourceType, step, state]] of [
      ['step.started', 'Synthesis', undefined],
      ['step.completed', 'Synthesis', 'Success'],
      ['step.started', 'place', undefined],
    ].entries()) {
      const event: DesignRuntimeEvent = {
        designTool: 'backend',
        type: 'runtime.protocol',
        workspaceDirectory: '/runs/gcd',
        workspaceHandle: 'workspace-handle',
        event: {
          eventId: `event-${index}`,
          kind: 'flow',
          operationId: 'flow-gcd',
          origin: 'gui',
          payload: { sourceType, step, state },
          sequence: index + 1,
          timestamp: index + 1,
          type: 'execution.progress',
          workspaceId: 'workspace-gcd',
        },
      }
      backendRuntimeEvents.value.push(event)
      await nextTick()
    }
    expect(
      messages.messages
        .filter((message) => message.type === 'tool')
        .map((message) => message.content),
    ).toEqual(['Running Synthesis.\nCompleted Synthesis.\nRunning place.\n'])
    expect(wrapper.findAll('.step__label').map((label) => label.text())).toEqual([
      'Synthesis',
      'place',
    ])
    expect(
      wrapper.findAll('.step').map((step) => step.attributes('data-status')),
    ).toEqual(['done', 'running'])
  } finally {
    dispose(wrapper)
  }
})

it('starts the post-create flow when its handoff arrives after the workspace chat mounts', async () => {
  const { wrapper } = await mountPostCreateFlow({ handoff: false })
  try {
    runAllFlow.mockClear()
    useAgentShellStore().setPendingPostCreateFlow({
      ownerSessionId: 'owner',
      setupId: 'setup-gcd',
      workspacePath: '/runs/gcd',
    })
    await flushPromises()

    expect(runAllFlow).toHaveBeenCalledOnce()
    expect(useAgentShellStore().pendingPostCreateFlow).toBeNull()
  } finally {
    dispose(wrapper)
  }
})

it('publishes the final layout before reporting completion and signoff results', async () => {
  let finishFlow!: (result: { operationId: string }) => void
  runAllFlow.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishFlow = resolve
      }),
  )
  let releaseLayout!: () => void
  const layoutReady = new Promise<void>((resolve) => {
    releaseLayout = resolve
  })
  const { wrapper, messages } = await mountPostCreateFlow()
  const publishLayout = layoutReady.then(() => {
    messages.addMapMessage(
      {
        title: 'Layout preview',
        step: 'Harden',
        imageUrl: 'blob:harden',
        localPath: '/runs/gcd/Harden/output/gcd.png',
        info: [],
        category: 'Layout',
      },
      'owner',
    )
  })
  inspectArtifacts.mockReturnValue(publishLayout)
  const sendMessage = vi.fn(async () => {
    messages.addAssistantMessage(
      'Harden completed. Checking the signoff checklist.',
      'done',
      'owner',
    )
    messages.addAssistantMessage(
      'Signoff export blocked: STA requirements block export.',
      'error',
      'owner',
    )
    return { sessionId: 'owner' }
  })
  window.ecosDesktop!.agent!.sendMessage = sendMessage
  try {
    finishFlow({ operationId: 'flow-gcd' })
    await flushPromises()
    expect(sendMessage).not.toHaveBeenCalled()
    releaseLayout()
    await flushPromises()
    expect(sendMessage).toHaveBeenCalledOnce()
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        directory: '/runs/gcd',
        sessionId: 'owner',
      }),
    )
    expect(useAgentShellStore().tabs.find((tab) => tab.id === 'owner')).toMatchObject({
      mode: 'workspace',
      workspacePath: '/runs/gcd',
      started: true,
    })
    expect(
      messages.messages
        .slice(1)
        .map((message) => message.mapData?.step ?? message.content),
    ).toEqual([
      'Harden',
      'Harden completed. Checking the signoff checklist.',
      'Signoff export blocked: STA requirements block export.',
    ])
  } finally {
    releaseLayout()
    await publishLayout
    dispose(wrapper)
  }
})
