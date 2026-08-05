<template>
  <section
    v-if="rows.length"
    class="contract-panel my-4 rounded-lg border border-(--border-color) bg-(--bg-secondary)/30 p-4"
  >
    <div class="mb-3 flex items-center justify-between gap-3">
      <h3 class="min-w-0 flex-1 truncate text-sm font-semibold text-(--text-primary)">
        {{ title }}
      </h3>
      <span class="contract-state" role="status">{{ executionState }}</span>
    </div>
    <div
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
      class="selectable mt-4 text-xs leading-5 whitespace-pre-line text-(--text-primary)"
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
  </section>
</template>

<script setup lang="ts">
import type { DesktopAgentChoice, DesktopAgentChoiceOption } from '@ecos-studio/shared'
import AgentChoiceCard from './AgentChoiceCard.vue'

withDefaults(
  defineProps<{
    answeredOptionId?: string
    choice?: DesktopAgentChoice
    choiceDisabled?: boolean
    confirmationText?: string
    executionState: string
    rows: [string, string][]
    title: string
  }>(),
  {
    answeredOptionId: '',
    choice: undefined,
    choiceDisabled: false,
    confirmationText: '',
  },
)
const emit = defineEmits<{
  select: [option: DesktopAgentChoiceOption]
}>()
</script>

<style scoped>
.contract-state {
  flex: 0 0 auto;
  padding: 0.1875rem 0.4375rem;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: 0.6875rem;
  white-space: nowrap;
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
