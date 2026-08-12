import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia, storeToRefs } from 'pinia'
import { nextTick } from 'vue'
import { useMessageStore } from './messageStore'

describe('messageStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useMessageStore().setActiveSessionId('session-test')
  })

  it('isolates messages per Agent chat session', () => {
    const store = useMessageStore()
    store.addMessage('alpha')
    store.setActiveSessionId('session-b')
    store.addMessage('beta')

    expect(store.messages.map((message) => message.content)).toEqual(['beta'])
    store.setActiveSessionId('session-test')
    expect(store.messages.map((message) => message.content)).toEqual(['alpha'])
  })

  it('clears all in-memory chat messages', () => {
    const store = useMessageStore()

    store.addMessage('hello')
    store.addAssistantMessage('hi there', 'done')

    expect(store.messages.map((message) => message.content)).toEqual([
      'hello',
      'hi there',
    ])

    store.clearMessages()

    expect(store.messages).toEqual([])
  })

  it('keeps storeToRefs consumers reactive when messages are cleared', async () => {
    const store = useMessageStore()
    const { messages } = storeToRefs(store)

    store.addMessage('workspace scoped prompt')
    expect(messages.value).toHaveLength(1)

    store.clearMessages()
    await nextTick()

    expect(messages.value).toEqual([])
  })

  it('clears only GUI report and layout cards from the requested session', () => {
    const store = useMessageStore()
    store.addMessage('Keep this conversation')
    store.addExecutionContract({
      fields: [{ label: 'Design', value: 'gcd' }],
      schema_version: 'flow-agent.resolved_execution_contract.v1',
      title: 'Resolved execution contract',
    })
    store.addInfoMessage({
      title: 'place.log',
      step: 'Placement',
      items: [{ content: 'report', format: 'text', label: 'place.log' }],
    })
    store.addMapMessage({
      imageUrl: 'blob:layout',
      info: [],
      localPath: '/tmp/layout.png',
      step: 'Placement',
      title: 'Layout preview',
    })
    store.setActiveSessionId('session-b')
    store.addInfoMessage({
      title: 'route.log',
      step: 'Routing',
      items: [{ content: 'report', format: 'text', label: 'route.log' }],
    })

    expect(store.hasSessionGuiArtifacts('session-test')).toBe(true)
    expect(store.clearSessionGuiArtifacts('session-test')).toBe(true)
    expect(store.hasSessionGuiArtifacts('session-test')).toBe(false)
    expect(store.clearSessionGuiArtifacts('session-test')).toBe(false)
    expect(store.messagesBySessionId['session-test']).toMatchObject([
      { content: 'Keep this conversation', type: 'text' },
      { type: 'info', infoData: { step: 'Execution contract' } },
    ])
    expect(store.messagesBySessionId['session-b']).toHaveLength(1)
  })

  it('clears GUI artifacts only for rerun-affected steps', () => {
    const store = useMessageStore()
    store.addInfoMessage({
      title: 'floorplan.log',
      step: 'Floorplan',
      items: [{ content: 'report', format: 'text', label: 'floorplan.log' }],
    })
    store.addMapMessage({
      imageUrl: 'blob:place',
      info: [],
      localPath: '/tmp/place.png',
      step: 'Placement',
      title: 'Layout preview',
    })

    expect(store.clearSessionGuiArtifactsForSteps(['Floorplan'])).toBe(true)
    expect(store.messages).toMatchObject([{ mapData: { step: 'Placement' } }])
  })

  it('renders a provider contract as a structured assistant message', () => {
    const store = useMessageStore()

    store.addExecutionContract({
      fields: [
        { label: 'Design', value: 'gcd' },
        { label: 'Backend', value: 'local_ecc' },
      ],
      schema_version: 'flow-agent.resolved_execution_contract.v1',
      title: 'Resolved execution contract',
    })

    expect(store.messages).toMatchObject([
      {
        infoData: {
          items: [
            { content: 'gcd', label: 'Design' },
            { content: 'local_ecc', label: 'Backend' },
          ],
          title: 'Resolved execution contract',
        },
        role: 'assistant',
        type: 'info',
      },
    ])
  })

  it('records one answer for the matching choice prompt', () => {
    const store = useMessageStore()
    const choice = {
      promptId: 'prompt-1',
      title: 'Choose a stage',
      options: [
        { id: 'prompt-1-1', label: 'place', value: '1' },
        { id: 'prompt-1-2', label: 'route', value: '2' },
      ],
      variant: 'list' as const,
    }

    store.addChoice(choice, 'choice-message')

    expect(store.answerChoice(choice.promptId, choice.options[0])).toBe(true)
    expect(store.answerChoice(choice.promptId, choice.options[1])).toBe(false)
    expect(store.messages[0]).toMatchObject({
      answeredOptionId: 'prompt-1-1',
      id: 'choice-message',
      type: 'choice',
    })
  })

  it('dismisses prior open choices when a new choice arrives or free-text advances', () => {
    const store = useMessageStore()
    const first = {
      promptId: 'prompt-1',
      title: 'Choose an operation',
      options: [{ id: 'prompt-1-1', label: 'Create', value: '1' }],
      variant: 'list' as const,
    }
    const second = {
      promptId: 'prompt-2',
      title: 'Choose an operation',
      options: [{ id: 'prompt-2-1', label: 'Create', value: '1' }],
      variant: 'list' as const,
    }

    store.addChoice(first, 'choice-1')
    store.addChoice(second, 'choice-2')

    expect(store.messages[0]).toMatchObject({
      answeredOptionId: '__dismissed__',
      id: 'choice-1',
    })
    expect(store.messages[1].answeredOptionId).toBeUndefined()

    store.dismissOpenChoices()
    expect(store.messages[1]).toMatchObject({
      answeredOptionId: '__dismissed__',
      id: 'choice-2',
    })
  })

  it('merges tool deltas with the same provider message id', () => {
    const store = useMessageStore()

    store.upsertAgentEvent({
      delta: '**Thinking…**\n',
      messageId: 'turn-1-tool',
      type: 'tool',
    })
    store.upsertAgentEvent({
      delta: '**Searching workspace…**\n',
      messageId: 'turn-1-tool',
      type: 'tool',
    })

    expect(store.messages).toMatchObject([
      {
        content: 'Thinking…\nSearching workspace…\n',
        id: 'turn-1-tool',
        status: 'loading',
        type: 'tool',
      },
    ])

    store.finishStreamingMessages()
    expect(store.messages).toEqual([])
  })

  it('keeps flow execution timelines after the turn finishes', () => {
    const store = useMessageStore()

    store.appendToolProgress('Running place.')
    store.appendToolProgress(
      'Completed place. Saved: /runs/gcd/place_dreamplace/output/gcd_place.def.gz',
    )

    expect(store.messages).toHaveLength(1)
    expect(store.messages[0]).toMatchObject({
      status: 'loading',
      type: 'tool',
    })
    expect(store.messages[0]?.content).toContain('Running place.')
    expect(store.messages[0]?.content).toContain('Completed place.')

    store.finishToolProgress()
    store.finishStreamingMessages()
    expect(store.messages).toHaveLength(1)
    expect(store.messages[0]?.status).toBe('done')
    expect(store.messages[0]?.content).toContain('Running place.')
  })
})
