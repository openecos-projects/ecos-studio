<template>
  <aside class="manager-sidebar" aria-label="Resource categories">
    <nav class="resource-nav">
      <button
        v-for="item in items"
        :key="item.id"
        type="button"
        class="resource-nav-item"
        :class="{ active: active === item.id }"
        @click="emit('select', item.id)"
      >
        <i :class="item.icon" aria-hidden="true"></i>
        <span>{{ item.label }}</span>
        <b>{{ item.count }}</b>
      </button>
    </nav>

    <div class="manager-help">
      <div class="help-icon">
        <i class="ri-question-line" aria-hidden="true"></i>
      </div>
      <div>
        <strong>Need help?</strong>
        <p>Learn how to add and manage resources.</p>
      </div>
      <button type="button" @click="emit('docs')">
        View Documentation
        <i class="ri-external-link-line" aria-hidden="true"></i>
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import type { CategoryFilter, SidebarItem } from '@/views/pluginManagerFilters'

defineProps<{
  items: SidebarItem[]
  active: CategoryFilter
}>()

const emit = defineEmits<{
  select: [id: CategoryFilter]
  docs: []
}>()
</script>

<style scoped>
.manager-sidebar {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 0;
  padding: 16px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-primary) 72%, transparent);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--bg-primary) 78%, transparent);
}

.resource-nav {
  display: grid;
  gap: 10px;
}

.resource-nav-item {
  display: grid;
  grid-template-columns: 24px 1fr auto;
  align-items: center;
  width: 100%;
  min-height: 34px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  text-align: left;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.resource-nav-item i {
  font-size: 16px;
}

.resource-nav-item b {
  display: grid;
  min-width: 22px;
  height: 22px;
  place-items: center;
  border-radius: 999px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  font-size: 11px;
  font-weight: 700;
}

.resource-nav-item.active {
  color: var(--accent-color);
  background: color-mix(in srgb, var(--accent-color) 12%, transparent);
}

.resource-nav-item.active b {
  color: var(--accent-color);
  background: color-mix(in srgb, var(--bg-primary) 82%, transparent);
}

.manager-help {
  display: grid;
  grid-template-columns: 24px 1fr;
  gap: 10px;
  padding: 16px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-primary) 78%, transparent);
}

.help-icon {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 8px;
  color: var(--accent-color);
  background: color-mix(in srgb, var(--accent-color) 12%, transparent);
}

.manager-help strong {
  display: block;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 750;
}

.manager-help p {
  margin: 3px 0 12px;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.45;
}

.manager-help button {
  grid-column: 1 / -1;
  justify-self: start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  color: var(--accent-color);
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
}

@media (max-width: 1240px) {
  .manager-sidebar {
    flex: 0 0 auto;
    flex-direction: column;
    gap: 12px;
  }

  .resource-nav {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .resource-nav-item {
    min-height: 42px;
    padding: 0 12px;
  }

  .manager-help {
    width: auto;
    grid-template-columns: 24px minmax(0, 1fr) auto;
    align-items: center;
    padding: 12px 14px;
  }

  .manager-help p {
    margin: 2px 0 0;
  }

  .manager-help button {
    grid-column: auto;
    justify-self: end;
    margin-left: 12px;
    white-space: nowrap;
  }
}

@media (max-width: 767px) {
  .manager-sidebar {
    flex-direction: column;
  }

  .resource-nav {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .resource-nav-item {
    min-height: 40px;
  }

  .manager-help {
    width: auto;
  }
}
</style>
