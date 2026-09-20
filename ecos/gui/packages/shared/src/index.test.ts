import { describe, expect, it } from 'vitest'

import type {
  DesktopAgentChoice,
  DesktopAgentEvent,
  DesktopAgentInterruptRequest,
  DesktopAgentKnownProject,
  DesktopAgentStartSessionRequest,
  DesktopSaveFileDialogOptions,
  EccWorkspacePdkConfigPersist,
  ProjectEccPdkConfigWriteRequest,
} from './index.ts'

describe('shared public contracts', () => {
  it('exports Save As dialog options from the package entry point', () => {
    const options = {
      defaultPath: '/exports/design_signoff_package.tar.gz',
      filters: [{ name: 'Tarball', extensions: ['tar.gz'] }],
      title: 'Export Signoff Package',
    } satisfies DesktopSaveFileDialogOptions

    expect(options.title).toBe('Export Signoff Package')
  })

  it('exports structured Agent choice, streaming, status, and interrupt contracts', () => {
    const choice = {
      promptId: 'operation-1',
      title: 'Choose an operation',
      variant: 'buttons',
      options: [{ id: 'run', label: 'Run flow', value: '1' }],
    } satisfies DesktopAgentChoice
    const event = {
      choice,
      delta: 'working',
      messageId: 'message-1',
      status: 'running',
      type: 'choice',
    } satisfies DesktopAgentEvent
    const interrupt = {
      providerId: 'ecos_agent',
      sessionId: 'session-1',
    } satisfies DesktopAgentInterruptRequest

    expect(event.choice.options[0]?.value).toBe('1')
    expect(interrupt.sessionId).toBe('session-1')

    const knownProject = {
      name: 'gcd',
      path: '/projects/gcd',
    } satisfies DesktopAgentKnownProject
    const startSession = {
      knownProjects: [knownProject],
      mode: 'workspace',
      projectRoot: '/projects/gcd',
      providerId: 'ecos_agent',
      sessionId: 'session-1',
    } satisfies DesktopAgentStartSessionRequest
    expect(startSession.projectRoot).toBe('/projects/gcd')
    expect(startSession.knownProjects?.[0]?.path).toBe('/projects/gcd')
  })

  it('exports project ecc.toml PDK config contracts', () => {
    const writeRequest = {
      externalPaths: ['/pdk/macros/sram'],
      overrides: {
        lefs: ['/pdk/IP/STD_cell/lef/std.lef', '/pdk/macros/sram/sram.lef'],
        tech: '/pdk/prtech/tech.lef',
      },
      pdkName: 'ics55',
      pdkRoot: '/pdk',
      projectRoot: '/projects/gcd',
    } satisfies ProjectEccPdkConfigWriteRequest
    expect(writeRequest.projectRoot).toBe('/projects/gcd')
    expect(writeRequest.overrides.lefs).toHaveLength(2)

    const persist = {
      externalPaths: ['/pdk/macros/sram'],
    } satisfies EccWorkspacePdkConfigPersist
    expect(persist.externalPaths?.[0]).toBe('/pdk/macros/sram')
  })
})
