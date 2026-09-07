// @vitest-environment happy-dom

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, expect, it, vi } from 'vitest'
import type { DesktopAgentEvent, DesktopApi } from '@ecos-studio/shared'
import AIChatPanel from './AIChatPanel.vue'
import { getAgentSessionUi, removeAgentSessionUi } from './agentSessionUi'
import { useAgentShellStore } from '@/stores/agentShellStore'
import { useMessageStore } from '@/stores/messageStore'
import { quickStartRunnerKey, type QuickStartRunner } from '@/composables/quickStartUi'
import type { QuickStartFlowResult } from '@/composables/quickStartFlow'
import { agentWorkspaceSetupKey } from '@/composables/agentWorkspaceSetup'

vi.mock('@/composables/useWorkspace', async () => {
  const { ref } = await import('vue')
  return {
    useWorkspace: () => ({
      currentProject: ref(null),
      workspaceSession: ref({ workspaceId: 'workspace-handle' }),
      runtimeEvents: ref([]),
      openProject: vi.fn(),
      invalidateWorkspaceResources: vi.fn(),
      waitForRuntimeOperation: vi.fn(),
    }),
  }
})
vi.mock('@/composables/useWorkspaceLifecycle', () => ({
  useWorkspaceLifecycle: () => ({}),
}))
vi.mock('@/composables/useFlowRunner', () => ({
  useFlowRunner: () => ({ runAllFlow: vi.fn() }),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function guide(completed = false): DesktopAgentEvent {
  return {
    providerId: 'ecos_agent',
    sessionId: 'owner',
    messageId: completed ? 'completed-message' : 'home-message',
    type: 'interaction',
    interaction: {
      schema_version: 'flow-agent.interaction_request.v1',
      requestId: completed ? 'completed-request' : 'home-request',
      kind: 'choice',
      purpose: 'execution',
      status: 'pending',
      title: completed ? 'The GCD example flow completed. What next?' : 'Get started',
      interaction: {
        kind: 'choice',
        variant: 'buttons',
        options: completed
          ? [
              { id: 'optimize_current', label: 'Optimize the current design' },
              { id: 'manual_rerun', label: 'Configure parameters and rerun stages' },
              { id: 'create_flow', label: 'Run your own RTL-to-GDS flow' },
            ]
          : [{ id: 'quick_start', label: 'Quick Start: run the GCD example' }],
      },
    },
  }
}

const wrappers: VueWrapper[] = []
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  removeAgentSessionUi('owner')
  removeAgentSessionUi('other')
  delete window.ecosDesktop
})

async function setup() {
  const pinia = createPinia()
  const shell = useAgentShellStore(pinia)
  const messages = useMessageStore(pinia)
  shell.createTab({ mode: 'home' }, { id: 'owner' })
  shell.createTab({ mode: 'home' }, { id: 'other', activate: false })
  shell.markTabStarted('owner')
  shell.markTabStarted('other')
  messages.setActiveSessionId('owner')
  messages.addMessage('Run Quick Start')
  messages.upsertAgentEvent(guide())
  const answer = deferred<{ canUndo: boolean }>()
  const flow = deferred<QuickStartFlowResult>()
  const listeners = new Set<(event: DesktopAgentEvent) => void>()
  const sendMessage = vi.fn(async () => {
    for (const listener of listeners) listener(guide(true))
    return { sessionId: 'owner' }
  })
  const answerInteraction = vi.fn(() => answer.promise)
  window.ecosDesktop = {
    agent: {
      onEvent: (listener: (event: DesktopAgentEvent) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      getModelSettings: async () => ({ model: 'test', models: [] }),
      answerInteraction,
      sendMessage,
      interrupt: vi.fn(async () => ({})),
    },
  } as unknown as DesktopApi
  const runner = vi.fn<QuickStartRunner>(async (_event, _signal, narrate) => {
    narrate?.('Running CTS: build the clock distribution network.')
    return flow.promise
  })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
  await router.push('/')
  await router.isReady()
  const mountPanel = (mode: 'home' | 'workspace' = 'home') => {
    const wrapper = mount(AIChatPanel, {
      props: { shell: mode },
      global: {
        plugins: [pinia, router],
        provide: { [quickStartRunnerKey]: runner, [agentWorkspaceSetupKey]: vi.fn() },
        stubs: {
          MessageItem: true,
          AgentModelSettingsMenu: true,
          AgentActivityStream: true,
          AgentSessionContractPanels: true,
          AgentCodexSetupCard: true,
        },
      },
    })
    wrappers.push(wrapper)
    return wrapper
  }
  const wrapper = mountPanel()
  await flushPromises()
  await wrapper.get('.interaction-card__option').trigger('click')
  expect(answerInteraction).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionId: 'owner',
      optionId: 'quick_start',
      requestId: 'home-request',
    }),
  )
  return { wrapper, mountPanel, shell, messages, runner, answer, flow, sendMessage }
}

it('defers a delayed Quick Start answer until its owner is active and keeps that owner across remounts', async () => {
  const state = await setup()
  await state.wrapper.findAll('[role="tab"]')[1]!.trigger('click')
  state.answer.resolve({ canUndo: false })
  await flushPromises()
  expect(state.runner).not.toHaveBeenCalled()
  expect(getAgentSessionUi('owner').isRequestPending).toBe(false)
  expect(getAgentSessionUi('owner').pendingGuiAction?.type).toBe('quick_start')
  await state.wrapper.findAll('[role="tab"]')[0]!.trigger('click')
  await flushPromises()
  expect(state.runner).toHaveBeenCalledOnce()
  state.wrapper.unmount()
  const remounted = state.mountPanel('workspace')
  await flushPromises()
  expect(remounted.get('.quick-start-stop').text()).toBe('Stop Quick Start')
  await remounted.findAll('[role="tab"]')[1]!.trigger('click')
  state.flow.resolve({
    workspacePath: '/runs/gcd',
    operationId: 'flow-owner',
    state: 'succeeded',
  })
  await flushPromises()
  expect(state.sendMessage).toHaveBeenCalledWith({
    providerId: 'ecos_agent',
    sessionId: 'owner',
    message: 'quick_start_result:{"workspace":"/runs/gcd","operation_id":"flow-owner"}',
  })
  expect(getAgentSessionUi('other').isQuickStartRunning).toBe(false)
  expect(state.messages.messagesBySessionId.other ?? []).toEqual([])
  await remounted.findAll('[role="tab"]')[0]!.trigger('click')
  expect(remounted.get('.interaction-dock').attributes('open')).toBeDefined()
  expect(remounted.text()).toContain('Optimize the current design')
})

it('does not launch Quick Start when its owner closes before the answer returns', async () => {
  const state = await setup()
  await state.wrapper.findAll('[aria-label="Close chat"]')[0]!.trigger('click')
  await flushPromises()
  expect(state.shell.tabs.map((tab) => tab.id)).toEqual(['other'])
  state.answer.resolve({ canUndo: false })
  await flushPromises()
  expect(state.runner).not.toHaveBeenCalled()
  expect(state.sendMessage).not.toHaveBeenCalled()
  expect(getAgentSessionUi('other').isRequestPending).toBe(false)
})
