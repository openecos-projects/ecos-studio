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
    class="soc-inspector flex max-h-[min(78vh,900px)] flex-col overflow-y-auto bg-(--bg-secondary)/80 p-4"
    aria-label="Template inspector"
  >
    <header class="flex items-start justify-between gap-3 border-b border-(--border-color) pb-4">
      <div class="min-w-0">
        <p class="soc-inspector__mono text-[10px] font-semibold uppercase tracking-[0.18em] text-(--text-secondary)">Inspector</p>
        <h2 class="mt-1.5 break-words text-base font-bold leading-snug tracking-tight text-(--text-primary)">{{ selectedName }}</h2>
      </div>
      <span class="shrink-0 rounded-md bg-(--accent-color)/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-(--accent-color)">
        Live
      </span>
    </header>

    <section class="space-y-3 py-4">
      <h3 class="soc-inspector__mono text-[10px] font-semibold uppercase tracking-wide text-(--text-secondary)">Die summary</h3>
      <div class="soc-inspector__stack">
        <div class="soc-inspector__field">
          <span class="soc-inspector__mono text-[10px] font-semibold uppercase tracking-wide text-(--text-secondary)">Design</span>
          <p class="mt-1.5 text-sm font-semibold text-(--text-primary)">{{ template.name }}</p>
        </div>
        <div class="soc-inspector__field">
          <span class="soc-inspector__mono text-[10px] font-semibold uppercase tracking-wide text-(--text-secondary)">Info</span>
          <p class="mt-1.5 text-sm leading-relaxed text-(--text-primary)">{{ template.info }}</p>
        </div>
        <div class="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-(--border-color) bg-(--border-color)">
          <div class="soc-inspector__field">
            <span class="soc-inspector__mono text-[10px] font-semibold uppercase tracking-wide text-(--text-secondary)">I/O Pins</span>
            <p class="soc-inspector__mono mt-1.5 text-lg font-bold tabular-nums text-(--text-primary)">{{ template.ioPinsCount }}</p>
          </div>
          <div class="soc-inspector__field">
            <span class="soc-inspector__mono text-[10px] font-semibold uppercase tracking-wide text-(--text-secondary)">Core count</span>
            <p class="soc-inspector__mono mt-1.5 text-lg font-bold tabular-nums text-(--text-primary)">{{ template.coreCount }}</p>
          </div>
        </div>
      </div>
    </section>

    <section class="space-y-3 border-t border-(--border-color) pt-4">
      <h3 class="soc-inspector__mono text-[10px] font-semibold uppercase tracking-wide text-(--text-secondary)">Selected core</h3>
      <div v-if="selectedCore" class="soc-inspector__stack">
        <div class="soc-inspector__field">
          <span class="soc-inspector__mono text-[10px] font-semibold uppercase tracking-wide text-(--text-secondary)">id</span>
          <p class="soc-inspector__mono mt-1.5 text-sm font-semibold text-(--text-primary)">{{ selectedCore.id }}</p>
        </div>
        <div class="soc-inspector__field">
          <span class="soc-inspector__mono text-[10px] font-semibold uppercase tracking-wide text-(--text-secondary)">name</span>
          <p class="mt-1.5 break-all text-sm font-medium leading-relaxed text-(--text-primary)">{{ selectedName }}</p>
        </div>
        <div class="soc-inspector__field">
          <span class="soc-inspector__mono text-[10px] font-semibold uppercase tracking-wide text-(--text-secondary)">info</span>
          <p class="mt-1.5 text-sm leading-relaxed text-(--text-primary)">{{ selectedInfo }}</p>
        </div>
        <div class="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-(--border-color) bg-(--border-color)">
          <div class="soc-inspector__field">
            <span class="soc-inspector__mono text-[10px] font-semibold uppercase tracking-wide text-(--text-secondary)">IO align</span>
            <p class="soc-inspector__mono mt-1.5 text-sm font-semibold text-(--text-primary)">{{ selectedCore.align }}</p>
          </div>
          <div class="soc-inspector__field">
            <span class="soc-inspector__mono text-[10px] font-semibold uppercase tracking-wide text-(--text-secondary)">orient</span>
            <p class="soc-inspector__mono mt-1.5 text-sm font-semibold text-(--text-primary)">{{ selectedCore.orient }}</p>
          </div>
        </div>
        <div class="soc-inspector__field">
          <span class="soc-inspector__mono text-[10px] font-semibold uppercase tracking-wide text-(--text-secondary)">bounding box</span>
          <p class="soc-inspector__mono mt-1.5 text-xs leading-relaxed text-(--text-primary)">{{ selectedBoundingBox }} μm</p>
        </div>
        <div class="soc-inspector__field">
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

.soc-inspector__stack {
  display: grid;
  gap: 1px;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--border-color);
}

.soc-inspector__field {
  min-width: 0;
  background: color-mix(in srgb, var(--bg-primary) 88%, var(--bg-secondary));
  padding: 12px 14px;
}

.soc-inspector {
  scrollbar-gutter: stable;
}
</style>
