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

    expect(
      wrapper.findAll('button').some((button) => button.text() === '一键安装'),
    ).toBe(false)
    expect(
      wrapper.findAll('button').some((button) => button.text() === '选择本地 codex'),
    ).toBe(true)
  })
})
