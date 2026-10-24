// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EnvironmentDoctorResult } from '@ecos-studio/shared'
import EnvironmentDoctorDialog from './EnvironmentDoctorDialog.vue'

const mocks = vi.hoisted(() => ({
  fetchEnvironmentDoctor: vi.fn(),
}))

vi.mock('@/api/environmentDoctor', () => ({
  fetchEnvironmentDoctor: mocks.fetchEnvironmentDoctor,
}))

const DialogStub = {
  props: ['visible'],
  template: '<div><slot /></div>',
}

const result: EnvironmentDoctorResult = {
  summary: {
    status: 'attention',
    checked: 2,
    failed: 0,
    attention: 1,
    detail: 'ecc 0.1.0a12 at /tools/ecc/chipcompiler',
    installedAt: '2026-10-21T15:37:05+00:00',
  },
  components: [
    {
      component: 'yosys',
      status: 'pass',
      required: true,
      detail: '/tools/yosys',
      remediation: null,
      installedAt: '2026-10-21T08:29:53+00:00',
    },
    {
      component: 'klayout',
      status: 'fail',
      required: false,
      detail: null,
      remediation: 'Install klayout.',
      installedAt: null,
    },
  ],
  projectPath: '/work/demo',
}

function mountDialog() {
  return mount(EnvironmentDoctorDialog, {
    props: { modelValue: true },
    global: { stubs: { Dialog: DialogStub } },
  })
}

describe('EnvironmentDoctorDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchEnvironmentDoctor.mockResolvedValue(result)
  })

  it('renders the doctor summary, components, and remediation', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    expect(wrapper.text()).toContain('Needs attention')
    expect(wrapper.text()).toContain('2 checked')
    expect(wrapper.text()).toContain('ecc 0.1.0a12')
    expect(wrapper.text()).toContain('Project: /work/demo')
    expect(wrapper.text()).toContain('yosys')
    expect(wrapper.text()).toContain('/tools/yosys')
    expect(wrapper.text()).toContain('Install klayout.')
    expect(wrapper.text()).toContain('filesystem time')
    expect(mocks.fetchEnvironmentDoctor).toHaveBeenCalledTimes(1)
  })

  it('shows an actionable error and retries', async () => {
    mocks.fetchEnvironmentDoctor.mockRejectedValueOnce(new Error('ECC unavailable'))
    const wrapper = mountDialog()
    await flushPromises()

    expect(wrapper.find('[role="alert"]').text()).toContain('ECC unavailable')

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Try again')!
      .trigger('click')
    await flushPromises()

    expect(mocks.fetchEnvironmentDoctor).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('Needs attention')
  })
})
