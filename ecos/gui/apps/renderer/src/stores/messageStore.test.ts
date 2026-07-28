import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia, storeToRefs } from 'pinia'
import { nextTick } from 'vue'
import { useMessageStore } from './messageStore'

describe('messageStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
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
})
