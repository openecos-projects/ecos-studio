import { describe, expect, it } from 'vitest'
import type { Message } from '../types'
import {
  describeInteractionAnswer,
  groupMessagesIntoTurns,
  groupTurnResponses,
  isChatStepArtifactGroup,
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

function report(id: string, step: string, title = `${step}.rpt`): Message {
  return msg({
    id,
    role: 'assistant',
    type: 'info',
    isGuiArtifact: true,
    content: `${title} - ${step}`,
    infoData: {
      title,
      step,
      items: [{ label: title, content: `${title} body`, format: 'text' }],
    },
  })
}

function layout(id: string, step: string): Message {
  return msg({
    id,
    role: 'assistant',
    type: 'map',
    isGuiArtifact: true,
    content: `Layout preview - ${step}`,
    mapData: {
      title: 'Layout preview',
      step,
      imageUrl: `blob:${id}`,
      localPath: `/tmp/${id}.png`,
      info: [],
      category: 'Layout',
    },
  })
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

  it('folds consecutive GUI artifacts for the same step into one group', () => {
    const turns = groupMessagesIntoTurns([
      msg({ id: 'u1', role: 'user', content: 'run flow' }),
      msg({ id: 't1', role: 'assistant', type: 'tool', content: 'Running place.' }),
      report('r1', 'Placement', 'place.rpt'),
      report('r2', 'Placement', 'congestion.rpt'),
      layout('m1', 'Placement'),
      report('r3', 'Routing', 'route.rpt'),
      layout('m2', 'Routing'),
    ])

    const responses = turns[0]?.responses ?? []
    expect(responses).toHaveLength(3)
    expect(responses[0]).toMatchObject({ id: 't1', type: 'tool' })
    expect(isChatStepArtifactGroup(responses[1]!)).toBe(true)
    if (isChatStepArtifactGroup(responses[1]!)) {
      expect(responses[1].step).toBe('Placement')
      expect(responses[1].messages.map((message) => message.id)).toEqual([
        'r1',
        'r2',
        'm1',
      ])
    }
    expect(isChatStepArtifactGroup(responses[2]!)).toBe(true)
    if (isChatStepArtifactGroup(responses[2]!)) {
      expect(responses[2].step).toBe('Routing')
      expect(responses[2].messages.map((message) => message.id)).toEqual(['r3', 'm2'])
    }
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

describe('groupTurnResponses', () => {
  it('folds a single GUI artifact into a step group', () => {
    const items = groupTurnResponses([report('r1', 'STA')])
    expect(items).toHaveLength(1)
    expect(isChatStepArtifactGroup(items[0]!)).toBe(true)
    if (isChatStepArtifactGroup(items[0]!)) {
      expect(items[0].step).toBe('STA')
      expect(items[0].messages.map((message) => message.id)).toEqual(['r1'])
    }
  })

  it('folds GUI path and ECC step names for the same step into one group', () => {
    const items = groupTurnResponses([
      report('r1', 'Timing Opt', 'opt.rpt'),
      layout('m1', 'Timing optimization'),
    ])
    expect(items).toHaveLength(1)
    expect(isChatStepArtifactGroup(items[0]!)).toBe(true)
    if (isChatStepArtifactGroup(items[0]!)) {
      expect(items[0].messages.map((message) => message.id)).toEqual(['r1', 'm1'])
    }
  })

  it('keeps a late layout in its step group across intervening progress', () => {
    const items = groupTurnResponses([
      report('r1', 'Floorplan'),
      msg({ id: 't1', role: 'assistant', type: 'tool', content: 'Running place.' }),
      layout('m1', 'Floorplan'),
    ])

    expect(items).toHaveLength(2)
    expect(isChatStepArtifactGroup(items[0]!)).toBe(true)
    if (isChatStepArtifactGroup(items[0]!)) {
      expect(items[0].messages.map((message) => message.id)).toEqual(['r1', 'm1'])
    }
    expect(items[1]).toMatchObject({ id: 't1', type: 'tool' })
  })
})
