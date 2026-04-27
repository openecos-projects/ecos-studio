<!-- ecos/gui/src/components/AboutDialog.vue -->
<template>
  <Dialog
    v-model:visible="visible"
    modal
    header="About ECOS Studio"
    :style="{ width: '420px' }"
    :contentStyle="{ padding: '24px' }"
    :closable="true"
    :draggable="false"
    class="about-dialog"
    :pt="{
      mask: { class: 'about-dialog-mask' },
      header: { class: 'about-dialog-header' },
      headerActions: { class: 'about-dialog-close' },
    }"
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

<style>
/* PrimeVue Dialog teleports to <body>, so scoped styles can't reach it */
.about-dialog.p-dialog {
  background: var(--bg-primary) !important;
  color: var(--text-primary) !important;
  border: 1px solid var(--border-color) !important;
  border-radius: 12px !important;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.06),
    0 16px 48px rgba(0, 0, 0, 0.5) !important;
}

.about-dialog .p-dialog-header {
  color: var(--text-primary);
  padding: 20px 24px 8px !important;
}

.about-dialog .p-dialog-content {
  background: transparent;
}

.about-dialog .about-dialog-close {
  position: absolute;
  top: 8px;
  right: 8px;
}

.about-dialog .p-dialog-close-button {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 50%;
  width: 24px;
  height: 24px;
  color: var(--text-secondary);
}

.about-dialog .p-dialog-close-button:hover {
  color: var(--text-primary);
  background: var(--border-color);
}

.about-dialog-mask.p-dialog-mask,
.about-dialog-mask.p-overlay-mask {
  background: rgba(0, 0, 0, 0.45) !important;
  backdrop-filter: blur(12px) !important;
  -webkit-backdrop-filter: blur(12px) !important;
}
</style>

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
