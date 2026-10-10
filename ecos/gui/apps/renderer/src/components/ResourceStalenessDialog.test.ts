// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PrimeVue from 'primevue/config'
import type { ResourceStalenessItem } from '@ecos-studio/shared'

const { pluginStore } = vi.hoisted(() => ({
  pluginStore: {
    resources: [] as { id: string; name: string; type: string }[],
    resourceErrors: {} as Record<string, string>,
    resourceProgress: {} as Record<string, { progress: number }>,
    fetchTools: vi.fn(async () => undefined),
    updateResource: vi.fn(async (_id: string) => undefined),
  },
}))

vi.mock('@/stores/pluginStore', () => ({
  usePluginStore: () => pluginStore,
}))

import ResourceStalenessDialog from './ResourceStalenessDialog.vue'
import { useResourceStalenessGuard } from '@/composables/useResourceStalenessGuard'

const TOOL_ITEM: ResourceStalenessItem = {
  id: 'tool:yosys',
  display_name: 'Yosys',
  installed_version: '0.61',
  latest_version: '0.62',
  update_kind: 'version',
}

const PDK_ITEM: ResourceStalenessItem = {
  id: 'pdk-install-1',
  display_name: 'ICS55 PDK',
  installed_version: '1.0.0',
  latest_version: '1.0.0',
  update_kind: 'rebuild',
}

function dialogRoot(): HTMLElement | null {
  return document.body.querySelector('.resource-staleness-dialog')
}

function dialogText(): string {
  return dialogRoot()?.textContent ?? ''
}

function buttonByText(text: string): HTMLButtonElement | null {
  const buttons = dialogRoot()?.querySelectorAll<HTMLButtonElement>('button') ?? []
  return Array.from(buttons).find((button) => button.textContent?.includes(text)) ?? null
}

function requestConfirmation(
  resources: ResourceStalenessItem[],
  retry: (allowStale: boolean) => Promise<void> = async () => undefined,
): void {
  useResourceStalenessGuard().requestStalenessConfirmation({
    resources,
    runLabel: 'full flow',
    retry,
  })
}

describe('ResourceStalenessDialog', () => {
  beforeEach(() => {
    pluginStore.resources = []
    pluginStore.resourceErrors = {}
    pluginStore.resourceProgress = {}
    pluginStore.fetchTools.mockClear()
    pluginStore.updateResource.mockClear()
    pluginStore.updateResource.mockImplementation(async () => undefined)
    useResourceStalenessGuard().dismiss()
  })

  it('stays hidden without a pending request', async () => {
    const wrapper = mount(ResourceStalenessDialog, {
      global: { plugins: [PrimeVue] },
    })
    await nextTick()
    expect(dialogRoot()).toBeNull()
    wrapper.unmount()
  })

  it('lists the stale resources with versions and update kinds', async () => {
    const wrapper = mount(ResourceStalenessDialog, {
      global: { plugins: [PrimeVue] },
    })
    requestConfirmation([
      TOOL_ITEM,
      PDK_ITEM,
      { ...TOOL_ITEM, id: 'mpc:gf180', display_name: 'GF180 MPC', update_kind: null },
    ])
    await nextTick()

    expect(dialogText()).toContain('Resource Updates Available')
    expect(dialogText()).toContain('Yosys')
    expect(dialogText()).toContain('0.61')
    expect(dialogText()).toContain('0.62')
    expect(dialogText()).toContain('new version')
    expect(dialogText()).toContain('ICS55 PDK')
    expect(dialogText()).toContain('republished (same version)')
    expect(dialogText()).toContain('GF180 MPC')
    expect(dialogText()).toContain('update available')
    wrapper.unmount()
  })

  it('dismisses on Cancel', async () => {
    const wrapper = mount(ResourceStalenessDialog, {
      global: { plugins: [PrimeVue] },
    })
    requestConfirmation([TOOL_ITEM])
    await nextTick()

    buttonByText('Cancel')?.click()
    await nextTick()

    expect(useResourceStalenessGuard().pendingRequest.value).toBeNull()
    wrapper.unmount()
  })

  it('runs anyway with the stale resources after confirmation', async () => {
    const wrapper = mount(ResourceStalenessDialog, {
      global: { plugins: [PrimeVue] },
    })
    const retry = vi.fn(async (_allowStale: boolean) => undefined)
    requestConfirmation([TOOL_ITEM], retry)
    await nextTick()

    buttonByText('Run anyway')?.click()
    await flushPromises()

    expect(retry).toHaveBeenCalledWith(true)
    expect(pluginStore.updateResource).not.toHaveBeenCalled()
    expect(useResourceStalenessGuard().pendingRequest.value).toBeNull()
    wrapper.unmount()
  })

  it('updates every resource and then retries the run', async () => {
    pluginStore.resources = [{ id: 'pdk-install-1', name: 'ics55', type: 'pdk' }]
    const wrapper = mount(ResourceStalenessDialog, {
      global: { plugins: [PrimeVue] },
    })
    const retry = vi.fn(async (_allowStale: boolean) => undefined)
    requestConfirmation([TOOL_ITEM, PDK_ITEM], retry)
    await nextTick()

    buttonByText('Update and run')?.click()
    await flushPromises()

    expect(pluginStore.updateResource).toHaveBeenCalledWith('tool:yosys')
    expect(pluginStore.updateResource).toHaveBeenCalledWith('pdk:ics55')
    expect(pluginStore.fetchTools).toHaveBeenCalledWith({ silent: true })
    expect(retry).toHaveBeenCalledWith(false)
    expect(useResourceStalenessGuard().pendingRequest.value).toBeNull()
    wrapper.unmount()
  })

  it('keeps the dialog open with an inline error when an update fails', async () => {
    const wrapper = mount(ResourceStalenessDialog, {
      global: { plugins: [PrimeVue] },
    })
    const retry = vi.fn(async (_allowStale: boolean) => undefined)
    pluginStore.updateResource.mockImplementation(async (id: string) => {
      pluginStore.resourceErrors[id] = 'download failed'
    })
    requestConfirmation([TOOL_ITEM], retry)
    await nextTick()

    buttonByText('Update and run')?.click()
    await flushPromises()

    expect(retry).not.toHaveBeenCalled()
    expect(dialogText()).toContain('download failed')
    expect(useResourceStalenessGuard().pendingRequest.value).not.toBeNull()
    wrapper.unmount()
  })

  it('disables Update and run when a resource has no updatable id', async () => {
    const wrapper = mount(ResourceStalenessDialog, {
      global: { plugins: [PrimeVue] },
    })
    requestConfirmation([PDK_ITEM])
    await nextTick()

    const updateButton = buttonByText('Update and run')
    expect(updateButton?.disabled).toBe(true)
    expect(dialogText()).toContain(
      'Some resources can only be updated from Resource Manager.',
    )
    wrapper.unmount()
  })
})
