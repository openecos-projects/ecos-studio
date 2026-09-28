// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PrimeVue from 'primevue/config'

const { deleteEngineeringSnapshotMock, toastAddMock } = vi.hoisted(() => ({
  deleteEngineeringSnapshotMock: vi.fn(),
  toastAddMock: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({
    isReady: vi.fn(async () => undefined),
    currentRoute: { value: { path: '/' } },
  }),
}))

vi.mock('primevue/usetoast', () => ({
  useToast: () => ({ add: toastAddMock }),
}))

vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({
    workspace: { deleteEngineeringSnapshot: deleteEngineeringSnapshotMock },
  }),
}))

import WorkspaceSnapshotRecoveryDialog from './WorkspaceSnapshotRecoveryDialog.vue'
import { useSnapshotOpenRecovery } from '@/composables/useSnapshotOpenRecovery'

function dialogText(): string {
  return document.body.querySelector('.snapshot-recovery-dialog')?.textContent ?? ''
}

describe('WorkspaceSnapshotRecoveryDialog', () => {
  beforeEach(() => {
    deleteEngineeringSnapshotMock.mockReset()
    toastAddMock.mockReset()
    useSnapshotOpenRecovery().dismissSnapshotOpenRecovery()
  })

  it('stays hidden without a pending request', async () => {
    const wrapper = mount(WorkspaceSnapshotRecoveryDialog, {
      global: { plugins: [PrimeVue] },
    })
    await nextTick()
    expect(document.body.querySelector('.snapshot-recovery-dialog')).toBeNull()
    wrapper.unmount()
  })

  it('offers an explicit rebuild for snapshot_rebuild_required and retries the open', async () => {
    const wrapper = mount(WorkspaceSnapshotRecoveryDialog, {
      global: { plugins: [PrimeVue] },
    })
    const retry = vi.fn(async () => true)
    useSnapshotOpenRecovery().requestSnapshotOpenRecovery({
      code: 'snapshot_rebuild_required',
      detail: 'invalid Engineering Snapshot: /work/demo/home/engineering-snapshot.json',
      directory: '/work/demo',
      retry,
    })
    await nextTick()

    expect(dialogText()).toContain('Snapshot Rebuild Required')
    expect(dialogText()).toContain('snapshot_rebuild_required')
    expect(dialogText()).toContain('/work/demo')
    expect(dialogText()).toContain(
      'invalid Engineering Snapshot: /work/demo/home/engineering-snapshot.json',
    )

    deleteEngineeringSnapshotMock.mockResolvedValueOnce(true)
    const rebuildButton = document.body.querySelector<HTMLButtonElement>(
      '.snapshot-recovery-dialog .snapshot-recovery-primary',
    )
    expect(rebuildButton?.textContent).toContain('Rebuild Snapshot')
    rebuildButton?.click()
    await flushPromises()

    expect(deleteEngineeringSnapshotMock).toHaveBeenCalledWith('/work/demo')
    expect(retry).toHaveBeenCalledOnce()
    await nextTick()
    expect(useSnapshotOpenRecovery().pendingRequest.value).toBeNull()
    wrapper.unmount()
  })

  it('explains snapshot_identity_mismatch without a one-click rebuild', async () => {
    const wrapper = mount(WorkspaceSnapshotRecoveryDialog, {
      global: { plugins: [PrimeVue] },
    })
    useSnapshotOpenRecovery().requestSnapshotOpenRecovery({
      code: 'snapshot_identity_mismatch',
      detail: 'Engineering Snapshot workspace identity mismatch',
      directory: '/work/copied',
      retry: vi.fn(),
    })
    await nextTick()

    expect(dialogText()).toContain('Workspace Identity Mismatch')
    expect(dialogText()).toContain('snapshot_identity_mismatch')
    expect(dialogText()).toContain('copied by hand')
    expect(
      document.body.querySelector('.snapshot-recovery-dialog .snapshot-recovery-primary'),
    ).toBeNull()

    const closeButton = document.body.querySelector<HTMLButtonElement>(
      '.snapshot-recovery-dialog .snapshot-recovery-secondary',
    )
    expect(closeButton?.textContent).toContain('Close')
    closeButton?.click()
    await nextTick()
    expect(useSnapshotOpenRecovery().pendingRequest.value).toBeNull()
    expect(deleteEngineeringSnapshotMock).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('keeps the dialog open and reports when the snapshot delete fails', async () => {
    const wrapper = mount(WorkspaceSnapshotRecoveryDialog, {
      global: { plugins: [PrimeVue] },
    })
    const retry = vi.fn(async () => true)
    useSnapshotOpenRecovery().requestSnapshotOpenRecovery({
      code: 'snapshot_rebuild_required',
      detail: 'invalid Engineering Snapshot',
      directory: '/work/demo',
      retry,
    })
    await nextTick()

    deleteEngineeringSnapshotMock.mockRejectedValueOnce(
      new Error('Refusing to delete a snapshot outside an ECOS workspace'),
    )
    document.body
      .querySelector<HTMLButtonElement>(
        '.snapshot-recovery-dialog .snapshot-recovery-primary',
      )
      ?.click()
    await flushPromises()

    expect(retry).not.toHaveBeenCalled()
    expect(toastAddMock).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', summary: 'Snapshot Rebuild Failed' }),
    )
    expect(useSnapshotOpenRecovery().pendingRequest.value).not.toBeNull()
    wrapper.unmount()
  })
})
