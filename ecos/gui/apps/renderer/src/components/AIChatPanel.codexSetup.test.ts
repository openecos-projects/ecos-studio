// @vitest-environment happy-dom

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  DesktopApi,
  DesktopModelProfile,
  DesktopModelProfileState,
} from '@ecos-studio/shared'
import AIChatPanel from './AIChatPanel.vue'
import AgentProfileManagerDialog from './AgentProfileManagerDialog.vue'
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
      backendRuntimeEvents: ref([]),
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
  activeProfileId: 'glm',
  apiKeyConfigured: true,
  authState: 'authenticated' as const,
  binPath: '/usr/bin/codex',
  message: 'GLM（智谱） API Key 已配置，Codex CLI 已就绪。',
  platformSupportsInstall: true,
  state: 'ready' as const,
  version: 'codex-cli 0.154.0',
}

const profileState: DesktopModelProfileState = {
  activeProfileId: 'glm',
  apiKeyConfigured: { codex: false, glm: true },
  profiles: [
    {
      id: 'codex',
      name: 'Codex（GPT）',
      baseUrl: null,
      wireApi: 'responses',
      envKey: 'OPENAI_API_KEY',
      models: [],
      defaultModel: '',
      builtIn: true,
    },
    {
      id: 'glm',
      name: 'GLM（智谱）',
      baseUrl: 'https://open.bigmodel.cn/api/v1',
      wireApi: 'responses',
      envKey: 'ZAI_API_KEY',
      models: [
        { slug: 'glm-5.3', displayName: 'GLM-5.3', contextWindow: 1_000_000 },
        { slug: 'glm-5.3-flash', displayName: 'GLM-5.3-Flash', contextWindow: 200_000 },
      ],
      defaultModel: 'glm-5.3-flash',
      builtIn: true,
    },
  ],
}

describe('AIChatPanel profile management', () => {
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

  it('opens the profile manager from the model menu and swaps keys', async () => {
    const setProfileApiKey = vi.fn(async () => ({
      ...profileState,
      apiKeyConfigured: { codex: false, glm: true },
    }))
    const wrapper = await mountPanel({
      getStatus: async () => readyStatus,
      recheck: async () => readyStatus,
      listProfiles: async () => profileState,
      selectProfile: async () => profileState,
      setProfileApiKey,
    })

    const menu = wrapper.findComponent({ name: 'AgentModelSettingsMenu' })
    expect(menu.exists()).toBe(true)
    await menu.get('.model-settings__trigger').trigger('click')
    await menu.get('.model-settings__configure').trigger('click')
    await flushPromises()

    const dialog = wrapper.findComponent(AgentProfileManagerDialog)
    expect(dialog.exists()).toBe(true)
    expect(dialog.props('open')).toBe(true)

    dialog.vm.$emit('set-api-key', 'glm', 'replacement-key')
    await flushPromises()
    expect(setProfileApiKey).toHaveBeenCalledWith({
      profileId: 'glm',
      apiKey: 'replacement-key',
    })
  })

  it('waits for a new profile to be saved before setting its key', async () => {
    let finishSave!: (state: DesktopModelProfileState) => void
    const upsertProfile = vi.fn(
      () =>
        new Promise<DesktopModelProfileState>((resolve) => {
          finishSave = resolve
        }),
    )
    const setProfileApiKey = vi.fn(async () => profileState)
    const wrapper = await mountPanel({
      recheck: async () => readyStatus,
      listProfiles: async () => profileState,
      upsertProfile,
      setProfileApiKey,
    })
    const profile = { ...profileState.profiles[1]!, id: 'new-profile', builtIn: false }
    wrapper.findComponent(AgentProfileManagerDialog).vm.$emit('save', profile, 'new-key')
    await flushPromises()
    expect(upsertProfile).toHaveBeenCalledWith({ profile })
    expect(setProfileApiKey).not.toHaveBeenCalled()
    finishSave({ ...profileState, profiles: [...profileState.profiles, profile] })
    await flushPromises()
    expect(setProfileApiKey).toHaveBeenCalledWith({
      profileId: 'new-profile',
      apiKey: 'new-key',
    })
  })

  it('shows save failures inside the manager and does not save the key', async () => {
    const setProfileApiKey = vi.fn()
    const wrapper = await mountPanel({
      recheck: async () => readyStatus,
      listProfiles: async () => profileState,
      upsertProfile: async () => {
        throw new Error('Invalid endpoint')
      },
      setProfileApiKey,
    })
    const dialog = wrapper.findComponent(AgentProfileManagerDialog)
    dialog.vm.$emit('save', profileState.profiles[1] as DesktopModelProfile, 'new-key')
    await flushPromises()
    expect(dialog.props('error')).toContain('Invalid endpoint')
    expect(setProfileApiKey).not.toHaveBeenCalled()
  })
})
