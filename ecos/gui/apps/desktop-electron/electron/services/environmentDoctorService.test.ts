import { describe, expect, it, vi } from 'vitest'
import {
  EnvironmentDoctorService,
  parseEnvironmentDoctorOutput,
} from './environmentDoctorService'

const doctorOutput = JSON.stringify([
  {
    doctor: 'environment',
    status: 'attention',
    checked: 2,
    failed: 0,
    attention: 1,
    detail: 'ecc 0.1.0a12 at /tools/ecc/chipcompiler',
    installed_at: '2026-10-21T15:37:05+00:00',
  },
  {
    component: 'yosys',
    status: 'pass',
    required: true,
    detail: '/tools/yosys',
    installed_at: '2026-10-21T08:29:53+00:00',
  },
  {
    component: 'klayout',
    status: 'fail',
    required: false,
    remediation: 'Install klayout.',
  },
])

describe('parseEnvironmentDoctorOutput', () => {
  it('normalizes the environment summary and component records', () => {
    expect(parseEnvironmentDoctorOutput(doctorOutput, '/work/demo')).toEqual({
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
    })
  })

  it('rejects malformed or non-environment output', () => {
    expect(() => parseEnvironmentDoctorOutput('not json', null)).toThrow('invalid JSON')
    expect(() => parseEnvironmentDoctorOutput('{}', null)).toThrow('unexpected response')
    expect(() => parseEnvironmentDoctorOutput('[]', null)).toThrow(
      'no environment summary',
    )
  })
})

describe('EnvironmentDoctorService', () => {
  it('runs a bounded doctor request for the supplied project', async () => {
    const runner = vi.fn(async () => ({ exitCode: 0, stderr: '', stdout: doctorOutput }))
    const service = new EnvironmentDoctorService({ runner })

    await expect(service.run('/work/demo')).resolves.toMatchObject({
      projectPath: '/work/demo',
      summary: { status: 'attention' },
    })
    expect(runner).toHaveBeenCalledWith(['doctor', '--json', '--project', '/work/demo'])
  })

  it('returns structured results when required checks make doctor exit non-zero', async () => {
    const runner = vi.fn(async () => ({
      exitCode: 1,
      stderr: 'validation detail\n',
      stdout: doctorOutput,
    }))
    const service = new EnvironmentDoctorService({ runner })

    await expect(service.run()).resolves.toMatchObject({
      projectPath: null,
      summary: { attention: 1 },
    })
  })

  it('surfaces stderr when doctor does not return parseable JSON', async () => {
    const service = new EnvironmentDoctorService({
      runner: async () => ({
        exitCode: 2,
        stdout: '',
        stderr: 'ECC CLI is not available',
      }),
    })

    await expect(service.run()).rejects.toThrow(
      'ECC doctor returned invalid JSON. ECC CLI is not available',
    )
  })
})
