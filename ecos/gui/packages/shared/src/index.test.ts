import { describe, expect, it } from 'vitest'

import type {
  DesktopAgentInteractionRequest,
  DesktopAgentEvent,
  DesktopAgentInterruptRequest,
  DesktopAgentKnownProject,
  DesktopAgentStartSessionRequest,
  DesktopSaveFileDialogOptions,
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

  it('exports structured Agent interactions, streaming, status, and interrupt contracts', () => {
    const event = {
      interaction: {
        interaction: {
          kind: 'choice',
          options: [{ id: 'run', label: 'Run flow' }],
          variant: 'buttons',
        },
        kind: 'choice',
        purpose: 'execution',
        requestId: 'request-1',
        schema_version: 'flow-agent.interaction_request.v1',
        status: 'pending',
        title: 'Choose an operation',
      },
      delta: 'working',
      messageId: 'message-1',
      status: 'awaiting_interaction',
      type: 'interaction',
    } satisfies DesktopAgentEvent
    const interrupt = {
      providerId: 'ecos_agent',
      sessionId: 'session-1',
    } satisfies DesktopAgentInterruptRequest

    expect('value' in event.interaction.interaction.options[0]!).toBe(false)
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

  it('exports versioned interaction requests without client execution values', () => {
    const request = {
      schema_version: 'flow-agent.interaction_request.v1',
      requestId: 'request-1',
      purpose: 'execution',
      kind: 'choice',
      title: 'Choose an operation',
      interaction: {
        kind: 'choice',
        options: [{ id: 'option-1', label: 'Run flow' }],
        variant: 'buttons',
      },
    } satisfies DesktopAgentInteractionRequest

    expect(request.interaction.options[0]?.id).toBe('option-1')
    expect('value' in request.interaction.options[0]!).toBe(false)
  })
})
