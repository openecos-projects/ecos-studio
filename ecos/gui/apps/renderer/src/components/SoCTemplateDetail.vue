<script setup lang="ts">
import { computed } from 'vue'
import DrawingAreaShell from '@/components/DrawingAreaShell.vue'
import SoCTemplateInspector from '@/components/SoCTemplateInspector.vue'
import SoCTemplatePreviewCanvas from '@/components/SoCTemplatePreviewCanvas.vue'
import { getSocDisplayCoreLabel } from '@/composables/socTemplatePreviewRenderer'
import { getSelectedSocCore } from '@/composables/socTemplatePreviewSelection'
import type { SocTemplateDetail as SocTemplateDetailModel } from '@/composables/socTemplateMapper'

const props = defineProps<{
  template: SocTemplateDetailModel
  selectedCoreId: number | null
}>()

defineEmits<{
  back: []
  'select-core': [coreId: number]
}>()

const selectedCore = computed(() => getSelectedSocCore(props.template, props.selectedCoreId))
const selectedCoreLabel = computed(() =>
  selectedCore.value ? getSocDisplayCoreLabel(selectedCore.value.id, selectedCore.value.name) : 'None',
)

const originBadge = computed(() => ({ label: 'Local', accent: false }))
</script>

<template>
  <section class="soc-detail flex flex-col gap-8 lg:gap-10" aria-label="SoC template detail">
    <!-- Hero -->
    <header class="soc-detail__hero relative overflow-hidden rounded-2xl border border-(--border-color) bg-(--bg-secondary)/90 p-6 shadow-[0_2px_16px_-8px_rgba(0,0,0,0.06)] sm:p-8 dark:shadow-[0_2px_16px_-8px_rgba(0,0,0,0.35)]">
      <div class="soc-detail__hero-accent pointer-events-none" aria-hidden="true" />
      <div class="relative flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
        <div class="flex min-w-0 flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
          <button
            type="button"
            class="group inline-flex w-max shrink-0 items-center gap-2 rounded-xl border border-(--border-color) bg-(--bg-primary) px-4 py-2.5 text-sm font-medium text-(--text-primary) shadow-sm transition-all duration-200 hover:border-(--accent-color) hover:text-(--accent-color)"
            @click="$emit('back')"
          >
            <i class="ri-arrow-left-line text-lg transition-transform duration-200 group-hover:-translate-x-0.5" aria-hidden="true"></i>
            Back
          </button>

          <div class="min-w-0 pl-0 lg:border-l lg:border-(--border-color) lg:pl-8">
            <div class="flex flex-wrap items-center gap-2">
              <span class="soc-detail__mono text-[10px] font-semibold uppercase tracking-[0.2em] text-(--text-secondary)">Inspection</span>
              <span class="h-3 w-px bg-(--border-color)" aria-hidden="true" />
              <span
                class="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                :class="
                  originBadge.accent
                    ? 'bg-(--accent-color)/12 text-(--accent-color)'
                    : 'bg-(--text-secondary)/12 text-(--text-secondary)'
                "
              >
                {{ originBadge.label }}
              </span>
              <span class="rounded-md bg-(--bg-primary) px-2 py-0.5 font-mono text-[10px] text-(--text-secondary)">{{ template.id }}</span>
            </div>
            <h1 class="soc-detail__title mt-4 font-bold tracking-tight text-(--text-primary)">
              {{ template.name }}
            </h1>
            <p class="mt-3 max-w-3xl text-sm leading-relaxed text-(--text-secondary) sm:text-[15px]">
              {{ template.info }}
            </p>
          </div>
        </div>

        <dl class="grid w-full grid-cols-3 gap-3 sm:max-w-xl xl:w-auto xl:max-w-none xl:min-w-[min(100%,380px)]">
          <div class="soc-detail__stat rounded-xl border border-(--border-color)/90 bg-(--bg-primary) px-3 py-3 shadow-inner">
            <dt class="soc-detail__mono text-[10px] font-semibold uppercase tracking-wide text-(--text-secondary)">Focus core</dt>
            <dd class="soc-detail__mono mt-1 truncate text-sm font-semibold text-(--text-primary)" :title="selectedCoreLabel">{{ selectedCoreLabel }}</dd>
          </div>
          <div class="soc-detail__stat rounded-xl border border-(--border-color)/90 bg-(--bg-primary) px-3 py-3 shadow-inner">
            <dt class="soc-detail__mono text-[10px] font-semibold uppercase tracking-wide text-(--text-secondary)">Cores</dt>
            <dd class="soc-detail__mono mt-1 text-xl font-bold tabular-nums text-(--text-primary)">{{ template.coreCount }}</dd>
          </div>
          <div class="soc-detail__stat rounded-xl border border-(--border-color)/90 bg-(--bg-primary) px-3 py-3 shadow-inner">
            <dt class="soc-detail__mono text-[10px] font-semibold uppercase tracking-wide text-(--text-secondary)">I/O Pins</dt>
            <dd class="soc-detail__mono mt-1 text-xl font-bold tabular-nums text-(--text-primary)">{{ template.ioPinsCount }}</dd>
          </div>
        </dl>
      </div>
    </header>

    <!-- Canvas + inspector -->
    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] lg:items-start">
      <div class="soc-detail__stage flex min-h-0 flex-col">
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-t-2xl border border-b-0 border-(--border-color) bg-(--bg-secondary)/95 px-4 py-3.5 sm:px-5">
          <div class="flex flex-wrap items-center gap-2">
            <span class="rounded-lg bg-(--accent-color)/12 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-(--accent-color)">
              Floorplan
            </span>
            <span class="text-xs text-(--text-secondary)">BBox · click die to select core</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="soc-detail__mono text-[10px] uppercase tracking-wider text-(--text-secondary)">Active</span>
            <span
              class="soc-detail__mono max-w-[min(100%,240px)] truncate rounded-lg border border-(--border-color) bg-(--bg-primary) px-2.5 py-1 text-xs font-semibold text-(--text-primary)"
              :title="selectedCoreLabel"
            >
              {{ selectedCoreLabel }}
            </span>
          </div>
        </div>
        <div
          class="relative flex min-h-[min(70vh,880px)] flex-col overflow-hidden rounded-b-2xl border border-(--border-color) bg-(--bg-secondary)/80 shadow-[inset_0_1px_0_0_color-mix(in_srgb,var(--border-color)_70%,transparent)]"
        >
          <div class="soc-detail__viewport-frame pointer-events-none absolute inset-3 rounded-lg border border-(--accent-color)/15 sm:inset-4" aria-hidden="true" />
          <DrawingAreaShell class="relative z-10 min-h-[min(56vh,640px)] flex-1">
            <SoCTemplatePreviewCanvas
              :template="template"
              :selected-core-id="selectedCoreId"
              @select-core="$emit('select-core', $event)"
            />
          </DrawingAreaShell>
        </div>
      </div>

      <SoCTemplateInspector :template="template" :selected-core="selectedCore" />
    </div>

    <!-- Core rail -->
    <section class="rounded-2xl border border-(--border-color) bg-(--bg-secondary)/90 p-5 shadow-[0_2px_16px_-10px_rgba(0,0,0,0.08)] sm:p-6 dark:shadow-[0_2px_16px_-10px_rgba(0,0,0,0.4)]">
      <div class="mb-5 flex flex-wrap items-end justify-between gap-4 border-b border-(--border-color) pb-4">
        <div>
          <p class="soc-detail__mono text-[10px] font-semibold uppercase tracking-[0.18em] text-(--text-secondary)">Core map</p>
          <h2 class="mt-1 text-lg font-bold tracking-tight text-(--text-primary)">Selection rail</h2>
          <p class="mt-1 text-sm text-(--text-secondary)">Updates inspector and canvas highlight.</p>
        </div>
        <span class="soc-detail__mono rounded-xl border border-(--border-color) bg-(--bg-primary) px-3 py-1.5 text-[11px] font-medium tabular-nums text-(--text-secondary)">
          {{ template.cores.length }} total
        </span>
      </div>
      <div class="grid grid-cols-[repeat(auto-fill,minmax(152px,1fr))] gap-2.5">
        <button
          v-for="core in template.cores"
          :key="core.id"
          type="button"
          class="soc-detail__chip group flex flex-col gap-1 rounded-xl border px-3.5 py-3 text-left transition-all duration-200"
          :class="
            core.id === selectedCoreId
              ? 'border-(--accent-color) bg-(--accent-color)/10 shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent-color)_35%,transparent),inset_3px_0_0_0_var(--accent-color)]'
              : 'border-(--border-color) bg-(--bg-primary) hover:border-(--accent-color)/45 hover:shadow-sm'
          "
          :data-soc-core-chip="core.id"
          @click="$emit('select-core', core.id)"
        >
          <span class="truncate text-sm font-bold text-(--text-primary)">{{ getSocDisplayCoreLabel(core.id, core.name) }}</span>
          <span class="soc-detail__mono truncate text-[10px] text-(--text-secondary)">#{{ core.id }} · {{ core.align }} · {{ core.orient }}</span>
        </button>
      </div>
    </section>
  </section>
</template>

<style scoped>
.soc-detail__mono {
  font-family: ui-monospace, 'Cascadia Code', 'SFMono-Regular', 'IBM Plex Mono', Menlo, monospace;
}

.soc-detail__hero {
  box-shadow:
    0 1px 0 0 color-mix(in srgb, var(--border-color) 72%, transparent),
    inset 0 1px 0 0 color-mix(in srgb, var(--bg-primary) 65%, transparent);
}

.soc-detail__hero-accent {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--accent-color) 78%, transparent) 0%,
    color-mix(in srgb, var(--accent-color) 38%, transparent) 48%,
    color-mix(in srgb, var(--accent-color) 14%, transparent) 100%
  );
  border-radius: 1rem 0 0 1rem;
}

.soc-detail__title {
  font-size: clamp(1.5rem, 3.5vw, 2.25rem);
  line-height: 1.12;
}

@media (prefers-reduced-motion: reduce) {
  .soc-detail__chip {
    transition: none;
  }
}
</style>
