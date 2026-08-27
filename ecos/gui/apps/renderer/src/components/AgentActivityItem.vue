<template>
  <div
    v-if="item.kind === 'reasoning_summary'"
    class="activity-item activity-item--reasoning"
    :data-status="item.status"
    role="listitem"
  >
    <i :class="itemIcon" aria-hidden="true"></i>
    <div class="activity-item__content">
      <div
        v-for="(part, index) in item.summary"
        :key="index"
        class="activity-item__reasoning markdown-body"
        v-html="renderAgentActivityMarkdown(part)"
      ></div>
    </div>
  </div>

  <details
    v-else
    class="activity-item activity-item--disclosure"
    :data-status="item.status"
    :open="item.status === 'running' || item.status === 'failed'"
    role="listitem"
  >
    <summary class="activity-item__summary">
      <i :class="itemIcon" aria-hidden="true"></i>
      <span class="activity-item__label">{{ agentActivityLabel(item) }}</span>
      <span
        v-if="terminalLabel || item.durationMs !== undefined"
        class="activity-item__duration"
      >
        {{ terminalLabel || formatActivityDuration(item.durationMs ?? 0) }}
      </span>
      <i class="ri-arrow-down-s-line activity-item__chevron" aria-hidden="true"></i>
    </summary>

    <div class="activity-item__details">
      <template v-if="item.kind === 'web_search'">
        <div
          v-for="(action, index) in item.actions"
          :key="`${action.kind}-${index}`"
          class="activity-action"
        >
          <i :class="webActionIcon(action.kind)" aria-hidden="true"></i>
          <a
            v-if="action.url"
            :href="action.url"
            :title="action.url"
            @click.prevent="openExternal(action.url)"
          >
            {{ action.title || urlHost(action.url) }}
          </a>
          <span v-else>{{ action.query || webActionLabel(action.kind) }}</span>
        </div>
      </template>

      <template v-else-if="item.kind === 'command_execution'">
        <dl class="activity-meta">
          <div v-if="item.cwd">
            <dt>Working directory</dt>
            <dd>{{ item.cwd }}</dd>
          </div>
          <div v-if="item.exitCode !== undefined">
            <dt>Exit code</dt>
            <dd>{{ item.exitCode }}</dd>
          </div>
        </dl>
        <pre class="activity-code"><code>{{ item.command }}</code></pre>
        <pre
          v-if="item.output"
          class="activity-code activity-code--output"
        ><code>{{ item.output }}</code></pre>
        <p v-if="item.truncated" class="activity-item__hint">Output truncated</p>
      </template>

      <template v-else>
        <dl class="activity-meta">
          <div v-if="item.server">
            <dt>Server</dt>
            <dd>{{ item.server }}</dd>
          </div>
        </dl>
        <section v-if="item.arguments" class="activity-detail-section">
          <h4>Arguments</h4>
          <pre class="activity-code"><code>{{ item.arguments }}</code></pre>
        </section>
        <p v-if="item.progress" class="activity-item__progress">{{ item.progress }}</p>
        <section v-if="item.result" class="activity-detail-section">
          <h4>Result</h4>
          <pre
            class="activity-code activity-code--output"
          ><code>{{ item.result }}</code></pre>
        </section>
        <p v-if="item.error" class="activity-item__error">{{ item.error }}</p>
        <p v-if="item.truncated" class="activity-item__hint">Details truncated</p>
      </template>
    </div>
  </details>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type {
  DesktopAgentActivity,
  DesktopAgentWebSearchAction,
} from '@ecos-studio/shared'
import {
  agentActivityLabel,
  agentActivityTerminalLabel,
  formatActivityDuration,
  renderAgentActivityMarkdown,
} from './agentActivityPresentation'
import { getOptionalDesktopApi } from '@/platform/desktop'

const props = defineProps<{ item: DesktopAgentActivity }>()
const terminalLabel = computed(() => agentActivityTerminalLabel(props.item))

const itemIcon = computed(() => {
  if (props.item.status === 'failed') {
    return 'ri-error-warning-line activity-item__icon activity-item__icon--error'
  }
  if (props.item.status === 'declined' || props.item.status === 'interrupted') {
    return 'ri-stop-circle-line activity-item__icon'
  }
  if (props.item.kind === 'reasoning_summary') {
    return 'ri-sparkling-2-line activity-item__icon'
  }
  if (props.item.kind === 'web_search') return 'ri-global-line activity-item__icon'
  if (props.item.kind === 'command_execution') {
    return 'ri-terminal-box-line activity-item__icon'
  }
  if (props.item.itemId === 'local-stage-identification') {
    return 'ri-route-line activity-item__icon'
  }
  if (props.item.itemId === 'local-knowledge-search') {
    return 'ri-book-open-line activity-item__icon'
  }
  if (props.item.itemId === 'local-source-search') {
    return 'ri-file-search-line activity-item__icon'
  }
  if (props.item.itemId === 'local-answer-validation') {
    return 'ri-shield-check-line activity-item__icon'
  }
  return 'ri-tools-line activity-item__icon'
})

function webActionLabel(kind: DesktopAgentWebSearchAction['kind']): string {
  if (kind === 'open_page') return 'Opened page'
  if (kind === 'find_in_page') return 'Searched within page'
  return 'Searched the web'
}

function webActionIcon(kind: DesktopAgentWebSearchAction['kind']): string {
  if (kind === 'open_page') return 'ri-external-link-line'
  if (kind === 'find_in_page') return 'ri-file-search-line'
  return 'ri-search-line'
}

function urlHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

async function openExternal(url: string): Promise<void> {
  const desktopApi = getOptionalDesktopApi()
  if (desktopApi) await desktopApi.system.openExternal(url)
  else window.open(url, '_blank', 'noopener,noreferrer')
}
</script>

<style scoped>
.activity-item {
  min-width: 0;
  margin: 0;
}

.activity-item--reasoning,
.activity-item__summary {
  display: grid;
  grid-template-columns: 1rem minmax(0, 1fr) auto auto;
  gap: 0.45rem;
  align-items: start;
  min-height: 1.6rem;
  padding: 0.18rem 0.125rem;
}

.activity-item__summary {
  color: var(--text-secondary);
  cursor: pointer;
  list-style: none;
}

.activity-item__summary::-webkit-details-marker {
  display: none;
}

.activity-item__summary:hover {
  color: var(--text-primary);
}

.activity-item__summary:focus-visible,
.activity-action a:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-color) 55%, transparent);
  outline-offset: 2px;
}

.activity-item__icon {
  display: inline-flex;
  width: 1rem;
  height: 1.125rem;
  align-items: center;
  justify-content: center;
  margin: 0;
  font-size: 0.875rem;
  line-height: 1;
}

.activity-item__icon--error,
.activity-item__error {
  color: var(--danger-color);
}

.activity-item__content,
.activity-item__label {
  min-width: 0;
  color: inherit;
  font-size: 0.75rem;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.activity-item__reasoning {
  max-width: 72ch;
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.5;
}

.activity-item__reasoning :deep(p) {
  margin: 0;
}

.activity-item__reasoning :deep(code) {
  font-size: 0.6875rem;
}

.activity-item__reasoning + .activity-item__reasoning {
  margin-top: 0.28rem;
}

.activity-item__duration {
  color: color-mix(in srgb, var(--text-secondary) 72%, transparent);
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  line-height: 1.55;
}

.activity-item__chevron {
  display: inline-flex;
  height: 1.125rem;
  align-items: center;
  flex: 0 0 auto;
  line-height: 1;
  color: color-mix(in srgb, var(--text-secondary) 65%, transparent);
  transition: transform 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

.activity-item[open] .activity-item__chevron {
  transform: rotate(180deg);
}

.activity-item__details {
  min-width: 0;
  margin: 0.1rem 0 0.45rem 1.55rem;
  color: var(--text-secondary);
  font-size: 0.6875rem;
}

.activity-action {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 0.45rem;
  padding: 0.16rem 0;
}

.activity-action > i {
  flex: 0 0 auto;
}

.activity-action a,
.activity-action span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.activity-action a {
  color: var(--accent-color);
  text-decoration: none;
}

.activity-action a:hover {
  text-decoration: underline;
}

.activity-meta {
  display: grid;
  gap: 0.22rem;
  margin: 0 0 0.38rem;
}

.activity-meta > div {
  display: grid;
  grid-template-columns: minmax(6rem, max-content) minmax(0, 1fr);
  gap: 0.65rem;
}

.activity-meta dt,
.activity-meta dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.activity-meta dt,
.activity-detail-section h4 {
  color: color-mix(in srgb, var(--text-secondary) 78%, transparent);
  font-weight: 550;
}

.activity-code {
  max-height: 9rem;
  margin: 0.25rem 0;
  overflow: auto;
  padding: 0.5rem 0.625rem;
  border: 1px solid color-mix(in srgb, var(--border-color) 72%, transparent);
  border-radius: 0.375rem;
  background: color-mix(in srgb, var(--bg-secondary) 58%, var(--bg-primary));
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 0.6875rem;
  line-height: 1.5;
  white-space: pre;
}

.activity-code--output {
  max-height: 16rem;
}

.activity-detail-section {
  margin-top: 0.45rem;
}

.activity-detail-section h4,
.activity-item__progress,
.activity-item__error,
.activity-item__hint {
  margin: 0;
  font-size: inherit;
  line-height: 1.5;
}

.activity-item__hint {
  color: color-mix(in srgb, var(--text-secondary) 78%, transparent);
}

@media (max-width: 640px) {
  .activity-item__details {
    margin-left: 1.15rem;
  }

  .activity-meta > div {
    grid-template-columns: 1fr;
    gap: 0.08rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .activity-item__chevron {
    transition: none;
  }
}
</style>
