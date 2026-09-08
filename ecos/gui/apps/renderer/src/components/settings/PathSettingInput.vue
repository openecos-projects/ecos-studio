<template>
  <div class="path-setting-input">
    <InputText
      v-model="draftValue"
      class="path-input"
      :placeholder="placeholder"
      spellcheck="false"
      @keydown.enter="commitDraft()"
    />
    <button class="browse-btn" type="button" @click="browse">{{ browseLabel }}</button>
    <button
      v-if="draftValue.trim() !== ''"
      class="clear-btn"
      type="button"
      title="Clear"
      @click="commitDraft('')"
    >
      <i class="ri-close-line" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import InputText from 'primevue/inputtext'
import type { DesktopSettingState } from '@ecos-studio/shared'
import { getOptionalDesktopApi } from '@/platform/desktop'

const props = defineProps<{
  entry: DesktopSettingState
}>()

const emit = defineEmits<{
  (e: 'commit', value: string): void
}>()

const draftValue = ref(props.entry.value ?? '')
/** The value this widget last acknowledged (initial or committed). */
const committedValue = ref(props.entry.value ?? '')
/** True while the user is typing something not yet acknowledged by a commit. */
const draftDirty = ref(false)

watch(draftValue, (value) => {
  // Dirty only while the user is typing something not yet acknowledged by
  // their own commit; once committed, authoritative updates may replace it.
  draftDirty.value = value !== committedValue.value && value !== (props.entry.value ?? '')
})

watch(
  () => props.entry,
  (entry) => {
    const incoming = entry.value ?? ''
    // An authoritative replace is adopted when the user has no pending edit —
    // or when it matches exactly what the user typed (their write accepted) —
    // so slow validations and cross-window updates are never lost.
    if (!draftDirty.value || incoming === draftValue.value) {
      draftValue.value = incoming
      committedValue.value = incoming
    }
  },
)

const isDirectory = computed(() => props.entry.descriptor.valueType === 'directoryPath')
const browseLabel = computed(() => (isDirectory.value ? 'Browse…' : 'Browse…'))
const placeholder = computed(() =>
  isDirectory.value ? 'Enter a directory path' : 'Enter an executable path',
)

function commitDraft(value?: string): void {
  const next = (value ?? draftValue.value).trim()
  draftValue.value = next
  if (next === (props.entry.value ?? '')) return
  committedValue.value = next
  emit('commit', next)
}

async function browse(): Promise<void> {
  const desktopApi = getOptionalDesktopApi()
  if (!desktopApi) return
  const picked = isDirectory.value
    ? await desktopApi.dialog.pickDirectory({
        title: props.entry.descriptor.title,
      })
    : ((
        await desktopApi.dialog.pickFiles({ title: props.entry.descriptor.title })
      )?.[0] ?? null)
  if (!picked) return
  draftValue.value = picked
  commitDraft(picked)
}
</script>

<style scoped>
.path-setting-input {
  align-items: center;
  display: flex;
  gap: 0.5rem;
  min-width: 0;
}

.path-input {
  flex: 1 1 auto;
  font-family: var(--font-mono, monospace);
  min-width: 0;
}

.browse-btn,
.clear-btn {
  align-items: center;
  background: var(--p-content-background, transparent);
  border: 1px solid var(--p-content-border-color, rgba(128, 128, 128, 0.4));
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex;
  padding: 0.35rem 0.7rem;
}

.browse-btn:hover,
.clear-btn:hover {
  background: var(--p-content-hover-background, rgba(128, 128, 128, 0.12));
}
</style>
