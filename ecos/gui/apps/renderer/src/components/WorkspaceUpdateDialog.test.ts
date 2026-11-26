// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import WorkspaceUpdateDialog from './WorkspaceUpdateDialog.vue'

const { snapshot, apply } = vi.hoisted(() => ({ snapshot: vi.fn(), apply: vi.fn() }))
vi.mock('@/api/workspaceResources', () => ({ getWorkspaceRuntimeSnapshotApi: snapshot }))
vi.mock('@/api/workspace', () => ({ updateWorkspaceConfigurationApi: apply }))
vi.mock('@/composables/useFlowRunner', () => ({
  isFlowExecutionActiveForWorkspace: () => false,
}))
vi.mock('@/composables/useWorkspaceLifecycle', () => ({
  useWorkspaceLifecycle: () => ({
    isCurrentSession: () => true,
    updateWorkspaceRevision: vi.fn(),
    invalidate: vi.fn(),
  }),
}))

it('preserves frozen timing and step overrides and saves just the changed workspace parameter', async () => {
  snapshot.mockResolvedValue({
    engineeringSnapshot: { workspaceRevision: 9 },
    parameters: { sdc: { primary_clocks: 'create_clock -period 10 [get_ports clk]' } },
    configuration: {
      workspaceSpec: {
        parameters: {
          'design.frequency_mhz': 100,
          'floorplan.core_util': 0.3,
          'placement:place.target_density': 0.2,
        },
      },
    },
  })
  apply.mockResolvedValue({ workspaceRevision: 10 })
  const wrapper = mount(WorkspaceUpdateDialog, {
    props: { handle: 'h', directory: '/project/ws_0001', sessionId: 's' },
    global: {
      stubs: {
        Dialog: { template: '<div><slot/></div>' },
        StepConfigValueBlock: {
          props: ['modelValue'],
          emits: ['update:modelValue'],
          template: `<input :value="modelValue" @input="$emit('update:modelValue', Number($event.target.value))"/>`,
        },
      },
    },
  })
  await flushPromises()
  expect(wrapper.text()).toContain('100 MHz')
  expect(wrapper.find('input').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('placement:place.target_density')
  const save = wrapper.get('button:last-child')
  expect(save.element.hasAttribute('disabled')).toBe(true)
  await wrapper.get('select').setValue('floorplan.core_util')
  await wrapper.get('input').setValue('0.35')
  await save.trigger('click')
  await flushPromises()
  expect(apply).toHaveBeenCalledExactlyOnceWith({
    workspaceHandle: 'h',
    expectedWorkspaceRevision: 9,
    commandId: expect.any(String),
    configuration: { design: {}, pdk: {}, parameters: { 'floorplan.core_util': 0.35 } },
  })
  expect(wrapper.emitted('saved')).toHaveLength(1)
})
