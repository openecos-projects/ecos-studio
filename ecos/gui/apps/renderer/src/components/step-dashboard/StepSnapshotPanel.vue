<template>
  <!-- Fixed 4x4 grid; Summary is anchored at row 1, column 1. -->
  <div class="snapshot-panel">
    <button
      type="button"
      class="snapshot-tile snapshot-summary-entry"
      title="Open data summary"
      aria-label="Open data summary"
      @click="emit('open')"
    >
      <span class="snapshot-tile-head">
        <i class="ri-dashboard-2-line" aria-hidden="true" />
        <i class="ri-arrow-right-up-line" aria-hidden="true" />
      </span>
      <span class="snapshot-tile-copy">
        <strong>Summary</strong>
        <small>View step data charts</small>
      </span>
    </button>
    <button
      v-for="action in actions"
      :key="action.id"
      type="button"
      class="snapshot-tile"
      :title="action.hint ?? `Open ${action.label}`"
      :aria-label="action.hint ?? `Open ${action.label}`"
      @click="emit('action', action.id)"
    >
      <span class="snapshot-tile-head">
        <i :class="action.icon" aria-hidden="true" />
        <i class="ri-arrow-right-up-line" aria-hidden="true" />
      </span>
      <span class="snapshot-tile-copy">
        <strong>{{ action.label }}</strong>
        <small v-if="action.caption">{{ action.caption }}</small>
      </span>
    </button>
    <!-- Other snapshot data fills the remaining grid cells in source order. -->
    <slot />
  </div>
</template>

<script setup lang="ts">
/**
 * A snapshot action tile, e.g. the DRC module tile that mirrors the Home
 * dashboard's Data Snapshot grid. Rendered right after the Summary entry.
 */
export interface StepSnapshotAction {
  id: string
  icon: string
  label: string
  caption?: string
  /** Button title/aria text; defaults to "Open {label}". */
  hint?: string
}

withDefaults(
  defineProps<{
    actions?: StepSnapshotAction[]
  }>(),
  { actions: () => [] },
)

const emit = defineEmits<{
  (e: 'open'): void
  (e: 'action', id: string): void
}>()
</script>

<style scoped>
.snapshot-panel {
  display: grid;
  flex: 1;
  gap: 4px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  grid-template-rows: repeat(4, minmax(0, 1fr));
  min-height: 0;
  min-width: 0;
  padding: 6px;
}

.snapshot-tile {
  background: color-mix(in srgb, var(--bg-primary) 74%, transparent);
  border: 1px solid color-mix(in srgb, var(--border-color) 75%, transparent);
  color: inherit;
  cursor: pointer;
  display: grid;
  font: inherit;
  gap: 4px;
  grid-template-rows: auto minmax(0, 1fr);
  margin: 0;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  padding: 6px 7px;
  text-align: left;
}
.snapshot-tile:hover {
  border-color: color-mix(in srgb, var(--accent-color) 62%, var(--border-color));
}
.snapshot-tile:focus-visible {
  outline: 1px solid var(--accent-color);
  outline-offset: -2px;
}

.snapshot-summary-entry {
  grid-area: 1 / 1;
}

.snapshot-tile-head {
  align-items: center;
  display: flex;
  justify-content: space-between;
  min-width: 0;
}
.snapshot-tile-head > i:first-child {
  color: var(--accent-color);
  font-size: 18px;
}
.snapshot-tile-head > i:last-child {
  color: var(--text-secondary);
  font-size: 12px;
}
.snapshot-tile:hover .snapshot-tile-head > i:last-child {
  color: var(--accent-color);
}
.snapshot-tile-copy {
  align-self: end;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.snapshot-tile-copy strong {
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.snapshot-tile-copy small {
  color: var(--text-secondary);
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
