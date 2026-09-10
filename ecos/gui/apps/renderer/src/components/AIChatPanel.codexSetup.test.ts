// @vitest-environment happy-dom

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopApi } from '@ecos-studio/shared'
import AIChatPanel from './AIChatPanel.vue'
import AgentCodexSetupCard from './AgentCodexSetupCard.vue'
import { useAgentShellStore } from '@/stores/agentShellStore'
import { useMessageStore } from '@/stores/messageStore'
import { quickStartRunnerKey, type QuickStartRunner } from '@/composables/quickStartUi'
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

const readyStatus = {
  apiKeyConfigured: true,
  authState: 'authenticated' as const,
  binPath: '/usr/bin/codex',
  message: 'GLM API Key 已配置，Codex CLI 已就绪。',
  modelSource: 'glm' as const,
  platformSupportsInstall: true,
  state: 'ready' as const,
  version: 'codex-cli 0.154.0',
}

describe('AIChatPanel codex setup management', () => {
  const wrappers: VueWrapper[] = []

  afterEach(() => {
    for (const wrapper of wrappers) wrapper.unmount()
    wrappers.length = 0
    vi.restoreAllMocks()
    delete window.ecosDesktop
  })

  async function mountPanel(codexApi: Record<string, unknown>) {
    const pinia = createPinia()
    const shell = useAgentShellStore(pinia)
    shell.createTab({ mode: 'home' }, { id: 'owner' })
    shell.markTabStarted('owner')
    const messages = useMessageStore(pinia)
    messages.setActiveSessionId('owner')
    window.ecosDesktop = {
      agent: {
        onEvent: () => () => {},
        getModelSettings: async () => ({
          model: 'glm-5.3',
          displayName: 'GLM-5.3',
          reasoningEffort: 'high',
          models: [],
        }),
        interrupt: vi.fn(async () => ({})),
        codex: codexApi,
      },
    } as unknown as DesktopApi
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    })
    await router.push('/')
    await router.isReady()
    const wrapper = mount(AIChatPanel, {
      props: { shell: 'home' as const },
      global: {
        plugins: [pinia, router],
        provide: {
          [quickStartRunnerKey]: vi.fn() as QuickStartRunner,
          [agentWorkspaceSetupKey]: vi.fn(),
        },
        stubs: {
          MessageItem: true,
          AgentActivityStream: true,
          AgentSessionContractPanels: true,
        },
      },
    })
    wrappers.push(wrapper)
    await flushPromises()
    return wrapper
  }

  it('reopens the setup card from the model menu while ready and swaps keys', async () => {
    const setGlmApiKey = vi.fn(async () => readyStatus)
    const wrapper = await mountPanel({
      getStatus: async () => readyStatus,
      recheck: async () => readyStatus,
      setModelSource: async () => readyStatus,
      setGlmApiKey,
      setOpenAIApiKey: async () => readyStatus,
    })

    expect(wrapper.findComponent(AgentCodexSetupCard).exists()).toBe(false)

    const menu = wrapper.findComponent({ name: 'AgentModelSettingsMenu' })
    expect(menu.exists()).toBe(true)
    await menu.get('.model-settings__trigger').trigger('click')
    await menu.get('.model-settings__configure').trigger('click')
    await flushPromises()

    const card = wrapper.findComponent(AgentCodexSetupCard)
    expect(card.exists()).toBe(true)
    expect(card.props('status')).toMatchObject({ state: 'ready', modelSource: 'glm' })

    await card.find('#codex-setup-glm-key').setValue(' replacement-key ')
    await card.find('form.codex-setup__key-form').trigger('submit')
    expect(setGlmApiKey).toHaveBeenCalledWith({ apiKey: 'replacement-key' })
  })
})
