// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'
import { compileStyle, parse } from 'vue/compiler-sfc'
import WorkspaceWorkbench from './WorkspaceWorkbench.vue'
import workbenchSource from './WorkspaceWorkbench.vue?raw'
import logSource from './FlowLogPanel.vue?raw'
import { useAgentShellStore } from '@/stores/agentShellStore'
import { useWorkspaceInformationPanel } from '@/composables/useWorkspaceInformationPanel'

describe('WorkspaceWorkbench Agent panel', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    useWorkspaceInformationPanel().informationPanelVisible.value = true
  })

  it('preserves the log minimum height and keeps Agent sizing independent of message content', () => {
    const style = document.createElement('style')
    style.textContent = [
      [logSource, 'data-v-log-test', 'FlowLogPanel.vue'],
      [workbenchSource, 'data-v-workbench-test', 'WorkspaceWorkbench.vue'],
    ]
      .map(
        ([source, id, filename]) =>
          compileStyle({
            source: parse(source).descriptor.styles[0].content,
            id,
            filename,
            scoped: true,
          }).code,
      )
      .join('\n')
    const container = document.createElement('div')
    container.innerHTML = `
      <div class="workspace-workbench-right" data-v-workbench-test>
        <section class="flow-log-panel" data-v-workbench-test data-v-log-test></section>
        <div class="workspace-workbench-inspector" data-v-workbench-test></div>
      </div>
    `
    document.head.append(style)
    document.body.append(container)
    try {
      const log = container.querySelector('.flow-log-panel')!
      const inspector = container.querySelector('.workspace-workbench-inspector')!

      expect(getComputedStyle(log).minHeight).toBe('96px')
      expect(getComputedStyle(inspector).flexBasis).toBe('0px')
      log.classList.add('is-collapsed')
      expect(getComputedStyle(log).minHeight).toBe('34px')
      expect(getComputedStyle(log).flexBasis).toBe('34px')
      log.classList.remove('is-collapsed')
      expect(getComputedStyle(log).minHeight).toBe('96px')
    } finally {
      style.remove()
      container.remove()
    }
  })

  it('hides the Agent panel when workspace visibility is turned off', async () => {
    const store = useAgentShellStore()
    store.openWorkspaceAgent()
    const wrapper = mount(WorkspaceWorkbench, {
      props: { flowTitle: 'Flow', nodes: [] },
      global: {
        stubs: {
          Splitter: { template: '<div><slot /></div>' },
          SplitterPanel: { template: '<div><slot /></div>' },
          FlowStatusStrip: {
            template: '<div class="flow-status"><slot name="actions" /></div>',
          },
          FlowRunControl: { template: '<button />' },
          ChatInspectorPanel: { template: '<div class="workspace-agent" />' },
        },
      },
    })

    expect(wrapper.find('.workspace-agent').exists()).toBe(true)
    store.closeWorkspaceAgent()
    await nextTick()

    expect(wrapper.find('.workspace-agent').exists()).toBe(false)
    expect(wrapper.find('.workspace-workbench-inspector').exists()).toBe(false)
  })

  it('removes the right panel in RTL mode when Agent is hidden', async () => {
    const store = useAgentShellStore()
    store.openWorkspaceAgent()
    const wrapper = mount(WorkspaceWorkbench, {
      props: { flowTitle: 'Flow', nodes: [], agentOnly: true },
      slots: {
        'right-log': '<div class="old-log">Old log</div>',
        left: '<div>Dashboard</div>',
      },
      global: {
        stubs: {
          Splitter: { template: '<div><slot /></div>' },
          SplitterPanel: { template: '<div><slot /></div>' },
          FlowStatusStrip: { template: '<div class="flow-status" />' },
          FlowRunControl: true,
          ChatInspectorPanel: {
            props: ['hideGuiArtifacts'],
            template: '<div class="workspace-agent">{{ hideGuiArtifacts }}</div>',
          },
        },
      },
    })
    expect(wrapper.find('.flow-status').exists()).toBe(false)
    expect(wrapper.find('.old-log').exists()).toBe(false)
    expect(wrapper.get('.workspace-agent').text()).toBe('true')
    useWorkspaceInformationPanel().toggleInformationPanel()
    await nextTick()
    expect(wrapper.classes()).toContain('is-information-hidden')
    useWorkspaceInformationPanel().toggleInformationPanel()
    await nextTick()
    expect(wrapper.classes()).not.toContain('is-information-hidden')
    store.closeWorkspaceAgent()
    await nextTick()
    expect(wrapper.find('.workspace-agent').exists()).toBe(false)
    expect(wrapper.classes()).toContain('is-agent-hidden')
    wrapper.unmount()
  })

  it('leaves the shared Frontend workbench unchanged when the RTL information panel is hidden', () => {
    useWorkspaceInformationPanel().informationPanelVisible.value = false
    const wrapper = mount(WorkspaceWorkbench, {
      props: { flowTitle: 'Frontend', nodes: [] },
      global: {
        stubs: {
          Splitter: { template: '<div><slot /></div>' },
          SplitterPanel: { template: '<div><slot /></div>' },
          FlowStatusStrip: true,
          FlowRunControl: true,
          ChatInspectorPanel: true,
        },
      },
    })
    expect(wrapper.classes()).not.toContain('is-information-hidden')
    wrapper.unmount()
  })
})
