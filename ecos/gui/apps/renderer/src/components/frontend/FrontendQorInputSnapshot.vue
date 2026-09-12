<template>
  <section class="frontend-qor-input-snapshot" aria-label="Input snapshot">
    <i class="ri-fingerprint-line" aria-hidden="true"></i>
    <div>
      <header>
        <strong>Input snapshot</strong>
        <span :class="{ 'is-tracked': fingerprint }">
          {{ fingerprint ? 'Tracked' : 'Not tracked' }}
        </span>
      </header>
      <p>
        {{
          fingerprint
            ? 'RTL sources, included headers, and macro definitions were recorded for this result.'
            : 'This result does not include a reproducible RTL input identity.'
        }}
      </p>
      <details v-if="fingerprint">
        <summary title="Show the complete SHA-256 input identity">
          Technical identity
          <i class="ri-arrow-down-s-line" aria-hidden="true"></i>
        </summary>
        <code>{{ fingerprint }}</code>
      </details>
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  fingerprint: string
}>()
</script>

<style scoped>
.frontend-qor-input-snapshot {
  display: grid;
  min-width: 0;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 8px;
}

.frontend-qor-input-snapshot > i {
  margin-top: 1px;
  color: var(--text-secondary);
  font-size: 14px;
}

.frontend-qor-input-snapshot > div {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.frontend-qor-input-snapshot header {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.frontend-qor-input-snapshot header strong,
.frontend-qor-input-snapshot header span {
  font-size: 10px;
  font-weight: 720;
}

.frontend-qor-input-snapshot header span {
  color: var(--text-secondary);
}

.frontend-qor-input-snapshot header span.is-tracked {
  color: var(--success-color);
}

.frontend-qor-input-snapshot p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 10px;
  line-height: 1.35;
}

.frontend-qor-input-snapshot details {
  min-width: 0;
}

.frontend-qor-input-snapshot summary {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  width: fit-content;
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 9px;
  font-weight: 650;
  list-style: none;
}

.frontend-qor-input-snapshot summary::-webkit-details-marker {
  display: none;
}

.frontend-qor-input-snapshot details[open] summary i {
  transform: rotate(180deg);
}

.frontend-qor-input-snapshot code {
  display: block;
  min-width: 0;
  margin-top: 5px;
  padding: 5px 6px;
  overflow-x: auto;
  border: 1px solid color-mix(in srgb, var(--border-color) 78%, transparent);
  border-radius: 4px;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--bg-secondary) 58%, transparent);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 9px;
  white-space: nowrap;
}
</style>
