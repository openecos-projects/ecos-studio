// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type {
  DesktopCodexDependencyStatus,
  DesktopModelProfile,
} from '@ecos-studio/shared'
import AgentCodexSetupCard from './AgentCodexSetupCard.vue'

const profiles: DesktopModelProfile[] = [
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
]

describe('AgentCodexSetupCard', () => {
  it('offers one-click install when Codex is missing on Linux', async () => {
    const status: DesktopCodexDependencyStatus = {
      authState: 'unknown',
      message: '未检测到 Codex CLI',
      platformSupportsInstall: true,
      state: 'missing',
    }
    const wrapper = mount(AgentCodexSetupCard, { props: { status, profiles } })

    expect(wrapper.text()).toContain('需要 Codex CLI')
    expect(wrapper.text()).toContain('未安装')
    const install = wrapper
      .findAll('button')
      .find((button) => button.text() === '一键安装')
    expect(install).toBeTruthy()
    await install!.trigger('click')
    expect(wrapper.emitted('install')).toHaveLength(1)
  })

  it('offers the key form when the CLI is installed but unauthenticated', () => {
    const status: DesktopCodexDependencyStatus = {
      authState: 'unauthenticated',
      binPath: '/managed/bin/codex',
      message: 'Codex CLI 已就绪。请填入 API Key 后使用 Agent。',
      platformSupportsInstall: true,
      state: 'needs_api_key',
      version: 'codex-cli 0.1.0',
    }
    const wrapper = mount(AgentCodexSetupCard, { props: { status, profiles } })

    expect(wrapper.text()).toContain('待配置')
    expect(wrapper.text()).toContain('/managed/bin/codex')
    expect(wrapper.find('#codex-setup-api-key').exists()).toBe(true)
    expect(wrapper.findAll('button').some((button) => button.text() === '打开登录')).toBe(
      false,
    )
  })

  it('hides install on platforms without one-click support', () => {
    const status: DesktopCodexDependencyStatus = {
      authState: 'unknown',
      platformSupportsInstall: false,
      state: 'missing',
    }
    const wrapper = mount(AgentCodexSetupCard, { props: { status, profiles } })

    expect(wrapper.findAll('button').some((button) => button.text() === '一键安装')).toBe(
      false,
    )
    expect(
      wrapper.findAll('button').some((button) => button.text() === '选择本地 codex'),
    ).toBe(true)
  })

  it('collects the active profile key and hides local bin for managed profiles', async () => {
    const status: DesktopCodexDependencyStatus = {
      activeProfileId: 'glm',
      authState: 'unauthenticated',
      binPath: '/managed/bin/codex',
      message: '已选择 GLM（智谱）。请填入 API Key 后使用 Agent。',
      platformSupportsInstall: true,
      state: 'needs_api_key',
      version: 'codex-cli 0.1.0',
    }
    const wrapper = mount(AgentCodexSetupCard, { props: { status, profiles } })

    expect(wrapper.text()).toContain('待配置')
    expect(
      wrapper.findAll('button').some((button) => button.text() === '选择本地 codex'),
    ).toBe(false)

    const glmButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'GLM（智谱）')
    expect(glmButton).toBeTruthy()
    await glmButton!.trigger('click')
    expect(wrapper.emitted('select-profile')).toEqual([['glm']])

    const input = wrapper.find('#codex-setup-api-key')
    expect(input.exists()).toBe(true)
    await input.setValue(' test-key ')
    const save = wrapper
      .findAll('button')
      .find((button) => button.text() === '保存并使用')
    expect(save).toBeTruthy()
    expect(save!.attributes('disabled')).toBeUndefined()
    await wrapper.find('form.codex-setup__key-form').trigger('submit')
    expect(wrapper.emitted('set-api-key')).toEqual([['glm', 'test-key']])
  })

  it('shows the codex profile as active by default', async () => {
    const status: DesktopCodexDependencyStatus = {
      authState: 'authenticated',
      binPath: '/managed/bin/codex',
      message: 'Codex CLI 已就绪。',
      platformSupportsInstall: true,
      state: 'ready',
      version: 'codex-cli 0.1.0',
    }
    const wrapper = mount(AgentCodexSetupCard, { props: { status, profiles } })

    const codexButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Codex（GPT）')
    expect(codexButton).toBeTruthy()
    await codexButton!.trigger('click')
    expect(wrapper.emitted('select-profile')).toEqual([['codex']])
  })

  it('collects a codex API key and emits it as the primary flow', async () => {
    const status: DesktopCodexDependencyStatus = {
      apiKeyConfigured: false,
      authState: 'unauthenticated',
      binPath: '/managed/bin/codex',
      message: 'Codex CLI 已就绪。请填入 API Key 后使用 Agent。',
      platformSupportsInstall: true,
      state: 'needs_api_key',
      version: 'codex-cli 0.1.0',
    }
    const wrapper = mount(AgentCodexSetupCard, { props: { status, profiles } })

    expect(wrapper.text()).toContain('待配置')

    const input = wrapper.find('#codex-setup-api-key')
    expect(input.attributes('placeholder')).toBe('粘贴 API Key')
    await input.setValue(' sk-test ')
    await wrapper.find('form.codex-setup__key-form').trigger('submit')
    expect(wrapper.emitted('set-api-key')).toEqual([['codex', 'sk-test']])
  })

  it('marks a configured key as replaceable', () => {
    const status: DesktopCodexDependencyStatus = {
      apiKeyConfigured: true,
      authState: 'authenticated',
      binPath: '/managed/bin/codex',
      message: 'Codex（GPT） API Key 已配置，Codex CLI 已就绪。',
      platformSupportsInstall: true,
      state: 'ready',
      version: 'codex-cli 0.1.0',
    }
    const wrapper = mount(AgentCodexSetupCard, { props: { status, profiles } })

    expect(wrapper.find('#codex-setup-api-key').attributes('placeholder')).toContain(
      '已配置（输入可更换）',
    )
  })
})
