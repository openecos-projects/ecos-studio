import { computed, ref } from 'vue'

export type AppNotificationSeverity = 'error' | 'warn' | 'info'

export interface AppNotification {
  id: string
  severity: AppNotificationSeverity
  title: string
  message: string
  detail?: string
  logFile?: string
  key?: string
  createdAt: number
  read: boolean
}

const notifications = ref<AppNotification[]>([])

function compactMessage(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function addNotification(
  input: Omit<AppNotification, 'id' | 'createdAt' | 'read'>,
): void {
  const message = compactMessage(input.message)
  if (!message) return

  const keyed = input.key
    ? notifications.value.find((item) => item.key === input.key)
    : undefined
  if (keyed) {
    Object.assign(keyed, input, { message, read: false })
    return
  }

  const duplicate = notifications.value.find(
    (item) =>
      item.severity === input.severity &&
      item.message === message &&
      Date.now() - item.createdAt < 5000,
  )
  if (duplicate) return

  notifications.value.unshift({
    ...input,
    id: crypto.randomUUID(),
    message,
    createdAt: Date.now(),
    read: false,
  })
  if (notifications.value.length > 100) notifications.value.length = 100
}

export function useNotificationStore() {
  const unreadCount = computed(
    () => notifications.value.filter((notification) => !notification.read).length,
  )

  function markRead(id: string): void {
    const item = notifications.value.find((notification) => notification.id === id)
    if (item) item.read = true
  }

  function remove(id: string): void {
    notifications.value = notifications.value.filter(
      (notification) => notification.id !== id,
    )
  }

  function clear(): void {
    notifications.value = []
  }

  return {
    notifications,
    unreadCount,
    addNotification,
    markRead,
    remove,
    clear,
  }
}
