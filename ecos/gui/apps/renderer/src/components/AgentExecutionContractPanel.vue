<template>
  <section
    v-if="title"
    class="contract-panel"
    :class="{ 'contract-panel--committed': isCommitted }"
  >
    <!-- Committed: compact receipt — no wide status chip fighting the title -->
    <template v-if="isCommitted">
      <div class="contract-panel__committed">
        <div class="contract-panel__title-row">
          <h3 class="contract-panel__title">{{ title }}</h3>
          <span class="contract-panel__state" role="status">{{ executionState }}</span>
        </div>
        <p v-if="summaryLine" class="contract-panel__summary selectable">
          {{ summaryLine }}
        </p>
        <button
          v-if="rows.length"
          type="button"
          class="contract-panel__toggle"
          :aria-expanded="detailsOpen"
          @click="detailsOpen = !detailsOpen"
        >
          {{ detailsOpen ? 'Hide details' : 'Details' }}
        </button>
      </div>
      <div
        v-if="detailsOpen && rows.length"
        class="contract-table-shell selectable mt-2"
        role="region"
        :aria-label="`${title} details`"
        tabindex="0"
      >
        <table
          class="w-full table-fixed border-collapse text-left text-xs text-(--text-secondary)"
        >
          <thead>
            <tr class="border-b border-(--border-color)">
              <th scope="col" class="w-[38%] py-2 font-medium">Key</th>
              <th scope="col" class="py-2 font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="[key, value] in rows"
              :key="key"
              class="border-b border-(--border-color)/60 last:border-b-0"
            >
              <th
                scope="row"
                class="py-2 pr-3 align-top font-medium text-(--text-secondary)"
              >
                {{ key }}
              </th>
              <td class="py-2 break-all text-(--text-primary)">{{ value }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- Awaiting review: full spec + actions -->
    <template v-else>
      <div class="contract-panel__header">
        <h3 class="contract-panel__title min-w-0 flex-1">{{ title }}</h3>
        <span class="contract-panel__state contract-panel__state--chip" role="status">
          {{ executionState }}
        </span>
      </div>
      <div
        v-if="rows.length"
        class="contract-table-shell selectable"
        role="region"
        :aria-label="`${title} details`"
        tabindex="0"
      >
        <table
          class="w-full table-fixed border-collapse text-left text-xs text-(--text-secondary)"
        >
          <thead>
            <tr class="border-b border-(--border-color)">
              <th scope="col" class="w-[38%] py-2 font-medium">Key</th>
              <th scope="col" class="py-2 font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="[key, value] in rows"
              :key="key"
              class="border-b border-(--border-color)/60 last:border-b-0"
            >
              <th
                scope="row"
                class="py-2 pr-3 align-top font-medium text-(--text-secondary)"
              >
                {{ key }}
              </th>
              <td class="py-2 break-all text-(--text-primary)">{{ value }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p
        v-if="confirmationText"
        class="selectable text-xs leading-5 whitespace-pre-line text-(--text-primary)"
        :class="rows.length ? 'mt-4' : ''"
      >
        {{ confirmationText }}
      </p>
      <AgentChoiceCard
        v-if="choice"
        class="mt-4"
        :answered-option-id="answeredOptionId"
        :choice="choice"
        :disabled="choiceDisabled"
        embedded
        @select="emit('select', $event)"
      />
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { DesktopAgentChoice, DesktopAgentChoiceOption } from '@ecos-studio/shared'
import AgentChoiceCard from './AgentChoiceCard.vue'

const SUMMARY_KEYS = [
  'Target workspace',
  'Workspace Name',
  'Design Name',
  'Design',
  'Start stage',
  'Flow',
  'Workspace',
  'Source workspace',
] as const

const props = withDefaults(
  defineProps<{
    answeredOptionId?: string
    choice?: DesktopAgentChoice
    choiceDisabled?: boolean
    confirmationText?: string
    executionState: string
    rows: [string, string][]
    summary?: string
    title: string
  }>(),
  {
    answeredOptionId: '',
    choice: undefined,
    choiceDisabled: false,
    confirmationText: '',
    summary: '',
  },
)
const emit = defineEmits<{
  select: [option: DesktopAgentChoiceOption]
}>()

const detailsOpen = ref(false)
const isCommitted = computed(() => Boolean(props.answeredOptionId))
const summaryLine = computed(() => {
  if (props.summary.trim()) return props.summary.trim()
  const byKey = new Map(props.rows)
  const preferred = SUMMARY_KEYS.map((key) => byKey.get(key))
    .filter((value): value is string => Boolean(value && value !== '-'))
    .map(summarizeValue)
  if (preferred.length) return preferred.slice(0, 3).join(' · ')
  return props.rows
    .map(([, value]) => summarizeValue(value))
    .filter((value) => value && value !== '-')
    .slice(0, 3)
    .join(' · ')
})

watch(isCommitted, (committed) => {
  if (!committed) detailsOpen.value = false
})

function summarizeValue(value: string): string {
  if (/[/\\]/.test(value)) {
    const leaf = value.split(/[/\\]/).filter(Boolean).at(-1)
    if (leaf) return leaf
  }
  return value
}
</script>

<style scoped>
.contract-panel {
  margin: 1rem 0;
  padding: 1rem;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--bg-secondary) 30%, transparent);
}

.contract-panel--committed {
  margin: 0.4rem 0;
  padding: 0.5rem 0.65rem;
  border-color: color-mix(in srgb, var(--border-color) 75%, transparent);
  background: transparent;
}

.contract-panel__committed {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.15rem;
}

.contract-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.contract-panel__title-row {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 0.45rem;
}

.contract-panel__title {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 0.8125rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.contract-panel--committed .contract-panel__title {
  flex: 0 1 auto;
  font-size: 0.75rem;
}

.contract-panel__summary {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.6875rem;
  line-height: 1.4;
  word-break: break-word;
}

.contract-panel__toggle {
  align-self: flex-start;
  margin-top: 0.1rem;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.6875rem;
  text-decoration: underline;
  text-underline-offset: 0.12em;
  cursor: pointer;
}

.contract-panel__toggle:hover,
.contract-panel__toggle:focus-visible {
  color: var(--text-primary);
}

.contract-panel__toggle:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-color) 65%, transparent);
  outline-offset: 2px;
}

/* Committed: quiet inline status, not a wide chip */
.contract-panel__state {
  flex: 0 0 auto;
  color: color-mix(in srgb, var(--text-secondary) 88%, var(--accent-color));
  font-size: 0.625rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.contract-panel__state--chip {
  padding: 0.125rem 0.375rem;
  border: 1px solid color-mix(in srgb, var(--border-color) 80%, transparent);
  border-radius: 999px;
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: 0.625rem;
  letter-spacing: 0.01em;
}

.contract-table-shell {
  max-height: min(18rem, 42vh);
  overflow: auto;
  padding: 0 0.5rem;
  border: 1px solid color-mix(in srgb, var(--border-color) 72%, transparent);
  border-radius: 6px;
  background: var(--bg-primary);
  scrollbar-width: thin;
  scrollbar-color: var(--border-color) transparent;
}

.contract-table-shell:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-color) 65%, transparent);
  outline-offset: 2px;
}

.contract-table-shell thead {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--bg-primary);
}

@media (max-width: 420px) {
  .contract-panel {
    padding: 0.75rem;
  }
}
</style>
