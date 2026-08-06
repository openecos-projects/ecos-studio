import { describe, expect, it } from 'vitest'
import type { Message } from '../types'
import { groupMessagesIntoTurns } from './chatTurns'

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
})
