import { beforeEach, describe, expect, it } from 'vitest'

import { useNotificationStore } from './notificationStore'

describe('notificationStore', () => {
  beforeEach(() => useNotificationStore().clear())

  it('deduplicates a repeated error and keeps details available', () => {
    const store = useNotificationStore()
    const input = {
      severity: 'error' as const,
      title: 'ECC sidecar stopped',
      message: 'ECC RPC sidecar exited with code 1.',
      detail: 'Last output: missing liberty file',
      logFile: '/tmp/ecc.log',
    }

    store.addNotification(input)
    store.addNotification(input)

    expect(store.notifications.value).toHaveLength(1)
    expect(store.notifications.value[0]).toMatchObject(input)
    expect(store.unreadCount.value).toBe(1)
  })

  it('marks and removes a notification', () => {
    const store = useNotificationStore()
    store.addNotification({
      severity: 'warn',
      title: 'Warning',
      message: 'Check config.',
    })
    const id = store.notifications.value[0]!.id

    store.markRead(id)
    expect(store.unreadCount.value).toBe(0)
    store.remove(id)
    expect(store.notifications.value).toHaveLength(0)
  })

  it('updates one operation notification in place', () => {
    const store = useNotificationStore()
    store.addNotification({
      key: 'operation-1',
      severity: 'error',
      title: 'ECC sidecar stopped',
      message: 'The sidecar stopped.',
    })
    const id = store.notifications.value[0]!.id

    store.addNotification({
      key: 'operation-1',
      severity: 'error',
      title: 'Place interrupted',
      message: 'Previous place run was interrupted.',
      logFile: '/work/demo/place_dreamplace/log/place.log',
    })

    expect(store.notifications.value).toEqual([
      expect.objectContaining({
        id,
        key: 'operation-1',
        title: 'Place interrupted',
        logFile: '/work/demo/place_dreamplace/log/place.log',
      }),
    ])
  })
})
