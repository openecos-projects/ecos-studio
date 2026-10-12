// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick, reactive, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PrimeVue from 'primevue/config'
import type { ResourceStalenessItem } from '@ecos-studio/shared'

const { pluginStore } = vi.hoisted(() => ({
  pluginStore: {
    resources: [] as { id: string; name: string; type: string }[],
    resourceErrors: {} as Record<string, string>,
    resourceProgress: {} as Record<string, { progress: number }>,
    fetchTools: vi.fn(async () => undefined),
    updateResource: vi.fn(async (_id: string): Promise<void> => undefined),
  },
}))

vi.mock('@/stores/pluginStore', () => ({
  usePluginStore: () => pluginStore,
}))
vi.mock('@/composables/useWorkspace', () => ({
  useWorkspace: () => ({ currentProject, workspaceSession }),
}))
vi.mock('vue-router', () => ({ useRoute: () => route }))

const currentProject = ref({ path: '/work/confirmed' })
const workspaceSession = ref({ sessionId: 'session-confirmed' })
const route = reactive({ fullPath: '/workspace/home' })

import ResourceStalenessDialog from './ResourceStalenessDialog.vue'
import {
  captureResourceStalenessContext,
  confirmStaleResourceRerun,
  useResourceStalenessGuard,
} from '@/composables/useResourceStalenessGuard'

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
    currentProject.value = { path: '/work/confirmed' }
    workspaceSession.value = { sessionId: 'session-confirmed' }
    route.fullPath = '/workspace/home'
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

  it.each(['workspace', 'session', 'route'])(
    'cancels the confirmation synchronously when the %s changes',
    async (context) => {
      const wrapper = mount(ResourceStalenessDialog, {
        global: { plugins: [PrimeVue] },
      })
      const retry = vi.fn(async (_allowStale: boolean) => undefined)
      requestConfirmation([TOOL_ITEM], retry)
      await nextTick()
      const runButton = buttonByText('Run anyway')
      expect(runButton).not.toBeNull()

      if (context === 'workspace') currentProject.value = { path: '/work/other' }
      if (context === 'session') workspaceSession.value = { sessionId: 'session-other' }
      if (context === 'route') route.fullPath = '/workspace/step/place'
      runButton?.click()
      await flushPromises()

      expect(useResourceStalenessGuard().pendingRequest.value).toBeNull()
      expect(retry).not.toHaveBeenCalled()
      wrapper.unmount()
    },
  )

  it('discards a refusal that arrives after the workspace changes', async () => {
    const wrapper = mount(ResourceStalenessDialog, { global: { plugins: [PrimeVue] } })
    const isCurrentContext = captureResourceStalenessContext()
    currentProject.value = { path: '/work/other' }
    const retry = vi.fn(async (_allowStale: boolean) => undefined)
    confirmStaleResourceRerun(
      { code: 'RESOURCE_UPDATE_AVAILABLE' },
      'full flow',
      retry,
      isCurrentContext,
    )
    await useResourceStalenessGuard().runAnyway()
    await nextTick()

    expect(useResourceStalenessGuard().pendingRequest.value).toBeNull()
    expect(retry).not.toHaveBeenCalled()
    expect(buttonByText('Run anyway')).toBeNull()
    wrapper.unmount()
  })

  it.each([false, true])(
    'does not retry after switching workspaces during an update (replacement request: %s)',
    async (replaceRequest) => {
      let completeUpdate!: () => void
      pluginStore.updateResource.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            completeUpdate = resolve
          }),
      )
      const wrapper = mount(ResourceStalenessDialog, {
        global: { plugins: [PrimeVue] },
      })
      const retry = vi.fn(async (_allowStale: boolean) => undefined)
      requestConfirmation([TOOL_ITEM], retry)
      await nextTick()
      buttonByText('Update and run')?.click()
      expect(pluginStore.updateResource).toHaveBeenCalledWith('tool:yosys')

      currentProject.value = { path: '/work/other' }
      const otherRetry = vi.fn(async (_allowStale: boolean) => undefined)
      if (replaceRequest) requestConfirmation([TOOL_ITEM], otherRetry)
      completeUpdate()
      await flushPromises()

      expect(retry).not.toHaveBeenCalled()
      expect(otherRetry).not.toHaveBeenCalled()
      if (replaceRequest) {
        expect(useResourceStalenessGuard().pendingRequest.value?.retry).toBe(otherRetry)
      } else {
        expect(useResourceStalenessGuard().pendingRequest.value).toBeNull()
      }
      wrapper.unmount()
    },
  )

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
  it('requires reconfiguration for a PDK version upgrade instead of retrying an old workspace binding', async () => {
    pluginStore.resources = [
      { id: 'pdk:ics55:managed:1.0.0', name: 'ics55', type: 'pdk' },
    ]
    const wrapper = mount(ResourceStalenessDialog, { global: { plugins: [PrimeVue] } })
    const retry = vi.fn(async (_allowStale: boolean) => undefined)
    requestConfirmation(
      [
        {
          ...PDK_ITEM,
          id: 'pdk:ics55:managed:1.0.0',
          latest_version: '2.0.0',
          update_kind: 'version',
        },
      ],
      retry,
    )
    await nextTick()
    expect(buttonByText('Update and run')?.disabled).toBe(true)
    expect(dialogText()).toContain('PDK version upgrades require a new project binding')
    expect(pluginStore.updateResource).not.toHaveBeenCalled()
    expect(retry).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
