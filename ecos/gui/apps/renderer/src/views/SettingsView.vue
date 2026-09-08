<template>
  <div class="settings-view">
    <aside class="settings-sidebar">
      <div class="settings-search">
        <i class="ri-search-line" />
        <InputText
          v-model="searchQuery"
          class="search-input"
          placeholder="Search settings"
          spellcheck="false"
        />
      </div>
      <nav class="settings-categories">
        <button
          v-for="category in categories"
          :key="category"
          class="category-btn"
          :class="{ active: category === activeCategory }"
          type="button"
          @click="activeCategory = category"
        >
          {{ category }}
        </button>
      </nav>
    </aside>
    <section class="settings-content">
      <h2 class="settings-heading">{{ activeCategory ?? 'Settings' }}</h2>
      <div v-if="store.loading && store.entries.length === 0" class="settings-empty">
        Loading settings…
      </div>
      <div v-else-if="visibleEntries.length === 0" class="settings-empty">
        No settings match your search.
      </div>
      <div v-else class="settings-rows">
        <SettingItemRow
          v-for="entry in visibleEntries"
          :key="entry.descriptor.key"
          :entry="entry"
          :validating="store.isValidating(entry.descriptor.key)"
          :write-error="store.errorFor(entry.descriptor.key)"
          @commit="(value) => void store.set(entry.descriptor.key, value)"
          @reset="() => void store.reset(entry.descriptor.key)"
        />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import InputText from 'primevue/inputtext'
import SettingItemRow from '@/components/settings/SettingItemRow.vue'
import { useSettingsRegistryStore } from '@/stores/settingsRegistryStore'

const ALL_CATEGORIES = 'All'

const route = useRoute()
const store = useSettingsRegistryStore()
const searchQuery = ref('')
const activeCategory = ref<string>(ALL_CATEGORIES)

const categories = computed(() => {
  const names = new Set<string>()
  for (const entry of store.entries) {
    names.add(entry.descriptor.category)
  }
  return [ALL_CATEGORIES, ...Array.from(names).sort()]
})

const visibleEntries = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  return store.entries.filter((entry) => {
    if (
      activeCategory.value !== ALL_CATEGORIES &&
      entry.descriptor.category !== activeCategory.value
    ) {
      return false
    }
    if (!query) return true
    const { description, key, title } = entry.descriptor
    return (
      title.toLowerCase().includes(query) ||
      description.toLowerCase().includes(query) ||
      key.toLowerCase().includes(query)
    )
  })
})

onMounted(() => {
  const requestedCategory = route.query.category
  if (typeof requestedCategory === 'string' && requestedCategory.trim()) {
    activeCategory.value = requestedCategory
  }
  store.bindChangedEvents()
  void store.load()
})

onUnmounted(() => {
  store.unbindChangedEvents()
})
</script>

<style scoped>
.settings-view {
  display: flex;
  gap: 2rem;
  height: 100%;
  padding: 1.5rem 2rem;
  overflow: auto;
}

.settings-sidebar {
  display: flex;
  flex-direction: column;
  flex: 0 0 14rem;
  gap: 1rem;
}

.settings-search {
  align-items: center;
  display: flex;
  gap: 0.4rem;
  position: relative;
}

.search-input {
  padding-left: 2rem;
  width: 100%;
}

.settings-search > i {
  left: 0.6rem;
  position: absolute;
  z-index: 1;
}

.settings-categories {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.category-btn {
  background: transparent;
  border: none;
  border-radius: 6px;
  color: inherit;
  cursor: pointer;
  padding: 0.45rem 0.7rem;
  text-align: left;
}

.category-btn:hover {
  background: var(--p-content-hover-background, rgba(128, 128, 128, 0.12));
}

.category-btn.active {
  background: var(--p-primary-color, rgba(59, 130, 246, 0.2));
  color: var(--p-primary-contrast-color, inherit);
  font-weight: 600;
}

.settings-content {
  flex: 1 1 auto;
  min-width: 0;
}

.settings-heading {
  border-bottom: 1px solid var(--p-content-border-color, rgba(128, 128, 128, 0.25));
  font-size: 1.25rem;
  margin: 0 0 0.5rem;
  padding-bottom: 0.75rem;
}

.settings-rows {
  display: flex;
  flex-direction: column;
}

.settings-empty {
  color: var(--p-text-muted-color, rgba(128, 128, 128, 0.9));
  padding: 2rem 0;
}
</style>
