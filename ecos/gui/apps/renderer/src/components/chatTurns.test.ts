import { describe, expect, it } from 'vitest'
import type { Message } from '../types'
import {
  describeInteractionAnswer,
  groupMessagesIntoTurns,
  pendingInteractionPresentation,
} from './chatTurns'

function msg(partial: Pick<Message, 'id' | 'role'> & Partial<Message>): Message {
  return {
    content: '',
    type: 'text',
    status: 'done',
    ...partial,
  }
}

describe('groupMessagesIntoTurns', () => {
  it('describes structured interaction answers for the transcript', () => {
    const choice = {
      interaction: {
        kind: 'choice' as const,
        options: [{ id: 'quick', label: 'Quick run' }],
        variant: 'list' as const,
      },
      kind: 'choice' as const,
      purpose: 'execution' as const,
      requestId: 'mode',
      schema_version: 'flow-agent.interaction_request.v1' as const,
      status: 'pending' as const,
      title: 'Run mode',
    }
    const parameterForm = {
      ...choice,
      interaction: {
        fields: [{ id: 'value', kind: 'text' as const, label: 'Parameter changes' }],
        kind: 'form' as const,
      },
      kind: 'form' as const,
      title: 'Parameter changes',
    }

    expect(describeInteractionAnswer(choice, { optionId: 'quick' })).toBe('Quick run')
    expect(describeInteractionAnswer(parameterForm, { values: { value: '' } })).toBe(
      'Keep current values',
    )
    expect(
      describeInteractionAnswer(parameterForm, { values: { value: 'density = 0.4' } }),
    ).toBe('density = 0.4')
  })

  it('anchors each user message as a turn header for following assistant nodes', () => {
    const turns = groupMessagesIntoTurns([
      msg({ id: 'u1', role: 'user', content: 'run flow' }),
      msg({ id: 'a1', role: 'assistant', content: 'ok' }),
      msg({ id: 't1', role: 'assistant', type: 'tool', content: 'tool' }),
      msg({ id: 'u2', role: 'user', content: 'confirm' }),
      msg({ id: 'a2', role: 'assistant', content: 'done' }),
    ])

    expect(turns).toHaveLength(2)
    expect(turns[0]?.user?.id).toBe('u1')
    expect(turns[0]?.responses.map((m) => m.id)).toEqual(['a1', 't1'])
    expect(turns[1]?.user?.id).toBe('u2')
    expect(turns[1]?.responses.map((m) => m.id)).toEqual(['a2'])
  })

  it('keeps leading assistant messages in a turn without a user node', () => {
    const turns = groupMessagesIntoTurns([
      msg({ id: 'a0', role: 'assistant', content: 'hello' }),
      msg({ id: 'u1', role: 'user', content: 'hi' }),
    ])

    expect(turns).toHaveLength(2)
    expect(turns[0]?.user).toBeUndefined()
    expect(turns[0]?.responses.map((m) => m.id)).toEqual(['a0'])
    expect(turns[1]?.user?.id).toBe('u1')
  })

  it('does not infer that preceding transcript context belongs to an interaction', () => {
    const presentation = pendingInteractionPresentation([
      msg({ id: 'welcome', role: 'assistant', content: 'Welcome' }),
      msg({
        id: 'rtl-prompt',
        role: 'assistant',
        content: 'What is the RTL file path? Enter a local .v / .sv file path.',
      }),
      msg({
        id: 'rtl-interaction',
        role: 'assistant',
        type: 'interaction',
        interaction: {
          interaction: {
            fields: [{ id: 'value', kind: 'path', label: 'RTL Source Path' }],
            kind: 'form',
          },
          kind: 'form',
          purpose: 'execution',
          requestId: 'rtl-request',
          schema_version: 'flow-agent.interaction_request.v1',
          status: 'pending',
          title: 'RTL Source Path',
        },
      }),
    ])

    expect(presentation.companionMessageId).toBeUndefined()
    expect(presentation.interaction?.description).toBeUndefined()
  })

  it('keeps an explicit interaction description instead of consuming transcript text', () => {
    const presentation = pendingInteractionPresentation([
      msg({ id: 'answer', role: 'assistant', content: 'A model answer.' }),
      msg({
        id: 'choice',
        role: 'assistant',
        type: 'interaction',
        interaction: {
          description: 'Choose one.',
          interaction: {
            kind: 'choice',
            options: [{ id: 'one', label: 'One' }],
            variant: 'list',
          },
          kind: 'choice',
          purpose: 'execution',
          requestId: 'choice-request',
          schema_version: 'flow-agent.interaction_request.v1',
          status: 'pending',
          title: 'Choose',
        },
      }),
    ])

    expect(presentation).toEqual({
      interaction: expect.objectContaining({ description: 'Choose one.' }),
    })
  })
})
