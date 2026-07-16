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
})
