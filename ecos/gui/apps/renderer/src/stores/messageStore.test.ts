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

  it('upserts one pending interaction by request id and consumes it once', () => {
    const store = useMessageStore()
    const interaction = {
      interaction: {
        kind: 'choice' as const,
        options: [{ id: 'option-1', label: 'Run' }],
        variant: 'buttons' as const,
      },
      kind: 'choice' as const,
      purpose: 'execution' as const,
      requestId: 'request-1',
      schema_version: 'flow-agent.interaction_request.v1' as const,
      status: 'pending' as const,
      title: 'Choose an operation',
    }

    store.addInteraction(interaction, 'interaction-1')
    store.addInteraction(interaction, 'interaction-duplicate')

    expect(store.messages).toHaveLength(1)
    expect(store.answerInteraction('request-1', 'Run')).toBe(true)
    expect(store.answerInteraction('request-1', 'Run')).toBe(false)
    expect(store.messages[0]).toMatchObject({
      interactionAnswer: 'Run',
      interaction: { requestId: 'request-1', status: 'answered' },
      interactionAnswered: true,
    })
  })

  it('binds only an explicitly matching interaction description to its preceding prompt', () => {
    const store = useMessageStore()
    const promptId = store.addAssistantMessage('Choose a run mode.', 'done')
    store.addInteraction(
      {
        interaction: {
          kind: 'choice',
          options: [{ id: 'quick', label: 'Quick run' }],
          variant: 'list',
        },
        kind: 'choice',
        description: 'Choose a run mode.',
        purpose: 'execution',
        requestId: 'mode',
        schema_version: 'flow-agent.interaction_request.v1',
        status: 'pending',
        title: 'Run mode',
      },
      'mode-interaction',
    )

    expect(store.messages[1]).toMatchObject({ interactionCompanionId: promptId })

    store.addAssistantMessage('Persistent workspace context.', 'done')
    store.addInteraction(
      {
        ...store.messages[1]!.interaction!,
        description: 'Choose another operation.',
        requestId: 'operation',
        status: 'pending',
      },
      'operation-interaction',
    )
    expect(
      store.messages[store.messages.length - 1]?.interactionCompanionId,
    ).toBeUndefined()
  })

  it('rewinds messages to the restored interaction after undo', () => {
    const store = useMessageStore()
    const interaction = {
      interaction: {
        kind: 'choice' as const,
        options: [{ id: 'option-1', label: 'Run' }],
        variant: 'list' as const,
      },
      kind: 'choice' as const,
      purpose: 'execution' as const,
      requestId: 'request-1',
      schema_version: 'flow-agent.interaction_request.v1' as const,
      status: 'pending' as const,
      title: 'Choose',
    }
    store.addInteraction(interaction, 'interaction-1')
    store.addAssistantMessage('Welcome shown before the selection.', 'done')
    store.answerInteraction('request-1', 'Run')
    store.addAssistantMessage('Prompt created by the wrong selection.', 'done')
    store.addInteraction(
      { ...interaction, canUndo: true, requestId: 'request-2' },
      'interaction-2',
    )

    expect(store.rewindToInteraction('request-1')).toBe(true)
    expect(store.messages).toHaveLength(2)
    expect(store.messages[0]).toMatchObject({
      interaction: { canUndo: false, requestId: 'request-1', status: 'pending' },
      interactionAnswered: false,
      interactionAnswer: undefined,
    })
    expect(store.messages[1]?.content).toBe('Welcome shown before the selection.')
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

  it('upserts structured activity by turn and item identity', () => {
    const store = useMessageStore()
    const activity = {
      itemId: 'reasoning-1',
      kind: 'reasoning_summary' as const,
      schema_version: 'flow-agent.activity.v1' as const,
      startedAt: 1000,
      status: 'running' as const,
      summary: ['Inspecting'],
      turnId: 'turn-1',
      turnStartedAt: 900,
    }

    store.upsertAgentEvent({ activity, sessionId: 'session-test', type: 'activity' })
    store.upsertAgentEvent({
      activity: {
        ...activity,
        status: 'completed',
        summary: ['Inspecting the flow.'],
      },
      sessionId: 'session-test',
      type: 'activity',
    })

    expect(store.messages).toHaveLength(1)
    expect(store.messages[0]).toMatchObject({
      activity: {
        items: [
          {
            itemId: 'reasoning-1',
            status: 'completed',
            summary: ['Inspecting the flow.'],
          },
        ],
        turnId: 'turn-1',
      },
      status: 'loading',
      type: 'activity',
    })

    store.finishStreamingMessages()
    expect(store.messages[0]).toMatchObject({
      activity: { completedAt: expect.any(Number) },
      status: 'done',
    })
  })

  it('keeps background-tab activity isolated by session', () => {
    const store = useMessageStore()
    store.upsertAgentEvent({
      activity: {
        itemId: 'search-1',
        kind: 'web_search',
        schema_version: 'flow-agent.activity.v1',
        startedAt: 1000,
        status: 'running',
        actions: [],
        query: 'CTS',
        turnId: 'turn-b',
        turnStartedAt: 900,
      },
      sessionId: 'session-b',
      type: 'activity',
    })

    expect(store.messages).toEqual([])
    store.setActiveSessionId('session-b')
    expect(store.messages).toMatchObject([
      { activity: { turnId: 'turn-b' }, type: 'activity' },
    ])
  })
})
