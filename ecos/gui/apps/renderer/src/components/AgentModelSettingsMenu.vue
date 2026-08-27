<template>
  <div ref="rootRef" class="model-settings" @keydown.esc.stop.prevent="close">
    <button
      ref="triggerRef"
      type="button"
      class="model-settings__trigger"
      :aria-expanded="open"
      aria-haspopup="dialog"
      :disabled="disabled || !settings"
      :title="triggerLabel"
      @click="toggle"
    >
      <span class="model-settings__model">{{ compactModelName }}</span>
      <span v-if="settings" class="model-settings__effort">{{ effortLabel }}</span>
      <i class="ri-arrow-up-s-line" aria-hidden="true"></i>
    </button>

    <div
      v-if="open"
      class="model-settings__popover"
      role="dialog"
      aria-label="Agent model settings"
    >
      <div
        v-for="section in sections"
        :key="section.key"
        class="model-settings__entry"
        @pointerenter="showFlyout(section.key, $event)"
        @focusin="showFlyout(section.key, $event)"
      >
        <button
          type="button"
          class="model-settings__row"
          aria-haspopup="menu"
          :aria-expanded="activeFlyout === section.key"
          @click="openFlyout(section.key, $event)"
        >
          <span>{{ section.label }}</span>
          <strong>{{ section.current }}</strong>
          <i class="ri-arrow-right-s-line" aria-hidden="true"></i>
        </button>
      </div>

      <p v-if="error" class="model-settings__error" role="status">{{ error }}</p>
    </div>

    <Teleport to="body">
      <div
        v-if="activeSection"
        ref="flyoutRef"
        class="model-settings__flyout"
        :class="`model-settings__flyout--${activeSection.key}`"
        :style="flyoutStyle"
        role="menu"
        :aria-label="activeSection.label"
        @keydown.esc.stop.prevent="close"
      >
        <button
          v-for="option in activeSection.options"
          :key="option.value"
          type="button"
          class="model-settings__option"
          role="menuitemradio"
          :aria-checked="option.selected"
          :disabled="busy"
          @click="select(option.value)"
        >
          <i
            :class="option.selected ? 'ri-check-line' : 'model-settings__check-space'"
            aria-hidden="true"
          ></i>
          <span>{{ option.label }}</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import type {
  DesktopAgentModelSettings,
  DesktopAgentReasoningEffort,
  DesktopAgentSetModelSettingsRequest,
} from '@ecos-studio/shared'

const props = defineProps<{
  busy?: boolean
  disabled?: boolean
  error?: string
  settings?: DesktopAgentModelSettings
}>()
const emit = defineEmits<{
  update: [
    settings: Pick<DesktopAgentSetModelSettingsRequest, 'model' | 'reasoningEffort'>,
  ]
}>()

const rootRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
const flyoutRef = ref<HTMLElement | null>(null)
const open = ref(false)
const activeFlyout = ref<'model' | 'effort' | null>(null)
const flyoutStyle = ref<{
  left: string
  top: string
  visibility: 'hidden' | 'visible'
}>({ left: '0px', top: '0px', visibility: 'hidden' })
const effortNames: Record<DesktopAgentReasoningEffort, string> = {
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
}
const effortLabel = computed(() =>
  props.settings ? effortNames[props.settings.reasoningEffort] : '',
)
const compactModelName = computed(() => props.settings?.displayName ?? 'Model')
const triggerLabel = computed(() =>
  props.settings
    ? `${props.settings.displayName}, ${effortLabel.value} reasoning`
    : 'Model settings unavailable',
)
const currentModel = computed(() =>
  props.settings?.models.find((model) => model.model === props.settings?.model),
)
const sections = computed(() => [
  {
    current: props.settings?.displayName ?? '',
    key: 'model' as const,
    label: 'Model',
    options: (props.settings?.models ?? []).map((model) => ({
      label: model.displayName,
      selected: model.model === props.settings?.model,
      value: model.model,
    })),
  },
  {
    current: effortLabel.value,
    key: 'effort' as const,
    label: 'Reasoning',
    options: (currentModel.value?.supportedReasoningEfforts ?? []).map((effort) => ({
      label: effortNames[effort],
      selected: effort === props.settings?.reasoningEffort,
      value: effort,
    })),
  },
])
const activeSection = computed(() =>
  sections.value.find((section) => section.key === activeFlyout.value),
)

async function showFlyout(key: 'model' | 'effort', event: Event): Promise<void> {
  const anchor = event.currentTarget as HTMLElement
  const anchorRect = anchor.getBoundingClientRect()
  activeFlyout.value = key
  flyoutStyle.value = { left: '0px', top: '0px', visibility: 'hidden' }
  await nextTick()
  if (activeFlyout.value !== key || !flyoutRef.value) return
  const gap = 6
  const margin = 12
  const width = flyoutRef.value.offsetWidth
  const height = flyoutRef.value.offsetHeight
  let left = anchorRect.left - width - gap
  if (left < margin) left = anchorRect.right + gap
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin))
  const top = Math.max(
    margin,
    Math.min(anchorRect.top - 4, window.innerHeight - height - margin),
  )
  flyoutStyle.value = { left: `${left}px`, top: `${top}px`, visibility: 'visible' }
}

async function openFlyout(key: 'model' | 'effort', event: Event): Promise<void> {
  await showFlyout(key, event)
  flyoutRef.value?.querySelector<HTMLButtonElement>('.model-settings__option')?.focus()
}

function toggle(): void {
  open.value = !open.value
  activeFlyout.value = null
}

function close(): void {
  open.value = false
  activeFlyout.value = null
  triggerRef.value?.focus()
}

function select(value: string): void {
  if (activeFlyout.value === 'model') emit('update', { model: value })
  else emit('update', { reasoningEffort: value as DesktopAgentReasoningEffort })
  close()
}

function onDocumentPointerDown(event: PointerEvent): void {
  const target = event.target as Node
  if (
    open.value &&
    !rootRef.value?.contains(target) &&
    !flyoutRef.value?.contains(target)
  ) {
    close()
  }
}

onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown))
onUnmounted(() => document.removeEventListener('pointerdown', onDocumentPointerDown))
</script>

<style scoped>
.model-settings {
  position: relative;
  min-width: 0;
  margin-left: auto;
}

.model-settings__trigger {
  display: inline-flex;
  max-width: 15rem;
  height: 1.75rem;
  align-items: center;
  gap: 0.3rem;
  padding: 0 0.45rem;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 0.6875rem;
  cursor: pointer;
}

.model-settings__trigger:hover:not(:disabled),
.model-settings__trigger[aria-expanded='true'] {
  background: color-mix(in srgb, var(--bg-secondary) 75%, transparent);
  color: var(--text-primary);
}

.model-settings__trigger:focus-visible,
.model-settings__row:focus-visible,
.model-settings__option:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-color) 55%, transparent);
  outline-offset: 1px;
}

.model-settings__trigger:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.model-settings__model {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-settings__effort {
  flex: 0 0 auto;
}

.model-settings__popover {
  position: absolute;
  right: 0;
  bottom: calc(100% + 0.55rem);
  z-index: 20;
  width: min(18rem, calc(100vw - 3rem));
  padding: 0.3rem;
  border: 1px solid var(--border-color);
  border-radius: 1.25rem;
  background: var(--bg-secondary);
  box-shadow: 0 0.75rem 2rem color-mix(in srgb, var(--text-primary) 16%, transparent);
}

.model-settings__row,
.model-settings__option {
  display: grid;
  width: 100%;
  min-height: 2rem;
  align-items: center;
  border: 0;
  border-radius: 0.9rem;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 0.75rem;
  text-align: left;
  cursor: pointer;
}

.model-settings__entry {
  position: relative;
}

.model-settings__row {
  grid-template-columns: minmax(0, 1fr) auto 1rem;
  gap: 0.5rem;
  padding: 0 0.5rem;
}

.model-settings__row strong {
  color: var(--text-secondary);
  font-weight: 500;
}

.model-settings__option {
  grid-template-columns: 1rem minmax(0, 1fr);
  gap: 0.4rem;
  padding: 0 0.5rem;
}

.model-settings__row:hover,
.model-settings__row[aria-expanded='true'],
.model-settings__option:hover:not(:disabled) {
  background: color-mix(in srgb, var(--bg-tertiary) 70%, var(--bg-primary));
}

.model-settings__option:disabled {
  cursor: wait;
  opacity: 0.6;
}

.model-settings__check-space {
  width: 1rem;
}

.model-settings__flyout {
  position: fixed;
  z-index: 1000;
  max-height: 18rem;
  overflow-y: auto;
  padding: 0.35rem;
  border: 1px solid var(--border-color);
  border-radius: 1.25rem;
  background: var(--bg-secondary);
  box-shadow: 0 0.75rem 2rem color-mix(in srgb, var(--text-primary) 16%, transparent);
}

.model-settings__flyout--model {
  width: min(22rem, calc(100vw - 3rem));
}

.model-settings__flyout--effort {
  width: min(15rem, calc(100vw - 3rem));
}

.model-settings__error {
  margin: 0.3rem 0.45rem 0.2rem;
  color: var(--danger-color);
  font-size: 0.6875rem;
  line-height: 1.4;
}

@media (max-width: 640px) {
  .model-settings__trigger {
    max-width: 10rem;
  }
}
</style>
