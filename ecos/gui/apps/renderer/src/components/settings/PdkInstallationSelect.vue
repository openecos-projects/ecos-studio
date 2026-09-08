<template>
  <select
    class="pdk-installation-select"
    :value="props.entry.value ?? ''"
    @change="onSelect"
  >
    <option value="">No default</option>
    <option
      v-for="installation in installations"
      :key="installation.id"
      :value="installation.id"
    >
      {{ installation.displayName
      }}{{ installation.version ? ` (${installation.version})` : '' }}
    </option>
  </select>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { DesktopSettingState, PdkInstallationSnapshot } from '@ecos-studio/shared'
import { getOptionalDesktopApi } from '@/platform/desktop'

const props = defineProps<{
  entry: DesktopSettingState
}>()

const emit = defineEmits<{
  (e: 'commit', value: string): void
}>()

const installations = ref<PdkInstallationSnapshot[]>([])

onMounted(async () => {
  const desktopApi = getOptionalDesktopApi()
  if (!desktopApi) return
  try {
    installations.value = await desktopApi.pdkInventory.list()
  } catch {
    installations.value = []
  }
})

function onSelect(event: Event): void {
  emit('commit', (event.target as HTMLSelectElement).value)
}
</script>

<style scoped>
.pdk-installation-select {
  background: var(--p-content-background, transparent);
  border: 1px solid var(--p-content-border-color, rgba(128, 128, 128, 0.4));
  border-radius: 6px;
  color: inherit;
  min-width: 16rem;
  padding: 0.35rem 0.5rem;
}
</style>
