<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import SoCTemplateDetail from '@/components/SoCTemplateDetail.vue'
import { loadSocTemplateDetail } from '@/composables/socTemplateCatalog'
import type { SocTemplateDetail as SocTemplateDetailModel } from '@/composables/socTemplateMapper'
import { getDefaultSocCoreId } from '@/composables/socTemplatePreviewSelection'

const props = defineProps<{
  templateId: string
}>()

const router = useRouter()
const template = ref<SocTemplateDetailModel | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const selectedCoreId = ref<number | null>(null)

async function loadDetail(): Promise<void> {
  loading.value = true
  error.value = null

  try {
    const detail = await loadSocTemplateDetail(props.templateId)
    template.value = detail
    selectedCoreId.value = getDefaultSocCoreId(detail)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Unable to load SoC template data'
  } finally {
    loading.value = false
  }
}

watch(() => props.templateId, loadDetail, { immediate: true })
</script>

<template>
  <div class="soc-view relative min-h-full w-full overflow-x-hidden overflow-y-auto text-(--text-primary)">
    <div class="soc-view__wash" aria-hidden="true" />
    <div class="soc-view__grid" aria-hidden="true" />
    <div class="soc-view__orb soc-view__orb--tr" aria-hidden="true" />
    <div class="soc-view__orb soc-view__orb--bl" aria-hidden="true" />
    <div class="soc-view__edge" aria-hidden="true" />

    <div class="relative z-10 mx-auto max-w-[1680px] px-5 py-8 sm:px-7 lg:px-10 lg:py-12">
      <!-- Loading -->
      <div v-if="loading" class="soc-detail-loading rounded-2xl border border-(--border-color) bg-(--bg-secondary)/90 p-8 sm:p-10" aria-busy="true">
        <div class="soc-detail-loading__shimmer mx-auto max-w-4xl space-y-6">
          <div class="flex flex-wrap gap-4">
            <div class="soc-detail-loading__bone h-11 w-36 rounded-xl" />
            <div class="soc-detail-loading__bone h-11 flex-1 rounded-xl opacity-75" />
          </div>
          <div class="grid gap-5 lg:grid-cols-[1fr_320px]">
            <div class="space-y-4 rounded-2xl border border-(--border-color) bg-(--bg-primary)/80 p-5">
              <div class="soc-detail-loading__bone h-10 w-full rounded-lg" />
              <div class="soc-detail-loading__bone min-h-[380px] rounded-xl" />
            </div>
            <div class="soc-detail-loading__bone min-h-[300px] rounded-2xl" />
          </div>
          <p class="text-center text-sm font-medium tracking-wide text-(--text-secondary)">Loading template detail…</p>
        </div>
      </div>

      <!-- Error -->
      <div
        v-else-if="error"
        class="flex flex-col gap-6 rounded-2xl border border-red-500/30 bg-red-500/[0.06] p-8 shadow-[0_2px_24px_-12px_rgba(220,38,38,0.25)] sm:flex-row sm:items-center sm:p-10"
        role="alert"
      >
        <div
          class="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-red-500/35 bg-red-500/12 font-mono text-2xl font-bold text-red-600"
          aria-hidden="true"
        >
          !
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-red-600/90">Read error</p>
          <h1 class="mt-2 text-xl font-bold tracking-tight text-(--text-primary)">Could not load template</h1>
          <p class="mt-2 text-sm leading-relaxed text-(--text-secondary)">{{ error }}</p>
          <p
            v-if="error.includes('Unknown SoC template')"
            class="mt-4 rounded-xl border border-(--border-color) bg-(--bg-primary)/90 px-4 py-3 text-sm leading-relaxed text-(--text-secondary)"
          >
            Templates will load from the workspace API when it is connected. Right now only IDs you have imported in this browser exist — open the SoC gallery and import a JSON file, or pick a template from the list.
          </p>
        </div>
        <button
          type="button"
          class="inline-flex shrink-0 items-center justify-center rounded-xl bg-(--accent-color) px-6 py-3 text-sm font-semibold text-white shadow-[0_12px_28px_-14px_color-mix(in_srgb,var(--accent-color)_70%,transparent)] transition-opacity hover:opacity-92"
          @click="loadDetail"
        >
          Retry
        </button>
      </div>

      <SoCTemplateDetail
        v-else-if="template"
        :template="template"
        :selected-core-id="selectedCoreId"
        @back="router.push('/soc')"
        @select-core="selectedCoreId = $event"
      />
    </div>
  </div>
</template>

<style scoped>
.soc-view {
  background: var(--bg-primary);
}

.soc-view__wash {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse 120% 80% at 15% -10%, color-mix(in srgb, var(--accent-color) 14%, transparent) 0%, transparent 55%),
    radial-gradient(ellipse 90% 60% at 100% 0%, color-mix(in srgb, var(--text-secondary) 8%, transparent) 0%, transparent 45%),
    linear-gradient(180deg, color-mix(in srgb, var(--bg-secondary) 65%, var(--bg-primary)) 0%, var(--bg-primary) 38%, var(--bg-primary) 100%);
}

.soc-view__grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.5;
  background-image:
    linear-gradient(color-mix(in srgb, var(--border-color) 70%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--border-color) 70%, transparent) 1px, transparent 1px);
  background-size: 20px 20px;
  mask-image: linear-gradient(180deg, black 0%, black 48%, transparent 82%);
}

.soc-view__orb {
  position: absolute;
  pointer-events: none;
  border-radius: 50%;
  opacity: 0.55;
}

.soc-view__orb--tr {
  width: min(48vw, 360px);
  height: min(48vw, 360px);
  right: -6%;
  top: -4%;
  background: radial-gradient(circle at 30% 30%, color-mix(in srgb, var(--accent-color) 20%, transparent) 0%, transparent 68%);
}

.soc-view__orb--bl {
  width: min(42vw, 300px);
  height: min(42vw, 300px);
  left: -8%;
  bottom: 10%;
  background: radial-gradient(circle at 70% 70%, color-mix(in srgb, var(--text-secondary) 11%, transparent) 0%, transparent 70%);
}

.soc-view__edge {
  position: absolute;
  left: 0;
  top: 14%;
  bottom: 16%;
  width: 3px;
  pointer-events: none;
  background: linear-gradient(
    180deg,
    transparent 0%,
    color-mix(in srgb, var(--accent-color) 50%, transparent) 24%,
    color-mix(in srgb, var(--accent-color) 28%, transparent) 52%,
    color-mix(in srgb, var(--accent-color) 50%, transparent) 76%,
    transparent 100%
  );
  opacity: 0.55;
}

.soc-detail-loading__bone {
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--border-color) 50%, transparent) 0%,
    color-mix(in srgb, var(--bg-primary) 88%, var(--border-color)) 50%,
    color-mix(in srgb, var(--border-color) 50%, transparent) 100%
  );
  background-size: 200% 100%;
  animation: soc-detail-load-shimmer 1.25s ease-in-out infinite;
}

@keyframes soc-detail-load-shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .soc-detail-loading__bone {
    animation: none;
    background: color-mix(in srgb, var(--border-color) 32%, transparent);
  }
}
</style>
