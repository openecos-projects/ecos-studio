import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FrontendProjectManifestService } from './frontendProjectManifestService'
import { ProjectDoctorService } from './projectDoctorService'

const directories: string[] = []

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

async function createService(frontend?: FrontendProjectManifestService) {
  const root = await mkdtemp(join(tmpdir(), 'ecos-project-doctor-'))
  directories.push(root)
  const callRuntime = vi.fn()
  const service = new ProjectDoctorService(
    { resolveProjectRoot: realpath },
    { callRuntime },
    frontend,
  )
  return { root, service, callRuntime }
}

const findingsReport = {
  doctor: 'project',
  status: 'failed',
  projectRoot: '/canonical/gcd',
  checked: 2,
  inconsistent: 1,
  findings: [
    {
      check: 'missing-directory',
      status: 'fail',
      workspace_id: 'ws_0002',
      workspace: '/canonical/gcd/ws_0002',
      detail: 'workspace directory does not exist',
    },
  ],
}

describe('ProjectDoctorService', () => {
  it('checks consistency through the ECC runtime with the canonical project root', async () => {
    const { root, service, callRuntime } = await createService()
    callRuntime.mockResolvedValue(findingsReport)

    const result = await service.check(root)

    expect(callRuntime).toHaveBeenCalledWith('project.doctor.check', {
      projectDir: await realpath(root),
    })
    expect(result).toEqual(findingsReport)
  })

  it('repairs through the ECC runtime and keeps fix records', async () => {
    const { root, service, callRuntime } = await createService()
    callRuntime.mockResolvedValue({
      ...findingsReport,
      status: 'fixed',
      fixed: 1,
      findings: [{ ...findingsReport.findings[0], fix: 'removed' }],
    })

    const result = await service.repair(root)

    expect(callRuntime).toHaveBeenCalledWith('project.doctor.repair', {
      projectDir: await realpath(root),
    })
    expect(result.status).toBe('fixed')
    expect(result.fixed).toBe(1)
    expect(result.findings[0]?.fix).toBe('removed')
  })

  it('maps a missing ECC manifest to a clean not-applicable result', async () => {
    const { root, service, callRuntime } = await createService()
    callRuntime.mockResolvedValue({
      doctor: 'project',
      status: 'not_applicable',
      projectRoot: null,
      checked: 0,
      inconsistent: 0,
      findings: [],
    })

    const result = await service.check(root)

    expect(result.status).toBe('not_applicable')
    expect(result.findings).toEqual([])
  })

  it('never shows frontend projects a backend consistency panel', async () => {
    const scope = { resolveProjectRoot: realpath }
    const frontend = new FrontendProjectManifestService(scope)
    const { root, service, callRuntime } = await createService(frontend)
    await frontend.mutate(root, {
      type: 'create',
      name: 'cpu',
      designName: 'core',
      projectType: 'frontend',
    })

    const check = await service.check(root)
    const repair = await service.repair(root)

    expect(check.status).toBe('not_applicable')
    expect(repair.status).toBe('not_applicable')
    expect(callRuntime).not.toHaveBeenCalled()
  })

  it('degrades malformed runtime payloads instead of propagating them', async () => {
    const { root, service, callRuntime } = await createService()
    callRuntime.mockResolvedValue({ unexpected: true })

    const result = await service.check(root)

    expect(result).toMatchObject({ doctor: 'project', status: 'not_applicable' })
  })
})
