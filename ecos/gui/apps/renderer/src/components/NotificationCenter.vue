<template>
  <div class="notification-center">
    <button
      type="button"
      class="notification-trigger"
      :class="{ active: open }"
      :aria-expanded="open"
      aria-label="Open notifications"
      title="Notifications"
      @click="open = !open"
    >
      <i class="ri-notification-3-line" aria-hidden="true" />
      <span v-if="unreadCount" class="notification-count">{{ unreadCountLabel }}</span>
    </button>

    <section
      v-if="open"
      class="notification-panel"
      role="dialog"
      aria-label="Notifications"
    >
      <header class="notification-header">
        <div>
          <p class="notification-eyebrow">Activity</p>
          <h2>Notifications</h2>
        </div>
        <button
          type="button"
          class="notification-icon-button"
          aria-label="Clear all notifications"
          title="Clear all"
          :disabled="!notifications.length"
          @click="clear"
        >
          <i class="ri-delete-bin-6-line" aria-hidden="true" />
        </button>
      </header>

      <div v-if="!notifications.length" class="notification-empty">
        <i class="ri-checkbox-circle-line" aria-hidden="true" />
        <span>No notifications</span>
      </div>

      <ul v-else class="notification-list">
        <li
          v-for="notification in notifications"
          :key="notification.id"
          class="notification-item"
          :class="`notification-item--${notification.severity}`"
          :data-unread="!notification.read"
          @click="markRead(notification.id)"
        >
          <span class="notification-status" aria-hidden="true">
            <i :class="iconFor(notification.severity)" />
          </span>
          <div class="notification-body">
            <div class="notification-item-heading">
              <strong>{{ notification.title }}</strong>
              <time :datetime="new Date(notification.createdAt).toISOString()">
                {{ formatTime(notification.createdAt) }}
              </time>
            </div>
            <p>{{ notification.message }}</p>
            <details
              v-if="notification.detail || notification.logFile"
              class="notification-detail"
            >
              <summary>View details</summary>
              <pre v-if="notification.detail">{{ notification.detail }}</pre>
              <code v-if="notification.logFile">Log: {{ notification.logFile }}</code>
            </details>
          </div>
          <button
            type="button"
            class="notification-icon-button notification-dismiss"
            aria-label="Dismiss notification"
            title="Dismiss"
            @click.stop="remove(notification.id)"
          >
            <i class="ri-close-line" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  useNotificationStore,
  type AppNotificationSeverity,
} from '@/stores/notificationStore'

const open = ref(false)
const { notifications, unreadCount, markRead, remove, clear } = useNotificationStore()
const unreadCountLabel = computed(() =>
  unreadCount.value > 99 ? '99+' : unreadCount.value,
)

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && open.value) open.value = false
}

onMounted(() => document.addEventListener('keydown', handleKeydown))
onUnmounted(() => document.removeEventListener('keydown', handleKeydown))

function iconFor(severity: AppNotificationSeverity): string {
  if (severity === 'error') return 'ri-error-warning-line'
  if (severity === 'warn') return 'ri-alert-line'
  return 'ri-information-line'
}

function formatTime(timestamp: number): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(timestamp)
}
</script>

<style scoped>
.notification-center {
  position: relative;
  display: flex;
  align-items: center;
  height: 100%;
}

.notification-trigger,
.notification-icon-button {
  display: inline-grid;
  place-items: center;
  color: var(--text-secondary);
  cursor: pointer;
  transition:
    border-color 140ms ease,
    color 140ms ease,
    background 140ms ease;
}

.notification-trigger {
  position: relative;
  width: 40px;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 1rem;
}

.notification-trigger:hover,
.notification-trigger.active {
  color: var(--text-primary);
  background: var(--bg-secondary);
}

.notification-icon-button:hover:not(:disabled) {
  border-color: var(--accent-color);
  color: var(--accent-color);
  background: var(--bg-primary);
}

.notification-count {
  position: absolute;
  top: 2px;
  right: 1px;
  z-index: 1;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--danger-color);
  color: var(--accent-text);
  font-size: 0.62rem;
  font-weight: 700;
  line-height: 15px;
  text-align: center;
}

.notification-panel {
  position: absolute;
  top: 42px;
  right: 0;
  display: flex;
  width: min(420px, calc(100vw - 24px));
  max-height: min(70vh, 620px);
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.22);
}

.notification-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.9rem 1rem 0.75rem;
  border-bottom: 1px solid var(--border-color);
}

.notification-header h2,
.notification-eyebrow {
  margin: 0;
}

.notification-header h2 {
  font-size: 0.95rem;
  font-weight: 650;
}

.notification-eyebrow {
  color: var(--accent-color);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.notification-icon-button {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-color);
  border-radius: 5px;
  background: var(--bg-secondary);
  font-size: 0.9rem;
}

.notification-icon-button:disabled {
  cursor: default;
  opacity: 0.4;
}

.notification-list {
  display: grid;
  gap: 1px;
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
  background: var(--border-color);
}

.notification-item {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) 28px;
  gap: 0.65rem;
  align-items: start;
  padding: 0.8rem 0.9rem;
  background: var(--bg-primary);
  cursor: pointer;
}

.notification-item[data-unread='true'] {
  background: color-mix(in srgb, var(--info-bg) 42%, var(--bg-primary));
}

.notification-status {
  padding-top: 0.1rem;
  color: var(--info-color);
  font-size: 1rem;
}

.notification-item--error .notification-status {
  color: var(--danger-color);
}
.notification-item--warn .notification-status {
  color: var(--warn-color);
}

.notification-body {
  min-width: 0;
}

.notification-item-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}

.notification-item-heading strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 0.78rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notification-item-heading time {
  flex: none;
  color: var(--text-secondary);
  font-size: 0.64rem;
}

.notification-body > p {
  margin: 0.25rem 0 0;
  color: var(--text-secondary);
  font-size: 0.74rem;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.notification-detail {
  margin-top: 0.45rem;
}
.notification-detail summary {
  color: var(--accent-color);
  font-size: 0.68rem;
  cursor: pointer;
}
.notification-detail pre,
.notification-detail code {
  display: block;
  max-height: 180px;
  margin: 0.45rem 0 0;
  overflow: auto;
  color: var(--text-secondary);
  font:
    0.66rem/1.45 ui-monospace,
    SFMono-Regular,
    Consolas,
    monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.notification-dismiss {
  align-self: start;
}

.notification-empty {
  display: grid;
  place-items: center;
  gap: 0.5rem;
  min-height: 160px;
  color: var(--text-secondary);
  font-size: 0.75rem;
}

.notification-empty i {
  color: var(--success-color);
  font-size: 1.5rem;
}

@media (max-width: 560px) {
  .notification-panel {
    position: fixed;
    top: 40px;
    right: 10px;
    left: 10px;
    width: auto;
  }
}
</style>
