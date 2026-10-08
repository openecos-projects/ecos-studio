// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils'
import { computed, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({
  pickFiles: vi.fn(),
  importMacroLocationFile: vi.fn(),
  readOptionalProjectTextFile: vi.fn(),
}))

vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({
    dialog: { pickFiles: testState.pickFiles },
    workspace: { importMacroLocationFile: testState.importMacroLocationFile },
  }),
}))

vi.mock('@/utils/projectFiles', () => ({
  readOptionalProjectTextFile: testState.readOptionalProjectTextFile,
}))

vi.mock('@/composables/useWorkspaceLifecycle', () => ({
  useWorkspaceLifecycle: () => ({
    currentSessionId: computed(() => 'session-1'),
    session: ref({
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      projectRoot: '/work/gcd/ws_0001',
      state: 'active',
      resourceVersions: { 'step-config': 0 },
    }),
    resourceVersions: ref({ 'step-config': 0 }),
    isCurrentSession: () => true,
    runForSession: async (_sessionId: string, operation: () => unknown) =>
      await operation(),
  }),
}))

import MacroLocationFilePanel from './MacroLocationFilePanel.vue'

describe('MacroLocationFilePanel', () => {
  it('reads the fixed target and refreshes after replacing it', async () => {
    testState.readOptionalProjectTextFile
      .mockReset()
      .mockResolvedValueOnce('placeInstance OLD 1 2 R0\n')
      .mockResolvedValueOnce('placeInstance NEW 3 4 R90\n')
    testState.pickFiles.mockReset().mockResolvedValue(['/tmp/custom.tcl'])
    testState.importMacroLocationFile.mockReset().mockResolvedValue(undefined)

    const wrapper = mount(MacroLocationFilePanel, {
      global: {
        stubs: {
          Textarea: {
            props: ['modelValue'],
            template: '<textarea :value="modelValue" />',
          },
        },
      },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('config/macro_location.tcl')
    expect(wrapper.find('textarea').element.value).toBe('placeInstance OLD 1 2 R0\n')

    await wrapper.get('button').trigger('click')
    await flushPromises()
    await nextTick()

    expect(testState.importMacroLocationFile).toHaveBeenCalledWith('/tmp/custom.tcl')
    expect(wrapper.find('textarea').element.value).toBe('placeInstance NEW 3 4 R90\n')
  })
})
