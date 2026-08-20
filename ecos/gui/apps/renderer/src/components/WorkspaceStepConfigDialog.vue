<template>
  <div class="workspace-step-config-dialog">
    <aside class="workspace-step-config-nav" aria-label="Flow step configuration">
      <header>
        <span>Flow steps</span>
        <small>{{ configurableSteps.length }}</small>
      </header>

      <div v-if="loading" class="workspace-step-config-state">
        <i class="ri-loader-4-line animate-spin" aria-hidden="true" />
      </div>
      <p v-else-if="error" class="workspace-step-config-state is-error">{{ error }}</p>
      <p v-else-if="configurableSteps.length === 0" class="workspace-step-config-state">
        No flow steps
      </p>
      <div v-else class="workspace-step-config-list">
        <button
          v-for="item in configurableSteps"
          :key="item.step"
          type="button"
          :class="{ active: selectedStep === item.step }"
          :aria-pressed="selectedStep === item.step"
          @click="selectStep(item.step)"
        >
          <i :class="item.icon" aria-hidden="true" />
          <span class="workspace-step-config-step">
            <span>{{ item.label }}</span>
            <small v-if="item.tool">{{ item.tool }}</small>
          </span>
        </button>
      </div>
    </aside>

    <section class="workspace-step-config-editor">
      <StepConfigPanel
        v-if="selectedStep"
        ref="stepConfigPanel"
        :key="selectedStep"
        :step="selectedStep"
        :tool="selectedTool"
      />
      <div v-else class="workspace-step-config-empty">
        Select a step to edit its parameters.
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { formatStepToolName, StepEnum } from '@/api/type'
import StepConfigPanel from '@/components/StepConfigPanel.vue'
import { useFlowStages } from '@/composables/useFlowStages'

const { dynamicFlowStages, error, isLoading: loading } = useFlowStages()
const selectedStep = ref<StepEnum | undefined>()
const stepConfigPanel = ref<{ hasUnsavedChanges: boolean } | null>(null)
const hasUnsavedChanges = computed(
  () => stepConfigPanel.value?.hasUnsavedChanges ?? false,
)

const configurableSteps = computed(() => {
  const seen = new Set<StepEnum>()
  return dynamicFlowStages.value.flatMap((stage) => {
    const step = Object.values(StepEnum).find(
      (candidate) => candidate.toLowerCase() === stage.path.toLowerCase(),
    )
    if (!step || seen.has(step)) return []
    seen.add(step)
    return [
      {
        step,
        label: stage.label,
        icon: stage.icon,
        tool: formatStepToolName(stage.tool),
      },
    ]
  })
})

const selectedTool = computed(
  () =>
    configurableSteps.value.find((item) => item.step === selectedStep.value)?.tool ?? '',
)

watch(
  configurableSteps,
  (steps) => {
    if (steps.some((item) => item.step === selectedStep.value)) return
    if (selectedStep.value && !confirmDiscardChanges()) return
    selectedStep.value = steps[0]?.step
  },
  { immediate: true },
)

function selectStep(step: StepEnum): void {
  if (step === selectedStep.value) return
  if (!confirmDiscardChanges()) return
  selectedStep.value = step
}

function confirmDiscardChanges(): boolean {
  return !hasUnsavedChanges.value || confirm('Discard unsaved configuration changes?')
}

defineExpose({ hasUnsavedChanges })
</script>

<style scoped>
.workspace-step-config-dialog {
  display: flex;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--border-color);
}

.workspace-step-config-nav {
  display: flex;
  width: 190px;
  flex: 0 0 190px;
  flex-direction: column;
  border-right: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.workspace-step-config-nav header {
  display: flex;
  min-height: 38px;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-color);
  padding: 0 10px;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 700;
}

.workspace-step-config-nav small {
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 500;
}

.workspace-step-config-list {
  min-height: 0;
  overflow: auto;
  padding: 4px;
}

.workspace-step-config-list button {
  display: flex;
  width: 100%;
  min-height: 36px;
  align-items: center;
  gap: 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 4px 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.workspace-step-config-step {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 1px;
}

.workspace-step-config-step span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-step-config-step small {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.02em;
  text-overflow: ellipsis;
  text-transform: none;
  white-space: nowrap;
}

.workspace-step-config-list button:hover {
  background: var(--bg-primary);
  color: var(--text-primary);
}

.workspace-step-config-list button.active {
  border-color: color-mix(in srgb, var(--accent-color) 40%, var(--border-color));
  background: color-mix(in srgb, var(--accent-color) 12%, var(--bg-primary));
  color: var(--text-primary);
}

.workspace-step-config-list i {
  width: 16px;
  flex: 0 0 16px;
  color: var(--accent-color);
  text-align: center;
}

.workspace-step-config-state,
.workspace-step-config-empty {
  margin: 0;
  padding: 16px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.workspace-step-config-state.is-error {
  color: #dc2626;
}

.workspace-step-config-editor {
  min-width: 0;
  flex: 1;
}

.workspace-step-config-empty {
  display: flex;
  height: 100%;
  align-items: center;
  justify-content: center;
}
</style>
