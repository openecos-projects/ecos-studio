<template>
  <div class="step-config-root flex h-full min-h-0 w-full min-w-0 flex-col">
    <div class="shrink-0 border-b border-(--border-color) bg-(--bg-primary) px-3 py-2">
      <h2 class="truncate text-[12px] font-bold text-(--text-primary)">
        {{ stepTitle }}
      </h2>
      <p class="mt-0.5 text-[10px] tracking-wider text-(--text-secondary) uppercase">
        Step configuration
      </p>
    </div>

    <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <!-- Not a flow step -->
      <div
        v-if="!hasFlowStep"
        class="sc-scroll flex flex-col items-center justify-center px-2 py-12 text-center"
      >
        <i class="ri-route-line mb-3 text-4xl text-(--text-secondary) opacity-40"></i>
        <p class="text-[12px] leading-relaxed text-(--text-secondary)">
          Open a flow step (e.g. Floorplan) to view and edit the configuration file for
          this step.
        </p>
      </div>

      <!-- Loading -->
      <div v-else-if="loading" class="flex flex-col items-center justify-center py-20">
        <i class="ri-loader-4-line spin text-3xl text-(--accent-color)"></i>
        <p class="mt-3 text-[11px] text-(--text-secondary)">Loading configuration…</p>
      </div>

      <!-- Runtime error -->
      <div
        v-else-if="error"
        class="m-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3"
      >
        <div class="flex items-start gap-2">
          <i class="ri-error-warning-line mt-0.5 shrink-0 text-lg text-red-400"></i>
          <p class="text-[12px] leading-relaxed break-words text-red-300">{{ error }}</p>
        </div>
        <button
          type="button"
          class="mt-3 cursor-pointer text-[11px] text-(--accent-color) hover:underline"
          @click="refetch"
        >
          Retry
        </button>
      </div>

      <!-- Empty -->
      <div
        v-else-if="isEmpty"
        class="flex flex-col items-center justify-center px-2 py-12 text-center"
      >
        <i
          class="ri-file-settings-line mb-3 text-4xl text-(--text-secondary) opacity-40"
        ></i>
        <p class="text-[12px] leading-relaxed text-(--text-secondary)">N/A</p>
        <p
          v-if="runtimeMessages.length"
          class="mt-2 text-[10px] break-words text-(--text-secondary) opacity-80"
        >
          {{ runtimeMessages.join(' ') }}
        </p>
      </div>

      <!-- Main content -->
      <template v-else>
        <div
          v-if="stepConfigReadError"
          class="mx-3 mt-3 shrink-0 rounded-lg border border-amber-500/35 bg-amber-500/10 p-3"
        >
          <div class="flex items-start gap-2">
            <i class="ri-folder-warning-line mt-0.5 shrink-0 text-lg text-amber-400"></i>
            <p class="text-[11px] leading-relaxed break-words text-amber-200/95">
              {{ stepConfigReadError }}
            </p>
          </div>
        </div>

        <!-- Resolved path + editor -->
        <template v-if="stepConfigPathResolved && !stepConfigReadError">
          <div class="sc-editor-body min-h-0 flex-1">
            <header class="topbar">
              <div class="topbar-left">
                <i class="ri-file-settings-line"></i>
                <span class="title">{{ stepConfigFileLabel }}</span>
                <span v-if="hasStepConfigChanges" class="unsaved-indicator">*</span>
                <span class="divider">/</span>
                <span class="subtitle">Edit</span>
                <i
                  v-if="stepConfigSaveError"
                  class="ri-error-warning-line shrink-0 cursor-help text-red-400"
                  :title="stepConfigSaveError"
                ></i>
              </div>
              <div class="topbar-right">
                <button
                  type="button"
                  class="btn-text"
                  :disabled="loading || isSavingStepConfig"
                  @click="reloadStepConfigFiles"
                >
                  <i class="ri-refresh-line"></i>
                  Reload
                </button>
                <button
                  type="button"
                  class="btn-text"
                  :disabled="
                    !hasStepConfigChanges ||
                    loading ||
                    !!stepConfigReadError ||
                    isMutationLocked
                  "
                  @click="resetStepConfig"
                >
                  <i class="ri-arrow-go-back-line"></i>
                  Reset
                </button>
                <button
                  type="button"
                  class="btn-primary"
                  :disabled="
                    !hasStepConfigChanges ||
                    isSavingStepConfig ||
                    !!stepConfigReadError ||
                    isMutationLocked
                  "
                  @click="onSaveStepConfig"
                >
                  <i
                    :class="isSavingStepConfig ? 'ri-loader-4-line spin' : 'ri-save-line'"
                  ></i>
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
                    <p class="mb-2 text-[11px] text-(--text-secondary)">
                      Edit and save; structured editing returns after a successful save
                      with valid JSON.
                    </p>
                    <Textarea
                      v-model="stepConfigTextDraft"
                      auto-resize
                      rows="14"
                      class="w-full font-mono text-[11px]"
                    />
                  </div>
                </div>

                <template v-else>
                  <StepConfigDynamicView
                    v-if="currentStep"
                    v-model="stepConfigDraft"
                    :step="currentStep"
                  />
                </template>
              </template>

              <p v-else class="px-1 text-[11px] text-(--text-secondary) italic">
                (empty file)
              </p>
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
  runtimeMessages,
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
  isMutationLocked,
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
