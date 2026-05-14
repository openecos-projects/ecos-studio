<template>
  <div class="step-config-root flex flex-col h-full min-h-0 w-full min-w-0">
    <div class="shrink-0 px-3 py-2 border-b border-(--border-color) bg-(--bg-primary)">
      <h2 class="text-[12px] font-bold text-(--text-primary) truncate">{{ stepTitle }}</h2>
      <p class="text-[10px] text-(--text-secondary) uppercase tracking-wider mt-0.5">Step configuration</p>
    </div>

    <div class="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
      <!-- Not a flow step -->
      <div v-if="!hasFlowStep"
        class="flex flex-col items-center justify-center text-center py-12 px-2 sc-scroll">
        <i class="ri-route-line text-4xl text-(--text-secondary) opacity-40 mb-3"></i>
        <p class="text-[12px] text-(--text-secondary) leading-relaxed">
          Open a flow step (e.g. Floorplan) to view and edit the configuration file for this step.
        </p>
      </div>

      <!-- Loading -->
      <div v-else-if="loading" class="flex flex-col items-center justify-center py-20">
        <i class="ri-loader-4-line text-3xl text-(--accent-color) spin"></i>
        <p class="text-[11px] text-(--text-secondary) mt-3">Loading configuration…</p>
      </div>

      <!-- API error -->
      <div v-else-if="error" class="p-3 m-3 rounded-lg border border-red-500/40 bg-red-500/10">
        <div class="flex items-start gap-2">
          <i class="ri-error-warning-line text-red-400 text-lg shrink-0 mt-0.5"></i>
          <p class="text-[12px] text-red-300 leading-relaxed break-words">{{ error }}</p>
        </div>
        <button type="button" class="mt-3 text-[11px] text-(--accent-color) hover:underline cursor-pointer"
          @click="refetch">
          Retry
        </button>
      </div>

      <!-- Empty -->
      <div v-else-if="isEmpty"
        class="flex flex-col items-center justify-center text-center py-12 px-2">
        <i class="ri-file-settings-line text-4xl text-(--text-secondary) opacity-40 mb-3"></i>
        <p class="text-[12px] text-(--text-secondary) leading-relaxed">No configuration data.</p>
        <p v-if="serverMessages.length" class="text-[10px] text-(--text-secondary) opacity-80 mt-2 break-words">
          {{ serverMessages.join(' ') }}
        </p>
      </div>

      <!-- Main content -->
      <template v-else>
        <div v-if="stepConfigReadError"
          class="mx-3 mt-3 p-3 rounded-lg border border-amber-500/35 bg-amber-500/10 shrink-0">
          <div class="flex items-start gap-2">
            <i class="ri-folder-warning-line text-amber-400 text-lg shrink-0 mt-0.5"></i>
            <p class="text-[11px] text-amber-200/95 leading-relaxed break-words">{{ stepConfigReadError }}</p>
          </div>
        </div>

        <!-- Resolved path + editor -->
        <template v-if="stepConfigPathResolved && !stepConfigReadError">
          <div class="sc-editor-body flex-1 min-h-0">
            <header class="topbar">
              <div class="topbar-left">
                <i class="ri-file-settings-line"></i>
                <span class="title">{{ stepConfigFileLabel }}</span>
                <span v-if="hasStepConfigChanges" class="unsaved-indicator">*</span>
                <span class="divider">/</span>
                <span class="subtitle">Edit</span>
                <i v-if="stepConfigSaveError" class="ri-error-warning-line text-red-400 cursor-help shrink-0"
                  :title="stepConfigSaveError"></i>
              </div>
              <div class="topbar-right">
                <button type="button" class="btn-text" :disabled="loading || isSavingStepConfig"
                  @click="reloadStepConfigFiles">
                  <i class="ri-refresh-line"></i>
                  Reload
                </button>
                <button type="button" class="btn-text"
                  :disabled="!hasStepConfigChanges || loading || !!stepConfigReadError"
                  @click="resetStepConfig">
                  <i class="ri-arrow-go-back-line"></i>
                  Reset
                </button>
                <button type="button" class="btn-primary"
                  :disabled="!hasStepConfigChanges || isSavingStepConfig || !!stepConfigReadError"
                  @click="onSaveStepConfig">
                  <i :class="isSavingStepConfig ? 'ri-loader-4-line spin' : 'ri-save-line'"></i>
                  {{ isSavingStepConfig ? 'Saving…' : 'Save' }}
                </button>
              </div>
            </header>

            <div class="sc-scroll custom-scrollbar">
            <template v-if="hasStepFileBody">
              <div v-if="stepConfigJsonInvalid" class="card mb-3">
                <div class="card-head">
                  <i class="ri-alert-line c-orange"></i>
                  <span>Raw text (invalid JSON)</span>
                </div>
                <div class="card-body">
                  <p class="text-[11px] text-(--text-secondary) mb-2">Edit and save; structured editing returns after a successful save with valid JSON.</p>
                  <Textarea v-model="stepConfigTextDraft" auto-resize rows="14" class="w-full font-mono text-[11px]" />
                </div>
              </div>

              <template v-else>
                <StepConfigDynamicView v-if="currentStep" v-model="stepConfigDraft" :step="currentStep" />
              </template>

            </template>

            <p v-else
              class="text-[11px] text-(--text-secondary) italic px-1">(empty file)</p>
            </div>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Textarea from 'primevue/textarea'
import { getStepMetadata } from '@/api/type'
import { useStepConfigInfo } from '@/composables/useStepConfigInfo'
import StepConfigDynamicView from '@/components/step-config/StepConfigDynamicView.vue'

const {
  currentStep,
  hasFlowStep,
  loading,
  error,
  serverMessages,
  isEmpty,
  refetch,
  stepConfigPathResolved,
  stepConfigDisplay,
  stepConfigReadError,
  stepConfigJsonInvalid,
  stepConfigDraft,
  stepConfigTextDraft,
  hasStepConfigChanges,
  isSavingStepConfig,
  stepConfigSaveError,
  saveStepConfig,
  resetStepConfig,
  reloadStepConfigFiles,
} = useStepConfigInfo()

const stepTitle = computed(() => {
  const s = currentStep.value
  if (!s) return 'Step'
  return getStepMetadata(s)?.label ?? s
})

const hasStepFileBody = computed(() => (stepConfigDisplay.value?.trim() ?? '').length > 0)

const stepConfigFileLabel = computed(() => {
  const p = stepConfigPathResolved.value
  if (!p) return 'Config file'
  return fileBasename(p)
})

function fileBasename(absPath: string): string {
  const n = absPath.replace(/\\/g, '/')
  const i = n.lastIndexOf('/')
  return i >= 0 ? n.slice(i + 1) : n
}

/** Save toolbar when step config file path is resolved and readable */
async function onSaveStepConfig(): Promise<void> {
  await saveStepConfig()
}
</script>

<style src="./step-config/stepConfigEditor.css"></style>
