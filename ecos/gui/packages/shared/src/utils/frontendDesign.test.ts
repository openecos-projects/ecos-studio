import { describe, expect, it } from 'vitest'
import {
  frontendDesignKindFromConfig,
  frontendFlowSteps,
  normalizeFrontendDesignKind,
} from './frontendDesign'
import {
  createProjectManifestDraft,
  parseProjectManifest,
  recordReplacementBackupInManifest,
  registerWorkspaceInManifest,
  serializeProjectManifest,
} from './frontendProjectManifest'

const draft = () =>
  createProjectManifestDraft({
    rootPath: '/projects/rtl',
    name: 'rtl',
    designName: 'counter',
    projectType: 'frontend',
  })
const generic = () =>
  registerWorkspaceInManifest(draft(), {
    projectRoot: '/projects/rtl',
    workspacePath: '/projects/rtl/ws_0001',
    config: {
      frontend_design_kind: 'generic_rtl',
      filelist: '/rtl/design.f',
      parameters: {
        top_module: 'counter',
        clock: '',
        frequency_max: 75,
        extension: { enabled: true },
      },
    },
  })

describe('frontend design profiles and persisted projects', () => {
  it('keeps legacy workspaces on the CPU flow and rejects unknown profiles', () => {
    expect(frontendDesignKindFromConfig({ parameters: {} })).toBe('cpu_core')
    expect(frontendFlowSteps(normalizeFrontendDesignKind(undefined))).toContain('sim')
    expect(normalizeFrontendDesignKind('generic-rtl')).toBe('generic_rtl')
    expect(() => normalizeFrontendDesignKind('unknown')).toThrow('Unsupported')
  })

  it('persists the first generic workspace profile and stops at lint after reopening', () => {
    const reopened = parseProjectManifest(serializeProjectManifest(generic()))
    expect(reopened.base_design).toMatchObject({
      frontend_design_kind: 'generic_rtl',
      filelist: '/rtl/design.f',
      clock: '',
      parameters: { frequency_max: 75, extension: { enabled: true } },
    })
    expect(reopened.workspaces[0]).toMatchObject({
      start_step: 'prepare',
      end_step: 'lint',
    })
    const next = registerWorkspaceInManifest(reopened, {
      projectRoot: '/projects/rtl',
      workspacePath: '/projects/rtl/ws_0002',
      config: { parameters: { frontend_design_kind: 'generic_rtl' } },
    })
    expect(next.workspaces[1]?.end_step).toBe('lint')
  })

  it('preserves a generic project profile through backups and missing stage defaults', () => {
    const manifest = generic()
    const parsed = JSON.parse(serializeProjectManifest(manifest))
    delete parsed.workspaces[0].end_step
    expect(parseProjectManifest(JSON.stringify(parsed)).workspaces[0]?.end_step).toBe(
      'lint',
    )
    const backup = recordReplacementBackupInManifest(manifest, {
      targetPath: '/projects/rtl/ws_0001',
      backupPath: '/projects/rtl/ws_0001.backup',
    })
    expect(backup.workspaces[1]).toMatchObject({ status: 'archived', end_step: 'lint' })
  })

  it('rejects mixing CPU and generic RTL in an established project', () => {
    expect(() =>
      registerWorkspaceInManifest(generic(), {
        projectRoot: '/projects/rtl',
        workspacePath: '/projects/rtl/ws_0002',
        config: { frontend_design_kind: 'cpu_core' },
      }),
    ).toThrow('locked to generic_rtl')
    const legacy = registerWorkspaceInManifest(draft(), {
      projectRoot: '/projects/rtl',
      workspacePath: '/projects/rtl/ws_0001',
    })
    delete legacy.base_design.frontend_design_kind
    delete legacy.base_design.parameters?.frontend_design_kind
    expect(legacy.workspaces[0]?.end_step).toBe('sim')
    expect(() =>
      registerWorkspaceInManifest(legacy, {
        projectRoot: '/projects/rtl',
        workspacePath: '/projects/rtl/ws_0002',
        config: { frontend_design_kind: 'generic_rtl' },
      }),
    ).toThrow('locked to cpu_core')
  })

  it('rejects simulation as a generic project endpoint', () => {
    expect(() =>
      registerWorkspaceInManifest(generic(), {
        projectRoot: '/projects/rtl',
        workspacePath: '/projects/rtl/ws_0002',
        endStep: 'sim',
      }),
    ).toThrow('General RTL workspaces support')
  })
})
