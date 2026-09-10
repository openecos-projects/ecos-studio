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

  it('offers login when the CLI is installed but unauthenticated', async () => {
    const status: DesktopCodexDependencyStatus = {
      authState: 'unauthenticated',
      binPath: '/managed/bin/codex',
      message: '尚未登录',
      platformSupportsInstall: true,
      state: 'installed_needs_login',
      version: 'codex-cli 0.1.0',
    }
    const wrapper = mount(AgentCodexSetupCard, { props: { status } })

    expect(wrapper.text()).toContain('待登录')
    expect(wrapper.text()).toContain('/managed/bin/codex')
    const login = wrapper.findAll('button').find((button) => button.text() === '打开登录')
    expect(login).toBeTruthy()
    await login!.trigger('click')
    expect(wrapper.emitted('login')).toHaveLength(1)
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
      state: 'installed_needs_login',
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

  it('shows the codex source as active by default and keeps the login flow', async () => {
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
      .find((button) => button.text().startsWith('Codex 账号'))
    expect(codexButton).toBeTruthy()
    await codexButton!.trigger('click')
    expect(wrapper.emitted('set-source')).toEqual([[{ source: 'codex' }]])
  })
})
