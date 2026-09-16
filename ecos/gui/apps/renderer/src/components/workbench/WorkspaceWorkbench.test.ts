// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'
import WorkspaceWorkbench from './WorkspaceWorkbench.vue'
import { useAgentShellStore } from '@/stores/agentShellStore'

describe('WorkspaceWorkbench Agent panel', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('collapses the Agent panel and gives the log the remaining height', async () => {
    const store = useAgentShellStore()
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
    store.setWorkspaceAgentCollapsed(true)
    await nextTick()

    expect(wrapper.find('.workspace-agent').exists()).toBe(true)
    expect(wrapper.get('.workspace-workbench-inspector').attributes('style')).toContain(
      'display: none',
    )
    const toggle = wrapper.get('button.workspace-workbench-agent-toggle')
    expect(toggle.attributes('aria-label')).toBe('Expand Agent panel')
    await toggle.trigger('click')
    await nextTick()
    expect(store.workspaceAgentCollapsed).toBe(false)
    expect(wrapper.get('.workspace-workbench-inspector').isVisible()).toBe(true)
  })
})
