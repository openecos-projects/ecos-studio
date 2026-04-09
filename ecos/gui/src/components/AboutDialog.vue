<!-- ecos/gui/src/components/AboutDialog.vue -->
<template>
  <Dialog
    v-model:visible="visible"
    modal
    header="About ECOS Studio"
    :style="{ width: '420px' }"
    :closable="true"
    :draggable="false"
  >
    <div class="about-content">
      <p class="about-description">
        An integrated, open-source, RTL-to-Chip silicon design solution.
      </p>

      <table class="version-table">
        <tbody>
          <tr v-for="(label, key) in componentLabels" :key="key">
            <td class="label-cell">{{ label }}</td>
            <td class="version-cell">{{ versionText(key) }}</td>
          </tr>
        </tbody>
      </table>

      <button class="copy-btn" @click="copyVersions">
        <i class="ri-file-copy-line" />
        {{ copied ? 'Copied' : 'Copy version info' }}
      </button>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Dialog from 'primevue/dialog'
import { useVersion } from '@/composables/useVersion'

const visible = defineModel<boolean>({ required: true })
const { versions } = useVersion()

const componentLabels: Record<string, string> = {
  gui: 'GUI',
  server: 'Server',
  ecc: 'ECC-Tools',
  dreamplace: 'ECC-DreamPlace',
}

function versionText(key: string): string {
  return versions.value?.[key as keyof typeof versions.value] ?? 'unknown'
}

const copied = ref(false)
async function copyVersions(): Promise<void> {
  const lines = Object.entries(componentLabels)
    .map(([key, label]) => `${label}: ${versionText(key)}`)
    .join('\n')
  const text = `ECOS Studio\n${lines}`
  await navigator.clipboard.writeText(text)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}
</script>

<style scoped>
.about-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.about-description {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
}

.version-table {
  width: 100%;
  border-collapse: collapse;
}

.version-table td {
  padding: 6px 0;
  font-size: 13px;
}

.label-cell {
  color: var(--text-secondary);
  width: 130px;
}

.version-cell {
  color: var(--text-primary);
  font-family: monospace;
}

.copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  align-self: flex-start;
}

.copy-btn:hover {
  background: var(--bg-primary);
  color: var(--text-primary);
}
</style>
