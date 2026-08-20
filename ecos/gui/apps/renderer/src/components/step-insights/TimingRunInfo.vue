<template>
  <section v-if="entries.length" class="timing-run-info-card">
    <header class="timing-subheader">
      <div>
        <i class="ri-information-line" aria-hidden="true" />
        <h3>Run Information</h3>
      </div>
      <span>{{ entries.length }} values</span>
    </header>
    <dl class="timing-run-info-grid">
      <div v-for="entry in entries" :key="entry.id">
        <dt>{{ entry.label }}</dt>
        <dd :title="entry.value">{{ entry.value }}</dd>
      </div>
    </dl>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  entries: Array<{ id: string; label: string; value: string }>
}>()
</script>

<style scoped>
.timing-run-info-card {
  background: color-mix(in srgb, var(--bg-primary) 74%, transparent);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 10px;
}

.timing-subheader {
  align-items: center;
  display: flex;
  gap: 8px;
  justify-content: space-between;
}

.timing-subheader > div {
  align-items: center;
  display: flex;
  gap: 5px;
}

.timing-subheader i {
  color: var(--accent-color);
  font-size: 12px;
}

.timing-subheader h3 {
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 700;
  margin: 0;
}

.timing-subheader span {
  color: var(--text-secondary);
  font-size: 10px;
  white-space: nowrap;
}

.timing-run-info-grid {
  display: grid;
  gap: 6px;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  margin: 0;
}

.timing-run-info-grid > div {
  background: color-mix(in srgb, var(--bg-primary) 74%, transparent);
  border: 1px solid color-mix(in srgb, var(--border-color) 75%, transparent);
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: 5px 8px;
}

.timing-run-info-grid dt {
  color: var(--text-secondary);
  font-size: 10px;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.timing-run-info-grid dd {
  color: var(--text-primary);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  line-height: 1.25;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
