<script setup lang="ts">
import { ref } from 'vue'
import { importSocTemplateFromJsonText, removeImportedSocTemplate } from '@/composables/socTemplateCatalog'
import type { SocTemplateSummary } from '@/composables/socTemplateMapper'

defineProps<{
  items: SocTemplateSummary[]
  loading: boolean
  error: string | null
}>()

const emit = defineEmits<{
  back: []
  open: [templateId: string]
  retry: []
  'catalog-changed': []
}>()

const fileInputRef = ref<HTMLInputElement | null>(null)
const importError = ref<string | null>(null)
const importBusy = ref(false)

function coreDots(count: number): number[] {
  const n = Math.max(1, Math.min(count, 9))
  return Array.from({ length: n }, (_, i) => i)
}

function triggerImportPicker(): void {
  importError.value = null
  fileInputRef.value?.click()
}

async function onImportFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  importBusy.value = true
  importError.value = null

  try {
    const text = await file.text()
    const label = file.name.replace(/\.json$/i, '') || file.name
    await importSocTemplateFromJsonText(text, label)
    emit('catalog-changed')
  } catch (err) {
    importError.value = err instanceof Error ? err.message : 'Import failed.'
  } finally {
    importBusy.value = false
  }
}

function onRemoveImported(templateId: string): void {
  removeImportedSocTemplate(templateId)
  emit('catalog-changed')
}

function sourceBadgeLabel(sourceLabel: string): string {
  return sourceLabel.startsWith('remote:') ? 'Remote' : 'Local'
}

function sourceBadgeTitle(sourceLabel: string): string {
  return sourceLabel.startsWith('remote:')
    ? 'Loaded from the remote SoC template catalog'
    : 'Stored from an imported file on this browser'
}
</script>

<template>
  <section class="soc-gallery flex flex-col gap-10" aria-label="SoC template catalog">
    <!-- Hero -->
    <header class="soc-gallery__hero relative overflow-hidden rounded-2xl border border-(--border-color) bg-(--bg-secondary)/85 p-6 shadow-[0_1px_0_0_color-mix(in_srgb,var(--border-color)_80%,transparent)] sm:p-8">
      <div class="soc-gallery__hero-accent pointer-events-none" aria-hidden="true" />
      <div class="relative flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
        <div class="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
          <button
            type="button"
            class="group inline-flex w-max shrink-0 items-center gap-2 rounded-xl border border-(--border-color) bg-(--bg-primary) px-4 py-2.5 text-sm font-medium text-(--text-primary) shadow-sm transition-all duration-200 hover:border-(--accent-color) hover:text-(--accent-color) hover:shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent-color)_35%,transparent)]"
            @click="$emit('back')"
          >
            <i class="ri-arrow-left-line text-lg transition-transform duration-200 group-hover:-translate-x-0.5" aria-hidden="true"></i>
            Back
          </button>

          <div class="min-w-0 pl-0 sm:border-l sm:border-(--border-color) sm:pl-7">
            <div class="flex flex-wrap items-center gap-2">
              <span class="soc-gallery__mono text-[10px] font-semibold uppercase tracking-[0.22em] text-(--text-secondary)">RetroSoC</span>
              <span class="h-3 w-px bg-(--border-color)" aria-hidden="true" />
              <span class="rounded-md bg-(--accent-color)/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-(--accent-color)">
                Floorplan catalog
              </span>
            </div>
            <h1 class="mt-3 font-bold tracking-tight text-(--text-primary) sm:text-4xl sm:leading-[1.08]" style="font-size: clamp(1.65rem, 4vw, 2.35rem)">
              Templates
            </h1>
            <p class="mt-3 max-w-lg text-sm leading-relaxed text-(--text-secondary) sm:text-[15px]">
              Inspect floorplans and core bounding boxes from the remote SoC catalog, with local JSON imports available for private drafts.
            </p>
            <p
              class="mt-4 max-w-2xl rounded-xl border border-(--accent-color)/22 bg-(--accent-color)/[0.06] px-4 py-3 text-xs leading-relaxed text-(--text-secondary)"
              role="note"
            >
              <span class="font-semibold text-(--text-primary)">Catalog-backed:</span>
              remote entries are cached by the desktop app, while imported files stay on this device.
            </p>
          </div>
        </div>

        <div class="flex w-full flex-col gap-3 sm:max-w-md sm:self-end lg:w-auto lg:max-w-none">
          <input
            ref="fileInputRef"
            type="file"
            accept=".json,application/json"
            class="sr-only"
            aria-hidden="true"
            tabindex="-1"
            @change="onImportFileChange"
          />
          <div class="flex flex-wrap items-center gap-3 sm:justify-end">
            <button
              type="button"
              class="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-(--accent-color) px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_28px_-14px_color-mix(in_srgb,var(--accent-color)_75%,transparent)] transition-[transform,box-shadow,opacity] duration-200 hover:-translate-y-px hover:shadow-[0_16px_36px_-16px_color-mix(in_srgb,var(--accent-color)_55%,transparent)] disabled:cursor-not-allowed disabled:opacity-45 sm:flex-none"
              :disabled="importBusy"
              @click="triggerImportPicker"
            >
              <i class="ri-upload-cloud-2-line text-lg" aria-hidden="true"></i>
              Import JSON
            </button>
            <div
              class="inline-flex items-center gap-3 rounded-2xl border border-(--border-color) bg-(--bg-primary) px-4 py-2.5 text-xs font-medium text-(--text-secondary) shadow-inner"
              aria-label="catalog summary"
            >
              <span class="flex h-2 w-2 animate-pulse rounded-full bg-(--accent-color) shadow-[0_0_10px_color-mix(in_srgb,var(--accent-color)_55%,transparent)]" aria-hidden="true" />
              <span><strong class="soc-gallery__mono text-base font-semibold tabular-nums text-(--text-primary)">{{ items.length }}</strong> templates</span>
            </div>
          </div>
        </div>
      </div>
    </header>

    <Transition name="soc-gallery-fade">
      <p v-if="importError" class="rounded-xl border border-red-500/25 bg-red-500/[0.06] px-4 py-3 text-sm text-red-600 dark:text-red-400" role="alert">
        {{ importError }}
      </p>
    </Transition>

    <!-- Loading -->
    <div
      v-if="loading"
      class="soc-gallery__panel rounded-2xl border border-(--border-color) bg-(--bg-secondary)/90 p-10"
      aria-busy="true"
    >
      <div class="soc-gallery__shimmer mx-auto max-w-lg space-y-5">
        <div class="flex gap-3">
          <div class="soc-gallery__bone h-10 w-44 rounded-lg" />
          <div class="soc-gallery__bone h-10 flex-1 rounded-lg opacity-70" />
        </div>
        <div class="soc-gallery__bone h-36 rounded-xl" />
        <div class="soc-gallery__bone h-24 rounded-xl opacity-80" />
        <p class="text-center text-sm font-medium text-(--text-secondary)">Loading templates…</p>
      </div>
    </div>

    <!-- Error -->
    <div
      v-else-if="error"
      class="soc-gallery__panel flex flex-col gap-5 rounded-2xl border border-red-500/30 bg-red-500/[0.07] p-8 sm:flex-row sm:items-center"
      role="alert"
    >
      <div
        class="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-red-500/35 bg-red-500/15 font-mono text-xl font-bold text-red-600"
        aria-hidden="true"
      >
        !
      </div>
      <div class="min-w-0 flex-1">
        <h2 class="text-lg font-semibold tracking-tight text-(--text-primary)">Catalog load failed</h2>
        <p class="mt-2 text-sm leading-relaxed text-(--text-secondary)">{{ error }}</p>
      </div>
      <button
        type="button"
        class="inline-flex shrink-0 items-center justify-center rounded-xl bg-(--accent-color) px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-(--accent-color)/25 transition-opacity hover:opacity-92"
        @click="$emit('retry')"
      >
        Retry
      </button>
    </div>

    <!-- Empty -->
    <div
      v-else-if="items.length === 0"
      class="soc-gallery__panel rounded-2xl border border-dashed border-(--border-color) bg-(--bg-secondary)/60 px-8 py-16 text-center"
    >
      <div
        class="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-(--border-color) bg-(--bg-primary) font-mono text-2xl font-bold text-(--text-secondary)"
        aria-hidden="true"
      >
        ∅
      </div>
      <h2 class="text-lg font-semibold tracking-tight text-(--text-primary)">No templates yet</h2>
      <p class="mx-auto mt-2 max-w-md text-sm leading-relaxed text-(--text-secondary)">
        Refresh the catalog or import a <span class="soc-gallery__mono text-(--text-primary)/90">soc.json</span>-style file to inspect floorplans on this machine.
      </p>
    </div>

    <!-- Grid -->
    <div v-else class="flex flex-col gap-6">
      <div class="flex flex-wrap items-end justify-between gap-4 border-b border-(--border-color) pb-4">
        <div>
          <p class="soc-gallery__mono text-[10px] font-semibold uppercase tracking-[0.2em] text-(--text-secondary)">Registry</p>
          <p class="mt-1 text-sm text-(--text-secondary)">Selectable templates in this workspace.</p>
        </div>
        <span class="soc-gallery__mono rounded-lg border border-(--border-color) bg-(--bg-primary) px-3 py-1.5 text-[11px] font-medium tabular-nums text-(--text-secondary)">
          {{ items.length }} entries
        </span>
      </div>

      <ul class="soc-gallery__list grid list-none gap-5 p-0 sm:grid-cols-1 lg:grid-cols-2">
        <li v-for="item in items" :key="item.id" class="soc-gallery__li">
          <article
            class="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-(--border-color) bg-(--bg-secondary)/95 p-5 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.06)] transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-1 hover:border-(--accent-color)/45 hover:shadow-[0_16px_40px_-24px_color-mix(in_srgb,var(--accent-color)_28%,transparent)] dark:shadow-[0_2px_12px_-4px_rgba(0,0,0,0.35)]"
          >
            <div
              class="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-(--accent-color)/35 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              aria-hidden="true"
            />

            <div class="flex gap-4">
              <div
                class="soc-gallery__thumb relative h-[92px] w-[92px] shrink-0 overflow-hidden rounded-2xl border border-(--border-color) bg-(--bg-primary) shadow-inner"
                aria-hidden="true"
              >
                <div class="soc-gallery__die-pattern pointer-events-none absolute inset-0 opacity-[0.35]" aria-hidden="true" />
                <template v-if="item.thumbnail">
                  <div class="pointer-events-none absolute inset-0">
                    <div
                      class="absolute box-border overflow-hidden rounded-md border border-(--accent-color)/28 bg-(--accent-color)/10"
                      :style="{
                        left: `${item.thumbnail.coreSlotLeftPct}%`,
                        top: `${item.thumbnail.coreSlotTopPct}%`,
                        width: `${item.thumbnail.coreSlotWidthPct}%`,
                        height: `${item.thumbnail.coreSlotHeightPct}%`,
                      }"
                    >
                      <div
                        v-for="(core, tidx) in item.thumbnail.cores"
                        :key="`${item.id}-thumb-core-${tidx}`"
                        class="soc-gallery__thumb-core pointer-events-none absolute min-h-[2px] min-w-[2px] rounded-[3px] bg-(--accent-color) shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent-color)_40%,transparent)]"
                        :style="{
                          left: `${core.leftPct}%`,
                          top: `${core.topPct}%`,
                          width: `${core.widthPct}%`,
                          height: `${core.heightPct}%`,
                        }"
                      ></div>
                    </div>
                  </div>
                </template>
                <div
                  v-else
                  class="relative flex h-full w-full items-center justify-center"
                >
                  <div class="grid grid-cols-3 gap-1">
                    <span
                      v-for="i in coreDots(item.coreCount)"
                      :key="`${item.id}-c-${i}`"
                      class="h-2 w-2 rounded-sm bg-(--accent-color) shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent-color)_35%,transparent)]"
                    />
                  </div>
                </div>
              </div>

              <div class="min-w-0 flex-1 pt-0.5">
                <div class="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  <span
                    class="rounded-md bg-(--text-secondary)/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-(--text-secondary)"
                    :title="sourceBadgeTitle(item.sourceLabel)"
                  >
                    {{ sourceBadgeLabel(item.sourceLabel) }}
                  </span>
                  <span
                    class="inline-flex items-baseline gap-1 rounded-lg border border-(--border-color)/85 bg-(--bg-primary) px-2 py-0.5 shadow-[inset_0_1px_0_0_color-mix(in_srgb,var(--border-color)_35%,transparent)]"
                    :title="`${item.coreCount} cores`"
                  >
                    <span class="soc-gallery__mono text-sm font-bold tabular-nums leading-none text-(--text-primary)">{{ item.coreCount }}</span>
                    <span class="text-[10px] font-medium uppercase tracking-wide text-(--text-secondary)">cores</span>
                  </span>
                </div>
                <h2 class="mt-2.5 text-lg font-bold leading-snug tracking-tight text-(--text-primary) sm:text-xl">{{ item.name }}</h2>
                <p class="mt-1.5 line-clamp-2 text-sm leading-relaxed text-(--text-secondary)">{{ item.info }}</p>
              </div>
            </div>

            <div class="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-(--border-color)/80 pt-4">
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-xl border border-(--border-color) px-3.5 py-2 text-sm font-medium text-(--text-secondary) transition-colors hover:border-red-500/45 hover:bg-red-500/[0.07] hover:text-red-600"
                @click="onRemoveImported(item.id)"
              >
                <i class="ri-delete-bin-line text-base" aria-hidden="true"></i>
                Hide
              </button>
              <button
                type="button"
                class="inline-flex items-center gap-2 rounded-xl bg-(--accent-color) px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_24px_-14px_color-mix(in_srgb,var(--accent-color)_70%,transparent)] transition-[transform,opacity] duration-200 hover:-translate-y-px hover:opacity-95"
                @click="$emit('open', item.id)"
              >
                Open Details
                <i class="ri-arrow-right-up-line text-base" aria-hidden="true"></i>
              </button>
            </div>
          </article>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.soc-gallery__mono {
  font-family: ui-monospace, 'Cascadia Code', 'SFMono-Regular', 'IBM Plex Mono', Menlo, monospace;
}

.soc-gallery__die-pattern {
  background-image: repeating-linear-gradient(
    -12deg,
    transparent,
    transparent 5px,
    color-mix(in srgb, var(--border-color) 55%, transparent) 5px,
    color-mix(in srgb, var(--border-color) 55%, transparent) 6px
  );
}

.soc-gallery__hero {
  box-shadow:
    0 1px 0 0 color-mix(in srgb, var(--border-color) 75%, transparent),
    inset 0 1px 0 0 color-mix(in srgb, var(--bg-primary) 70%, transparent);
}

.soc-gallery__hero-accent {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--accent-color) 75%, transparent) 0%,
    color-mix(in srgb, var(--accent-color) 35%, transparent) 45%,
    color-mix(in srgb, var(--accent-color) 15%, transparent) 100%
  );
  border-radius: 1rem 0 0 1rem;
}

.soc-gallery__panel {
  box-shadow: 0 2px 16px -8px color-mix(in srgb, var(--text-primary) 12%, transparent);
}

.soc-gallery__bone {
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--border-color) 55%, transparent) 0%,
    color-mix(in srgb, var(--bg-primary) 90%, var(--border-color)) 50%,
    color-mix(in srgb, var(--border-color) 55%, transparent) 100%
  );
  background-size: 200% 100%;
  animation: soc-shimmer 1.35s ease-in-out infinite;
}

@keyframes soc-shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .soc-gallery__bone {
    animation: none;
    background: color-mix(in srgb, var(--border-color) 35%, transparent);
  }

  .soc-gallery__li {
    animation: none !important;
  }
}

.soc-gallery__li {
  animation: soc-rise 0.55s cubic-bezier(0.22, 1, 0.36, 1) backwards;
  animation-delay: 0ms;
}

.soc-gallery__li:nth-child(2) {
  animation-delay: 52ms;
}
.soc-gallery__li:nth-child(3) {
  animation-delay: 104ms;
}
.soc-gallery__li:nth-child(4) {
  animation-delay: 156ms;
}
.soc-gallery__li:nth-child(5) {
  animation-delay: 208ms;
}
.soc-gallery__li:nth-child(6) {
  animation-delay: 260ms;
}
.soc-gallery__li:nth-child(7) {
  animation-delay: 312ms;
}
.soc-gallery__li:nth-child(8) {
  animation-delay: 364ms;
}
.soc-gallery__li:nth-child(9) {
  animation-delay: 416ms;
}
.soc-gallery__li:nth-child(10) {
  animation-delay: 468ms;
}
.soc-gallery__li:nth-child(11) {
  animation-delay: 520ms;
}
.soc-gallery__li:nth-child(12) {
  animation-delay: 572ms;
}

@keyframes soc-rise {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.soc-gallery-fade-enter-active,
.soc-gallery-fade-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.soc-gallery-fade-enter-from,
.soc-gallery-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
