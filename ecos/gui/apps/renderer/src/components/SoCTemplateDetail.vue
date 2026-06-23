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

const originBadge = computed(() =>
  props.template.sourceLabel.startsWith('remote:')
    ? { label: 'Remote', accent: true }
    : { label: 'Local', accent: false },
)
</script>

<template>
  <section class="soc-detail flex flex-col gap-5 lg:gap-6" aria-label="SoC template detail">
    <header class="soc-detail__hero relative overflow-hidden rounded-xl border border-(--border-color) bg-(--bg-secondary)/95 px-4 py-4 shadow-sm sm:px-5 lg:px-6">
      <div class="relative grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
        <div class="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start">
          <button
            type="button"
            class="group inline-flex h-9 w-max shrink-0 items-center gap-2 rounded-lg border border-(--border-color) bg-(--bg-primary) px-3 text-sm font-medium text-(--text-primary) shadow-sm transition-all duration-200 hover:border-(--accent-color) hover:text-(--accent-color)"
            @click="$emit('back')"
          >
            <i class="ri-arrow-left-line text-lg transition-transform duration-200 group-hover:-translate-x-0.5" aria-hidden="true"></i>
            Back
          </button>

          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="soc-detail__mono text-[10px] font-semibold uppercase tracking-[0.14em] text-(--text-secondary)">SoC template</span>
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
            <h1 class="soc-detail__title mt-2 font-bold tracking-tight text-(--text-primary)">
              {{ template.name }}
            </h1>
            <p class="mt-1.5 max-w-3xl text-sm leading-relaxed text-(--text-secondary)">
              {{ template.info }}
            </p>
          </div>
        </div>

        <dl class="grid grid-cols-3 gap-2 sm:max-w-xl xl:min-w-[390px]">
          <div class="soc-detail__stat rounded-lg border border-(--border-color)/90 bg-(--bg-primary) px-3 py-2.5">
            <dt class="soc-detail__mono text-[10px] font-semibold uppercase tracking-wide text-(--text-secondary)">Focus core</dt>
            <dd class="soc-detail__mono mt-1 truncate text-sm font-semibold text-(--text-primary)" :title="selectedCoreLabel">{{ selectedCoreLabel }}</dd>
          </div>
          <div class="soc-detail__stat rounded-lg border border-(--border-color)/90 bg-(--bg-primary) px-3 py-2.5">
            <dt class="soc-detail__mono text-[10px] font-semibold uppercase tracking-wide text-(--text-secondary)">Cores</dt>
            <dd class="soc-detail__mono mt-1 text-xl font-bold tabular-nums text-(--text-primary)">{{ template.coreCount }}</dd>
          </div>
          <div class="soc-detail__stat rounded-lg border border-(--border-color)/90 bg-(--bg-primary) px-3 py-2.5">
            <dt class="soc-detail__mono text-[10px] font-semibold uppercase tracking-wide text-(--text-secondary)">I/O Pins</dt>
            <dd class="soc-detail__mono mt-1 text-xl font-bold tabular-nums text-(--text-primary)">{{ template.ioPinsCount }}</dd>
          </div>
        </dl>
      </div>
    </header>

    <div class="soc-detail__workbench grid gap-0 overflow-hidden rounded-xl border border-(--border-color) bg-(--bg-secondary)/92 shadow-[0_18px_48px_-38px_rgba(0,0,0,0.32)] xl:grid-cols-[minmax(0,1fr)_360px]">
      <div class="soc-detail__canvas-panel flex min-h-0 flex-col">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-(--border-color) bg-(--bg-secondary)/95 px-4 py-3 sm:px-5">
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
        <div class="relative flex min-h-[620px] flex-col bg-(--bg-primary)/72 p-3 sm:p-4">
          <DrawingAreaShell frameless class="relative min-h-0 flex-1">
            <SoCTemplatePreviewCanvas
              :template="template"
              :selected-core-id="selectedCoreId"
              @select-core="$emit('select-core', $event)"
            />
          </DrawingAreaShell>
        </div>
      </div>

      <SoCTemplateInspector class="soc-detail__inspector-panel" :template="template" :selected-core="selectedCore" />
    </div>

    <section class="rounded-xl border border-(--border-color) bg-(--bg-secondary)/92 p-4 shadow-sm sm:p-5">
      <div class="mb-4 flex flex-wrap items-end justify-between gap-4 border-b border-(--border-color) pb-3">
        <div>
          <p class="soc-detail__mono text-[10px] font-semibold uppercase tracking-[0.18em] text-(--text-secondary)">Core map</p>
          <h2 class="mt-1 text-lg font-bold tracking-tight text-(--text-primary)">Selection rail</h2>
        </div>
        <span class="soc-detail__mono rounded-xl border border-(--border-color) bg-(--bg-primary) px-3 py-1.5 text-[11px] font-medium tabular-nums text-(--text-secondary)">
          {{ template.cores.length }} total
        </span>
      </div>
      <div class="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2">
        <button
          v-for="core in template.cores"
          :key="core.id"
          type="button"
          class="soc-detail__chip group flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-all duration-200"
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

.soc-detail__title {
  font-size: clamp(1.7rem, 2.6vw, 2.5rem);
  line-height: 1.12;
}

.soc-detail__workbench {
  min-height: min(78vh, 900px);
}

.soc-detail__canvas-panel {
  min-width: 0;
}

.soc-detail__inspector-panel {
  border-left: 1px solid var(--border-color);
}

@media (max-width: 1279px) {
  .soc-detail__inspector-panel {
    border-left: 0;
    border-top: 1px solid var(--border-color);
  }
}

@media (prefers-reduced-motion: reduce) {
  .soc-detail__chip {
    transition: none;
  }
}
</style>
