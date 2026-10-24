// @vitest-environment happy-dom
import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CliInstallState, VersionInfo } from '@ecos-studio/shared'
import AboutDialog from './AboutDialog.vue'

const mocks = vi.hoisted(() => ({
  versions: {
    value: {
      gui: '0.1.0-alpha.9',
      runtime: 'ECC CLI',
      ecc: '0.1.0a12',
      eccTools: '0.1.0a13',
      dreamplace: '0.1.0a7',
    } satisfies VersionInfo,
  },
  refreshVersions: vi.fn(async () => undefined),
  fetchCliInstallerStatus: vi.fn(),
}))

vi.mock('@/composables/useVersion', () => ({
  useVersion: () => ({
    versions: mocks.versions,
    refreshVersions: mocks.refreshVersions,
  }),
}))

vi.mock('@/api/cliInstaller', () => ({
  fetchCliInstallerStatus: mocks.fetchCliInstallerStatus,
}))

const DialogStub = {
  props: ['visible'],
  template: '<div><slot /></div>',
}

function readyInstaller(): CliInstallState {
  return {
    status: 'ready',
    expectedVersion: '0.1.0-alpha.12',
    installedVersion: '0.1.0-alpha.12',
    source: 'bundled',
    versionDir: '/data/ecc/current',
    shimPath: '/home/u/.local/bin/ecos-ecc',
    selfCheck: { ok: true, detail: 'ecc 0.1.0a12' },
    warning: null,
    error: null,
  }
}

function mountDialog() {
  return shallowMount(AboutDialog, {
    props: { modelValue: true },
    global: {
      stubs: {
        Dialog: DialogStub,
        EnvironmentDoctorDialog: true,
      },
    },
  })
}

describe('AboutDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchCliInstallerStatus.mockResolvedValue(readyInstaller())
  })

  it('shows Studio, expected ECC, installed ECC, and alignment', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    expect(wrapper.text()).toContain('ECOS Studio')
    expect(wrapper.text()).toContain('0.1.0-alpha.9')
    expect(wrapper.text()).toContain('ECC expected')
    expect(wrapper.text()).toContain('ECC installed')
    expect(wrapper.text()).toContain('0.1.0-alpha.12')
    expect(wrapper.text()).toContain('Matched')
    expect(
      wrapper
        .findAll('button')
        .some((button) => button.text().includes('Environment details')),
    ).toBe(true)
    expect(mocks.fetchCliInstallerStatus).toHaveBeenCalledTimes(1)
    expect(mocks.refreshVersions).toHaveBeenCalledTimes(1)
  })

  it('surfaces external runtime drift in the dialog', async () => {
    mocks.fetchCliInstallerStatus.mockResolvedValue({
      ...readyInstaller(),
      source: 'external',
      installedVersion: '0.1.0-alpha.13',
      warning: 'The external ECC runtime reports version 0.1.0-alpha.13.',
    })
    const wrapper = mountDialog()
    await flushPromises()

    expect(wrapper.text()).toContain('Mismatch')
    expect(wrapper.text()).toContain('The external ECC runtime reports version')
  })
})
