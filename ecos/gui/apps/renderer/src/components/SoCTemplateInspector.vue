<script setup lang="ts">
import { computed } from 'vue'
import { formatSocArea, formatSocBoundingBox, getSocDisplayCoreLabel } from '@/composables/socTemplatePreviewRenderer'
import type { SocTemplateCore, SocTemplateDetail } from '@/composables/socTemplateMapper'

const props = defineProps<{
  template: SocTemplateDetail
  selectedCore: SocTemplateCore | null
}>()

const selectedInfo = computed(() => props.selectedCore?.info || 'No info provided')
const selectedName = computed(() =>
  props.selectedCore ? getSocDisplayCoreLabel(props.selectedCore.id, props.selectedCore.name) : 'No core selected',
)
const selectedBoundingBox = computed(() =>
  props.selectedCore ? formatSocBoundingBox(props.selectedCore.boundingBox, props.template.dbu) : '',
)
const selectedArea = computed(() => {
  if (!props.selectedCore) return ''

  const box = props.selectedCore.boundingBox
  return formatSocArea(box.area ?? box.width * box.height, props.template.dbu)
})
</script>

<template>
  <aside
    class="soc-inspector flex max-h-[min(82vh,940px)] flex-col gap-5 overflow-y-auto rounded-2xl border border-(--border-color) bg-(--bg-secondary)/95 p-5 shadow-[0_2px_20px_-12px_rgba(0,0,0,0.08)] lg:sticky lg:top-6 dark:shadow-[0_2px_20px_-12px_rgba(0,0,0,0.45)]"
    aria-label="Template inspector"
  >
    <header class="flex items-start justify-between gap-3 border-b border-(--border-color) pb-5">
      <div class="min-w-0">
        <p class="soc-inspector__mono text-[10px] font-semibold uppercase tracking-[0.18em] text-(--text-secondary)">Inspector</p>
        <h2 class="mt-2 break-words text-lg font-bold leading-snug tracking-tight text-(--text-primary)">{{ selectedName }}</h2>
      </div>
      <span class="shrink-0 rounded-lg bg-(--accent-color)/12 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-(--accent-color)">
        Live
      </span>
    </header>

    <section class="space-y-3">
      <h3 class="soc-inspector__mono text-[10px] font-semibold uppercase tracking-wide text-(--text-secondary)">Die summary</h3>
      <div class="space-y-2.5">
        <div class="rounded-xl border border-(--border-color)/90 bg-(--bg-primary) px-3.5 py-3 shadow-inner">
          <span class="soc-inspector__mono text-[10px] font-semibold uppercase tracking-wide text-(--text-secondary)">Design</span>
          <p class="mt-1.5 text-sm font-semibold text-(--text-primary)">{{ template.name }}</p>
        </div>
        <div class="rounded-xl border border-(--border-color)/90 bg-(--bg-primary) px-3.5 py-3 shadow-inner">
          <span class="soc-inspector__mono text-[10px] font-semibold uppercase tracking-wide text-(--text-secondary)">Info</span>
          <p class="mt-1.5 text-sm leading-relaxed text-(--text-primary)">{{ template.info }}</p>
        </div>
        <div class="grid grid-cols-2 gap-2.5">
          <div class="rounded-xl border border-(--border-color)/90 bg-(--bg-primary) px-3.5 py-3 shadow-inner">
            <span class="soc-inspector__mono text-[10px] font-semibold uppercase tracking-wide text-(--text-secondary)">I/O Pins</span>
            <p class="soc-inspector__mono mt-1.5 text-lg font-bold tabular-nums text-(--text-primary)">{{ template.ioPinsCount }}</p>
          </div>
          <div class="rounded-xl border border-(--border-color)/90 bg-(--bg-primary) px-3.5 py-3 shadow-inner">
            <span class="soc-inspector__mono text-[10px] font-semibold uppercase tracking-wide text-(--text-secondary)">Core count</span>
            <p class="soc-inspector__mono mt-1.5 text-lg font-bold tabular-nums text-(--text-primary)">{{ template.coreCount }}</p>
          </div>
        </div>
      </div>
    </section>

    <section class="space-y-3 border-t border-(--border-color) pt-5">
      <h3 class="soc-inspector__mono text-[10px] font-semibold uppercase tracking-wide text-(--text-secondary)">Selected core</h3>
      <div v-if="selectedCore" class="space-y-2.5">
        <div class="rounded-xl border border-(--border-color)/90 bg-(--bg-primary) px-3.5 py-3 shadow-inner">
          <span class="soc-inspector__mono text-[10px] font-semibold uppercase tracking-wide text-(--text-secondary)">id</span>
          <p class="soc-inspector__mono mt-1.5 text-sm font-semibold text-(--text-primary)">{{ selectedCore.id }}</p>
        </div>
        <div class="rounded-xl border border-(--border-color)/90 bg-(--bg-primary) px-3.5 py-3 shadow-inner">
          <span class="soc-inspector__mono text-[10px] font-semibold uppercase tracking-wide text-(--text-secondary)">name</span>
          <p class="mt-1.5 break-all text-sm font-medium leading-relaxed text-(--text-primary)">{{ selectedName }}</p>
        </div>
        <div class="rounded-xl border border-(--border-color)/90 bg-(--bg-primary) px-3.5 py-3 shadow-inner">
          <span class="soc-inspector__mono text-[10px] font-semibold uppercase tracking-wide text-(--text-secondary)">info</span>
          <p class="mt-1.5 text-sm leading-relaxed text-(--text-primary)">{{ selectedInfo }}</p>
        </div>
        <div class="grid grid-cols-2 gap-2.5">
          <div class="rounded-xl border border-(--border-color)/90 bg-(--bg-primary) px-3.5 py-3 shadow-inner">
            <span class="soc-inspector__mono text-[10px] font-semibold uppercase tracking-wide text-(--text-secondary)">IO align</span>
            <p class="soc-inspector__mono mt-1.5 text-sm font-semibold text-(--text-primary)">{{ selectedCore.align }}</p>
          </div>
          <div class="rounded-xl border border-(--border-color)/90 bg-(--bg-primary) px-3.5 py-3 shadow-inner">
            <span class="soc-inspector__mono text-[10px] font-semibold uppercase tracking-wide text-(--text-secondary)">orient</span>
            <p class="soc-inspector__mono mt-1.5 text-sm font-semibold text-(--text-primary)">{{ selectedCore.orient }}</p>
          </div>
        </div>
        <div class="rounded-xl border border-(--border-color)/90 bg-(--bg-primary) px-3.5 py-3 shadow-inner">
          <span class="soc-inspector__mono text-[10px] font-semibold uppercase tracking-wide text-(--text-secondary)">bounding box</span>
          <p class="soc-inspector__mono mt-1.5 text-xs leading-relaxed text-(--text-primary)">{{ selectedBoundingBox }} μm</p>
        </div>
        <div class="rounded-xl border border-(--border-color)/90 bg-(--bg-primary) px-3.5 py-3 shadow-inner">
          <span class="soc-inspector__mono text-[10px] font-semibold uppercase tracking-wide text-(--text-secondary)">area</span>
          <p class="soc-inspector__mono mt-1.5 text-xs leading-relaxed text-(--text-primary)">{{ selectedArea }} μm²</p>
        </div>
      </div>
      <div
        v-else
        class="rounded-xl border border-dashed border-(--border-color) bg-(--bg-primary)/60 px-4 py-8 text-center text-sm text-(--text-secondary)"
      >
        No core selected
      </div>
    </section>
  </aside>
</template>

<style scoped>
.soc-inspector__mono {
  font-family: ui-monospace, 'Cascadia Code', 'SFMono-Regular', 'IBM Plex Mono', Menlo, monospace;
}
</style>
