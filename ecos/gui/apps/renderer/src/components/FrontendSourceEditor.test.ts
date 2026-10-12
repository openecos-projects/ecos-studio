// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StateEnum } from '@/api/type'
import { frontendSourceLanguageForPath } from './frontendSourceLanguage'

const { runStepApi, getInfoApi, readText } = vi.hoisted(() => ({
  runStepApi: vi.fn(),
  getInfoApi: vi.fn(),
  readText: vi.fn(),
}))
vi.mock('@/api/flow', () => ({ runStepApi, getInfoApi }))
vi.mock('@/utils/projectFiles', () => ({
  readOptionalProjectTextFileTail: readText,
  writeProjectTextFile: vi.fn(),
}))
vi.mock('@/composables/useWorkspace', () => ({
  useWorkspace: () => ({
    currentProject: { value: { path: '/work/demo' } },
    workspaceSession: { value: { workspaceId: 'workspace-demo' } },
    showToast: vi.fn(),
    invalidateWorkspaceResources: vi.fn(),
  }),
}))
vi.mock('@/stores/themeStore', () => ({ useThemeStore: () => ({ isDark: false }) }))
vi.mock('./monacoRuntime', () => ({
  nextMonacoEditorId: () => 1,
  setMonacoTheme: vi.fn(),
  getMonacoRuntime: () => ({
    MarkerSeverity: { Error: 8, Warning: 4 },
    KeyMod: { CtrlCmd: 1 },
    KeyCode: { KeyS: 1 },
    Uri: { from: vi.fn() },
    editor: {
      setModelMarkers: vi.fn(),
      create: () => ({
        addCommand: vi.fn(),
        setModel: vi.fn(),
        dispose: vi.fn(),
        onDidChangeModelContent: () => ({ dispose: vi.fn() }),
      }),
      createModel: () => {
        let content = ''
        return {
          getValue: () => content,
          setValue: (value: string) => {
            content = value
          },
          dispose: vi.fn(),
          getLineCount: () => 1,
          getLineMaxColumn: () => 40,
        }
      },
    },
  }),
}))

import FrontendSourceEditor from './FrontendSourceEditor.vue'
import { useResourceStalenessGuard } from '@/composables/useResourceStalenessGuard'

describe('Lint resource confirmation', () => {
  beforeEach(() => {
    useResourceStalenessGuard().dismiss()
    runStepApi.mockReset().mockResolvedValue({ data: { state: StateEnum.Success } })
    getInfoApi.mockReset().mockResolvedValue({
      response: 'success',
      data: { info: { logs: [{ label: 'Lint log', path: '/work/demo/lint.log' }] } },
    })
    readText.mockReset().mockImplementation(async (path: string) => ({
      content: path.endsWith('.log')
        ? '%Warning-WIDTH: core.sv:1:1: previous diagnostic'
        : 'module core; endmodule',
      truncated: false,
    }))
  })

  it.each([false, true])(
    'restores the previous lint result on refusal and cancellation (previous result: %s)',
    async (previousResult) => {
      const wrapper = mount(FrontendSourceEditor, {
        props: { source: { label: 'core.sv', path: 'core.sv' } },
      })
      await flushPromises()
      const lintButton = wrapper.get('button.text-action')
      await vi.waitFor(() => expect(lintButton.attributes('disabled')).toBeUndefined())
      if (previousResult) {
        await lintButton.trigger('click')
        await flushPromises()
        expect(wrapper.text()).toContain('Lint passed')
        expect(wrapper.text()).toContain('previous diagnostic')
      }
      const beforeConfirmation = wrapper.get('.lint-panel').text()
      runStepApi.mockRejectedValueOnce(
        Object.assign(new Error('stale'), { code: 'RESOURCE_UPDATE_AVAILABLE' }),
      )
      await lintButton.trigger('click')
      await flushPromises()

      expect(useResourceStalenessGuard().pendingRequest.value).not.toBeNull()
      expect(wrapper.get('.lint-panel').text()).toBe(beforeConfirmation)
      useResourceStalenessGuard().dismiss()
      await flushPromises()
      expect(wrapper.text()).not.toContain('Lint running')
      expect(wrapper.get('.lint-panel').text()).toBe(beforeConfirmation)
      wrapper.unmount()
    },
  )
})

describe('frontendSourceLanguageForPath', () => {
  it.each([
    ['rtl/core.v', 'verilog'],
    ['rtl/defs.VH', 'verilog'],
    ['rtl/core.sv', 'systemverilog'],
    ['rtl/defs.SVH', 'systemverilog'],
    ['src/main.c', 'c'],
    ['include/model.h', 'c'],
    ['src/model.CPP', 'cpp'],
    ['include/model.hpp', 'cpp'],
    ['scripts/check.py', 'python'],
    ['scripts/run.sh', 'shell'],
    ['scripts/setup.tcl', 'tcl'],
    ['firmware/start.S', 'ecos-disassembly'],
    ['firmware/trap.asm', 'ecos-disassembly'],
  ])('maps %s to %s', (path, language) => {
    expect(frontendSourceLanguageForPath(path)).toBe(language)
  })

  it('uses plaintext for file lists and unknown paths', () => {
    expect(frontendSourceLanguageForPath('rtl/files.f')).toBe('plaintext')
    expect(frontendSourceLanguageForPath('README')).toBe('plaintext')
  })

  it('ignores URL query and fragment suffixes', () => {
    expect(frontendSourceLanguageForPath('rtl/core.sv?revision=2#L10')).toBe(
      'systemverilog',
    )
  })
})
