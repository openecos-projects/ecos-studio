<template>
  <section class="frontend-flow-strip" aria-label="Frontend flow tool readiness">
    <div class="frontend-flow-summary">
      <strong>Frontend Flow</strong>
      <span>{{ summary.installedCount }}/{{ summary.totalCount }} installed</span>
      <em v-if="summary.availableCount">
        {{ summary.availableCount }} ready to install
      </em>
    </div>
    <div
      class="frontend-flow-steps"
      role="list"
      aria-label="Frontend tool readiness by workflow stage"
    >
      <div
        v-for="item in summary.items"
        :key="item.label"
        class="frontend-flow-step"
        :class="item.status"
        role="listitem"
      >
        <span>{{ item.label }}</span>
        <b>{{ item.installed }}/{{ item.total }}</b>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { FrontendReadinessSummary } from '@/views/pluginManagerFilters'

defineProps<{
  summary: FrontendReadinessSummary
}>()
</script>

<style scoped>
.frontend-flow-strip {
  display: grid;
  grid-template-columns: minmax(140px, 180px) minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  padding: 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-primary) 78%, transparent);
}

.frontend-flow-summary {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.frontend-flow-summary strong {
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 750;
}

.frontend-flow-summary span,
.frontend-flow-summary em {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 11px;
  font-style: normal;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.frontend-flow-steps {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
  min-width: 0;
}

.frontend-flow-step {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  color: var(--text-secondary);
  background: var(--bg-primary);
  cursor: default;
  font-size: 11px;
}

.frontend-flow-step.ready {
  border-color: color-mix(in srgb, var(--success-color) 36%, var(--border-color));
  color: var(--success-color);
  background: var(--success-bg);
}

.frontend-flow-step span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.frontend-flow-step b {
  flex: 0 0 auto;
  margin-left: 6px;
  font-weight: 750;
}

@media (max-width: 767px) {
  .frontend-flow-strip {
    grid-template-columns: 1fr;
  }

  .frontend-flow-steps {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
