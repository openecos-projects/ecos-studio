// @vitest-environment happy-dom
import { DOMWrapper, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import type { DesktopModelProfileState } from '@ecos-studio/shared'
import AgentProfileManagerDialog from './AgentProfileManagerDialog.vue'

const state: DesktopModelProfileState = {
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

describe('AgentProfileManagerDialog', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('edits and saves built-in fields with the selected default model', async () => {
    const wrapper = mount(AgentProfileManagerDialog, {
      props: { open: true, state },
      attachTo: document.body,
    })
    const body = new DOMWrapper(document.body)

    expect(body.text()).toContain('GLM（智谱）')
    expect(body.text()).toContain('使用中')
    const nameInput = body.find<HTMLInputElement>('.profile-manager__form input')
    expect(nameInput.element.value).toBe('GLM（智谱）')
    expect(nameInput.element.disabled).toBe(false)
    await nameInput.setValue('My GLM')
    const defaultModel = body.find<HTMLSelectElement>('select[aria-label="默认模型"]')
    expect(defaultModel.element.disabled).toBe(false)
    await defaultModel.setValue('glm-5.3')
    await body.find('form').trigger('submit')
    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({
      id: 'glm',
      name: 'My GLM',
      defaultModel: 'glm-5.3',
      builtIn: true,
    })
    wrapper.unmount()
  })

  it('repairs the default after a model is renamed or removed', async () => {
    const wrapper = mount(AgentProfileManagerDialog, {
      props: { open: true, state },
      attachTo: document.body,
    })
    const body = new DOMWrapper(document.body)
    const inputs = body.findAll('.profile-manager__model-row input')
    await inputs[3]!.setValue('glm-new')
    await body.find('form').trigger('submit')
    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({
      defaultModel: 'glm-5.3',
    })
    await body.find('.profile-manager__model-remove').trigger('click')
    await body.find('form').trigger('submit')
    expect(wrapper.emitted('save')?.[1]?.[0]).toMatchObject({
      defaultModel: 'glm-new',
    })
    wrapper.unmount()
  })

  it('restores built-in defaults and refreshes the draft without exposing the key', async () => {
    const wrapper = mount(AgentProfileManagerDialog, {
      props: { open: true, state },
      attachTo: document.body,
    })
    const body = new DOMWrapper(document.body)
    await body.find('input[type="password"]').setValue('replacement-key')
    await body.find('[aria-label="恢复默认配置"]').trigger('click')
    expect(wrapper.emitted('delete')).toEqual([['glm']])
    const reset = {
      ...state,
      profiles: state.profiles.map((profile) =>
        profile.id === 'glm' ? { ...profile, name: 'Restored GLM' } : profile,
      ),
    }
    await wrapper.setProps({ state: reset })
    expect(body.find<HTMLInputElement>('form input').element.value).toBe('Restored GLM')
    expect(body.find<HTMLInputElement>('input[type="password"]').element.value).toBe('')
    wrapper.unmount()
  })

  it('uses existing Codex configuration unless a managed endpoint is selected', async () => {
    const wrapper = mount(AgentProfileManagerDialog, {
      props: { open: true, state: { ...state, activeProfileId: 'codex' } },
      attachTo: document.body,
    })
    const body = new DOMWrapper(document.body)
    expect(body.find('.profile-manager__models').exists()).toBe(false)
    await body.find('form').trigger('submit')
    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({
      id: 'codex',
      baseUrl: null,
      models: [],
      defaultModel: '',
    })
    await body.find('input[type="checkbox"]').setValue(false)
    expect(
      body.find<HTMLInputElement>('input[aria-label="Base URL"]').element.value,
    ).toBe('https://api.openai.com/v1')
    expect(body.find('.profile-manager__models').exists()).toBe(true)
    wrapper.unmount()
  })

  it('submits a new profile and key as one ordered save action', async () => {
    const wrapper = mount(AgentProfileManagerDialog, {
      props: { open: true, state },
      attachTo: document.body,
    })
    const body = new DOMWrapper(document.body)
    await body.find('.profile-manager__item--add').trigger('click')
    await body.find('input[type="password"]').setValue(' new-key ')
    await body.find('form').trigger('submit')
    expect(wrapper.emitted('save')?.[0]?.[1]).toBe('new-key')
    expect(wrapper.emitted('set-api-key')).toBeUndefined()
    expect(body.find<HTMLInputElement>('input[type="password"]').element.value).toBe(
      ' new-key ',
    )
    expect(
      body.find('.profile-manager__action--key').attributes('disabled'),
    ).toBeDefined()
    wrapper.unmount()
  })

  it('creates and saves a custom profile draft', async () => {
    const wrapper = mount(AgentProfileManagerDialog, {
      props: { open: true, state },
      attachTo: document.body,
    })
    const body = new DOMWrapper(document.body)

    const addButton = body
      .findAll('button')
      .find((button) => button.text().includes('新增配置'))
    await addButton!.trigger('click')

    const inputs = body.findAll('.profile-manager__form input')
    await inputs[0]!.setValue('Kimi')
    await inputs[1]!.setValue('https://api.moonshot.cn/v1')
    await inputs[2]!.setValue('MOONSHOT_API_KEY')
    const modelInputs = body.findAll('.profile-manager__model-row input')
    await modelInputs[0]!.setValue('kimi-k2')
    await modelInputs[1]!.setValue('Kimi K2')

    await body.find('form.profile-manager__form').trigger('submit')
    const saved = wrapper.emitted('save')?.[0]?.[0] as {
      name: string
      baseUrl: string
      defaultModel: string
      builtIn: boolean
    }
    expect(saved).toMatchObject({
      name: 'Kimi',
      baseUrl: 'https://api.moonshot.cn/v1',
      defaultModel: 'kimi-k2',
      builtIn: false,
    })
    wrapper.unmount()
  })
})
