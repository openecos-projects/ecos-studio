<script setup lang="ts">
import { computed, ref } from 'vue'
import { buildSocIoPinRects, buildSocPreviewRects, getSocDisplayCoreLabel } from '@/composables/socTemplatePreviewRenderer'
import type { SocTemplateDetail } from '@/composables/socTemplateMapper'

const props = defineProps<{
  template: SocTemplateDetail
  selectedCoreId: number | null
}>()

const emit = defineEmits<{
  'select-core': [coreId: number]
}>()

const hoveredCoreId = ref<number | null>(null)
const focusedCoreId = ref<number | null>(null)
const hoveredIoName = ref<string | null>(null)
const showIoLayer = ref(true)
const showLabels = ref(true)

function isSelectableCoreId(coreId: number): boolean {
  return Number.isFinite(coreId) && coreId >= 0
}

const renderedRects = computed(() =>
  buildSocPreviewRects(props.template).flatMap((rect, index) =>
    isSelectableCoreId(rect.coreId)
      ? [{ ...rect, renderKey: `${rect.coreId}-${index}` }]
      : [],
  ),
)

const ioRects = computed(() => buildSocIoPinRects(props.template))
const inspectedCoreId = computed(() => hoveredCoreId.value ?? focusedCoreId.value)
const activeCoreId = computed(() => inspectedCoreId.value ?? props.selectedCoreId)
const activeCore = computed(() => {
  const coreId = activeCoreId.value
  if (coreId === null) {
    return null
  }

  return props.template.cores.find(core => core.id === coreId) ?? null
})
const validCoreCount = computed(() => renderedRects.value.length)
const activeStatusKind = computed(() => {
  if (hoveredIoName.value) {
    return 'I/O pin'
  }

  return activeCore.value ? 'Core' : 'Selection'
})
const activeStatusLabel = computed(() => {
  if (hoveredIoName.value) {
    return hoveredIoName.value
  }

  return activeCore.value ? getSocDisplayCoreLabel(activeCore.value.id, activeCore.value.name) : 'No core selected'
})

const coreSlotStyle = computed(() => {
  const { die, coreArea: c } = props.template
  if (!die.width || !die.height) return {}
  return {
    left: `${((c.llx - die.llx) / die.width) * 100}%`,
    top: `${((die.ury - c.ury) / die.height) * 100}%`,
    width: `${(c.width / die.width) * 100}%`,
    height: `${(c.height / die.height) * 100}%`,
  }
})

function setHoveredCore(coreId: number | null): void {
  hoveredCoreId.value = coreId !== null && isSelectableCoreId(coreId) ? coreId : null
}

function setFocusedCore(coreId: number | null): void {
  focusedCoreId.value = coreId !== null && isSelectableCoreId(coreId) ? coreId : null
}

function setHoveredIo(name: string | null): void {
  hoveredIoName.value = name
}

function toggleIoLayer(): void {
  showIoLayer.value = !showIoLayer.value

  if (!showIoLayer.value) {
    hoveredIoName.value = null
  }
}

function toggleLabels(): void {
  showLabels.value = !showLabels.value
}

function coreTitle(rect: { label: string; coreId: number; align: string; orient: string }): string {
  return `${rect.label} · id ${rect.coreId} · align ${rect.align} · orient ${rect.orient}`
}

function alignPlacement(align: string): 'left' | 'right' | 'top' | 'bottom' | null {
  const value = align.trim().toLowerCase()
  if (['left', 'l', 'west', 'w'].includes(value)) return 'left'
  if (['right', 'r', 'east', 'e'].includes(value)) return 'right'
  if (['top', 'upper', 'north', 'n'].includes(value)) return 'top'
  if (['bottom', 'lower', 'south', 's'].includes(value)) return 'bottom'
  return null
}

function shouldShowAlignMarker(coreId: number, align: string): boolean {
  return coreId === activeCoreId.value && alignPlacement(align) !== null
}

function selectCore(coreId: number): void {
  if (!isSelectableCoreId(coreId)) {
    return
  }

  emit('select-core', coreId)
}
</script>

<template>
  <div
    class="soc-template-preview-canvas"
    :class="{ 'soc-template-preview-canvas--labels-hidden': !showLabels }"
    @mouseleave="setHoveredCore(null)"
  >
    <div class="soc-template-preview-canvas__toolbar" aria-label="Preview controls">
      <div class="soc-template-preview-canvas__identity">
        <span class="soc-template-preview-canvas__identity-icon" aria-hidden="true">
          <i class="ri-cpu-line"></i>
        </span>
        <div class="soc-template-preview-canvas__identity-copy">
          <span>Floorplan</span>
          <strong :title="template.name">{{ template.name }}</strong>
        </div>
      </div>

      <div class="soc-template-preview-canvas__actions" role="group" aria-label="Preview layers">
        <button
          type="button"
          class="soc-template-preview-canvas__toggle"
          :class="{ 'is-on': showIoLayer }"
          :aria-pressed="showIoLayer"
          :title="showIoLayer ? 'Hide I/O layer' : 'Show I/O layer'"
          @click="toggleIoLayer"
        >
          <i class="ri-layout-row-line" aria-hidden="true"></i>
          <span>I/O</span>
        </button>
        <button
          type="button"
          class="soc-template-preview-canvas__toggle"
          :class="{ 'is-on': showLabels }"
          :aria-pressed="showLabels"
          :title="showLabels ? 'Hide labels' : 'Show labels'"
          @click="toggleLabels"
        >
          <i class="ri-font-size-2" aria-hidden="true"></i>
          <span>Labels</span>
        </button>
      </div>
    </div>

    <div class="soc-template-preview-canvas__stage">
      <div class="soc-template-preview-canvas__die soc-preview-die">
        <div class="soc-preview-die__corners" aria-hidden="true" />

        <div v-show="showIoLayer" class="soc-preview-die__io" aria-label="I/O pads">
          <div
            v-for="io in ioRects"
            :key="`io-${io.pinIndex}-${io.placement}`"
            class="soc-preview-die__io-pin"
            :class="{ 'soc-preview-die__io-pin--ring': io.placement === 'ring' }"
            :title="io.name"
            role="img"
            :aria-label="`IO ${io.name}`"
            @mouseenter="setHoveredIo(io.name)"
            @mouseleave="setHoveredIo(null)"
            :style="{
              left: `${io.leftPct}%`,
              top: `${io.topPct}%`,
              width: `${io.widthPct}%`,
              height: `${io.heightPct}%`,
            }"
          >
            <div class="soc-preview-die__io-box">
              <span class="soc-preview-die__io-label">{{ io.shortLabel }}</span>
            </div>
          </div>
        </div>

        <div class="soc-template-preview-canvas__core-area soc-preview-die__cores" :style="coreSlotStyle">
          <button
            v-for="rect in renderedRects"
            :key="rect.renderKey"
            type="button"
            class="soc-template-preview-canvas__core soc-preview-die__core-btn"
            :class="{
              'is-selected': rect.coreId === selectedCoreId,
              'is-active': rect.coreId === activeCoreId,
              'is-muted': inspectedCoreId !== null && rect.coreId !== inspectedCoreId,
            }"
            :data-soc-core-id="rect.coreId"
            :aria-pressed="rect.coreId === selectedCoreId"
            :title="coreTitle(rect)"
            :style="{
              left: `${rect.leftPct}%`,
              top: `${rect.topPct}%`,
              width: `${rect.widthPct}%`,
              height: `${rect.heightPct}%`,
            }"
            @mouseenter="setHoveredCore(rect.coreId)"
            @mouseleave="setHoveredCore(null)"
            @focus="setFocusedCore(rect.coreId)"
            @blur="setFocusedCore(null)"
            @click="selectCore(rect.coreId)"
          >
            <span class="soc-template-preview-canvas__core-label">{{ rect.label }}</span>
            <span class="soc-template-preview-canvas__core-id">#{{ rect.coreId }}</span>
            <span
              v-if="shouldShowAlignMarker(rect.coreId, rect.align)"
              class="soc-template-preview-canvas__align-marker"
              :class="`soc-template-preview-canvas__align-marker--${alignPlacement(rect.align)}`"
              aria-hidden="true"
            />
          </button>

          <div v-if="validCoreCount === 0" class="soc-template-preview-canvas__empty" role="status">
            <i class="ri-cpu-line" aria-hidden="true"></i>
            <strong>No selectable cores</strong>
          </div>
        </div>
      </div>
    </div>

    <div class="soc-template-preview-canvas__status" aria-live="polite">
      <div class="soc-template-preview-canvas__status-main">
        <span>{{ activeStatusKind }}</span>
        <strong :title="activeStatusLabel">{{ activeStatusLabel }}</strong>
      </div>

      <dl v-if="activeCore" class="soc-template-preview-canvas__status-grid">
        <div>
          <dt>ID</dt>
          <dd>#{{ activeCore.id }}</dd>
        </div>
        <div>
          <dt>Align</dt>
          <dd>{{ activeCore.align }}</dd>
        </div>
        <div>
          <dt>Orient</dt>
          <dd>{{ activeCore.orient }}</dd>
        </div>
      </dl>

      <dl v-else class="soc-template-preview-canvas__status-grid">
        <div>
          <dt>Cores</dt>
          <dd>{{ validCoreCount }}</dd>
        </div>
        <div>
          <dt>I/O</dt>
          <dd>{{ template.ioPinsCount }}</dd>
        </div>
      </dl>
    </div>
  </div>
</template>

<style scoped>
.soc-template-preview-canvas {
  width: 100%;
  height: 100%;
  min-height: 560px;
  padding: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  align-items: center;
  justify-items: center;
  gap: 12px;
  color: var(--text-primary);
  container-type: inline-size;
}

.soc-template-preview-canvas__toolbar,
.soc-template-preview-canvas__status {
  width: min(100%, 820px);
}

.soc-template-preview-canvas__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px;
  border: 1px solid color-mix(in srgb, var(--border-color) 84%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-secondary) 84%, var(--bg-primary));
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--bg-primary) 72%, transparent);
}

.soc-template-preview-canvas__identity {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.soc-template-preview-canvas__identity-icon {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--accent-color) 34%, var(--border-color));
  background: color-mix(in srgb, var(--accent-color) 10%, var(--bg-primary));
  color: color-mix(in srgb, var(--accent-color) 88%, var(--text-primary));
  font-size: 17px;
}

.soc-template-preview-canvas__identity-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.soc-template-preview-canvas__identity-copy span,
.soc-template-preview-canvas__status-main span,
.soc-template-preview-canvas__status-grid dt {
  font-family: ui-monospace, 'Cascadia Code', 'SFMono-Regular', 'IBM Plex Mono', Menlo, monospace;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.soc-template-preview-canvas__identity-copy strong {
  display: block;
  max-width: min(42vw, 420px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: 1.2;
}

.soc-template-preview-canvas__actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  padding: 3px;
  border: 1px solid color-mix(in srgb, var(--border-color) 78%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-primary) 80%, var(--bg-secondary));
}

.soc-template-preview-canvas__toggle {
  min-height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition:
    color 160ms ease,
    border-color 160ms ease,
    background-color 160ms ease,
    box-shadow 160ms ease;
}

.soc-template-preview-canvas__toggle:hover,
.soc-template-preview-canvas__toggle:focus-visible {
  color: var(--text-primary);
  border-color: color-mix(in srgb, var(--border-color) 92%, transparent);
  background: color-mix(in srgb, var(--bg-secondary) 92%, var(--accent-color));
}

.soc-template-preview-canvas__toggle:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-color) 56%, transparent);
  outline-offset: 2px;
}

.soc-template-preview-canvas__toggle.is-on {
  border-color: color-mix(in srgb, var(--accent-color) 40%, var(--border-color));
  background: color-mix(in srgb, var(--accent-color) 13%, var(--bg-primary));
  color: color-mix(in srgb, var(--accent-color) 88%, var(--text-primary));
  box-shadow: 0 8px 20px -16px color-mix(in srgb, var(--accent-color) 52%, transparent);
}

.soc-template-preview-canvas__stage {
  width: 100%;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2px 0;
}

.soc-preview-die {
  position: relative;
  width: min(100%, 760px);
  min-width: min(100%, 280px);
  aspect-ratio: 1;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--border-color) 88%, transparent);
  background:
    linear-gradient(color-mix(in srgb, var(--border-color) 18%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--border-color) 18%, transparent) 1px, transparent 1px),
    radial-gradient(circle at 50% 42%, color-mix(in srgb, var(--accent-color) 12%, transparent) 0%, transparent 42%),
    linear-gradient(145deg, color-mix(in srgb, var(--bg-primary) 94%, var(--accent-color)) 0%, var(--bg-secondary) 58%, var(--bg-primary) 100%);
  background-size: 22px 22px, 22px 22px, auto, auto;
  box-shadow:
    0 1px 0 color-mix(in srgb, var(--border-color) 64%, transparent),
    inset 0 1px 0 color-mix(in srgb, var(--bg-primary) 70%, transparent),
    0 24px 44px -38px color-mix(in srgb, var(--text-primary) 34%, transparent);
  overflow: hidden;
  box-sizing: border-box;
  isolation: isolate;
}

.soc-preview-die__corners {
  position: absolute;
  inset: 10px;
  z-index: 4;
  pointer-events: none;
  border: 1px solid color-mix(in srgb, var(--accent-color) 14%, transparent);
  border-radius: 7px;
  opacity: 0.9;
}

.soc-preview-die__corners::before,
.soc-preview-die__corners::after {
  content: "";
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  pointer-events: none;
}

.soc-preview-die__corners::before {
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--accent-color) 64%, transparent) 0 22px, transparent 22px) left top / 62px 1px no-repeat,
    linear-gradient(180deg, color-mix(in srgb, var(--accent-color) 64%, transparent) 0 22px, transparent 22px) left top / 1px 62px no-repeat,
    linear-gradient(270deg, color-mix(in srgb, var(--accent-color) 64%, transparent) 0 22px, transparent 22px) right bottom / 62px 1px no-repeat,
    linear-gradient(0deg, color-mix(in srgb, var(--accent-color) 64%, transparent) 0 22px, transparent 22px) right bottom / 1px 62px no-repeat;
}

.soc-preview-die__io {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  transition: opacity 170ms ease;
}

.soc-preview-die__io-pin {
  position: absolute;
  box-sizing: border-box;
  pointer-events: auto;
  cursor: help;
  container-type: size;
  container-name: soc-io-pin;
  z-index: 1;
}

.soc-preview-die__io-box {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  border-radius: 4px;
  border: 1px solid color-mix(in srgb, var(--accent-color) 44%, var(--border-color));
  background: color-mix(in srgb, var(--accent-color) 18%, var(--bg-secondary));
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--bg-primary) 45%, transparent),
    0 0 0 1px color-mix(in srgb, var(--accent-color) 12%, transparent);
  transition:
    transform 160ms cubic-bezier(0.22, 1, 0.36, 1),
    border-color 160ms ease,
    background-color 160ms ease,
    box-shadow 160ms ease;
}

.soc-preview-die__io-pin:hover {
  z-index: 6;
}

.soc-preview-die__io-pin:hover .soc-preview-die__io-box {
  transform: scale(1.12);
  border-color: color-mix(in srgb, var(--accent-color) 78%, var(--border-color));
  background: color-mix(in srgb, var(--accent-color) 30%, var(--bg-primary));
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--accent-color) 26%, transparent),
    0 8px 18px -13px color-mix(in srgb, var(--accent-color) 58%, transparent);
}

.soc-preview-die__io-pin--ring .soc-preview-die__io-box {
  border-style: dashed;
  border-color: color-mix(in srgb, var(--accent-color) 42%, var(--border-color));
  background: color-mix(in srgb, var(--accent-color) 14%, var(--bg-primary));
}

.soc-preview-die__io-label {
  font-family: ui-monospace, 'Cascadia Code', 'SFMono-Regular', monospace;
  font-size: clamp(8px, 16cqmin, 12px);
  font-weight: 800;
  line-height: 1.1;
  text-align: center;
  color: color-mix(in srgb, var(--text-primary) 94%, var(--bg-primary));
  text-shadow: 0 1px 0 color-mix(in srgb, var(--bg-primary) 55%, transparent);
  -webkit-font-smoothing: antialiased;
  max-width: 100%;
  max-height: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
  transition:
    opacity 140ms ease,
    transform 140ms ease;
}

@container soc-io-pin (max-height: 10px) {
  .soc-preview-die__io-label {
    display: none;
  }
}

@container soc-io-pin (max-width: 22px) and (min-height: 11px) {
  .soc-preview-die__io-label {
    display: block;
    writing-mode: vertical-rl;
    text-orientation: mixed;
    font-size: clamp(7px, 11cqh, 11px);
    line-height: 1.05;
    max-width: none;
    max-height: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.soc-template-preview-canvas__core-area {
  position: absolute;
  z-index: 2;
  box-sizing: border-box;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--accent-color) 28%, var(--border-color));
  background:
    linear-gradient(color-mix(in srgb, var(--border-color) 12%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--border-color) 12%, transparent) 1px, transparent 1px),
    radial-gradient(circle at 45% 35%, color-mix(in srgb, var(--accent-color) 10%, transparent) 0%, transparent 42%),
    linear-gradient(
      145deg,
      color-mix(in srgb, var(--bg-secondary) 96%, var(--accent-color)) 0%,
      color-mix(in srgb, var(--bg-primary) 88%, var(--bg-secondary)) 100%
    );
  background-size: 16px 16px, 16px 16px, auto, auto;
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--accent-color) 12%, transparent),
    inset 0 18px 48px -28px color-mix(in srgb, var(--text-primary) 8%, transparent);
  overflow: hidden;
}

.soc-template-preview-canvas__core {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  padding: 4px;
  border-radius: 7px;
  border: 1px solid color-mix(in srgb, var(--accent-color) 42%, var(--border-color));
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--bg-primary) 22%, transparent), transparent),
    color-mix(in srgb, var(--accent-color) 15%, var(--bg-secondary));
  color: var(--text-primary);
  font: inherit;
  cursor: pointer;
  overflow: visible;
  z-index: 2;
  transform: translateZ(0);
  transition:
    transform 160ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 160ms ease,
    background-color 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease;
}

.soc-template-preview-canvas__core:hover {
  z-index: 7;
  transform: scale(1.025);
  border-color: color-mix(in srgb, var(--accent-color) 65%, transparent);
  background: color-mix(in srgb, var(--accent-color) 24%, var(--bg-secondary));
}

.soc-template-preview-canvas__core:focus-visible {
  z-index: 8;
  outline: 2px solid color-mix(in srgb, var(--accent-color) 70%, transparent);
  outline-offset: 2px;
}

.soc-template-preview-canvas__core.is-active {
  z-index: 6;
  border-color: color-mix(in srgb, var(--accent-color) 76%, var(--border-color));
}

.soc-template-preview-canvas__core.is-muted {
  opacity: 0.44;
}

.soc-template-preview-canvas__core.is-selected {
  z-index: 5;
  border-color: color-mix(in srgb, var(--accent-color) 95%, var(--border-color));
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--bg-primary) 24%, transparent), transparent),
    color-mix(in srgb, var(--accent-color) 28%, var(--bg-primary));
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--accent-color) 35%, transparent),
    0 10px 26px -14px color-mix(in srgb, var(--accent-color) 45%, transparent);
}

.soc-template-preview-canvas__core-label,
.soc-template-preview-canvas__core-id {
  display: block;
  width: 100%;
  text-align: center;
  pointer-events: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition:
    opacity 140ms ease,
    transform 140ms ease;
}

.soc-template-preview-canvas__core-label {
  font-size: 11px;
  font-weight: 800;
  line-height: 1.12;
}

.soc-template-preview-canvas__core-id {
  font-family: ui-monospace, 'Cascadia Code', 'SFMono-Regular', 'IBM Plex Mono', Menlo, monospace;
  font-size: 9px;
  font-weight: 800;
  line-height: 1;
  color: color-mix(in srgb, var(--text-secondary) 82%, var(--accent-color));
}

.soc-template-preview-canvas__align-marker {
  position: absolute;
  z-index: 2;
  display: block;
  border-radius: 3px;
  background: oklch(0.82 0.16 86);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--bg-primary) 65%, transparent),
    0 8px 18px -10px oklch(0.82 0.16 86 / 0.75);
  pointer-events: none;
}

.soc-template-preview-canvas__align-marker--left,
.soc-template-preview-canvas__align-marker--right {
  top: 10%;
  bottom: 10%;
  width: max(5px, min(18%, 10px));
}

.soc-template-preview-canvas__align-marker--left {
  left: -3px;
}

.soc-template-preview-canvas__align-marker--right {
  right: -3px;
}

.soc-template-preview-canvas__align-marker--top,
.soc-template-preview-canvas__align-marker--bottom {
  left: 10%;
  right: 10%;
  height: max(5px, min(18%, 10px));
}

.soc-template-preview-canvas__align-marker--top {
  top: -3px;
}

.soc-template-preview-canvas__align-marker--bottom {
  bottom: -3px;
}

.soc-template-preview-canvas--labels-hidden .soc-template-preview-canvas__core-label,
.soc-template-preview-canvas--labels-hidden .soc-template-preview-canvas__core-id,
.soc-template-preview-canvas--labels-hidden .soc-preview-die__io-label {
  opacity: 0;
  transform: translateY(2px);
}

.soc-template-preview-canvas__empty {
  position: absolute;
  left: 50%;
  top: 50%;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transform: translate(-50%, -50%);
  padding: 9px 12px;
  border-radius: 8px;
  border: 1px dashed color-mix(in srgb, var(--border-color) 92%, var(--accent-color));
  background: color-mix(in srgb, var(--bg-primary) 74%, var(--bg-secondary));
  color: var(--text-secondary);
  font-size: 12px;
}

.soc-template-preview-canvas__status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 42px;
  padding: 7px 9px 7px 11px;
  border: 1px solid color-mix(in srgb, var(--border-color) 84%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-secondary) 82%, var(--bg-primary));
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--bg-primary) 72%, transparent);
}

.soc-template-preview-canvas__status-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.soc-template-preview-canvas__status-main strong {
  display: block;
  max-width: min(50vw, 440px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: 1.22;
}

.soc-template-preview-canvas__status-grid {
  margin: 0;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(48px, max-content);
  gap: 6px;
  flex: 0 0 auto;
}

.soc-template-preview-canvas__status-grid div {
  min-width: 48px;
  padding: 5px 8px;
  border-radius: 7px;
  border: 1px solid color-mix(in srgb, var(--border-color) 78%, transparent);
  background: color-mix(in srgb, var(--bg-primary) 78%, var(--bg-secondary));
}

.soc-template-preview-canvas__status-grid dd {
  margin: 1px 0 0;
  font-family: ui-monospace, 'Cascadia Code', 'SFMono-Regular', 'IBM Plex Mono', Menlo, monospace;
  font-size: 12px;
  font-weight: 800;
  line-height: 1.1;
  color: var(--text-primary);
}

@media (prefers-reduced-motion: reduce) {
  .soc-template-preview-canvas__core,
  .soc-template-preview-canvas__toggle,
  .soc-preview-die__io,
  .soc-preview-die__io-box,
  .soc-template-preview-canvas__core-label,
  .soc-template-preview-canvas__core-id,
  .soc-preview-die__io-label {
    transition: none;
  }

  .soc-template-preview-canvas__core:hover,
  .soc-preview-die__io-pin:hover .soc-preview-die__io-box {
    transform: none;
  }
}

@media (max-width: 680px) {
  .soc-template-preview-canvas {
    min-height: 420px;
  }

  .soc-template-preview-canvas__toolbar,
  .soc-template-preview-canvas__status {
    align-items: stretch;
  }

  .soc-template-preview-canvas__toolbar {
    flex-direction: column;
  }

  .soc-template-preview-canvas__identity {
    width: 100%;
  }

  .soc-template-preview-canvas__identity-copy strong,
  .soc-template-preview-canvas__status-main strong {
    max-width: 100%;
  }

  .soc-template-preview-canvas__actions {
    width: 100%;
  }

  .soc-template-preview-canvas__toggle {
    flex: 1 1 0;
  }

  .soc-template-preview-canvas__status {
    flex-direction: column;
  }

  .soc-template-preview-canvas__status-grid {
    width: 100%;
    grid-auto-flow: initial;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
