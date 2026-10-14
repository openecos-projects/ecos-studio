// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RtlImportStep from './RtlImportStep.vue'

const apiMocks = vi.hoisted(() => ({
  pickRtlSources: vi.fn(),
  pickDirectory: vi.fn(),
  pickFiles: vi.fn(),
  scanRtlDirectory: vi.fn(),
}))

vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({
    dialog: {
      pickRtlSources: apiMocks.pickRtlSources,
      pickDirectory: apiMocks.pickDirectory,
      pickFiles: apiMocks.pickFiles,
    },
    workspace: { scanRtlDirectory: apiMocks.scanRtlDirectory },
  }),
}))

const stubs = { DesignFileTransfer: true }

function lastSelection(wrapper: ReturnType<typeof mount>) {
  const updates = wrapper.emitted('update:selection')
  if (!updates?.length) throw new Error('no update:selection event was emitted')
  return updates[updates.length - 1][0]
}

describe('RtlImportStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('seeds the pending Verilog selection from props and emits deduplicated updates', async () => {
    const wrapper = mount(RtlImportStep, {
      props: { verilog: ['/rtl/a.v', '/rtl/a.v', '/rtl/b.v'], filelist: '' },
      global: { stubs },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('/rtl/a.v')
    expect(wrapper.text()).toContain('/rtl/b.v')
  })

  it('adds dialog-picked RTL files and clears a pending filelist (exclusive)', async () => {
    const wrapper = mount(RtlImportStep, {
      props: { verilog: [], filelist: '/rtl/sources.f' },
      global: { stubs },
    })
    apiMocks.pickRtlSources.mockResolvedValueOnce({
      directories: [],
      files: ['/rtl/picked.v'],
    })
    const picker = wrapper.vm as unknown as { browseRtlFiles(): Promise<void> }
    await picker.browseRtlFiles()
    await flushPromises()

    const updates = wrapper.emitted('update:selection')
    expect(updates).toBeTruthy()
    expect(updates![updates!.length - 1][0]).toEqual({
      verilog: ['/rtl/picked.v'],
      filelist: '',
    })
  })

  it('emits an exclusive filelist selection and resets scanned state', async () => {
    const wrapper = mount(RtlImportStep, {
      props: { verilog: ['/rtl/a.v'], filelist: '' },
      global: { stubs },
    })
    apiMocks.pickFiles.mockResolvedValueOnce(['/rtl/design/files.f'])
    const picker = wrapper.vm as unknown as { pickFilelist(): Promise<void> }
    await picker.pickFilelist()
    await flushPromises()

    expect(lastSelection(wrapper)).toEqual({
      verilog: [],
      filelist: '/rtl/design/files.f',
    })
  })

  it('rejects dialog files that are not HDL sources', async () => {
    const wrapper = mount(RtlImportStep, {
      props: { verilog: [], filelist: '' },
      global: { stubs },
    })
    apiMocks.pickRtlSources.mockResolvedValueOnce({
      directories: [],
      files: ['/rtl/readme.txt'],
    })
    const picker = wrapper.vm as unknown as {
      browseRtlFiles(): Promise<void>
      manualFilePickError: string
    }
    await picker.browseRtlFiles()
    await flushPromises()
    expect(wrapper.emitted('update:selection')).toBeUndefined()
    expect(picker.manualFilePickError).toContain('RTL design files')
  })

  it('scans a selected folder and emits its files as the selection', async () => {
    const wrapper = mount(RtlImportStep, {
      props: { verilog: [], filelist: '' },
      global: { stubs },
    })
    apiMocks.pickDirectory.mockResolvedValueOnce('/rtl/design')
    apiMocks.scanRtlDirectory.mockResolvedValueOnce({
      rootPath: '/rtl/design',
      files: ['/rtl/design/top.v', '/rtl/design/child.sv'],
    })
    const picker = wrapper.vm as unknown as { browseRtlFolder(): Promise<void> }
    await picker.browseRtlFolder()
    await flushPromises()

    expect(apiMocks.scanRtlDirectory).toHaveBeenCalledWith('/rtl/design')
    expect(lastSelection(wrapper)).toEqual({
      verilog: ['/rtl/design/top.v', '/rtl/design/child.sv'],
      filelist: '',
    })
  })

  it('classifies a manually entered path on input', async () => {
    const wrapper = mount(RtlImportStep, {
      props: { verilog: [], filelist: '', showManualPath: true },
      global: { stubs },
    })
    const input = wrapper.find('input[name="rtl-source-path"]')
    expect(input.exists()).toBe(true)
    await input.setValue('/rtl/design/cpu.f')
    await flushPromises()
    expect(lastSelection(wrapper)).toEqual({
      verilog: [],
      filelist: '/rtl/design/cpu.f',
    })

    await input.setValue('/rtl/design/top.v')
    await flushPromises()
    expect(lastSelection(wrapper)).toEqual({
      verilog: ['/rtl/design/top.v'],
      filelist: '',
    })
  })

  it('shows the imported project source for reuse', () => {
    const wrapper = mount(RtlImportStep, {
      props: {
        verilog: [],
        filelist: '',
        importedSource: { rtlList: ['/projects/gcd/rtl/gcd.v'], filelist: '' },
      },
      global: { stubs },
    })
    expect(wrapper.text()).toContain('Imported in this project')
    expect(wrapper.text()).toContain('/projects/gcd/rtl/gcd.v')
  })
})
