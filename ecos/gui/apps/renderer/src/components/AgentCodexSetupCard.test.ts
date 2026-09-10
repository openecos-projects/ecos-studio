// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { DesktopCodexDependencyStatus } from '@ecos-studio/shared'
import AgentCodexSetupCard from './AgentCodexSetupCard.vue'

describe('AgentCodexSetupCard', () => {
  it('offers one-click install when Codex is missing on Linux', async () => {
    const status: DesktopCodexDependencyStatus = {
      authState: 'unknown',
      message: '未检测到 Codex CLI',
      platformSupportsInstall: true,
      state: 'missing',
    }
    const wrapper = mount(AgentCodexSetupCard, { props: { status } })

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
    const wrapper = mount(AgentCodexSetupCard, { props: { status } })

    expect(wrapper.text()).toContain('待配置')
    expect(wrapper.text()).toContain('/managed/bin/codex')
    expect(wrapper.find('#codex-setup-openai-key').exists()).toBe(true)
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
    const wrapper = mount(AgentCodexSetupCard, { props: { status } })

    expect(wrapper.findAll('button').some((button) => button.text() === '一键安装')).toBe(
      false,
    )
    expect(
      wrapper.findAll('button').some((button) => button.text() === '选择本地 codex'),
    ).toBe(true)
  })

  it('shows the GLM key form instead of login when GLM source is selected', async () => {
    const status: DesktopCodexDependencyStatus = {
      authState: 'unauthenticated',
      binPath: '/managed/bin/codex',
      message: '已选择 GLM 模型来源',
      modelSource: 'glm',
      platformSupportsInstall: true,
      state: 'needs_api_key',
      version: 'codex-cli 0.1.0',
    }
    const wrapper = mount(AgentCodexSetupCard, { props: { status } })

    expect(wrapper.text()).toContain('待配置')
    expect(wrapper.findAll('button').some((button) => button.text() === '打开登录')).toBe(
      false,
    )
    expect(
      wrapper.findAll('button').some((button) => button.text() === '我已完成登录'),
    ).toBe(false)
    expect(
      wrapper.findAll('button').some((button) => button.text() === '选择本地 codex'),
    ).toBe(false)

    const sourceButtons = wrapper
      .findAll('button')
      .filter((button) => button.text().startsWith('GLM API'))
    expect(sourceButtons).toHaveLength(1)
    await sourceButtons[0]!.trigger('click')
    expect(wrapper.emitted('set-source')).toEqual([[{ source: 'glm' }]])

    const input = wrapper.find('#codex-setup-glm-key')
    expect(input.exists()).toBe(true)
    await input.setValue(' test-key ')
    const save = wrapper
      .findAll('button')
      .find((button) => button.text() === '保存并使用 GLM')
    expect(save).toBeTruthy()
    expect(save!.attributes('disabled')).toBeUndefined()
    await wrapper.find('form.codex-setup__key-form').trigger('submit')
    expect(wrapper.emitted('set-glm-key')).toEqual([['test-key']])
  })

  it('shows the codex source as active by default', async () => {
    const status: DesktopCodexDependencyStatus = {
      authState: 'authenticated',
      binPath: '/managed/bin/codex',
      message: 'Codex CLI 已就绪。',
      platformSupportsInstall: true,
      state: 'ready',
      version: 'codex-cli 0.1.0',
    }
    const wrapper = mount(AgentCodexSetupCard, { props: { status } })

    expect(wrapper.text()).not.toContain('智谱 API Key')
    const codexButton = wrapper
      .findAll('button')
      .find((button) => button.text().startsWith('Codex API'))
    expect(codexButton).toBeTruthy()
    await codexButton!.trigger('click')
    expect(wrapper.emitted('set-source')).toEqual([[{ source: 'codex' }]])
  })

  it('collects a codex API key and emits it as the primary flow', async () => {
    const status: DesktopCodexDependencyStatus = {
      apiKeyConfigured: false,
      authState: 'unauthenticated',
      binPath: '/managed/bin/codex',
      message: 'Codex CLI 已就绪。请填入 API Key 后使用 Agent。',
      modelSource: 'codex',
      platformSupportsInstall: true,
      state: 'needs_api_key',
      version: 'codex-cli 0.1.0',
    }
    const wrapper = mount(AgentCodexSetupCard, { props: { status } })

    expect(wrapper.text()).toContain('待配置')

    const input = wrapper.find('#codex-setup-openai-key')
    expect(input.attributes('placeholder')).toBe('粘贴 API Key')
    await input.setValue(' sk-test ')
    await wrapper.find('form.codex-setup__key-form').trigger('submit')
    expect(wrapper.emitted('set-openai-key')).toEqual([['sk-test']])
  })

  it('marks a configured key as replaceable', () => {
    const status: DesktopCodexDependencyStatus = {
      apiKeyConfigured: true,
      authState: 'authenticated',
      binPath: '/managed/bin/codex',
      message: 'Codex API Key 已配置，Codex CLI 已就绪。',
      modelSource: 'codex',
      platformSupportsInstall: true,
      state: 'ready',
      version: 'codex-cli 0.1.0',
    }
    const wrapper = mount(AgentCodexSetupCard, { props: { status } })

    expect(wrapper.find('#codex-setup-openai-key').attributes('placeholder')).toContain(
      '已配置（输入可更换）',
    )
  })
})
