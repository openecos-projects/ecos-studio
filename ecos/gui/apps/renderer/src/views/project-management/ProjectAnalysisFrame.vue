<template>
  <section class="analysis-panel mockup-analysis-panel" aria-label="Analysis">
    <div class="analysis-heading">
      <div class="analysis-title-group">
        <p id="project-analysis-subtitle" class="analysis-subtitle">{{ subtitle }}</p>
        <p v-if="context" class="analysis-context">{{ context }}</p>
      </div>
      <div
        v-if="hasProjectData"
        class="analysis-tabs"
        role="tablist"
        aria-label="Analysis views"
      >
        <button
          v-for="tab in tabs"
          :id="`analysis-tab-${tab.id}`"
          :key="tab.id"
          type="button"
          role="tab"
          :aria-selected="selectedTab === tab.id"
          :tabindex="selectedTab === tab.id ? 0 : -1"
          :aria-controls="`analysis-${tab.id}-panel`"
          :class="{ selected: selectedTab === tab.id }"
          @click="selectTab(tab.id)"
          @keydown="handleTabKeydown($event, tab.id)"
        >
          {{ tab.label }}
        </button>
      </div>
    </div>
    <slot></slot>
  </section>
</template>

<script setup lang="ts">
type AnalysisTab = 'dashboard' | 'step'

defineProps<{
  subtitle: string
  context?: string
  hasProjectData: boolean
  selectedTab: AnalysisTab
}>()

const emit = defineEmits<{
  'select-tab': [tab: AnalysisTab]
}>()

const tabs = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'step', label: 'Step Analysis' },
] as const

function selectTab(tab: AnalysisTab): void {
  emit('select-tab', tab)
}

function handleTabKeydown(event: KeyboardEvent, currentTab: AnalysisTab): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return

  event.preventDefault()
  const currentIndex = tabs.findIndex((tab) => tab.id === currentTab)
  const nextIndex =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) %
          tabs.length
  const nextTab = tabs[nextIndex].id
  selectTab(nextTab)
  document.getElementById(`analysis-tab-${nextTab}`)?.focus()
}
</script>

<style scoped>
.analysis-panel {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
  overflow: hidden;
}

.mockup-analysis-panel {
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.analysis-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  margin-bottom: 12px;
}

.analysis-title-group {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.analysis-subtitle {
  min-width: 0;
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 650;
  line-height: 1.3;
}

.analysis-context {
  overflow: hidden;
  margin: 0;
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  font-weight: 720;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.analysis-tabs {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-secondary) 48%, transparent);
}

.analysis-tabs button {
  min-height: 26px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  font-weight: 750;
}

.analysis-tabs button.selected {
  color: var(--text-primary);
  background: color-mix(in srgb, var(--accent-color) 12%, var(--bg-primary));
}

.analysis-tabs button:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-color) 72%, transparent);
  outline-offset: 1px;
}

@media (max-width: 700px) {
  .analysis-heading {
    align-items: stretch;
    flex-direction: column;
  }

  .analysis-tabs {
    align-self: flex-start;
  }
}
</style>
