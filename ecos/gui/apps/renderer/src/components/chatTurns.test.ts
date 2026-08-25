import { describe, expect, it } from 'vitest'
import type { Message } from '../types'
import { groupMessagesIntoTurns, pendingInteractionPresentation } from './chatTurns'

function msg(partial: Pick<Message, 'id' | 'role'> & Partial<Message>): Message {
  return {
    content: '',
    type: 'text',
    status: 'done',
    ...partial,
  }
}

describe('groupMessagesIntoTurns', () => {
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

  it('moves the prompt immediately before a pending interaction into its card', () => {
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

    expect(presentation.companionMessageId).toBe('rtl-prompt')
    expect(presentation.interaction?.description).toBe(
      'What is the RTL file path? Enter a local .v / .sv file path.',
    )
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
